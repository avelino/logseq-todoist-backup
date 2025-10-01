import "@logseq/libs";
import type {
  BlockEntity,
  IBatchBlock,
  PageEntity,
  SettingSchemaDesc,
} from "@logseq/libs/dist/LSPlugin";

const TODOIST_API_BASE = "https://api.todoist.com/api/v1";
const DEFAULT_PAGE_NAME = "todoist";
const TOOLBAR_KEY = "logseq-todoist-backup-sync";
const TOOLBAR_BUTTON_CLASS = "logseq-todoist-backup-button";
const TOOLBAR_ICON_CLASS = "logseq-todoist-backup-icon";
const TOOLBAR_ICON_IMG_CLASS = "logseq-todoist-backup-icon-image";
const TODOIST_ID_PROPERTY = "todoist-id";
const PLACEHOLDER_CONTENT = "Nenhuma tarefa encontrada.";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PluginSettings = {
  todoist_token?: string;
  page_name?: string;
  sync_interval_minutes?: number;
};

type Trigger = "manual" | "auto";

type TodoistId = string | number;

type TodoistDue = {
  string?: string | null;
  date?: string | null;
  datetime?: string | null;
  timezone?: string | null;
};

type TodoistTask = {
  id: TodoistId;
  content: string;
  description?: string | null;
  project_id?: TodoistId | null;
  labels?: Array<TodoistId | string>;
  label_ids?: Array<TodoistId>;
  due?: TodoistDue | null;
  url?: string;
};

type TodoistProject = {
  id: TodoistId;
  name: string;
};

type TodoistLabel = {
  id: TodoistId;
  name: string;
};

type PaginatedResponse<T> = {
  data?: T[];
  items?: T[];
  tasks?: T[];
  projects?: T[];
  labels?: T[];
  results?: T[];
  next_cursor?: string | null;
};

const settingsSchema: SettingSchemaDesc[] = [
  {
    key: "todoist_token",
    type: "string",
    default: "",
    title: "Todoist token",
    description:
      "Personal Todoist token with read permissions. No write operations are performed.",
  },
  {
    key: "page_name",
    type: "string",
    default: DEFAULT_PAGE_NAME,
    title: "Target page",
    description: "Logseq page where the backup will be stored.",
  },
  {
    key: "sync_interval_minutes",
    type: "number",
    default: 5,
    title: "Sync interval (min)",
    description: "Minutes between automatic background sync executions.",
  },
];

let syncInProgress = false;
let scheduledSync: number | null = null;

const model = {
  async syncTodoistBackup() {
    await syncTodoist("manual");
  },
};

async function main() {
  logseq.useSettingsSchema(settingsSchema);
  logseq.provideModel(model);
  logseq.provideStyle(`
    .${TOOLBAR_BUTTON_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
    }

    .${TOOLBAR_BUTTON_CLASS} .${TOOLBAR_ICON_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      line-height: 1;
    }

    .${TOOLBAR_BUTTON_CLASS}:hover {
      opacity: 0.8;
    }

    .${TOOLBAR_ICON_IMG_CLASS} {
      width: 1.25rem;
      height: 1.25rem;
      object-fit: contain;
    }
  `);

  const iconUrl = logseq.resolveResourceFullUrl("logo.png");

  logseq.App.registerCommandPalette(
    {
      key: TOOLBAR_KEY,
      label: "Todoist: Sync backup",
    },
    () => syncTodoist("manual")
  );

  logseq.App.registerUIItem("toolbar", {
    key: TOOLBAR_KEY,
    template: `
      <a
        class="button ${TOOLBAR_BUTTON_CLASS}"
        data-on-click="syncTodoistBackup"
        title="Todoist: Sync backup"
      >
        <span class="${TOOLBAR_ICON_CLASS}" aria-hidden="true">
          <img src="${iconUrl}" class="${TOOLBAR_ICON_IMG_CLASS}" alt="Todoist backup" />
        </span>
      </a>
    `,
  });

  logseq.onSettingsChanged(() => {
    scheduleAutoSync();
  });

  scheduleAutoSync();
}

function registerLifecycle() {
  async function cleanup() {
    cancelScheduledSync();
  }

  logseq.beforeunload(cleanup);
  window.addEventListener("beforeunload", () => {
    void cleanup();
  });
}

