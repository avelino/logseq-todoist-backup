import type { BlockEntity, BlockUUIDTuple, IBatchBlock } from "@logseq/libs/dist/LSPlugin";

import {
  BACKLOG_PAGE_SUFFIX,
  PLACEHOLDER_CONTENT,
  TODOIST_COMMENT_ID_PROPERTY,
  TODOIST_COMMENTS_PROPERTY,
  TODOIST_COMMENT_POSTED_PROPERTY,
  TODOIST_COMPLETED_PROPERTY,
  TODOIST_DUE_PROPERTY,
  TODOIST_ID_PROPERTY,
  TODOIST_STATUS_PROPERTY,
} from "./constants";
import {
  formatDue,
  formatLabelTag,
  safeLinkText,
  safeText,
  dueTimestamp,
  convertInlineTodoistLabels,
  TodoistBackupTask,
  TodoistComment,
} from "./todoist";
import { type StatusAliases, statusToAlias, aliasToStatus } from "./settings";

type CommentWrapperBlock = IBatchBlock;

type TaskWithBlock = {
  task: TodoistBackupTask;
  block: IBatchBlock;
};

/**
 * Determines the destination page name for a task based on its date.
 * Uses due date for active tasks, completion date for completed tasks,
 * or Backlog for tasks without dates.
 *
 * @param task Todoist task to determine page for.
 * @param pagePrefix Base page name prefix from settings (e.g., "todoist").
 */
export function resolveTaskPageName(task: TodoistBackupTask, pagePrefix: string): string {
  // For completed tasks, use completion date
  if (task.completed) {
    const completedDate = task.completed_date ?? task.completed_at;
    if (completedDate) {
      const normalized = formatCompletedDate(completedDate);
      if (normalized) {
        return `${pagePrefix}/${normalized}`;
      }
    }
  }

  // For active tasks, use due date
  const dueFormatted = formatDue(task.due);
  if (dueFormatted) {
    return `${pagePrefix}/${dueFormatted}`;
  }

  // Fallback to any existing due date
  const fallback = task.fallbackDue;
  if (fallback) {
    const sanitized = safeText(fallback);
    if (sanitized && /^\d{4}-\d{2}-\d{2}$/.test(sanitized)) {
      return `${pagePrefix}/${sanitized}`;
    }
  }

  // No date found, use Backlog
  return `${pagePrefix}/${BACKLOG_PAGE_SUFFIX}`;
}

/**
 * Groups tasks by date and writes them to separate journal-style pages.
 *
 * @param pagePrefix Base page name prefix from settings (e.g., "todoist").
 * @param tasks Tasks with their corresponding block data.
 * @param projectMap Mapping of project ids to names.
 * @param labelMap Mapping of label ids or names to normalized names.
 * @param statusAliases Status alias configuration from settings.
 */
export async function writeBlocks(
  pagePrefix: string,
  tasks: TodoistBackupTask[],
  projectMap: Map<string, string>,
  labelMap: Map<string, string>,
  statusAliases: StatusAliases
) {
  // Group tasks by their destination page
  const tasksByPage = new Map<string, TaskWithBlock[]>();

  for (const task of tasks) {
    const pageName = resolveTaskPageName(task, pagePrefix);
    const block: IBatchBlock = {
      content: blockContent(task, projectMap, labelMap, statusAliases),
      children: buildCommentBlocks(task),
    };

    if (!tasksByPage.has(pageName)) {
      tasksByPage.set(pageName, []);
    }
    tasksByPage.get(pageName)!.push({ task, block });
  }

  // Write blocks to each page
  for (const [pageName, tasksWithBlocks] of tasksByPage.entries()) {
    const blocks = tasksWithBlocks.map((t) => t.block);
    await writeBlocksToPage(pageName, blocks, statusAliases);
  }

  // Clean up empty pages that may have had tasks moved
  await cleanupObsoletePages(pagePrefix, tasksByPage, statusAliases);
}

/**
 * Writes blocks to a specific Logseq page, updating or creating blocks as needed.
 *
 * @param pageName Destination page for the blocks.
 * @param blocks Collection of blocks to write.
 * @param statusAliases Status alias configuration from settings.
 */
