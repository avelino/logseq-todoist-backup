import {
  TODOIST_API_BASE,
  ISO_DATE_PATTERN,
  TODOIST_REST_API_BASE,
  TODOIST_SYNC_API_BASE,
} from "./constants";

export type TodoistId = string | number;

export type TodoistDue = {
  string?: string | null;
  date?: string | null;
  datetime?: string | null;
  timezone?: string | null;
};

export type TodoistTask = {
  id: TodoistId;
  content: string;
  description?: string | null;
  project_id?: TodoistId | null;
  labels?: Array<TodoistId | string>;
  label_ids?: Array<TodoistId>;
  due?: TodoistDue | null;
  url?: string;
};

export type TodoistComment = {
  id: TodoistId;
  task_id: TodoistId;
  content: string;
  posted_at: string | null;
};

type RawTodoistComment = {
  id?: TodoistId | null;
  task_id?: TodoistId | null;
  content?: string | null;
  posted_at?: string | null;
};

export type TodoistCompletedItem = {
  task_id?: TodoistId;
  content?: string;
  description?: string | null;
  project_id?: TodoistId | null;
  labels?: Array<TodoistId | string>;
  label_ids?: Array<TodoistId>;
  completed_at?: string | null;
  completed_date?: string | null;
  task?: Partial<TodoistTask> & { id?: TodoistId };
};

export type TodoistBackupTask = TodoistTask & {
  completed?: boolean;
  completed_at?: string | null;
  completed_date?: string | null;
  status?: "active" | "completed" | "deleted";
  fallbackDue?: string;
  comments?: TodoistComment[];
};

export type TodoistProject = {
  id: TodoistId;
  name: string;
};

export type TodoistLabel = {
  id: TodoistId;
  name: string;
};

export type PaginatedResponse<T> = {
  data?: T[];
  items?: T[];
  tasks?: T[];
  projects?: T[];
  labels?: T[];
  results?: T[];
  next_cursor?: string | null;
};

export type FetchPaginatedOptions = {
  baseUrl?: string;
  searchParams?: Record<string, string | undefined>;
  method?: "GET" | "POST";
  body?: unknown;
};

export type FetchCommentsOptions = {
  retryLimit?: number;
};

/**
 * Fetches paginated resources from Todoist REST endpoints.
 *
 * @param path API path to fetch.
 * @param token Todoist API token.
 * @param options Additional fetch options such as base url and parameters.
 */
export async function fetchPaginated<T>(
  path: string,
  token: string,
  options: FetchPaginatedOptions = {}
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  const {
    baseUrl = TODOIST_API_BASE,
    searchParams = {},
    method = "GET",
  } = options;

  do {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status} while fetching ${path}`);
    }

    const body = (await response.json()) as PaginatedResponse<T> | T[];
    const pageItems = extractItems(body);
    items.push(...pageItems);
    cursor = getCursor(body);
  } while (cursor);

  return items;
}

/**
 * Fetches and sanitizes comments for the specified Todoist tasks.
 *
 * @param taskIds Identifiers of tasks whose comments will be requested.
 * @param token Todoist API token.
 * @param options Optional retry configuration for transient failures.
 */
export async function fetchTaskComments(
  taskIds: TodoistId[],
  token: string,
  options: FetchCommentsOptions = {}
): Promise<Map<string, TodoistComment[]>> {
  const map = new Map<string, TodoistComment[]>();
  if (taskIds.length === 0) {
    return map;
  }

  const retryLimit = Math.max(0, options.retryLimit ?? 1);
  const idsToFetch = taskIds
    .map((id) => String(id))
    .filter((value, index, self) => self.indexOf(value) === index);
  const queue = [...idsToFetch];
  const attempts = new Map<string, number>();

  while (queue.length > 0) {
    const taskId = queue.shift();
    if (!taskId) {
      continue;
    }

    try {
      const comments = await fetchPaginated<TodoistComment>("/comments", token, {
        searchParams: {
          task_id: taskId,
        },
        baseUrl: TODOIST_REST_API_BASE,
      });

      const sanitized = comments
        .map((comment) => sanitizeComment(comment, taskId))
        .filter((comment): comment is TodoistComment => Boolean(comment));

      map.set(taskId, sanitized);
    } catch (error) {
      const currentAttempts = attempts.get(taskId) ?? 0;
      const nextAttempts = currentAttempts + 1;
      attempts.set(taskId, nextAttempts);
      if (nextAttempts <= retryLimit) {
        queue.push(taskId);
      } else {
        console.error(
          "[logseq-todoist-backup] failed to fetch comments for task",
          taskId,
          error
        );
      }
    }
  }

  return map;
}

/**
 * Extracts data arrays from various Todoist pagination formats.
 */
export function extractItems<T>(body: PaginatedResponse<T> | T[]): T[] {
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

/**
 * Validates and normalizes a raw comment payload from Todoist.
 */
function sanitizeComment(comment: RawTodoistComment, fallbackTaskId: string): TodoistComment | undefined {
  if (!comment) {
    return undefined;
  }
  const id = comment.id;
  if (id === null || id === undefined) {
    return undefined;
  }
  const taskId = comment.task_id ?? fallbackTaskId;
  if (taskId === null || taskId === undefined) {
    return undefined;
  }
  const content = safeText(comment.content ?? "");
  return {
    id,
    task_id: taskId,
    content,
    posted_at: comment.posted_at ?? null,
  };
}

/**
 * Reads the pagination cursor from Todoist responses when present.
 */
export function getCursor<T>(body: PaginatedResponse<T> | T[]): string | undefined {
  if (Array.isArray(body)) {
    return undefined;
  }

  const value = body.next_cursor;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Builds a map of Todoist ids to names for projects and similar collections.
 */
export function buildNameMap(collection: Array<{ id: TodoistId; name: string }>) {
  const map = new Map<string, string>();
  for (const item of collection) {
    map.set(String(item.id), item.name);
  }
  return map;
}

/**
 * Combines label ids and names into a lookup map for quick resolution.
 */
export function buildLabelMap(labels: TodoistLabel[]) {
  const map = new Map<string, string>();
  for (const label of labels) {
    const name = label.name;
    map.set(String(label.id), name);
    map.set(name, name);
  }
  return map;
}

/**
 * Converts a completed task payload into the shared backup task shape.
 */
export function normalizeCompletedTask(item: TodoistCompletedItem): TodoistBackupTask | undefined {
  const source = item.task ?? {};
  const id = source.id ?? item.task_id;
  if (id === undefined || id === null) {
    return undefined;
  }

  const url = source.url ?? (id ? `https://todoist.com/showTask?id=${id}` : undefined);

  return {
    id,
    content: source.content ?? item.content ?? "",
    description: source.description ?? item.description ?? null,
    project_id: source.project_id ?? item.project_id ?? null,
    labels: source.labels ?? item.labels,
    label_ids: source.label_ids ?? item.label_ids,
    due: source.due ?? null,
    url,
    completed: true,
    completed_at: item.completed_at ?? null,
    completed_date: item.completed_date ?? null,
  };
}