async function syncTodoist(trigger: Trigger) {
  if (syncInProgress) {
    if (trigger === "manual") {
      await logseq.UI.showMsg("Sync already in progress", "warning");
    }
    return;
  }

  const { token, pageName } = readSettings();
  if (!token) {
    if (trigger === "manual") {
      await logseq.UI.showMsg(
        "Configure the Todoist token in the plugin settings.",
        "warning"
      );
    }
    return;
  }

  syncInProgress = true;
  if (trigger === "manual") {
    await logseq.UI.showMsg("Syncing Todoist data...", "info");
  }

  try {
    const [tasks, projects, labels] = await Promise.all([
      fetchPaginated<TodoistTask>("/tasks", token),
      fetchPaginated<TodoistProject>("/projects", token),
      fetchPaginated<TodoistLabel>("/labels", token),
    ]);

    const projectMap = buildNameMap(projects);
    const labelMap = buildLabelMap(labels);

    const blocks = buildBlocks(tasks, projectMap, labelMap);
    await writeBlocks(pageName, blocks);

    if (trigger === "manual") {
      await logseq.UI.showMsg(
        `Todoist backup synced (${blocks.length} tasks).`,
        "success"
      );
    } else {
      console.info("[logseq-todoist-backup] automatic sync completed.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[logseq-todoist-backup] failed to sync", error);
    await logseq.UI.showMsg(`Failed to sync Todoist: ${message}`, "error");
  } finally {
    syncInProgress = false;
  }
}

function readSettings() {
  const { token, pageName } = readSettingsWithInterval();
  return { token, pageName };
}

function readSettingsWithInterval() {
  const settings = (logseq.settings ?? {}) as PluginSettings;
  const token = settings.todoist_token?.trim();
  const pageName = settings.page_name?.trim() || DEFAULT_PAGE_NAME;
  const intervalMinutes = Number(settings.sync_interval_minutes) || 5;
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
  return { token, pageName, intervalMs };
}

async function fetchPaginated<T>(path: string, token: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${TODOIST_API_BASE}${path}`);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Erro ${response.status} ao consultar ${path}`);
    }

    const body = (await response.json()) as PaginatedResponse<T> | T[];
    const pageItems = extractItems(body);
    items.push(...pageItems);
    cursor = getCursor(body);
  } while (cursor);

  return items;
}

function extractItems<T>(body: PaginatedResponse<T> | T[]): T[] {
  if (Array.isArray(body)) {
    return body;
  }

  const candidates: Array<T[] | undefined> = [
    body.data,
    body.items,
    body.tasks,
    body.projects,
    body.labels,
    body.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function getCursor<T>(body: PaginatedResponse<T> | T[]): string | undefined {
  if (Array.isArray(body)) {
    return undefined;
  }

  const value = body.next_cursor;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildNameMap(collection: Array<{ id: TodoistId; name: string }>) {
  const map = new Map<string, string>();
  for (const item of collection) {
    map.set(String(item.id), item.name);
  }
  return map;
}

function buildLabelMap(labels: TodoistLabel[]) {
  const map = new Map<string, string>();
  for (const label of labels) {
    const name = label.name;
    map.set(String(label.id), name);
    map.set(name, name);
  }
  return map;
}

function buildBlocks(
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

function dueTimestamp(due?: TodoistDue | null) {
  if (!due) return Number.POSITIVE_INFINITY;
  const { datetime, date } = due;
  if (datetime) {
    const value = Date.parse(datetime);
    if (Number.isFinite(value)) return value;
  }
  if (date) {
    const value = Date.parse(date);
    if (Number.isFinite(value)) return value;
    const assumed = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(assumed)) return assumed;
  }
  if (due.string) {
    const value = Date.parse(due.string);
    if (Number.isFinite(value)) return value;
  }
  return Number.POSITIVE_INFINITY;
}

function blockContent(
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

function formatDue(due?: TodoistDue | null) {
  if (!due) return "";
  if (due.date && ISO_DATE_PATTERN.test(due.date)) {
    return due.date;
  }
  if (due.datetime) {
    const date = new Date(due.datetime);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  if (due.date) {
    const parsed = new Date(`${due.date}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  if (due.string) {
    const parsed = new Date(due.string);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return "";
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

function formatLabelTag(label: string) {
  const sanitized = label.replace(/[^\w\s-]/g, " ").trim();
  if (!sanitized) return "";
  const dashed = sanitized.replace(/\s+/g, "-");
  return dashed.startsWith("#") ? dashed : `#${dashed}`;
}

function safeText(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim();
}

function safeLinkText(value: string | null | undefined) {
  return safeText(value).replace(/[\[\]]/g, " ");
}

async function writeBlocks(pageName: string, blocks: IBatchBlock[]) {
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

function extractTodoistId(content: string) {
  const match = content.match(new RegExp(`^${TODOIST_ID_PROPERTY}::\\s*(.+)$`, "mi"));
  return match ? match[1].trim() : undefined;
}

function buildBlockMap(tree: BlockEntity[]) {
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

function scheduleAutoSync() {
  const { token, intervalMs } = readSettingsWithInterval();
  if (!token) {
    cancelScheduledSync();
    return;
  }

  cancelScheduledSync();
  scheduledSync = window.setTimeout(async () => {
    scheduledSync = null;
    await syncTodoist("auto");
    scheduleAutoSync();
  }, intervalMs);
}

function cancelScheduledSync() {
  if (scheduledSync !== null) {
    clearTimeout(scheduledSync);
    scheduledSync = null;
  }
}

logseq.ready(main)
  .then(registerLifecycle)
  .catch((error) => {
    console.error("[logseq-todoist-backup] erro ao iniciar o plugin", error);
  });
