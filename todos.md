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

## Next

- [ ] **[URGENT]** The changes view spawns up to four git processes per modified file with no concurrency cap.
    - What it is: `getRepoChanges` (`src/backend/services/git/git-changes.ts:198`) fans out over every entry and calls `hasNoActualChangeForKind` in an unbounded `Promise.all`; that helper (`git-changes.ts:529`) runs `git cat-file -s` and `git show` for both the index and the working tree per file. A working tree with a hundred modified files issues roughly four hundred concurrent git processes and reads every file's full content into JS, on every sidebar refresh.
    - How it will be implemented: derive the cosmetic classification from a single `git diff --numstat -z` (or `--raw`) pass instead of per-file commands, and route any remaining per-file git work through a small bounded pool of four to eight workers.

- [ ] **[URGENT]** The 20 s poll and window-focus refresh re-run the whole active view and re-fetch the selected file diff.
    - What it is: `initializeStates.ts:179` polls `refreshRepos` every 20 s and `initializeStates.ts:126` does the same on focus (throttled to 1.5 s). Each call runs `applyMutation`, which reloads the active view, the merge-conflict state and the stash list, and `loadChanges`/`loadHistory` re-select the current file, so `getFileDiff` runs again for the file the user is already reading.
    - How it will be implemented: split the refresh into a cheap status-only path for polling (bootstrap without the active-view reload) and a full path for explicit user actions; skip the selected-file re-fetch when path, kind and diff inputs are unchanged; pause the interval while `document.visibilityState === 'hidden'`.

- [ ] **[URGENT]** Bulk file operations spawn one or two git processes per file, strictly serially.
    - What it is: `discardRepoFiles` (`src/backend/services/git/git-changes.ts:405`) loops the paths and awaits `discardRepoFile` for each, which itself runs `git ls-files --error-unmatch` and then `git restore` or `git clean`. Discarding five hundred files is up to a thousand sequential git processes with the UI waiting.
    - How it will be implemented: one `git ls-files --error-unmatch -- <paths…>` call to partition tracked from untracked, then a single `git restore --worktree -- <tracked…>` and a single `git clean -fd -- <untracked…>`. Apply the same partitioning to the other bulk helpers in that file.

- [ ] **[URGENT]** Selecting a commit downloads the entire commit patch even though nothing reads it.
    - What it is: `getCommitDetail` (`src/backend/services/git/git-history.ts:168`) runs `git show -m --first-parent --stat --patch --format=medium` and returns the patch as `CommitDetail.patch`. No frontend code reads that field — `CommitInspectPane` and `useRepo` only use `files`, `summary`, `body`, `refs` and `tags` — so a large commit is stringified over HTTP, cloned over IPC and thrown away, right before the per-file diff is requested anyway.
    - How it will be implemented: replace the `--patch --stat` call with `--name-status` only (the file list is what the pane needs), drop `patch` from `CommitDetail`, and keep the lazy `getCommitFileDiff` request as the single source of patch content. Add a byte cap with an explicit "diff too large" marker while touching this path.

- [ ] **[URGENT]** Spawned git processes have no timeout and no cancellation.
    - What it is: `executeCommand` (`src/electronUtils/executeCommand.ts:15`) spawns without a timeout or an `AbortSignal`, and `callApiPost` (`src/electronUtils/helpers.ts:21`) has no request timeout either. A `fetch`, `pull`, `push` or `clone` against an unreachable remote never resolves, which blocks the Electron main process on the invoke; the dev server's `runWithTimeout` only rejects the HTTP promise and orphans the child process.
    - How it will be implemented: add a per-call timeout plus an `AbortSignal` to `executeCommand` that kills the child on expiry, pass generous but finite values for network operations, and propagate the abort when the request closes.

- [ ] **[NOT_URGENT]** A mutation response still replaces the whole repository list, even though the status it carries is now cached.
    - What it is: `buildBootstrap` (`src/backend/services/app.ts:431`) is still the return value of about forty mutating methods (`stageFile`, `commitRepo`, `renameRepo`, `discardStash`, `createTag`, …), so each one ships every repository, group and account and the renderer's `stateCounter` watch then calls `useRepo(...).update(...)` for every repository. The per-repository status sweep that used to make this expensive is now cached (`src/backend/services/repoStatusCache.ts`), so only the payload shape and the blanket renderer update remain.
    - How it will be implemented: return the cheap DB lists plus the status of the repository the mutation touched, and have the renderer apply that single repository to its existing list instead of replacing all of them; keep `getBootstrap` for startup and repo-list changes.

