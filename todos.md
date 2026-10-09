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

## Next

- [ ] **[URGENT]** Unbounded `git rev-list` walks are repeated on every history, tags and sidebar request.
    - What it is: `getUnpushedCommitSet` (`src/backend/services/git/git-helpers.ts:552`) runs `git rev-list HEAD --not --remotes` with no cap and is called by every history page (`git-history.ts:120`), every commit detail (`git-history.ts:175`) and the tag list (`git-tags.ts`). `getRepoSidebarStatus` (`git-changes.ts:98`) runs a separate full `rev-list --count` whenever a branch has no upstream, and the UI only needs to know whether the count is greater than zero.
    - How it will be implemented: cache the unpushed SHA set per repo path keyed by the current `HEAD` sha plus the mtimes of `.git/refs/remotes` and `.git/packed-refs`, invalidating on mismatch; pass `--max-count` for the callers that only test membership of the displayed commits and for the "anything publishable?" check in the sidebar status.

- [ ] **[URGENT]** The file and history trees render every row with no virtualization.
    - What it is: `FileTree.vue:111` flattens the whole tree and the `v-for` at `FileTree.vue:148` mounts a full row (plus icon buttons, tooltips and menu directives) per entry; `RepChangesView`, `RepHistoryView` and `SidebarRepositories` all use it. A repo with thousands of changed files or a long history builds all rows at once, and `loadMoreHistory` keeps appending.
    - How it will be implemented: window the flattened list by scroll offset with a fixed row height, keeping the existing flatten and selection logic untouched; falls back to pagination if the row height cannot be made uniform. Note that the browser specs assert on row testids, so the existing selectors have to keep working.

- [ ] **[NOT_URGENT]** A mutation response still replaces the whole repository list, even though the status it carries is now cached.
    - What it is: `buildBootstrap` (`src/backend/services/app.ts:431`) is still the return value of about forty mutating methods (`stageFile`, `commitRepo`, `renameRepo`, `discardStash`, `createTag`, …), so each one ships every repository, group and account and the renderer's `stateCounter` watch then calls `useRepo(...).update(...)` for every repository. The per-repository status sweep that used to make this expensive is now cached (`src/backend/services/repoStatusCache.ts`), so only the payload shape and the blanket renderer update remain.
    - How it will be implemented: return the cheap DB lists plus the status of the repository the mutation touched, and have the renderer apply that single repository to its existing list instead of replacing all of them; keep `getBootstrap` for startup and repo-list changes.

- [ ] **[NOT_URGENT]** An untracked file is read twice before its size check rejects it.
    - What it is: the untracked branch of `getFileDiff` (`src/backend/services/git/git-changes.ts:344`) runs `git diff --no-index` and then reads the working-tree file, and only afterwards applies the 1 MB `previewByteLimit`. A huge generated file is fully buffered and diffed before being rejected.
    - How it will be implemented: call `readWorkingTreeFileSize` first and return the existing "file too big to preview" entry immediately when it exceeds the limit; only run `diff --no-index` and read content when the file is small enough to preview.

- [ ] **[NOT_URGENT]** The conflict editor re-parses the file quadratically and rebuilds every view zone on each keystroke.
    - What it is: `ConflictMonacoEditor.onDidChangeContent` calls `syncEditorChrome` per keystroke, which reads the full model, calls `parseMergeConflictBlocks` twice, then clears and recreates a DOM node with buttons per conflict block plus `changeViewZones` and `deltaDecorations`. Inside the parse, `countLines(content.slice(0, startOffset))` (`src/mainview/lib/mergeConflicts.ts:53`) re-scans the file from offset zero for every block.
    - How it will be implemented: debounce or rAF the chrome sync, compute the newline offsets once per parse and derive `startLine` from that table instead of re-slicing, and reuse zones keyed by block rather than destroying and recreating them.

- [ ] **[NOT_URGENT]** Missing indexes and non-transactional sequence rewrites.
    - What it is: `normalizeSequence` and `applySequenceOrder` (`src/electronUtils/useDatabase.ts:95,103`) issue one write per row with no transaction; `repositories(group_id)`, `repositories(account_id)` and `accounts(is_default)` have no index, and a SQLite foreign key does not create one — so `listGroups`' join degrades to a scan per group.
    - How it will be implemented: wrap the bulk sequence rewrites in `db.transaction(...)`, and add the three indexes with `CREATE INDEX IF NOT EXISTS` inside `configureDatabase` so existing databases pick them up.

- [ ] **[NOT_URGENT]** OAuth device sessions are never evicted and the provider poll interval is not enforced.
    - What it is: the `oauthSessions` map in `src/backend/services/oauth.ts` only removes the session currently being polled, and the provider's `intervalSeconds` is not checked server-side. An abandoned sign-in stays in memory for the process lifetime, and a renderer polling faster than the agreed interval can trip provider rate limiting.
    - How it will be implemented: sweep expired sessions at the entry of the start and poll handlers (or on a timer), and reject a poll that arrives before the next allowed poll time instead of forwarding it to the provider.