async function writeBlocksToPage(pageName: string, blocks: IBatchBlock[], statusAliases: StatusAliases) {
  let page = await logseq.Editor.getPage(pageName);
  if (!page) {
    await logseq.Editor.createPage(pageName, {}, { createFirstBlock: true, redirect: false });
    page = await logseq.Editor.getPage(pageName);
  }

  if (!page) {
    throw new Error(`Failed to create or retrieve page "${pageName}".`);
  }

  const existingBlocks = await logseq.Editor.getPageBlocksTree(page.uuid);
  const blockMap = buildBlockMap(existingBlocks ?? []);

  const seenIds = new Set<string>();
  for (const block of blocks) {
    const todoistId = extractTodoistId(block.content);
    if (!todoistId) continue;

    let formatted = block.content;
    const existing = blockMap.get(todoistId);
    let targetUuid: string | undefined;
    if (existing) {
      const existingDue = extractTodoistDue(existing.content ?? "");
      if (existingDue && !hasDueProperty(formatted)) {
        formatted = applyDueFallback(formatted, existingDue);
      }

      await logseq.Editor.updateBlock(existing.uuid, formatted);
      targetUuid = existing.uuid;
    } else {
      const created = await logseq.Editor.appendBlockInPage(page.uuid, formatted);
      if (created) {
        blockMap.set(todoistId, created);
        targetUuid = created.uuid;
      }
    }

    seenIds.add(todoistId);

    if (targetUuid) {
      const children = block.children ?? [];
      await syncComments(targetUuid, children);
    }
  }

  const obsoleteBlocks = [...blockMap.entries()].filter(([id]) => !seenIds.has(id));
  for (const [, entity] of obsoleteBlocks) {
    const content = entity.content ?? "";
    const status = extractTodoistStatus(content, statusAliases);
    if (status === "completed") {
      continue;
    }
    if (!status && hasCompletedProperty(content)) {
      continue;
    }
    await logseq.Editor.removeBlock(entity.uuid);
  }

  if (blocks.length === 0 && blockMap.size === 0) {
    await logseq.Editor.appendBlockInPage(page.uuid, PLACEHOLDER_CONTENT);
  }
}

/**
 * Removes tasks from old pages when they've been moved to different dates.
 * Searches for Todoist tasks in pages matching the prefix pattern.
 *
 * @param pagePrefix Base page name prefix.
 * @param currentTasksByPage Map of current page names to their tasks.
 * @param statusAliases Status alias configuration from settings.
 */
async function cleanupObsoletePages(
  pagePrefix: string,
  currentTasksByPage: Map<string, TaskWithBlock[]>,
  statusAliases: StatusAliases
) {
  // Collect all current task IDs
  const currentTaskIds = new Set<string>();
  for (const tasksWithBlocks of currentTasksByPage.values()) {
    for (const { task } of tasksWithBlocks) {
      currentTaskIds.add(String(task.id));
    }
  }

  // Search for pages with the prefix pattern
  const allPages = await logseq.Editor.getAllPages();
  if (!allPages) {
    return;
  }

  for (const page of allPages) {
    const pageName = page.originalName ?? page.name;
    if (!pageName.startsWith(`${pagePrefix}/`)) {
      continue;
    }

    // Skip pages that are in current sync
    if (currentTasksByPage.has(pageName)) {
      continue;
    }

    // Check blocks on this page
    const existingBlocks = await logseq.Editor.getPageBlocksTree(page.uuid);
    if (!existingBlocks || existingBlocks.length === 0) {
      continue;
    }

    const blockMap = buildBlockMap(existingBlocks);
    for (const [todoistId, entity] of blockMap.entries()) {
      // Remove if task no longer exists in current sync
      if (!currentTaskIds.has(todoistId)) {
        const content = entity.content ?? "";
        const status = extractTodoistStatus(content, statusAliases);
        if (status === "completed") {
          continue;
        }
        if (!status && hasCompletedProperty(content)) {
          continue;
        }
        await logseq.Editor.removeBlock(entity.uuid);
      }
    }
  }
}

