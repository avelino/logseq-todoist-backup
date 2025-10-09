import type { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";

import { DEFAULT_PAGE_NAME } from "./constants";

export type PluginSettings = {
  todoist_token?: string;
  page_name?: string;
  sync_interval_minutes?: number;
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
  return { token, pageName, intervalMs };
}

/**
 * Reads sanitized settings without interval metadata for simple callers.
 */
export function readSettings() {
  const { token, pageName } = readSettingsWithInterval();
  return { token, pageName };
}
