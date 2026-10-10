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
`[BACKEND UNIT]` or `[FRONTEND TEST]`. That section tracks coverage only.

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
- Covered the whole merge service: conflict state, per-file details, ours/theirs resolution, mark resolved, save resolution, abort and commit.
- Covered the stash service, which turned up a stashed diff that read a file from the wrong commit.
- Ran the token verification and device sign-in flows from a local provider stub that can fail on demand.
- Covered the repository commit, file, branch, tag, stash and history flows.
- Covered the git helpers' parsers, the keychain wrapper and the monaco language and option helpers.
- Stood in for the native pickers in browser dev mode, so adding a repository and picking an editor or terminal have specs.
- Covered the committed tree and file reads, the pagination bounds and the tag refs of the history service.
- Covered the remote auth environment, the askpass script and the concurrency helper.
- Covered the git changes index, patch, ignore and commit operations and the sidebar status, which turned up a non-ASCII path listed as a second, mangled row.
- Covered the database sequence operations and opened a pre-groups database, which turned up a migration that failed before it added the column its index needs.
- Covered the tooltip, error and context menu directives.
- Covered the small presentational components, including the task error banner and the toast precedence.
- Covered the app bootstrap, selection, repository, group and account handlers, including the CRUD validation and the ordering operations.
- Covered the app create, clone, settings and the account token verification, repository discovery and device sign-in flows.
- Covered the app remote operations and the merge, stash and retry-pull recovery results.
- Covered every component that was without a spec: the popover, input modal, monaco settings button, draggable list, changes file tree, client header, create repository modal, settings and its editors panel, the diffs editor hunk anchoring, the commit inspect pane and the explorer.

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
spec that closes the gap — `[BROWSER]`, `[BACKEND UNIT]`, `[FRONTEND TEST]` or `[HARNESS]` — so
one flat list says both how much it matters and what writing it means. The `[BROWSER]` entries
come first within each marker because they cover the flows a user actually runs.

- [ ] **[NOT_URGENT] [BROWSER]** The Electron shell and the packaged app have no end-to-end spec.
    - What it is: `playwright.config.ts` boots `bun run dev`, so no spec ever launches Electron, and the preload bridge, the IPC registration, window creation, the application menu and the built bundle (`src/electron/main.ts`, `src/electron/preload.ts`, `src/electronUtils/mainProloadHelpers.ts:36,169`) run only when a person starts the app. `native-boundary.spec.ts` proves the opposite direction — that those methods are unavailable in browser dev mode.
    - How it will be implemented: launch the app with Playwright's `_electron`, open a sandbox lab, drive one native action through the real preload bridge, open and close the integrated terminal and quit; point the same spec at the built bundle behind the release script.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `mainProloadHelpers.ts` and the API request wrapper.
    - What it is: `generateHandlers` forwards every backend method to `callApiPost` (`src/electronUtils/helpers.ts:35`) and merges the native methods, `registerIpcHandlers` registers `api:<name>` and the `renderer:diagnostic` channel, `createWindow` owns the size policy, the dev-server probe and the missing-build error, and `createPreloadApi` fans `native-command` out to listeners with an unsubscribe. None of them has a spec.
    - How it will be implemented: inject fake `electron` and preload objects, then assert the registered channel list, the forwarded params, the diagnostic colouring, the window options, and the error envelope and 12-minute timeout a failed request produces.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `main.ts` native methods and application menu.
    - What it is: the picker cancel handling and `.app`/`.exe` label trimming, `openFileInEditor`'s two existence guards, `revealPathInFileManager`'s two modes, `openDirectoryInTerminal`'s terminal fallback list, and the menu template with its settings accelerator.
    - How it will be implemented: build the helpers with injected `dialog`, `shell` and `executeCommand` fakes and assert both the calls and the thrown messages.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** `integratedTerminal.ts` PTY lifecycle.
    - What it is: shell resolution, spawn, the `data`/`exit` events, write, resize and the SIGHUP close. A component spec can only stub the modal around it.
    - How it will be implemented: spawn a real shell through node-pty, run one command and assert its output arrives, then resize, write and close.