- [ ] **[NOT_URGENT]** Loading indicators leak entries onto the global z-index stack.
    - What it is: `toggleLoading` (`src/mainview/directives/VLoading.ts:65`) discards the return value of `overlayState.toggleZIndex(true, …)`, so every `updated` while a loader is visible pushes a new value onto the module-level `zIndStack` (`directives/useOverlaysState.ts:3`) that is never removed; `increaseZIndex` then computes `Math.max(...zIndStack)` over an ever-growing array.
    - How it will be implemented: reuse the already-allocated `el.__loaderZIndex` — reassign it from the `claimZIndex()` result on show and skip claiming when the element already holds one, so the stack stays bounded and `claimZIndex` stays cheap.

- [ ] **[NOT_URGENT]** The file and history trees render every row with no virtualization.
    - What it is: `FileTree.vue:111` flattens the whole tree and the `v-for` at `FileTree.vue:148` mounts a full row (plus icon buttons, tooltips and menu directives) per entry; `RepChangesView`, `RepHistoryView` and `SidebarRepositories` all use it. A repo with thousands of changed files or a long history builds all rows at once, and `loadMoreHistory` keeps appending.
    - How it will be implemented: window the flattened list by scroll offset with a fixed row height, keeping the existing flatten and selection logic untouched; falls back to pagination if the row height cannot be made uniform. Note that the browser specs assert on row testids, so the existing selectors have to keep working.

- [ ] **[NOT_URGENT]** Unbounded `git rev-list` walks are repeated on every history, tags and sidebar request.
    - What it is: `getUnpushedCommitSet` (`src/backend/services/git/git-helpers.ts:462`) runs `git rev-list HEAD --not --remotes` with no cap and is called by every history page (`git-history.ts:117`), every commit detail (`git-history.ts:173`) and the tag list (`git-tags.ts`). `getRepoSidebarStatus` (`git-changes.ts:95`) runs a separate full `rev-list --count` whenever a branch has no upstream, and the UI only needs to know whether the count is greater than zero.
    - How it will be implemented: cache the unpushed SHA set per repo path keyed by the current `HEAD` sha plus the mtimes of `.git/refs/remotes` and `.git/packed-refs`, invalidating on mismatch; pass `--max-count` for the callers that only test membership of the displayed commits and for the "anything publishable?" check in the sidebar status.

- [ ] **[NOT_URGENT]** An untracked file is read twice before its size check rejects it.
    - What it is: the untracked branch of `getFileDiff` (`src/backend/services/git/git-changes.ts:327`) runs `git diff --no-index` and then reads the working-tree file, and only afterwards applies the 1 MB `previewByteLimit`. A huge generated file is fully buffered and diffed before being rejected.
    - How it will be implemented: call `readWorkingTreeFileSize` first and return the existing "file too big to preview" entry immediately when it exceeds the limit; only run `diff --no-index` and read content when the file is small enough to preview.

- [ ] **[NOT_URGENT]** Each modified file is fetched from git twice for the cosmetic-change check.
    - What it is: `hasNoActualChangeForKind` (`src/backend/services/git/git-changes.ts:548,562`) calls `readGitRevisionFileSize` (`git cat-file -s`) and then `readGitRevisionFile` (`git show`) for the same revision, for both `HEAD:`/`:` and the working tree.
    - How it will be implemented: read each blob once and use its byte length instead of a separate `cat-file -s`, or serve both size and content from one `git cat-file --batch` session so a single process answers both questions.

- [ ] **[NOT_URGENT]** The conflict editor re-parses the file quadratically and rebuilds every view zone on each keystroke.
    - What it is: `ConflictMonacoEditor.onDidChangeContent` calls `syncEditorChrome` per keystroke, which reads the full model, calls `parseMergeConflictBlocks` twice, then clears and recreates a DOM node with buttons per conflict block plus `changeViewZones` and `deltaDecorations`. Inside the parse, `countLines(content.slice(0, startOffset))` (`src/mainview/lib/mergeConflicts.ts:53`) re-scans the file from offset zero for every block.
    - How it will be implemented: debounce or rAF the chrome sync, compute the newline offsets once per parse and derive `startLine` from that table instead of re-slicing, and reuse zones keyed by block rather than destroying and recreating them.

- [ ] **[NOT_URGENT]** SQLite statements are recompiled on every call.
    - What it is: every method in `src/backend/services/database.ts` builds a new SQL string and calls `db.prepare(...)` per invocation, and `createRuntimeDatabaseClient` (`src/electronUtils/useDatabase.ts:42`) prepares a fresh statement each time. Settings are read and written on every `getChanges` and `getEditorSettings`, so hot queries recompile constantly.
    - How it will be implemented: memoise prepared statements in a `Map<string, Statement>` inside `createRuntimeDatabaseClient` and reuse them across calls, clearing the map if the schema changes.

