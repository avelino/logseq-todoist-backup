import type { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";

import { DEFAULT_PAGE_NAME } from "./constants";
import { logWarn } from "./logger";

export type PluginSettings = {
  todoist_token?: string;
  page_name?: string;
  sync_interval_minutes?: number;
  include_comments?: boolean;
  exclude_title_patterns?: string;
  enable_debug_logs?: boolean;
  status_alias_active?: string;
  status_alias_completed?: string;
  status_alias_deleted?: string;
};

export const settingsSchema: SettingSchemaDesc[] = [
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
  {
    key: "include_comments",
    type: "boolean",
    default: false,
    title: "Download comments",
    description: "Include Todoist task comments in the backup page.",
  },
  {
    key: "exclude_title_patterns",
    type: "string",
    default: "",
    title: "Excluded task title patterns",
    description:
      "Regular expressions to skip tasks by title. Provide one per line. Use /pattern/flags to customize flags; plain patterns default to case-insensitive matching.",
    inputAs: "textarea",
  },
  {
    key: "enable_debug_logs",
    type: "boolean",
    default: false,
    title: "Enable debug logs",
    description: "Show detailed sync operations in the browser console. Useful for troubleshooting.",
  },
  {
    key: "status_alias_active",
    type: "string",
    default: "◼️",
    title: "Status alias: Active",
    description: "Custom value to display for active tasks (default: ◼️). This appears in the todoist-status property.",
  },
  {
    key: "status_alias_completed",
    type: "string",
    default: "✅",
    title: "Status alias: Completed",
    description: "Custom value to display for completed tasks (default: ✅). This appears in the todoist-status property.",
  },
  {
    key: "status_alias_deleted",
    type: "string",
    default: "🗑️",
    title: "Status alias: Deleted",
    description: "Custom value to display for deleted tasks (default: 🗑️). This appears in the todoist-status property.",
  },
];

/**
 * Reads settings and enriches them with a validated interval in milliseconds.
 */
export function readSettingsWithInterval() {
  const settings = (logseq.settings ?? {}) as PluginSettings;
  const token = settings.todoist_token?.trim();
  const pageName = settings.page_name?.trim() || DEFAULT_PAGE_NAME;
  const intervalMinutes = Number(settings.sync_interval_minutes) || 5;
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
  const includeComments = Boolean(settings.include_comments);
  const excludePatterns = compileTitleExcludePatterns(settings.exclude_title_patterns);
  const statusAliases = readStatusAliases(settings);
  return { token, pageName, intervalMs, includeComments, excludePatterns, statusAliases };
}

/**
 * Reads sanitized settings without interval metadata for simple callers.
 */
export function readSettings() {
  const { token, pageName, includeComments, excludePatterns, statusAliases } = readSettingsWithInterval();
  return { token, pageName, includeComments, excludePatterns, statusAliases };
}

/**
 * Reads and validates status alias settings.
 */
function readStatusAliases(settings: PluginSettings) {
  return {
    active: settings.status_alias_active?.trim() || "◼️",
    completed: settings.status_alias_completed?.trim() || "✅",
    deleted: settings.status_alias_deleted?.trim() || "🗑️",
  };
}

/**
 * Compiles user-provided patterns that exclude Todoist tasks by title.
 *
 * @param raw Raw setting value received from Logseq.
 */
function compileTitleExcludePatterns(raw: string | undefined) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return [] as RegExp[];
  }

  const patterns = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const compiled: RegExp[] = [];

  for (const line of patterns) {
    const { source, flags } = extractPattern(line);
    try {
      compiled.push(new RegExp(source, flags));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn("invalid exclude pattern ignored", { pattern: line, message });
    }
  }

  return compiled;
}

/**
 * Extracts the RegExp source and flags from a raw pattern line.
 *
 * @param input Raw pattern line supplied by the user.
 */
function extractPattern(input: string) {
  if (input.startsWith("/")) {
    const lastSlash = input.lastIndexOf("/");
    if (lastSlash > 0) {
      const candidateFlags = input.slice(lastSlash + 1);
      if (/^[a-z]*$/i.test(candidateFlags)) {
        const body = input.slice(1, lastSlash);
        if (body.length > 0) {
          return { source: body, flags: candidateFlags };
        }
      }
    }
  }

  return { source: input, flags: "i" };
}