- [ ] **[NOT_URGENT]** The full file pair is normalized for "no actual change" at least twice per selection.
    - What it is: `useDiffViewer` calls `hasNoActualDiffChanges` (`src/mainview/composables/useDiffViewer.ts:33`), then `DiffsDiffEditor.createRenderedDiff` (`DiffsDiffEditor.vue:79`) calls `normalizeComparableDiffText` on both sides again, and `hasOnlyWhitespaceChanges` runs two more full-content regex replaces; `selectedDiffConflictCount` (`RepChangesView.vue:178`) regex-scans the whole modified content on top. The normalizer in `src/shared/diffIgnoredChars.ts:116` walks every character of both files per pass.
    - How it will be implemented: compute the normalized pair once per diff and pass the result into `DiffsDiffEditor` instead of recomputing it there, and derive the conflict-marker count from that same pass; also early-return from the normalizer when `ignoredChars` is empty and whitespace stripping is off.

- [ ] **[NOT_URGENT]** Hunk anchors re-split the whole patch and re-query the shadow DOM per hunk.
    - What it is: `setHunkAnchors` (`src/mainview/components/DiffsDiffEditor.vue:360`) runs from `onPostRender` on every render and, per hunk, does `gutter.querySelector` plus `addLine.querySelectorAll('.gitvan-hunk-button')`, while `buildChangeBlockPatch` (`DiffsDiffEditor.vue:191`) re-splits the entire patch with `fullPatch.split(/^@@ /m)`. A diff with hundreds of hunks costs O(hunks × patch size) string scanning on each render.
    - How it will be implemented: split the patch once per diff and cache the per-hunk patches in a `Map`, and build the anchors once per rendered node instead of from the post-render callback.

- [ ] **[NOT_URGENT]** `MonacoEditor` forces a layout and copies the whole model on every keystroke.
    - What it is: the watcher on `modelValue` (`src/mainview/components/MonacoEditor.vue:81`) runs `syncEditor`, which calls `modelRef.getValue()` (a full string copy), `updateOptions` and `editorRef.value.layout()` even when only the content changed; `onDidChangeContent` writes `modelValue` back, so this runs per keystroke. `automaticLayout` is already enabled in `lib/monaco.ts:91`, making the explicit `layout()` redundant.
    - How it will be implemented: distinguish an editor-originated change from an external one (the `applyingExternalValue` flag already exists) so only external changes hit the compare/`setValue` path; drop the `layout()` call and call `updateOptions` only when the options object actually changed.

- [ ] **[NOT_URGENT]** Dragging a splitter re-renders the whole panel and writes to `localStorage` on every `mousemove`.
    - What it is: `EtSplitter.onResize` (`src/mainview/components/EtSplitter.vue:41`) runs unthrottled on raw `mousemove`: it reads `getBoundingClientRect`, writes the reactive `currentWidth` — which re-invokes the slot content and re-patches the entire slotted panel, including a large file tree — and calls synchronous `localStorage.setItem`.
    - How it will be implemented: coalesce the update into a `requestAnimationFrame` callback, cache the container rect on `mousedown`, and persist the width to `localStorage` once on `mouseup`.

- [ ] **[NOT_URGENT]** Changing the diff font size rebuilds the entire diff DOM.
    - What it is: the watcher in `DiffsDiffEditor.vue:486` includes `settings.state.diffFontSize` and `diffViewWrap` and calls `renderDiff`, which calls `instance.render({ forceRender: true })` — a full teardown and rebuild under the shadow root — even though font size is already applied through the `--diffs-font-size` CSS custom property in `hostStyle` (`DiffsDiffEditor.vue:509`).
    - How it will be implemented: remove `diffFontSize` from the watcher (CSS already covers it), keep `diffViewWrap` only if it truly changes rendering options, and avoid `forceRender` when only display options changed.

- [ ] **[NOT_URGENT]** The repositories sidebar writes reactive state on every scroll event while its dropdown is open.
    - What it is: `updateAddMenuPosition` (`src/mainview/components/SidebarRepositories.vue:101`) reads `getBoundingClientRect` and writes the reactive `addMenuPosition` on each `scroll` (capture) and `resize` event (`SidebarRepositories.vue:176`), so every scroll frame of any pane forces a layout read and a re-render.
    - How it will be implemented: throttle the handler with `requestAnimationFrame` and skip the reactive write when the computed position did not change; closing the menu on scroll is an acceptable alternative if it keeps the behaviour stable.

- [ ] **[NOT_URGENT]** The Explorer can only select a snapshot from the first history page.
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
- [ ] `oauth.ts` has no test at all: device flow start, polling, `slow_down` interval bump,
      session expiry, `access_denied`, and the token exchange. Mock `fetch`; no backend test
      touches the network today.