- [ ] **[NOT_URGENT]** Missing indexes, non-transactional sequence rewrites, and a dead UPDATE in group deletion.
    - What it is: `deleteGroup` (`src/backend/services/database.ts:364`) deletes the group's repositories and then runs `UPDATE repositories SET group_id = NULL WHERE group_id = ?`, which can no longer match anything; `normalizeSequence` and `applySequenceOrder` (`src/electronUtils/useDatabase.ts:95,103`) issue one write per row with no transaction; `repositories(group_id)`, `repositories(account_id)` and `accounts(is_default)` have no index, and a SQLite foreign key does not create one — so `listGroups`' join degrades to a scan per group.
    - How it will be implemented: drop the redundant UPDATE, wrap the bulk sequence rewrites in `db.transaction(...)`, and add the three indexes with `CREATE INDEX IF NOT EXISTS` inside `configureDatabase` so existing databases pick them up.

- [ ] **[NOT_URGENT]** OAuth device sessions are never evicted and the provider poll interval is not enforced.
    - What it is: the `oauthSessions` map in `src/backend/services/oauth.ts` only removes the session currently being polled, and the provider's `intervalSeconds` is not checked server-side. An abandoned sign-in stays in memory for the process lifetime, and a renderer polling faster than the agreed interval can trip provider rate limiting.
    - How it will be implemented: sweep expired sessions at the entry of the start and poll handlers (or on a timer), and reject a poll that arrives before the next allowed poll time instead of forwarding it to the provider.

- [ ] **[NOT_URGENT]** Task bookkeeping in `useTasks` grows for the session and is re-scanned on every render.
    - What it is: `runningOperations[finalKey] = undefined` (`src/mainview/composables/useTasks.ts:37`) never deletes the key, so one entry per file path and commit sha accumulates; `isBusy`, `isAnyOperationRunning` and `getRunningOperation` walk that whole record and are read from templates. `setTimeout(updateLongRunningOperations, 500)` is also scheduled on every run and never cleared when the operation finishes first.
    - How it will be implemented: `delete runningOperations[finalKey]` in the `finally` block, keep a separate `Set` of in-flight keys so `isBusy` is O(1), and clear the pending timer when the operation completes before it fires.

- [ ] **[NOT_URGENT]** The changes sidebar rebuilds each section in O(n²).
    - What it is: `buildChangeSection` (`src/mainview/components/RepChangesView.vue:89`) calls `hasBackendNoActualChange` and `hasBackendCosmeticCheckTooLarge` for every entry, and each runs a linear `findChangeEntry` (`RepChangesView.vue:61`) over the same array. With thousands of changed files that is millions of comparisons on every changes reload.
    - How it will be implemented: read `stagedNoActualChange`, `stagedTooLargeForCosmeticCheck` and the unstaged pair straight off the entry being mapped, since the entry that `find` searches for is already in hand; or build one `Map<path, entry>` per kind before the `.map()`.

- [ ] **[NOT_URGENT]** `fileIconAndLanguageByPath` allocates a fifty-entry table for every row on every render.
    - What it is: the `map` array literal is constructed inside the function (`src/mainview/lib/utils.ts:12`), then scanned with `.some()` and `endsWith` per call. It runs per row from `ChangesFileTree.vue:44` and from `getMonacoLanguage` (`lib/monaco.ts:81`), so each re-render of a large list allocates hundreds of thousands of objects and runs tens of thousands of string checks.
    - How it will be implemented: hoist the table to a module-level constant and precompute an extension/filename to `{ lang, icon }` lookup `Map` at module load for O(1) resolution; hoist the small maps in `statusLetter` and `statusClass` the same way.

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

- [ ] **[NOT_URGENT]** `useRepos` deep-watches a counter and rebuilds its repo list with a nested `find`.
    - What it is: `_useRepositories` watches `_coreState.stateCounter` with `{ deep: true }` (`src/mainview/composables/useRepos.ts:24`) — a deep traversal of a number — and the callback runs `_coreState.repos.find(...)` once per repo, which is O(n²) and re-runs on every bootstrap.
    - How it will be implemented: drop `deep: true` since the counter is a scalar, and build one `id → repo` `Map` per bootstrap to drive `update` instead of calling `find` per entry.

