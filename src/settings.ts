import type { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";

import { DEFAULT_PAGE_NAME } from "./constants";

export type PluginSettings = {
  todoist_token?: string;
  page_name?: string;
  sync_interval_minutes?: number;
  include_comments?: boolean;
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
  return { token, pageName, intervalMs, includeComments };
}

/**
 * Reads sanitized settings without interval metadata for simple callers.
 */
export function readSettings() {
  const { token, pageName, includeComments } = readSettingsWithInterval();
  return { token, pageName, includeComments };
}