- [ ] `auth.ts` has no test: the macOS keychain wrapper and its platform guard.
- [ ] `git-changes.ts`: `getFileDiff` for all three kinds including the image preview, the 1 MB
      cap and the no-diff fallback; `applyPatch`/`applyPartialFilePatch`; `ignoreRepoPath`;
      `commitRepoChanges` and `undoLastRepoCommit`; the stage/unstage/restore/delete file
      operations; `getRepoSidebarStatus` parsing for branch, ahead, behind, upstream,
      publishable commits and the error path; and the non-batched cosmetic fallback.
- [ ] `git-history.ts`: `getCommittedTree` (including ordering, types and sizes),
      `getCommittedFile` (cap, image preview, binary detection, "no commits yet"),
      `normalizePageCount` for invalid input, and tag refs inside `%d`.
- [ ] `git-helpers.ts`: `normalizeGitIgnoreEntry` and `appendGitIgnoreEntry`,
      `buildImagePreview`, `textByteSize`, `readGitMetadataFile`, `readGitIndexStageFile`,
      `parseIncomingBranchFromMergeMessage`, `countConflictMarkers`, `parseTrackCounts`,
      `labelForStatus`, `extractConflictPathsFromCommitBody`, `buildDiffStats`, and the
      rename/copy branch of `parseCommitFilesWithConflicts`.
- [ ] `git-common.ts`: the remote auth path (`createRemoteGitEnvForUrl`, the non-HTTPS
      rejection, the host-mismatch guard and the askpass script), `runWithConcurrency`,
      `resolveGitExecutable`, and the buffered run variants. Every existing remote test passes
      `auth: undefined`, so the whole auth branch is dead in tests.
- [ ] `app.ts`: the remaining handlers that only `app.spec.ts` now partially covers — bootstrap
      and selection, repository/group/account CRUD and ordering, clone and create, remote
      operations, merge and stash recovery, and `resolveRepoFilePath`. Also assert that paths
      escaping the repository (for example `../../etc/passwd`) are rejected.
- [ ] `useDatabase.ts`: sequence normalization, `moveSequence`/`reorderSequence` bounds, and the
      legacy-database migration path. The statement cache in `createRuntimeDatabaseClient` is covered.
- [ ] `repoStatusCache.ts`: `invalidateAllRepoSidebarStatuses` while a computation is in flight.

### Frontend unit and component tests

- [ ] Composables with no spec: `useConfirmation.ts` (queueing, anchoring, confirm/cancel) and
      `useToast.ts`.
- [ ] `useRepo.ts`: only about fourteen of its eighty public methods are named in any spec.
      Cover the commit flow (`commitRepository`, `suggestedCommitSummary`, `canCommit`,
      amend/cancel), file operations (stage/unstage/discard/delete/revert, single and bulk),
      branch operations, tag operations, the stash operations, and the history/file-history
      loaders.
- [ ] Components with no dedicated spec, most valuable first: `DiffsDiffEditor.vue` (hunk
      anchoring), `ConflictMonacoEditor.vue`, `Popover.vue`, `FileTree.vue` and
      `ChangesFileTree.vue`, `DraggableList.vue`, `EtSplitter.vue`, `RepExplorerView.vue`,
      `AppCreateRepositoryModal.vue`, `Settings.vue` and `SettingsEditors.vue`,
      `GitClientHeader.vue`, `CommitInspectPane.vue`, `CenteredInputModal.vue`,
      `MonacoEditor.vue`, `MonacoEditorSettingsButton.vue`, and the small presentational ones
      (`Button`, `IconButton`, `Alert`, `AppErrorBanner`, `AppSuccessToast`).
- [ ] Directives: `VLoading.ts` has a spec; `VTooltip.ts`, `VContextMenu.ts`, `VError.ts` and
      `ContextMenuPanel.vue` still have none.
- [ ] `lib` modules with no test: `monaco.ts`, `mergeConflicts.ts`, `nativePaths.ts`,
      `buildOpenWithEntries.ts` and `loadingIndicatorState.ts`.

### Harness

- [ ] Assert that `src/shared/apiMethods.ts` stays in sync with the handlers in `app.ts` and
      `src/electron/main.ts`, so a renamed handler cannot silently vanish from the renderer's
      task list.
- [ ] Run `bun run test:ui`, `bun run test:e2e` and `bunx vue-tsc --noEmit` in CI. Nothing
      enforces the suites today, and `vite build` does not typecheck, so a green local run is
      the only signal there is.
- [ ] Decide what to do with `src/mainview/tests/App.real.spec.ts`: it is excluded by
      `vite.config.ts` and `package.json`, so it never runs, and it needs local fixture data.
      Either gate it behind an env var and document it, or delete it.
