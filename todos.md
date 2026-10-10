# Gitvan Todos

## General

General notes and new ideas go here. Drop ideas in any shape, then move them into
**Next** once they have a concrete shape and a marker. Nothing in this file is a
per-implementation checklist.

Conventions for **Next**:

- `[URGENT]` — real and highest priority.
- `[NOT_URGENT]` — real but can wait.
- `[NOT_PLANNED]` — deliberate. Listed so it is not proposed again, and so it is
  considered in future planning.

Maintenance rule: when no unaddressed `[URGENT]` item is left in **Next**, review the
`[NOT_URGENT]` items, promote the ones with the highest impact to `[URGENT]`, and move
them to the top of the section.

Each **Next** item is one sentence plus two lines: what it is, and how it will be
implemented. Do not store benchmark numbers or implementation detail in **Done**.

## Done

- Added a repeatable backend performance baseline that any item can be measured against with `bun do.ts perf`.
- Made the per-repository sidebar status a single cached owner that mutating git commands invalidate.
- Added finite timeouts and request-scoped cancellation to spawned git commands.
- Stopped fetching a commit's whole patch when only its file list is displayed.
- Made bulk discard partition a batch and mutate tracked and untracked paths in two commands.
- Classified cosmetic changes from batched git reads instead of per-file commands.
- Read each blob once for the cosmetic-change check.
- Made the periodic refresh status-only, paused it while hidden, and reused an unchanged file diff.
- Reported a repository that was removed mid-request as a handled outcome instead of a raw type error.
- Removed an account even when its keychain entry cannot be deleted, instead of failing after the row was gone.
- Made a repository with no commits yet report an empty history, an empty snapshot and a clean status.
- Read the cosmetic flags off each change entry instead of searching the list for the entry being mapped.
- Reused the loading directive's overlay layer while it is visible so updates no longer grow the z-index stack.
- Reused prepared SQLite statements per connection instead of recompiling every query.
- Kept the useTasks running set bounded per operation and cancelled its pending long-running timer.
- Precomputed the file icon and language lookup at module load instead of rebuilding the table per row.
- Looked repositories up once per bootstrap in useRepos instead of a deep watch and a nested find.
- Ordered the change multi-selection through one index map instead of a scan per comparison.
- Removed the debug logging from the diff render, hover and discard paths.
- Swept expired OAuth device sessions and answered a too-early poll without forwarding it.
- Added the missing foreign-key indexes and ran the sequence rewrites in one transaction.
- Size-checked an untracked file before diffing it, counting its lines from numstat instead.
- Resized the diff font through the CSS custom property instead of rebuilding the diff.
- Coalesced splitter drags into one frame and persisted the width on mouseup.
- Stopped the monaco editor syncing the whole model on every keystroke.
- Throttled the repositories add-menu reposition to one frame per scroll.
- Shared the unpushed commit set across the views that ask for it and dropped it on a mutation.
- Kept a status scan that started before a refresh from repopulating the emptied cache.
- Rejected a repository path that resolves outside the repository root.
- Windowed the file trees with uniform rows, keeping the history tree on its page size.
- Returned only the repositories a mutation touched and merged them in the renderer.
- Synced the conflict chrome once per frame and reused its zones across edits.
- Normalized the diff pair once per diff and reused it for the badge, the renderer and the conflict count.
- Split a hunk patch once per diff and anchored the hunk buttons once per rendered node.

## Next

- [ ] **[URGENT]** The Explorer can only select a snapshot from the first history page.
    - What it is: `RepExplorerView` fills the snapshot `<select>` from `repo.history?.commits`, which holds one page (60) until the history view asks for more, and the Explorer has no load-more of its own — so an older commit cannot be selected in a deep repository.
    - How it will be implemented: give the Explorer its own way to page the commit list (request a larger limit while it is open, or load another page from the select) and keep `explorerCommitSha` selection stable across those loads.