- [ ] **[NOT_URGENT] [BACKEND UNIT]** The Keychain wrapper against the real `security` CLI.
    - What it is: `auth.ts` is only exercised with a mocked `executeCommand` and, in the browser run, a fake `security` earlier on `PATH` (`playwright/support/fakeKeychain.ts`), so the real add/find/delete and the missing-entry exit code never run.
    - How it will be implemented: an opt-in spec that stores, reads and deletes a throwaway item under its own service name, skipped unless an environment flag asks for it.

- [ ] **[NOT_URGENT] [HARNESS]** Run the suites in CI.
    - What it is: `bun run test:ui`, `bun run test:e2e` and `bunx vue-tsc --noEmit` are not enforced anywhere, and `vite build` does not typecheck, so a green local run is the only signal there is. No coverage provider or threshold is configured either.
    - How it will be implemented: one CI job per suite, reusing the commands in `package.json` and the browser run's own ports and temp database, with `@vitest/coverage-v8` thresholds and the Electron spec above added once they exist.

- [ ] **[NOT_PLANNED] [BROWSER]** The Explorer's "Select a file to inspect the committed contents." message stays uncovered.
    - What it is: loading a snapshot always selects its first file, so the message is unreachable and nothing covers it. The empty states ("No commits found.", "No committed files found") have specs through the empty lab.
    - Why it is deliberate: covering it would mean rendering a snapshot with no selectable file, which no real repository can produce. If that ever becomes reachable, the spec comes with it.

- [ ] **[NOT_PLANNED] [BROWSER]** Signing and notarization stay a release-script check, not a spec.
    - What it is: `src/electronUtils/releaseHelpers.ts` builds, signs and notarizes the app, and nothing in the suite verifies the signature.
    - Why it is deliberate: signing and notarization need Apple credentials and a notary round trip, so the release script is the only place that can check them. The launch smoke for the produced bundle is tracked by the Electron shell item above.

- [ ] **[NOT_PLANNED] [FRONTEND TEST]** `src/mainview/tests/App.real.spec.ts` stays excluded.
    - What it is: `vite.config.ts` and `package.json` exclude it, so it never runs, and it needs local fixture data.
    - Why it is deliberate: it duplicates what the browser specs already prove against the sandbox labs, and the local fixture it needs is not worth carrying.

- [ ] **[NOT_PLANNED] [BACKEND UNIT]** The non-batched cosmetic fallback in `git-changes.ts` stays uncovered.
    - What it is: `applyCosmeticChangeChecks` sends a modified entry to the bounded per-file pool when the raw diff carries no blob for it, which only a porcelain-only row produces.
    - Why it is deliberate: `git status --porcelain=v2 -z` and `git diff --raw -z` now spell every path verbatim and report the same modified paths, so only a defensive branch is left. The non-ASCII path that used to reach it has its own regression spec.

- [ ] **[NOT_PLANNED] [FRONTEND TEST]** `GitClientHeader`'s no-repository branch stays uncovered.
    - What it is: the header carries fallbacks for an undefined selected repository, but the account button dereferences `repo` without a guard, so mounting it with no selection throws before those fallbacks render.
    - Why it is deliberate: `App.vue` renders the header only inside `v-if="selectedRepo"`, so no real session can reach it. If a no-selection render ever becomes reachable, the spec and the guard come with it.

- [ ] **[NOT_PLANNED] [BACKEND UNIT]** Real GitHub and GitLab calls stay behind the local provider stub.
    - What it is: `oauth.ts` and `listCloneableRepos` are exercised against `playwright/support/providerStub.ts`, which fails on demand, so no spec ever reaches a real provider.
    - Why it is deliberate: a network dependency in the suite is flaky, needs credentials and hits rate limits, while answering nothing the stub does not. The sign-in and discovery flows are already covered end to end against it.

- [ ] **[NOT_PLANNED] [BACKEND UNIT]** The performance baseline stays a manual `bun do.ts perf` run.
    - What it is: `src/electronUtils/perfBaseline.ts` measures the hot endpoints, but no spec asserts a budget.
    - Why it is deliberate: a wall-clock budget in the suite would be machine-dependent and flaky. The baseline is meant to be read before and after a change, which the Done entry records.

How to run what exists today: `bun run test:ui` (Vitest, unit and component) and
`bun run test:e2e` (Playwright, browser). The browser run owns its own ports and a fresh
database per run, so it never touches the developer's app data.
