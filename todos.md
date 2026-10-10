# Gitvan Todos

## General

General notes and new ideas go here. Drop ideas in any shape, then move them into
**Next** once they have a concrete shape and a marker. Nothing in this file is a
per-implementation checklist.

Conventions for **Next** and **Test Suite**:

- `[URGENT]` — real and highest priority.
- `[NOT_URGENT]` — real but can wait.
- `[NOT_PLANNED]` — deliberate. Listed so it is not proposed again, and so it is
  considered in future planning.

Every **Test Suite** item also carries the kind of spec that closes it: `[BROWSER]`,
`[BACKEND UNIT]`, `[FRONTEND TEST]` or `[HARNESS]`. That section tracks coverage only.

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
- Gave the Explorer its own pageable commit list, so an older snapshot is selectable and stays selected.

## Next

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

Missing test coverage only. It carries the same markers as **Next**, paired with the kind of
spec that closes the gap — `[BROWSER]`, `[BACKEND UNIT]`, `[FRONTEND TEST]` or `[HARNESS]` —
so one flat list says both how much it matters and what writing it means. The `[BROWSER]`
entries come first within each marker because they cover the flows a user actually runs.

- [ ] **[URGENT] [BACKEND UNIT]** `git-merge.ts` has no test at all.
    - What it is: every merge path is uncovered — merge conflict state, per-file conflict details, ours/theirs resolution, mark resolved, save resolution, abort and commit merge.
    - How it will be implemented: a fixture repository per merge outcome, driving the service the way `app.spec.ts` drives its handlers.

- [ ] **[URGENT] [BACKEND UNIT]** `git-stash.ts` has no test at all.
    - What it is: list, detail, file diff, create, restore and discard are uncovered, including the stash-restore conflict classification.
    - How it will be implemented: stash a fixture working tree, then assert each operation and the conflict outcome of restoring over a conflicting tree.

- [ ] **[URGENT] [BROWSER]** Settings leftovers need a stub that can fail on demand.
    - What it is: verifying a provider token and starting the OAuth device sign-in both need the provider's API, so neither can be driven from a spec today. The panels, the account lifecycle and the OAuth provider settings have specs.
    - How it will be implemented: a dev-server route that answers the provider endpoints and can be told to fail, so the success and failure paths of both flows become testable.

- [ ] **[URGENT] [FRONTEND TEST]** `useRepo.ts` names only about fourteen of its eighty public methods in any spec.
    - What it is: the commit flow (`commitRepository`, `suggestedCommitSummary`, `canCommit`, amend/cancel), file operations (stage/unstage/discard/delete/revert, single and bulk), branch and tag operations, the stash operations, and the history/file-history loaders have no direct coverage; recent work added specs for the diff-reuse and explorer-paging paths only.
    - How it will be implemented: extend the existing per-concern `useRepo-*.spec.ts` files rather than one large spec, mocking `useTasks` per operation.

