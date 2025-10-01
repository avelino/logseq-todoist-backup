import type { BlockEntity, IBatchBlock } from "@logseq/libs/dist/LSPlugin";

import {
  PLACEHOLDER_CONTENT,
  TODOIST_ID_PROPERTY,
} from "./constants";
import {
  formatDue,
  formatLabelTag,
  safeLinkText,
  safeText,
  dueTimestamp,
  TodoistTask,
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

    const formatted = block.content;
    const existing = blockMap.get(todoistId);
    if (existing) {
      await logseq.Editor.updateBlock(existing.uuid, formatted);
    } else {
      const created = await logseq.Editor.appendBlockInPage(page.uuid, formatted);
      if (created) {
        blockMap.set(todoistId, created);
      }
    }

    seenIds.add(todoistId);
  }

  const obsoleteBlocks = [...blockMap.entries()].filter(([id]) => !seenIds.has(id));
  for (const [, entity] of obsoleteBlocks) {
    await logseq.Editor.removeBlock(entity.uuid);
  }

  if (blocks.length === 0 && blockMap.size === 0) {
    await logseq.Editor.appendBlockInPage(page.uuid, PLACEHOLDER_CONTENT);
  }
}

export function buildBlocks(
  tasks: TodoistTask[],
  projectMap: Map<string, string>,
  labelMap: Map<string, string>
): IBatchBlock[] {
  const sorted = [...tasks].sort((a, b) => {
    const aTime = dueTimestamp(a.due);
    const bTime = dueTimestamp(b.due);
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return safeText(a.content).localeCompare(safeText(b.content));
  });

  return sorted.map((task) => ({
    content: blockContent(task, projectMap, labelMap),
  }));
}

export function blockContent(
  task: TodoistTask,
  projectMap: Map<string, string>,
  labelMap: Map<string, string>
) {
  const dueText = safeLinkText(formatDue(task.due));
  const taskTitle = safeLinkText(safeText(task.content) || "Untitled task");
  const description = safeText(task.description ?? "");
  const projectName = projectMap.get(String(task.project_id ?? "")) ?? "Inbox";
  const labels = resolveLabels(task, labelMap);
  const labelsProperty = labels.length
    ? labels
        .map(formatLabelTag)
        .filter((value) => value.length > 0)
        .join(" ")
    : "-";
  const url = task.url ?? `https://todoist.com/showTask?id=${task.id}`;

  const dateLogseqFormat = dueText ? `[[${dueText}]]` : "[[No due date]]";
  const taskTitleLogseqFormat = `${taskTitle} [todoist](${url})`;
  const descProperty = description ? description : "-";

  return [
    `${dateLogseqFormat} ${taskTitleLogseqFormat}`,
    `todoist-id:: ${task.id}`,
    `todoist-desc:: ${descProperty}`,
    `todoist-project:: ${projectName}`,
    `todoist-labels:: ${labelsProperty}`,
  ].join("\n");
}

export function extractTodoistId(content: string) {
  const match = content.match(new RegExp(`^${TODOIST_ID_PROPERTY}::\\s*(.+)$`, "mi"));
  return match ? match[1].trim() : undefined;
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

function resolveLabels(task: TodoistTask, labelMap: Map<string, string>) {
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
