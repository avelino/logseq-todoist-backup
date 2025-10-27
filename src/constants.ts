export const TODOIST_API_BASE = "https://api.todoist.com/api/v1";
export const TODOIST_SYNC_API_BASE = "https://api.todoist.com/sync/v9";
export const TODOIST_REST_API_BASE = "https://api.todoist.com/rest/v2";
export const DEFAULT_PAGE_NAME = "todoist";
export const TOOLBAR_KEY = "logseq-todoist-backup-sync";
export const TOOLBAR_BUTTON_CLASS = "logseq-todoist-backup-button";
export const TOOLBAR_ICON_CLASS = "logseq-todoist-backup-icon";
export const TOOLBAR_ICON_IMG_CLASS = "logseq-todoist-backup-icon-image";
export const TODOIST_ID_PROPERTY = "todoist-id";
export const TODOIST_COMPLETED_PROPERTY = "todoist-completed";
export const TODOIST_STATUS_PROPERTY = "todoist-status";
export const TODOIST_DUE_PROPERTY = "todoist-due";
export const TODOIST_COMMENTS_PROPERTY = "todoist-comments";
export const TODOIST_COMMENT_ID_PROPERTY = "todoist-comment-id";
export const TODOIST_COMMENT_POSTED_PROPERTY = "todoist-comment-posted";
export const PLACEHOLDER_CONTENT = "No tasks found.";
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const BACKLOG_PAGE_SUFFIX = "Backlog";

export type TodoistStatus = "active" | "completed" | "deleted";

export type StatusAliases = {
  active: string;
  completed: string;
  deleted: string;
};

/**
 * Maps internal Todoist status to user-configured alias for display in markdown.
 *
 * @param status Internal status value from Todoist.
 * @param aliases User-configured status aliases.
 */
export function statusToAlias(status: TodoistStatus | undefined, aliases: StatusAliases): string {
  if (!status) {
    return aliases.active;
  }
  return aliases[status] ?? status;
}

/**
 * Parses a status property value from markdown, recognizing both canonical values
 * and user-configured aliases.
 *
 * @param value Raw status property value from markdown block.
 * @param aliases User-configured status aliases.
 */
export function aliasToStatus(value: string | undefined, aliases: StatusAliases): TodoistStatus | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  // Check canonical values first
  if (normalized === "active" || normalized === "completed" || normalized === "deleted") {
    return normalized as TodoistStatus;
  }

  // Check against aliases
  const trimmedValue = value.trim();
  if (trimmedValue === aliases.active) {
    return "active";
  }
  if (trimmedValue === aliases.completed) {
    return "completed";
  }
  if (trimmedValue === aliases.deleted) {
    return "deleted";
  }

  return undefined;
}