/**
 * Retrieves completed Todoist tasks using the sync API.
 */
export async function fetchCompletedTasks(token: string): Promise<TodoistBackupTask[]> {
  const items = await fetchPaginated<TodoistCompletedItem>("/completed/get_all", token, {
    baseUrl: TODOIST_SYNC_API_BASE,
    searchParams: {
      limit: "200",
    },
  });

  return items
    .map((item) => normalizeCompletedTask(item))
    .filter((task): task is TodoistBackupTask => Boolean(task));
}

/**
 * Merges active and completed Todoist tasks into a unified task list.
 */
export function mergeBackupTasks(
  active: TodoistTask[],
  completed: TodoistBackupTask[]
): TodoistBackupTask[] {
  const map = new Map<string, TodoistBackupTask>();

  for (const task of completed) {
    const key = String(task.id);
    map.set(key, {
      ...task,
      status: "completed",
      fallbackDue: formatDue(task.due) || undefined,
    });
  }

  for (const task of active) {
    const key = String(task.id);
    map.set(key, {
      ...task,
      completed: false,
      completed_at: null,
      completed_date: null,
      status: "active",
      fallbackDue: formatDue(task.due) || undefined,
    });
  }

  return [...map.values()];
}

/**
 * Converts due information into a numeric timestamp for sorting.
 */
export function dueTimestamp(due?: TodoistDue | null) {
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

/**
 * Formats Todoist due information into `YYYY-MM-DD` when possible.
 */
export function formatDue(due?: TodoistDue | null) {
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

/**
 * Trims whitespace and normalizes line breaks in free-text inputs.
 */
export function safeText(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim();
}

/**
 * Sanitizes text while preserving balanced Logseq and Markdown link syntax.
 */
export function safeLinkText(value: string | null | undefined) {
  const sanitized = safeText(value);
  if (!sanitized) return "";

  const pieces: string[] = [];
  let index = 0;

  while (index < sanitized.length) {
    const char = sanitized[index];

    if (char === "[") {
      if (sanitized[index + 1] === "[") {
        const closing = sanitized.indexOf("]]", index + 2);
        if (closing !== -1) {
          pieces.push(sanitized.slice(index, closing + 2));
          index = closing + 2;
          continue;
        }
      }

      const closing = sanitized.indexOf("]", index + 1);
      if (closing !== -1) {
        pieces.push(sanitized.slice(index, closing + 1));
        index = closing + 1;
        continue;
      }

      pieces.push(" ");
      index += 1;
      continue;
    }

    if (char === "]") {
      pieces.push(" ");
      index += 1;
      continue;
    }

    pieces.push(char);
    index += 1;
  }

  return safeText(pieces.join(""));
}

/**
 * Normalizes label names into Logseq-friendly tags.
 */
export function formatLabelTag(label: string) {
  const sanitized = label.replace(/[^\w\s-]/g, " ").trim();
  if (!sanitized) return "";
  const dashed = sanitized.replace(/\s+/g, "-");
  return dashed.startsWith("#") ? dashed : `#${dashed}`;
}

/**
 * Converts Todoist inline labels (@label) to Logseq hashtags (#label).
 * Preserves email addresses and other @ mentions that are not labels.
 *
 * @param text Text containing potential Todoist inline labels.
 */
export function convertInlineTodoistLabels(text: string): string {
  if (!text) return "";

  // Pattern: @ followed by word characters and hyphens (typical label format)
  // Negative lookbehind to avoid matching emails (preceded by alphanumeric)
  // Match @word-name but not user@email.com
  return text.replace(/(?<![a-zA-Z0-9])@([\w-]+)/g, '#$1');
}