- [ ] **[NOT_PLANNED]** Keep the localhost Express backend and the IPC-to-HTTP transport as the single request path.
    - What it is: every call is structured-cloned over IPC, sent as JSON to the Express server, parsed, answered as JSON, parsed again in the renderer and cloned back (`src/electronUtils/helpers.ts:24`, `src/electronUtils/browserOnlyHelpers.ts:79`, `src/electronUtils/mainProloadHelpers.ts:169`), which costs more than an in-process call for large diff payloads.
    - Why it is deliberate: the same transport is what makes the browser `dev2` mode and the standalone server work, and collapsing the Electron path into direct handler calls would fork the request path. Keep the extra serialization as the price of one transport; the payloads themselves are the thing to shrink.

- [ ] **[NOT_PLANNED]** Keep interval and focus polling as the change-detection mechanism; do not add a filesystem watcher.
    - What it is: the app re-reads repository state on a 20 s interval and on window focus (`src/mainview/composables/initializeStates.ts:194,141`) rather than watching the working tree, so out-of-band edits are picked up with a delay and the sweep cost is paid continuously.
    - Why it is deliberate: a recursive watcher over user repositories brings platform-specific limits, event storms on large trees and a new class of bugs, for a desktop Git client where a short delay is acceptable. Polling is a status-only refresh now, and the plan is to keep it cheap rather than replace it.

- [ ] **[NOT_PLANNED]** Keep full-file diff loading with the 1 MB preview cap; no streaming or paginated diffs.
    - What it is: diffs carry both full file sides in one payload and are capped by `previewByteLimit` (`src/backend/services/git/git-helpers.ts:6`) with a "file too big to preview" message, rather than being streamed or paged.
    - Why it is deliberate: the diff engine needs both complete sides to parse a file, so streaming would require a different diff pipeline. The cap is the intended guard; the plan is to trim payloads that are not needed at all, not to re-architect diff delivery.

- [ ] **[NOT_PLANNED]** Keep git execution in the native host; no renderer-side git and no browser-side diff computation.
    - What it is: `runGit`/`executeCommand` live in the main process and the renderer only ever receives results, so a slow git command occupies the host rather than a renderer worker.
    - Why it is deliberate: this matches the boundary in `AGENTS.md` — the native layer owns PTY, git execution and filesystem mutation, and Vue owns orchestration. Offloading git to a renderer worker or a browser reimplementation would break that split; the plan is to keep reducing how many git commands are issued, not to move where they run.

- [ ] **[NOT_PLANNED]** Each changed-file row mounts a body-level tooltip, a document click listener and a forced layout read.
    - What it is: `v-tooltip` (`src/mainview/directives/VTooltip.ts:165`) appends a tooltip element to `document.body` and registers a `document` click listener per bound element, and `v-loading` (`src/mainview/directives/VLoading.ts:21,34`) calls `getComputedStyle(el).position` and reads `el.clientWidth/clientHeight` per element at mount. `RepChangesView` puts one or two of each on every unlocked row (`RepChangesView.vue:974-991`), so a large changes list creates thousands of body nodes, thousands of document listeners and thousands of forced synchronous layouts.
    - How it will be implemented: move to one shared singleton tooltip driven by delegated `mouseover`/`mouseout` on the list container (skipping the `updated` rewrite when the value string is unchanged), and make `v-loading` set the position and icon size through CSS classes instead of reading computed style and element size at mount.

## Test Suite

Missing tests, in the order worth writing them. This section tracks coverage only; the
markers above track product work. Update it whenever a gap is filled instead of leaving
stale entries behind.

How to run what exists today: `bun run test:ui` (Vitest, unit and component) and
`bun run test:e2e` (Playwright, browser). The browser run owns its own ports and a fresh
database per run, so it never touches the developer's app data.

### Browser specs (highest user risk first)

- [ ] Settings leftovers: verifying a provider token and starting the OAuth device sign-in both need
      the provider's API, so they need a stub that can fail on demand. The panels, the account
      lifecycle and the OAuth provider settings now have specs.
- [ ] Explorer leftover: "Select a file to inspect the committed contents." is unreachable because
      loading a snapshot always selects its first file, so nothing covers it. The empty states
      ("No commits found.", "No committed files found") have specs through the empty lab.
- [ ] Dev-server stubs for the native pickers: `native-boundary.spec.ts` pins that every
      `src/electron/main.ts` RPC reports itself unavailable in browser dev mode, so a stub has to
      update that guard. With one, creating a local repository and picking an editor or terminal
      from disk become testable.

