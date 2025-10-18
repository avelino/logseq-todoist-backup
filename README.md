<p align="center">
  <a href="https://github.com/avelino/logseq-todoist-backup">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./logo.png">
      <img src="./logo.png" height="128" alt="Logseq Todoist Backup logo">
    </picture>
  </a>
</p>

# Logseq Todoist Backup

Logseq plugin that keeps a read-only backup of all Todoist tasks organized in journal-style pages within your graph.

## Overview

- Read-only integration with the Todoist API (`https://api.todoist.com/api/v1`).
- Manual sync via toolbar or command palette.
- Automatic background sync with a configurable interval (default 5 minutes).
- Updates existing blocks based on `todoist-id::`, avoiding duplicates and removing tasks that no longer exist while preserving completed tasks.
- Generates Logseq-friendly blocks including links, description, project, and labels prefixed with `#`.
- Tasks are organized in date-based pages (`todoist/YYYY-MM-DD`) to maintain performance as your backup grows. Tasks without dates are stored in `todoist/Backlog`.

## Requirements

- Logseq `0.9.0` or newer.
- Todoist personal API token with read access.

## Developer Installation

1. `pnpm install`
2. `pnpm build`
3. In Logseq, enable developer mode and load the plugin directory (not the `dist` folder).

## Configuration

Inside the plugin settings provide:

- `Todoist token`: personal token from [Todoist Integrations](https://todoist.com/prefs/integrations).
- `Target page`: prefix for the Logseq pages where tasks will be synced (defaults to `todoist`). Tasks will be organized under `{prefix}/YYYY-MM-DD` and `{prefix}/Backlog`.
- `Sync interval (min)`: minutes between automatic background syncs (defaults to `5`).

## Usage

- **Manual sync**: click the toolbar icon (📁) or run the command palette entry `Todoist: Sync backup`.
- **Automatic sync**: runs in the background without refreshing the UI, respecting the configured interval.
- **Block format**:

```
[[YYYY-MM-DD]] Title [todoist](https://todoist.com/showTask?id=...)
todoist-id:: 123456789
todoist-desc:: Short description ("-" if empty)
todoist-project:: Project name
todoist-labels:: #label-1 #label-2
```

Dates are normalized to `YYYY-MM-DD`. Labels are sanitized and prefixed with `#`.

## Sync behavior

- Each task is identified by `todoist-id::`. Existing blocks are updated, new ones appended, and obsolete ones removed. Completed tasks remain available unless deleted in Todoist.
- Tasks are automatically distributed to pages based on their dates:
  - **Completed tasks**: placed in `{prefix}/{completion_date}` (e.g., `todoist/2025-10-18`)
  - **Active tasks with due dates**: placed in `{prefix}/{due_date}` (e.g., `todoist/2025-10-20`)
  - **Tasks without dates**: placed in `{prefix}/Backlog`
- When a task's date changes, it is automatically moved to the appropriate page during the next sync.
- When no tasks are found for a page, a placeholder block with `No tasks found.` is inserted.
- All interactions with Todoist are read-only.

## Development

- `pnpm dev` runs Vite with HMR.
- `pnpm build` produces the distributable in `dist`.
- Main logic lives in `src/main.ts`.

Contributions are welcome—feel free to open issues or pull requests with improvements and suggestions.