/**
 * Builds block payloads for a set of Todoist tasks, including comments.
 *
 * @param tasks Tasks returned from Todoist ready for serialization.
 * @param projectMap Mapping of project ids to names.
 * @param labelMap Mapping of label ids or names to normalized names.
 * @param statusAliases Status alias configuration from settings.
 */
export function buildBlocks(
  tasks: TodoistBackupTask[],
  projectMap: Map<string, string>,
  labelMap: Map<string, string>,
  statusAliases: StatusAliases
): IBatchBlock[] {
  const sorted = [...tasks].sort((a, b) => {
    const aCompleted = Boolean(a.completed);
    const bCompleted = Boolean(b.completed);
    if (aCompleted !== bCompleted) {
      return aCompleted ? 1 : -1;
    }
    const aTime = dueTimestamp(a.due);
    const bTime = dueTimestamp(b.due);
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return safeText(a.content).localeCompare(safeText(b.content));
  });

  return sorted.map((task) => ({
    content: blockContent(task, projectMap, labelMap, statusAliases),
    children: buildCommentBlocks(task),
  }));
}

/**
 * Generates the main block content for a Todoist task, including properties.
 *
 * @param task Todoist task with optional completion metadata.
 * @param projectMap Mapping of project ids to names.
 * @param labelMap Mapping of label ids or names to normalized names.
 * @param statusAliases Status alias configuration from settings.
 */
export function blockContent(
  task: TodoistBackupTask,
  projectMap: Map<string, string>,
  labelMap: Map<string, string>,
  statusAliases: StatusAliases
) {
  const dueText = resolvePrimaryDate(task);
  const rawTitle = safeLinkText(safeText(task.content) || "Untitled task");
  const taskTitle = convertInlineTodoistLabels(rawTitle);
  const projectName = projectMap.get(String(task.project_id ?? "")) ?? "Inbox";
  const labels = resolveLabels(task, labelMap);
  const url = task.url ?? `https://todoist.com/showTask?id=${task.id}`;

  const dateLogseqFormat = dueText ? `[[${dueText}]]` : "[[No due date]]";
  const taskTitleLogseqFormat = `${taskTitle}`;

  const properties = [`todoist-id:: [${task.id}](${url})`, `todoist-project:: #${projectName}`];

  const duePropertyValue = resolveDuePropertyValue(task);
  if (duePropertyValue) {
    properties.push(`${TODOIST_DUE_PROPERTY}:: ${duePropertyValue}`);
  }

  const description = safeText(task.description ?? "");
  if (description) {
    properties.push(`todoist-desc:: ${description}`);
  }

  const labelsProperty = labels
    .map((label) => {
      const tag = formatLabelTag(label);
      return tag.startsWith("#") ? tag : `#${tag}`;
    })
    .filter((value) => value.length > 0)
    .join(" ");

  if (labelsProperty) {
    properties.push(`todoist-labels:: ${labelsProperty}`);
  }

  if (task.completed) {
    const completedDate = task.completed_date ?? task.completed_at ?? "";
    const formatted = formatCompletedDate(completedDate);
    const completedValue = formatted ? `[[${formatted}]]` : completedDate ? safeLinkText(completedDate) : "";
    if (completedValue) {
      properties.push(`${TODOIST_COMPLETED_PROPERTY}:: ${completedValue}`);
    }
  }

  const canonicalStatus = task.status ?? (task.completed ? "completed" : "active");
  const statusValue = statusToAlias(canonicalStatus, statusAliases);
  properties.push(`${TODOIST_STATUS_PROPERTY}:: ${statusValue}`);

  return [`${dateLogseqFormat} ${taskTitleLogseqFormat}`, ...properties].join("\n");
}

/**
 * Creates child blocks containing Todoist comments for a task.
 *
 * @param task Todoist task enriched with comment data.
 */