- [ ] **[NOT_URGENT]** Multi-select ordering in the changes view is quadratic inside its comparator.
    - What it is: `updateChangeSelection` (`src/mainview/components/RepChangesView.vue:402`) sorts with `entryIds.indexOf(left) - entryIds.indexOf(right)`, a linear scan per comparison, and rebuilds `entryIds` on every click. Selecting a large range (select-all then shift-click) makes this tens of millions of operations.
    - How it will be implemented: build an `id → index` `Map` once per selection change and sort by the mapped index, reusing the same map for the identity and range checks.

- [ ] **[NOT_URGENT]** Debug logging sits in hot render and hover paths.
    - What it is: `console.log('hunk count', …)` runs on every diff render (`src/mainview/components/DiffsDiffEditor.vue:96`), `console.log('hover', { …, getBoundingClientRect() })` forces layout on every hunk-button hover (`DiffsDiffEditor.vue:304`), `console.warn('addLine not found for hunk', { i, hunk, hunks })` serialises whole hunk objects (`DiffsDiffEditor.vue:407`), and `console.log('[onDiscard]', …)` (`RepChangesView.vue:269`) and `console.log(repoTable.createTableSql())` (`src/backend/services/database.ts:146`) sit on user actions and module load.
    - How it will be implemented: delete them; where the information is genuinely useful, route it through the existing renderer-diagnostic channel instead of `console.log`, since only `console.error` is currently forwarded.

- [ ] **[NOT_PLANNED]** Keep the localhost Express backend and the IPC-to-HTTP transport as the single request path.
    - What it is: every call is structured-cloned over IPC, sent as JSON to the Express server, parsed, answered as JSON, parsed again in the renderer and cloned back (`src/electronUtils/helpers.ts:21`, `src/electronUtils/browserOnlyHelpers.ts:68`, `src/electronUtils/mainProloadHelpers.ts:169`), which costs more than an in-process call for large diff payloads.
    - Why it is deliberate: the same transport is what makes the browser `dev2` mode and the standalone server work, and collapsing the Electron path into direct handler calls would fork the request path. Keep the extra serialization as the price of one transport; optimise payload size instead (see the `[URGENT]` commit-detail item).

- [ ] **[NOT_PLANNED]** Keep interval and focus polling as the change-detection mechanism; do not add a filesystem watcher.
    - What it is: the app re-reads repository state on a 20 s interval and on window focus (`src/mainview/composables/initializeStates.ts:179,126`) rather than watching the working tree, so out-of-band edits are picked up with a delay and the sweep cost is paid continuously.
    - Why it is deliberate: a recursive watcher over user repositories brings platform-specific limits, event storms on large trees and a new class of bugs, for a desktop Git client where a short delay is acceptable. The plan is to make polling cheap (see the `[URGENT]` bootstrap and refresh items) rather than to replace it.

- [ ] **[NOT_PLANNED]** Keep full-file diff loading with the 1 MB preview cap; no streaming or paginated diffs.
    - What it is: diffs carry both full file sides in one payload and are capped by `previewByteLimit` (`src/backend/services/git/git-helpers.ts:6`) with a "file too big to preview" message, rather than being streamed or paged.
    - Why it is deliberate: the diff engine needs both complete sides to parse a file, so streaming would require a different diff pipeline. The cap is the intended guard; the plan is to trim payloads that are not needed at all, not to re-architect diff delivery.

- [ ] **[NOT_PLANNED]** Keep git execution in the native host; no renderer-side git and no browser-side diff computation.
    - What it is: `runGit`/`executeCommand` live in the main process and the renderer only ever receives results, so a slow git command occupies the host rather than a renderer worker.
    - Why it is deliberate: this matches the boundary in `AGENTS.md` — the native layer owns PTY, git execution and filesystem mutation, and Vue owns orchestration. Offloading git to a renderer worker or a browser reimplementation would break that split; the plan is to reduce how many git commands are issued (see the `[URGENT]` items), not to move where they run.

- [ ] **[NOT_PLANNED]** Each changed-file row mounts a body-level tooltip, a document click listener and a forced layout read.
    - What it is: `v-tooltip` (`src/mainview/directives/VTooltip.ts:165`) appends a tooltip element to `document.body` and registers a `document` click listener per bound element, and `v-loading` (`src/mainview/directives/VLoading.ts:21,34`) calls `getComputedStyle(el).position` and reads `el.clientWidth/clientHeight` per element at mount. `RepChangesView` puts one or two of each on every unlocked row (`RepChangesView.vue:974-991`), so a large changes list creates thousands of body nodes, thousands of document listeners and thousands of forced synchronous layouts.
    - How it will be implemented: move to one shared singleton tooltip driven by delegated `mouseover`/`mouseout` on the list container (skipping the `updated` rewrite when the value string is unchanged), and make `v-loading` set the position and icon size through CSS classes instead of reading computed style and element size at mount.
