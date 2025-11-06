Logseq Todoist Backup – Agent Guidelines
=======================================

Project Snapshot

- Logseq plugin written in strict TypeScript, bundled with Vite (`npx pnpm build`).
- Main entry: `src/main.ts`; supporting modules: `todoist.ts`, `blocks.ts`, `settings.ts`, `scheduler.ts`, `ui.ts`, `logger.ts`, `constants.ts`.
- Interacts with Logseq runtime (`logseq` global) for UI, scheduling, and page mutations; communicates with Todoist REST API v1 via HTTPS.
- Plugin setting `include_comments` controls whether Todoist comments are fetched during sync (default `false`).
- Plugin setting `exclude_title_patterns` accepts newline-separated regex patterns to skip Todoist tasks whose titles match.
- Plugin setting `enable_debug_logs` controls visibility of debug and info logs in browser console (default `false`); errors always visible.
- Plugin settings `status_alias_active`, `status_alias_completed`, and `status_alias_deleted` allow customization of task status display values (defaults: ◼️, ✅, ❌ respectively); aliases are applied to the `todoist-status::` property in task blocks.
- When comments are enabled, `comments_collapsed` determines if the wrapper block starts collapsed (default `true`).
- Tasks are organized in journal-style pages by date: `{page_name}/YYYY-MM-DD` for tasks with dates, `{page_name}/Backlog` for tasks without dates. This prevents single-page performance issues as task count grows.

Environment & Tooling

- Package manager: pnpm (invoke via `npx pnpm ...`); lockfile is `pnpm-lock.yaml`.
- Install deps before running scripts: `npx pnpm install`.
- Build command: `npx pnpm build` (runs `tsc` then `vite build`).
- Lint command: `npx pnpm exec eslint ./src --ext .ts` (uses local ESLint 8 + `@typescript-eslint` 8 with `.eslintrc.json`).
- Target Node version aligns com CI (`actions/setup-node@v3`) rodando Node 20.8+. Evite APIs ausentes nesse runtime.

Code Structure Rules

- Preserve module boundaries: keep Todoist API DTOs and helpers inside `todoist.ts`; block construction in `blocks.ts`; scheduling logic in `scheduler.ts`; logging utilities in `logger.ts`.
- Keep all new runtime constants inside `constants.ts` unless strongly scoped to a module.
- UI composition (`registerToolbar`, `provideStyles`, etc.) remains in `ui.ts`; avoid mixing DOM strings elsewhere.
- Logging: use `logInfo()`, `logWarn()`, `logDebug()`, and `logError()` from `logger.ts` instead of raw console.* calls; structured logs use `logDebug(operation, data)` format.
- Use TypeScript types exported from `todoist.ts` when handling Todoist entities; never duplicate type shapes.
- Prefer pure functions returning new data over mutating inputs unless interacting with Logseq APIs that require mutation.
- Document every function with a concise JSDoc block describing purpose and parameters. Include comment formatting expectations for comment blocks: prefix each Todoist comment with `[todoist](url)` and append sanitized text when present.
- Page organization logic resides in `blocks.ts`: `resolveTaskPageName()` determines destination page based on task dates; `writeBlocks()` groups tasks by page and distributes them accordingly; `cleanupObsoletePages()` removes tasks from old pages when dates change.

TypeScript & Validation Expectations

- Project runs with `strict` compiler options; ensure new code respects strict null checks and type inference.
- Validate all external inputs aggressively:
  - Todoist responses: guard optional fields, normalize IDs to `string`, validate dates against `ISO_DATE_PATTERN`, and handle pagination cursors defensively.
  - Logseq settings: trim strings, coerce numbers, clamp intervals (`>= 1 minute`); reuse `readSettingsWithInterval` for timing.