function buildCommentBlocks(task: TodoistBackupTask): CommentWrapperBlock[] {
  const comments = task.comments ?? [];
  if (comments.length === 0) {
    return [];
  }

  const sorted = [...comments].sort((a, b) => {
    const aTime = commentTimestamp(a.posted_at);
    const bTime = commentTimestamp(b.posted_at);
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  const wrapper: CommentWrapperBlock = {
    content: buildCommentWrapperContent(sorted.length),
    children: sorted.map((comment) => ({
      content: commentContent(task, comment),
    })),
  };

  return [wrapper];
}

/**
 * Builds the wrapper block content for the Todoist comments section.
 *
 * @param commentCount Total number of comments attached to the task.
 */
function buildCommentWrapperContent(commentCount: number) {
  return ["comments...", `${TODOIST_COMMENTS_PROPERTY}:: ${commentCount}`].join("\n");
}

/**
 * Builds the markdown content for a single Todoist comment block.
 *
 * @param task Owning Todoist task used to resolve fallback ids.
 * @param comment Comment information returned from Todoist.
 */
function commentContent(task: TodoistBackupTask, comment: TodoistComment) {
  const sanitizedText = safeText(comment.content);
  const formattedText = sanitizedText ? safeLinkText(sanitizedText) : "";
  const url = buildCommentUrl(task, comment);
  const prefix = `[todoist](${url})`;
  const commentLine = formattedText ? `${prefix} ${formattedText}` : prefix;
  const lines = [commentLine, `${TODOIST_COMMENT_ID_PROPERTY}:: ${comment.id}`];
  if (comment.posted_at) {
    const formatted = formatCommentTimestamp(comment.posted_at);
    lines.push(`${TODOIST_COMMENT_POSTED_PROPERTY}:: ${formatted}`);
  }
  return lines.join("\n");
}

/**
 * Composes a direct Todoist URL pointing to a specific comment.
 *
 * @param task Owning Todoist task used as fallback for missing ids.
 * @param comment Todoist comment metadata.
 */
function buildCommentUrl(task: TodoistBackupTask, comment: TodoistComment) {
  const taskId = String(comment.task_id ?? task.id);
  return `https://todoist.com/app/task/${taskId}/comment/${comment.id}`;
}

/**
 * Normalizes comment timestamps to ISO strings when possible.
 *
 * @param value Timestamp string returned by Todoist.
 */
function formatCommentTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return safeText(value);
  }
  return parsed.toISOString();
}

/**
 * Synchronizes comment wrapper blocks for a given parent block.
 *
 * @param parentUuid Parent block uuid receiving comment children.
 * @param children Prepared comment blocks to insert.
 */
async function syncComments(parentUuid: string, children: IBatchBlock[]) {
  const existing = await logseq.Editor.getBlock(parentUuid, { includeChildren: true });
  if (existing && existing.children) {
    for (const child of existing.children) {
      if (!isBlockEntity(child)) {
        continue;
      }
      if (isCommentWrapper(child.content ?? "")) {
        await logseq.Editor.removeBlock(child.uuid);
      }
    }
  }

  if (children.length > 0) {
    await logseq.Editor.insertBatchBlock(parentUuid, children, {
      sibling: false,
    });
  }
}

/**
 * Type guard ensuring a value is a Logseq block entity.
 */
function isBlockEntity(value: BlockEntity | BlockUUIDTuple | undefined): value is BlockEntity {
  return Boolean(value && typeof value === "object" && "uuid" in value);
}

/**
 * Detects blocks representing the Todoist comments wrapper.
 */
function isCommentWrapper(content: string) {
  return new RegExp(`(?:^|\n)${TODOIST_COMMENTS_PROPERTY}::`, "m").test(content);
}

/**
 * Converts comment timestamps to sortable numeric values.
 */
function commentTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * Determines the primary date string to display for a task block.
 */
function resolvePrimaryDate(task: TodoistBackupTask) {
  const dueFormatted = formatDue(task.due);
  if (dueFormatted) {
    return safeLinkText(dueFormatted);
  }
  const fallback = task.fallbackDue ?? "";
  if (fallback) {
    return safeLinkText(fallback);
  }

  if (task.completed) {
    const completedFormatted = formatCompletedDate(task.completed_date ?? task.completed_at ?? "");
    if (completedFormatted) {
      return safeLinkText(completedFormatted);
    }
  }

  return "";
}

/**
 * Builds the property value for the Todoist due date when available.
 */