- [ ] **[NOT_URGENT] [BROWSER]** Dev-server stubs for the native pickers.
    - What it is: `native-boundary.spec.ts` pins that every `src/electron/main.ts` RPC reports itself unavailable in browser dev mode, so a stub has to update that guard. With one, creating a local repository and picking an editor or terminal from disk become testable.
    - How it will be implemented: extend the dev-server stub to answer the picker RPCs, then update the `native-boundary.spec.ts` guard that asserts they are unavailable.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `git-changes.ts`.
    - What it is: `applyPatch`/`applyPartialFilePatch`; `ignoreRepoPath`; `commitRepoChanges` and `undoLastRepoCommit`; the stage/unstage/restore/delete file operations; `getRepoSidebarStatus` parsing for branch, ahead, behind, upstream, publishable commits and the error path; and the non-batched cosmetic fallback.
    - How it will be implemented: a fixture repository per operation group, asserting the resulting index and status rather than the git commands issued.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `app.ts` handlers that only `app.spec.ts` partially covers.
    - What it is: bootstrap and selection, repository/group/account CRUD and ordering, clone and create, remote operations, and merge and stash recovery. `resolveRepoFilePath` is covered, including the paths that escape the repository.
    - How it will be implemented: grow `app.spec.ts` per handler group, reusing its repository and account fixtures.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `git-helpers.ts`.
    - What it is: `appendGitIgnoreEntry`, `buildImagePreview`, `readGitMetadataFile`, `readGitIndexStageFile`, `parseIncomingBranchFromMergeMessage`, `countConflictMarkers`, `parseTrackCounts`, `labelForStatus`, `extractConflictPathsFromCommitBody`, `buildDiffStats`, and the rename/copy branch of `parseCommitFilesWithConflicts`.
    - How it will be implemented: table-driven unit tests over each parser's input shapes, with no repository fixture where a string is enough.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `git-history.ts`.
    - What it is: `getCommittedTree` (including ordering, types and sizes), `getCommittedFile` (cap, image preview, binary detection, "no commits yet"), `normalizePageCount` for invalid input, and tag refs inside `%d`.
    - How it will be implemented: a fixture history with a binary, an image and an oversized file, plus a repository with no commits yet.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `git-common.ts` remote auth path.
    - What it is: `createRemoteGitEnvForUrl`, the non-HTTPS rejection, the host-mismatch guard and the askpass script, plus `runWithConcurrency`, `resolveGitExecutable` and the buffered run variants. Every existing remote test passes `auth: undefined`, so the whole auth branch is dead in tests.
    - How it will be implemented: pass a resolved auth object into the existing remote tests instead of `undefined`, and assert the environment and askpass script the run receives.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `auth.ts` has no test.
    - What it is: the macOS keychain wrapper and its platform guard are uncovered.
    - How it will be implemented: stub the keychain command per platform and assert the guard rejects the unsupported ones.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `useDatabase.ts` sequence handling.
    - What it is: sequence normalization, `moveSequence`/`reorderSequence` bounds, and the legacy-database migration path. The statement cache and transactions in `createRuntimeDatabaseClient` are covered.
    - How it will be implemented: drive each sequence operation at its bounds, and open a legacy database fixture to walk the migration.

- [ ] **[NOT_URGENT] [FRONTEND TEST]** Components with no dedicated spec.
    - What it is: `DiffsDiffEditor.vue` (hunk anchoring), `Popover.vue`, `ChangesFileTree.vue`, `DraggableList.vue`, `RepExplorerView.vue`, `AppCreateRepositoryModal.vue`, `Settings.vue` and `SettingsEditors.vue`, `GitClientHeader.vue`, `CommitInspectPane.vue`, `CenteredInputModal.vue`, `MonacoEditorSettingsButton.vue`, and the small presentational ones (`Button`, `IconButton`, `Alert`, `AppErrorBanner`, `AppSuccessToast`).
    - How it will be implemented: most valuable first, mounting each against the mocks its neighbours already use in `src/mainview/tests/components`.

- [ ] **[NOT_URGENT] [FRONTEND TEST]** Directives.
    - What it is: `VLoading.ts` has a spec; `VTooltip.ts`, `VContextMenu.ts`, `VError.ts` and `ContextMenuPanel.vue` still have none.
    - How it will be implemented: mount a host element per directive, asserting the DOM it mounts and removes.

- [ ] **[NOT_URGENT] [FRONTEND TEST]** `lib` modules with no test.
    - What it is: `monaco.ts` is uncovered.
    - How it will be implemented: test the language and option mapping it derives, mocking the monaco module it loads.

- [ ] **[NOT_URGENT] [HARNESS]** Run the suites in CI.
    - What it is: `bun run test:ui`, `bun run test:e2e` and `bunx vue-tsc --noEmit` are not enforced anywhere, and `vite build` does not typecheck, so a green local run is the only signal there is.
    - How it will be implemented: one CI job per suite, reusing the commands in `package.json` and the browser run's own ports and temp database.

- [ ] **[NOT_PLANNED] [BROWSER]** The Explorer's "Select a file to inspect the committed contents." message stays uncovered.
    - What it is: loading a snapshot always selects its first file, so the message is unreachable and nothing covers it. The empty states ("No commits found.", "No committed files found") have specs through the empty lab.
    - Why it is deliberate: covering it would mean rendering a snapshot with no selectable file, which no real repository can produce. If that ever becomes reachable, the spec comes with it.

- [ ] **[NOT_PLANNED] [HARNESS]** `src/mainview/tests/App.real.spec.ts` stays excluded.
    - What it is: `vite.config.ts` and `package.json` exclude it, so it never runs, and it needs local fixture data.
    - Why it is deliberate: it duplicates what the browser specs already prove against the sandbox labs, and the local fixture it needs cannot exist on CI.

How to run what exists today: `bun run test:ui` (Vitest, unit and component) and
`bun run test:e2e` (Playwright, browser). The browser run owns its own ports and a fresh
database per run, so it never touches the developer's app data.
