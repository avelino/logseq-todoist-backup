import type { BlockEntity, BlockUUIDTuple, IBatchBlock } from "@logseq/libs/dist/LSPlugin";

import {
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
  TodoistBackupTask,
  TodoistComment,
} from "./todoist";

export async function writeBlocks(pageName: string, blocks: IBatchBlock[]) {
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
      await syncComments(targetUuid, block.children ?? []);
    }
  }

  const obsoleteBlocks = [...blockMap.entries()].filter(([id]) => !seenIds.has(id));
  for (const [, entity] of obsoleteBlocks) {
    const content = entity.content ?? "";
    const status = extractTodoistStatus(content);
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

export function buildBlocks(
  tasks: TodoistBackupTask[],
  projectMap: Map<string, string>,
  labelMap: Map<string, string>
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
    content: blockContent(task, projectMap, labelMap),
    children: buildCommentBlocks(task),
  }));
}

export function blockContent(
  task: TodoistBackupTask,
  projectMap: Map<string, string>,
  labelMap: Map<string, string>
) {
  const dueText = resolvePrimaryDate(task);
  const taskTitle = safeLinkText(safeText(task.content) || "Untitled task");
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

  const statusValue = task.status ?? (task.completed ? "completed" : "active");
  properties.push(`${TODOIST_STATUS_PROPERTY}:: ${statusValue}`);

  return [`${dateLogseqFormat} ${taskTitleLogseqFormat}`, ...properties].join("\n");
}

function buildCommentBlocks(task: TodoistBackupTask): IBatchBlock[] {
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

  return [
    {
      content: `${TODOIST_COMMENTS_PROPERTY}:: ${sorted.length}`,
      children: sorted.map((comment) => ({
        content: commentContent(task, comment),
      })),
    },
  ];
}

function commentContent(task: TodoistBackupTask, comment: TodoistComment) {
  const text = safeLinkText(safeText(comment.content));
  const url = buildCommentUrl(task, comment);
  const lines = [`[${text}](${url})`, `${TODOIST_COMMENT_ID_PROPERTY}:: ${comment.id}`];
  if (comment.posted_at) {
    const formatted = formatCommentTimestamp(comment.posted_at);
    lines.push(`${TODOIST_COMMENT_POSTED_PROPERTY}:: ${formatted}`);
  }
  return lines.join("\n");
}

function buildCommentUrl(task: TodoistBackupTask, comment: TodoistComment) {
  const taskId = String(comment.task_id ?? task.id);
  return `https://todoist.com/app/task/${taskId}/comment/${comment.id}`;
}

function formatCommentTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return safeText(value);
  }
  return parsed.toISOString();
}

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
    await logseq.Editor.insertBatchBlock(parentUuid, children, { sibling: false });
  }
}

function isBlockEntity(value: BlockEntity | BlockUUIDTuple | undefined): value is BlockEntity {
  return Boolean(value && typeof value === "object" && "uuid" in value);
}

function isCommentWrapper(content: string) {
  return new RegExp(`^${TODOIST_COMMENTS_PROPERTY}::`, "m").test(content);
}

function commentTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

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

function resolveDuePropertyValue(task: TodoistBackupTask) {
  const explicitDue = formatDue(task.due);
  if (explicitDue) {
    return explicitDue;
  }
  return undefined;
}

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

export function extractTodoistId(content: string) {
  const match = content.match(new RegExp(`^${TODOIST_ID_PROPERTY}::\\s*(.+)$`, "mi"));
  return match ? match[1].trim() : undefined;
}

function extractTodoistStatus(content: string): TodoistBackupTask["status"] | undefined {
  const match = content.match(new RegExp(`^${TODOIST_STATUS_PROPERTY}::\\s*(.+)$`, "mi"));
  const value = match ? match[1].trim().toLowerCase() : undefined;
  if (value === "active" || value === "completed" || value === "deleted") {
    return value;
  }
  return undefined;
}

function hasCompletedProperty(content: string) {
  return new RegExp(`^${TODOIST_COMPLETED_PROPERTY}::\\s*(.+)$`, "mi").test(content);
}

function extractTodoistDue(content: string) {
  const match = content.match(new RegExp(`^${TODOIST_DUE_PROPERTY}::\\s*(.+)$`, "mi"));
  return match ? sanitizeDueValue(match[1]) : undefined;
}

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

function hasDueProperty(content: string) {
  return new RegExp(`^${TODOIST_DUE_PROPERTY}::`, "i").test(content);
}

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