function resolveDuePropertyValue(task: TodoistBackupTask) {
  const explicitDue = formatDue(task.due);
  if (explicitDue) {
    return explicitDue;
  }
  return undefined;
}

/**
 * Formats Todoist completion dates to `YYYY-MM-DD` when valid.
 */
function formatCompletedDate(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

/**
 * Extracts the Todoist task identifier from block content.
 */
export function extractTodoistId(content: string) {
  const match = content.match(new RegExp(`^${TODOIST_ID_PROPERTY}::\\s*(.+)$`, "mi"));
  return match ? match[1].trim() : undefined;
}

/**
 * Reads the persisted Todoist status property from block content.
 *
 * @param content Block content to extract status from.
 * @param statusAliases Status alias configuration from settings.
 */
function extractTodoistStatus(
  content: string,
  statusAliases: StatusAliases
): TodoistBackupTask["status"] | undefined {
  const match = content.match(new RegExp(`^${TODOIST_STATUS_PROPERTY}::\\s*(.+)$`, "mi"));
  if (!match) {
    return undefined;
  }
  const value = match[1].trim();
  return aliasToStatus(value, statusAliases);
}

/**
 * Checks whether a block contains the Todoist completion property.
 */
function hasCompletedProperty(content: string) {
  return new RegExp(`^${TODOIST_COMPLETED_PROPERTY}::\\s*(.+)$`, "mi").test(content);
}

/**
 * Retrieves the Todoist due property value from block content.
 */
function extractTodoistDue(content: string) {
  const match = content.match(new RegExp(`^${TODOIST_DUE_PROPERTY}::\\s*(.+)$`, "mi"));
  return match ? sanitizeDueValue(match[1]) : undefined;
}

/**
 * Injects or replaces due information when blocks lack explicit due data.
 */
function applyDueFallback(content: string, dueValue: string) {
  const normalized = sanitizeDueValue(dueValue);
  if (!normalized) {
    return content;
  }

  const lines = content.split("\n");
  if (lines.length === 0) {
    return content;
  }

  const placeholder = "[[No due date]]";
  if (lines[0].includes(placeholder)) {
    lines[0] = lines[0].replace(placeholder, `[[${normalized}]]`);
  }

  const dueLine = `${TODOIST_DUE_PROPERTY}:: ${normalized}`;
  const dueRegex = new RegExp(`^${TODOIST_DUE_PROPERTY}::`, "i");
  const existingDueIndex = lines.findIndex((line) => dueRegex.test(line));
  if (existingDueIndex !== -1) {
    lines[existingDueIndex] = dueLine;
  } else {
    const projectIndex = lines.findIndex((line) => line.startsWith("todoist-project::"));
    const insertIndex = projectIndex !== -1 ? projectIndex + 1 : 1;
    lines.splice(insertIndex, 0, dueLine);
  }

  return lines.join("\n");
}

/**
 * Normalizes due strings by trimming and removing Logseq wrappers.
 */
function sanitizeDueValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const trimmed = safeText(value);
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
    return trimmed.slice(2, -2).trim();
  }
  return trimmed;
}

/**
 * Determines whether a block already includes the Todoist due property.
 */
function hasDueProperty(content: string) {
  return new RegExp(`^${TODOIST_DUE_PROPERTY}::`, "i").test(content);
}

/**
 * Builds a map of Todoist ids to existing Logseq block entities.
 */
export function buildBlockMap(tree: BlockEntity[]) {
  const map = new Map<string, BlockEntity>();
  for (const block of tree) {
    const content = block.content ?? "";
    const id = extractTodoistId(content);
    if (id) {
      map.set(id, block);
    }
  }
  return map;
}

/**
 * Resolves label names for a task using the provided label map.
 */
function resolveLabels(task: TodoistBackupTask, labelMap: Map<string, string>) {
  const values = task.labels ?? task.label_ids ?? [];
  const names: string[] = [];
  for (const value of values ?? []) {
    const key = String(value);
    const name = labelMap.get(key) ?? key;
    const normalized = safeText(name);
    if (normalized && !names.includes(normalized)) {
      names.push(normalized);
    }
  }
  return names;
}
