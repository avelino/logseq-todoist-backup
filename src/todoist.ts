import { TODOIST_API_BASE, ISO_DATE_PATTERN } from "./constants";

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

export async function fetchPaginated<T>(path: string, token: string): Promise<T[]> {
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
      throw new Error(`Error ${response.status} while fetching ${path}`);
    }

    const body = (await response.json()) as PaginatedResponse<T> | T[];
    const pageItems = extractItems(body);
    items.push(...pageItems);
    cursor = getCursor(body);
  } while (cursor);

  return items;
}

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

export function getCursor<T>(body: PaginatedResponse<T> | T[]): string | undefined {
  if (Array.isArray(body)) {
    return undefined;
  }

  const value = body.next_cursor;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function buildNameMap(collection: Array<{ id: TodoistId; name: string }>) {
  const map = new Map<string, string>();
  for (const item of collection) {
    map.set(String(item.id), item.name);
  }
  return map;
}

export function buildLabelMap(labels: TodoistLabel[]) {
  const map = new Map<string, string>();
  for (const label of labels) {
    const name = label.name;
    map.set(String(label.id), name);
    map.set(name, name);
  }
  return map;
}

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

export function safeText(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim();
}

export function safeLinkText(value: string | null | undefined) {
  return safeText(value).replace(/[\[\]]/g, " ");
}

export function formatLabelTag(label: string) {
  const sanitized = label.replace(/[^\w\s-]/g, " ").trim();
  if (!sanitized) return "";
  const dashed = sanitized.replace(/\s+/g, "-");
  return dashed.startsWith("#") ? dashed : `#${dashed}`;
}
