/**
 * Structured logging utility that respects the user's debug preference.
 */

import type { PluginSettings } from "./settings";

const LOG_PREFIX = "[logseq-todoist-backup]";

/**
 * Checks if debug logging is enabled in plugin settings.
 */
function isDebugEnabled(): boolean {
  const settings = (logseq.settings ?? {}) as PluginSettings;
  return Boolean(settings.enable_debug_logs);
}

/**
 * Logs an informational message when debug mode is enabled.
 *
 * @param message Primary log message.
 * @param data Optional additional context.
 */
export function logInfo(message: string, data?: unknown): void {
  if (isDebugEnabled()) {
    if (data !== undefined) {
      console.info(LOG_PREFIX, message, data);
    } else {
      console.info(LOG_PREFIX, message);
    }
  }
}

/**
 * Logs a warning message when debug mode is enabled.
 *
 * @param message Primary warning message.
 * @param data Optional additional context.
 */
export function logWarn(message: string, data?: unknown): void {
  if (isDebugEnabled()) {
    if (data !== undefined) {
      console.warn(LOG_PREFIX, message, data);
    } else {
      console.warn(LOG_PREFIX, message);
    }
  }
}

/**
 * Logs an error message. Always visible regardless of debug setting.
 *
 * @param message Primary error message.
 * @param error Optional error object or additional context.
 */
export function logError(message: string, error?: unknown): void {
  if (error !== undefined) {
    console.error(LOG_PREFIX, message, error);
  } else {
    console.error(LOG_PREFIX, message);
  }
}

/**
 * Logs a debug message with structured data when debug mode is enabled.
 * Use for detailed sync operations, API responses, and data transformations.
 *
 * @param operation Operation being logged (e.g., "fetch_tasks", "write_blocks").
 * @param data Structured data to display.
 */
export function logDebug(operation: string, data: Record<string, unknown>): void {
  if (isDebugEnabled()) {
    console.info(LOG_PREFIX, `[${operation}]`, data);
  }
}