### Backend unit tests

- [ ] `git-merge.ts` has no test at all: merge conflict state, per-file conflict details,
      ours/theirs resolution, mark resolved, save resolution, abort and commit merge.
- [ ] `git-stash.ts` has no test at all: list, detail, file diff, create, restore and discard,
      including the stash-restore conflict classification.
- [ ] `auth.ts` has no test: the macOS keychain wrapper and its platform guard.
- [ ] `git-changes.ts`: `applyPatch`/`applyPartialFilePatch`; `ignoreRepoPath`;
      `commitRepoChanges` and `undoLastRepoCommit`; the stage/unstage/restore/delete file
      operations; `getRepoSidebarStatus` parsing for branch, ahead, behind, upstream,
      publishable commits and the error path; and the non-batched cosmetic fallback.
- [ ] `git-history.ts`: `getCommittedTree` (including ordering, types and sizes),
      `getCommittedFile` (cap, image preview, binary detection, "no commits yet"),
      `normalizePageCount` for invalid input, and tag refs inside `%d`.
- [ ] `git-helpers.ts`: `appendGitIgnoreEntry`,
      `buildImagePreview`, `readGitMetadataFile`, `readGitIndexStageFile`,
      `parseIncomingBranchFromMergeMessage`, `countConflictMarkers`, `parseTrackCounts`,
      `labelForStatus`, `extractConflictPathsFromCommitBody`, `buildDiffStats`, and the
      rename/copy branch of `parseCommitFilesWithConflicts`.
- [ ] `git-common.ts`: the remote auth path (`createRemoteGitEnvForUrl`, the non-HTTPS
      rejection, the host-mismatch guard and the askpass script), `runWithConcurrency`,
      `resolveGitExecutable`, and the buffered run variants. Every existing remote test passes
      `auth: undefined`, so the whole auth branch is dead in tests.
- [ ] `app.ts`: the remaining handlers that only `app.spec.ts` now partially covers — bootstrap
      and selection, repository/group/account CRUD and ordering, clone and create, remote
      operations, and merge and stash recovery. `resolveRepoFilePath` is covered, including the
      paths that escape the repository.
- [ ] `useDatabase.ts`: sequence normalization, `moveSequence`/`reorderSequence` bounds, and the
      legacy-database migration path. The statement cache and transactions in
      `createRuntimeDatabaseClient` are covered.

### Frontend unit and component tests

- [ ] `useRepo.ts`: only about fourteen of its eighty public methods are named in any spec.
      Cover the commit flow (`commitRepository`, `suggestedCommitSummary`, `canCommit`,
      amend/cancel), file operations (stage/unstage/discard/delete/revert, single and bulk),
      branch operations, tag operations, the stash operations, and the history/file-history
      loaders.
- [ ] Components with no dedicated spec, most valuable first: `DiffsDiffEditor.vue` (hunk
      anchoring), `Popover.vue`, `ChangesFileTree.vue`,
      `DraggableList.vue`, `RepExplorerView.vue`,
      `AppCreateRepositoryModal.vue`, `Settings.vue` and `SettingsEditors.vue`,
      `GitClientHeader.vue`, `CommitInspectPane.vue`, `CenteredInputModal.vue`,
      `MonacoEditorSettingsButton.vue`, and the small presentational ones
      (`Button`, `IconButton`, `Alert`, `AppErrorBanner`, `AppSuccessToast`).
- [ ] Directives: `VLoading.ts` has a spec; `VTooltip.ts`, `VContextMenu.ts`, `VError.ts` and
      `ContextMenuPanel.vue` still have none.
- [ ] `lib` modules with no test: `monaco.ts`.

### Harness

- [ ] Run `bun run test:ui`, `bun run test:e2e` and `bunx vue-tsc --noEmit` in CI. Nothing
      enforces the suites today, and `vite build` does not typecheck, so a green local run is
      the only signal there is.
- [ ] Decide what to do with `src/mainview/tests/App.real.spec.ts`: it is excluded by
      `vite.config.ts` and `package.json`, so it never runs, and it needs local fixture data.
      Either gate it behind an env var and document it, or delete it.
