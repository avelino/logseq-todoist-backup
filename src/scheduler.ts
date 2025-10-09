import { readSettingsWithInterval } from "./settings";

type SyncHandler = (trigger: "auto") => Promise<void>;

let scheduledSync: number | null = null;

/**
 * Calculates interval settings and schedules the next automatic sync run.
 *
 * @param handler Callback invoked when the scheduled sync fires.
 */
export function scheduleAutoSync(handler: SyncHandler) {
  const { token, intervalMs } = readSettingsWithInterval();
  if (!token) {
    cancelScheduledSync();
    return;
  }

  cancelScheduledSync();
  scheduledSync = window.setTimeout(async () => {
    scheduledSync = null;
    await handler("auto");
    scheduleAutoSync(handler);
  }, intervalMs);
}

/**
 * Clears the pending sync timeout when present.
 */
export function cancelScheduledSync() {
  if (scheduledSync !== null) {
    clearTimeout(scheduledSync);
    scheduledSync = null;
  }
}