- User-provided text: sanitize using existing helpers (`safeText`, `safeLinkText`, `formatLabelTag`, `convertInlineTodoistLabels`) before embedding into Logseq blocks; `safeLinkText` preserves Logseq wiki links and Markdown bracketed labels while stripping unmatched brackets; `convertInlineTodoistLabels` transforms Todoist inline labels (`@label-name`) to Logseq hashtags (`#label-name`) while preserving email addresses and leaving `@` mentions inside `[[wiki links]]` untouched.
- Prefer `unknown` over `any` for new external payloads; narrow via predicates or dedicated type guards.
- Handle async errors with try/catch; present actionable messages via `logseq.UI.showMsg` and log details using `logError()` from `logger.ts`.

Quality Gates Before Submitting Changes

- Run `npx pnpm install` if dependencies changed or a new workspace is cloned.
- Run `npx pnpm exec eslint ./src --ext .ts` to ensure zero lint errors.
- Run `npx pnpm build` to confirm TypeScript type-check passes and bundle succeeds.
- Add `"type": "module"` to `package.json` if Node warns about ESM config files.
- For behavioral changes, manually test within Logseq if possible: trigger manual sync, confirm automatic sync scheduling, verify block updates/deletions.

Development Conventions

- Avoid introducing global state beyond what already exists (`syncInProgress`, `scheduledSync`); prefer closures or module-scoped consts.
- Automatic background syncs must preserve the user's editing focus; capture the editing cursor before running and restore it afterward.
- Use template literals only when placeholders are necessary; keep strings ASCII.
- Keep network utilities reusable; any new endpoint helpers belong in `todoist.ts` with shared pagination handling.
- When updating existing blocks, ensure `todoist-id::` remains the canonical identifier; changes to block formatting must stay backward compatible and preserve completed tasks.
- Preserve Logseq history of completed items: blocks containing `todoist-completed::` should never be removed during sync.
- Use `todoist-status::` to persist task lifecycle (`active`, `completed`, `deleted`); the displayed status value uses configured aliases from settings (default emojis: ◼️ for active, ✅ for completed, ❌ for deleted); only remove blocks when Todoist no longer returns the task (treated as deleted).
- Do not commit unused modules; delete dead code paths and ensure imports stay minimal.
- Tasks are distributed across date-based pages: completed tasks use `completed_date`/`completed_at`, active tasks use `due` date, tasks without dates go to `{page_name}/Backlog`. When a task's date changes, it is automatically moved to the appropriate page during sync.

Error Handling & Logging

- Use structured logging from `logger.ts`: `logInfo()`, `logWarn()`, `logDebug(operation, data)`, `logError(message, error)`.
- Debug and info logs respect `enable_debug_logs` setting (default disabled); errors always visible regardless of setting.
- Structured debug logs use the format `logDebug("operation_name", { key: value })` for data visibility (e.g., `fetch_completed`, `write_blocks_start`).
- Distinguish between manual and automatic sync contexts: warn the user only for manual triggers, use `logInfo()` for background jobs.
- Never log raw Todoist tokens or sensitive user data; sanitize error objects before logging.
- Retry logic must avoid tight loops; respect existing backoff via scheduling (`scheduleAutoSync`).

Performance & Scheduling

- Keep `scheduleAutoSync` idempotent; always cancel previous timers before creating new ones.
- Avoid blocking UI thread: lengthy operations should stay asynchronous and rely on `Promise.all` for parallel Todoist fetches.
- When processing tasks, work on copies (`[...tasks]`) to avoid mutating caller-owned arrays.
- Journal-style page organization ensures each page remains small and performant: tasks are distributed by date to prevent single-page bottlenecks as backup history grows over months.

Security & Privacy

- Never log raw Todoist tokens or sensitive user data; logging utilities in `logger.ts` must never expose credentials.
- Ensure headers for API calls include `Authorization: Bearer` only when token is present; abort early if missing.

Review Checklist

- [ ] Code adheres to module boundaries and naming conventions.
- [ ] All new inputs validated, sanitized, and have explicit TypeScript types.
- [ ] Lint and build commands succeed locally.
- [ ] No extraneous files created; obsolete assets removed if unused.
- [ ] Documentation (README, this AGENT spec) updated when behavior or workflows change.

Maintainers expect contributions to favor maintainability, readability, and defensive programming. When in doubt, add explicit validation and document assumptions.
