import "@logseq/libs";

import { buildBlocks, writeBlocks } from "./blocks";
import {
  buildLabelMap,
  buildNameMap,
  fetchTaskComments,
  fetchCompletedTasks,
  fetchPaginated,
  mergeBackupTasks,
  TodoistLabel,
  TodoistProject,
  TodoistTask,
  TodoistBackupTask,
} from "./todoist";
import { readSettings, settingsSchema } from "./settings";
import { cancelScheduledSync, scheduleAutoSync } from "./scheduler";
import { provideStyles, registerCommands, registerToolbar } from "./ui";

let syncInProgress = false;

const model = {
  async syncTodoistBackup() {
    await syncTodoist("manual");
  },
};

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

function registerLifecycle() {
  async function cleanup() {
    cancelScheduledSync();
  }

  logseq.beforeunload(cleanup);
  window.addEventListener("beforeunload", () => {
    void cleanup();
  });
}

async function syncTodoist(trigger: "manual" | "auto") {
  if (syncInProgress) {
    if (trigger === "manual") {
      await logseq.UI.showMsg("Sync already in progress", "warning");
    }
    return;
  }

  const { token, pageName } = readSettings();
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

  try {
    const [tasks, completedTasks, projects, labels] = await Promise.all([
      fetchPaginated<TodoistTask>("/tasks", token),
      fetchCompletedTasks(token),
      fetchPaginated<TodoistProject>("/projects", token),
      fetchPaginated<TodoistLabel>("/labels", token),
    ]);

    const projectMap = buildNameMap(projects);
    const labelMap = buildLabelMap(labels);

    const backupTasks: TodoistBackupTask[] = mergeBackupTasks(tasks, completedTasks);

    const commentsMap = await fetchTaskComments(
      backupTasks.map((task) => task.id),
      token
    );

    const enrichedTasks = backupTasks.map((task) => ({
      ...task,
      comments: commentsMap.get(String(task.id)) ?? [],
    }));

    const blocks = buildBlocks(enrichedTasks, projectMap, labelMap);
    await writeBlocks(pageName, blocks);

    if (trigger === "manual") {
      await logseq.UI.showMsg(
        `Todoist backup synced (${blocks.length} tasks).`,
        "success"
      );
    } else {
      console.info("[logseq-todoist-backup] automatic sync completed.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[logseq-todoist-backup] failed to sync", error);
    await logseq.UI.showMsg(`Failed to sync Todoist: ${message}`, "error");
  } finally {
    syncInProgress = false;
  }
}

logseq.ready(main)
  .then(registerLifecycle)
  .catch((error) => {
    console.error("[logseq-todoist-backup] erro ao iniciar o plugin", error);
  });
