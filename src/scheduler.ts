import { readSettingsWithInterval } from "./settings";

type SyncHandler = (trigger: "auto") => Promise<void>;

let scheduledSync: number | null = null;

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

export function cancelScheduledSync() {
  if (scheduledSync !== null) {
    clearTimeout(scheduledSync);
    scheduledSync = null;
  }
}
