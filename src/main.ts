import "@logseq/libs";

import { writeBlocks } from "./blocks";
import {
  buildLabelMap,
  buildNameMap,
  fetchTaskComments,
  fetchCompletedTasks,
  fetchPaginated,
  mergeBackupTasks,
  TodoistBackupTask,
  TodoistLabel,
  TodoistProject,
  TodoistTask,
  safeText,
} from "./todoist";
import { readSettings, settingsSchema } from "./settings";
import { cancelScheduledSync, scheduleAutoSync } from "./scheduler";
import { provideStyles, registerCommands, registerToolbar } from "./ui";
import { logError, logInfo, logDebug } from "./logger";

let syncInProgress = false;

type EditingState = {
  blockUuid: string;
  cursorPosition?: number;
};

/**
 * Captures the current editing state so it can be restored after background syncs.
 */
async function captureEditingState(): Promise<EditingState | undefined> {
  try {
    const editing = await logseq.Editor.checkEditing();
    const blockUuid = typeof editing === "string" && editing.length > 0 ? editing : undefined;
    if (!blockUuid) {
      return undefined;
    }

    const cursor = await logseq.Editor.getEditingCursorPosition().catch(() => null);
    const cursorPosition = cursor && typeof cursor.pos === "number" ? cursor.pos : undefined;

    return { blockUuid, cursorPosition };
  } catch (error) {
    logError("failed to capture editing state", error);
    return undefined;
  }
}

/**
 * Restores editing focus when automatic sync temporarily steals the cursor.
 *
 * @param state Previously captured editing information.
 */
async function restoreEditingState(state: EditingState | undefined) {
  if (!state) {
    return;
  }

  try {
    const currentEditing = await logseq.Editor.checkEditing();
    if (typeof currentEditing === "string" && currentEditing.length > 0) {
      return;
    }

    const block = await logseq.Editor.getBlock(state.blockUuid, { includeChildren: false });
    if (!block) {
      return;
    }

    if (typeof state.cursorPosition === "number" && Number.isFinite(state.cursorPosition)) {
      await logseq.Editor.editBlock(state.blockUuid, { pos: state.cursorPosition });
    } else {
      await logseq.Editor.editBlock(state.blockUuid);
    }
  } catch (error) {
    logError("failed to restore editing focus", error);
  }
}

/**
 * Fetches Todoist comments and merges them into the provided task list.
 *
 * @param tasks Todoist tasks to enrich with comment data.
 * @param token Todoist API token used for authenticated requests.
 */
async function enrichTasksWithComments(
  tasks: TodoistBackupTask[],
  token: string
) {
  if (tasks.length === 0) {
    return tasks;
  }

  const commentsMap = await fetchTaskComments(
    tasks.map((task) => task.id),
    token
  );

  return tasks.map((task) => ({
    ...task,
    comments: commentsMap.get(String(task.id)) ?? [],
  }));
}

const model = {
  /**
   * Triggers a manual Todoist backup sync from the command palette.
   */
  async syncTodoistBackup() {
    await syncTodoist("manual");
  },
};

/**
 * Registers plugin settings, UI, and schedules the initial sync.
 */
async function main() {
  logseq.useSettingsSchema(settingsSchema);
  logseq.provideModel(model);
  provideStyles();

  const iconUrl = logseq.resolveResourceFullUrl("logo.png");
  registerCommands(() => syncTodoist("manual"));
  registerToolbar(iconUrl);

  logseq.onSettingsChanged(() => {
    scheduleAutoSync((trigger) => syncTodoist(trigger));
  });

  scheduleAutoSync((trigger) => syncTodoist(trigger));
}

/**
 * Hooks plugin cleanup into Logseq and window lifecycle events.
 */
function registerLifecycle() {
  /**
   * Cancels any pending scheduled sync timers before unload.
   */
  async function cleanup() {
    cancelScheduledSync();
  }

  logseq.beforeunload(cleanup);
  window.addEventListener("beforeunload", () => {
    void cleanup();
  });
}

/**
 * Synchronizes Todoist data with Logseq for manual and automatic triggers.
 *
 * @param trigger Indicates whether the sync was initiated manually or automatically.
 */
async function syncTodoist(trigger: "manual" | "auto") {
  if (syncInProgress) {
    if (trigger === "manual") {
      await logseq.UI.showMsg("Sync already in progress", "warning");
    }
    return;
  }

  const { token, pageName, includeComments, excludePatterns, statusAliases } = readSettings();
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

  let editingState: EditingState | undefined;
  if (trigger === "auto") {
    editingState = await captureEditingState();
  }

  try {
    const [tasks, completedTasks, projects, labels] = await Promise.all([
      fetchPaginated<TodoistTask>("/tasks", token),
      fetchCompletedTasks(token),
      fetchPaginated<TodoistProject>("/projects", token),
      fetchPaginated<TodoistLabel>("/labels", token),
    ]);

    const projectMap = buildNameMap(projects);
    const labelMap = buildLabelMap(labels);

    logDebug("fetch_completed", {
      tasks: tasks.length,
      completed: completedTasks.length,
      projects: projects.length,
      labels: labels.length,
    });

    const backupTasks: TodoistBackupTask[] = mergeBackupTasks(tasks, completedTasks);

    const filteredTasks = applyTitleExclusions(backupTasks, excludePatterns);

    if (filteredTasks.length < backupTasks.length) {
      logInfo(`excluded ${backupTasks.length - filteredTasks.length} tasks by pattern`);
    }

    const tasksForBlocks = includeComments
      ? await enrichTasksWithComments(filteredTasks, token)
      : filteredTasks;

    logDebug("write_blocks_start", {
      page: pageName,
      tasks: tasksForBlocks.length,
      includeComments,
    });

    await writeBlocks(pageName, tasksForBlocks, projectMap, labelMap, statusAliases);

    if (trigger === "manual") {
      await logseq.UI.showMsg(
        `Todoist backup synced (${tasksForBlocks.length} tasks).`,
        "success"
      );
    } else {
      logInfo("automatic sync completed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("failed to sync", error);
    await logseq.UI.showMsg(`Failed to sync Todoist: ${message}`, "error");
  } finally {
    syncInProgress = false;
    if (trigger === "auto") {
      await restoreEditingState(editingState);
    }
  }
}

/**
 * Removes tasks whose sanitized titles match configured exclusion patterns.
 *
 * @param tasks Todoist tasks combined from active and completed sources.
 * @param patterns Compiled regular expressions for titles to skip.
 */
function applyTitleExclusions(tasks: TodoistBackupTask[], patterns: RegExp[] | undefined) {
  if (!patterns || patterns.length === 0) {
    return tasks;
  }

  return tasks.filter((task) => {
    const title = safeText(task.content);
    if (!title) {
      return true;
    }

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(title)) {
        return false;
      }
    }
    return true;
  });
}

logseq.ready(main)
  .then(registerLifecycle)
  .catch((error) => {
    logError("erro ao iniciar o plugin", error);
  });
