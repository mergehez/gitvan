# HANDOFF.md

The map of this repository for an agent starting a fresh session. It exists so nobody has to
scan the tree to find out where things live, how a request travels, and what is already
known to be broken.

**Maintenance (required):** this file is part of the codebase. When a change moves a file, changes a
convention, the test harness, a command, or one of the problems in **Known problems**, update the
matching section **in the same commit**. It describes how the project is _now_ — never add a
changelog, a "recently changed" list, or history. Line numbers drift: prefer paths, and only cite
`file:line` for things that are hard to find by name.

---

## 1. Orientation

Gitvan is a desktop Git client (macOS Apple Silicon only, alpha). The user tracks local repositories,
sees staged/unstaged changes, diffs, commits, history, branches, tags, stashes and merge conflicts,
and runs authenticated fetch/pull/push. It is repository-first: no PR, issue or provider dashboards
(README).

Runtime shape, as the code actually is today:

- **Electron 44** shell (`src/electron/main.ts`) plus a **Vue 3 + Vite 8** renderer (`src/mainview`).
- A **localhost Express backend** (`src/backend/devServer.ts` → `src/backend/services/app.ts`) that owns
  the SQLite database, git execution and everything else. The renderer never touches git or the disk.
- **One request transport for every mode**: the renderer calls `api:<method>` through `window.electronAPI`
  (Electron IPC via preload) or plain `fetch` in browser dev mode; either way the main process (or Vite)
  forwards it as an HTTP `POST /api/<method>` to the Express backend
  (`src/electronUtils/mainProloadHelpers.ts` `generateHandlers` → `callApiPost` in `helpers.ts`).
  This round trip is deliberate — see `todos.md` `[NOT_PLANNED] Keep the localhost Express backend…`.

> The README and CHANGELOG describe an Electrobun / `bun:sqlite` migration that this checkout does **not**
> contain, and list `build:canary` / `build:stable` scripts that do not exist. Trust `package.json`,
> `AGENTS.md` and this file for the runtime; treat the README as product copy. See **Known problems 1**.

## 2. Repository map

| Path                                                                              | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/backend/services/app.ts`                                                     | The whole RPC surface: `export const app = { … }`, one handler per API method, plus bootstrap/mutation builders, repo lookup, sandbox lab reset                                                                                                                                                                                                                                                                    |
| `src/backend/services/git.ts`                                                     | Thin facade re-exporting the git services (also what backend unit tests mock)                                                                                                                                                                                                                                                                                                                                      |
| `src/backend/services/git/*.ts`                                                   | `git-common` (runGit/executeCommand/timeouts/auth env), `git-repo` (clone/init/remote ops/publish), `git-changes` (status, index, diffs, commits), `git-history`, `git-merge`, `git-stash`, `git-tags`, `git-helpers` (parsers), `unpushedCommitCache`                                                                                                                                                             |
| `src/backend/services/database.ts`, `repoStatusCache.ts`, `auth.ts`, `oauth.ts`   | SQLite access + migrations, the cached per-repo sidebar status, account secrets (macOS keychain), GitHub/GitLab OAuth device flow                                                                                                                                                                                                                                                                                  |
| `src/backend/devServer.ts`                                                        | Express app + `/api/<method>` + `/health`, wrapped by `src/electronUtils/browserOnlyHelpers.ts`                                                                                                                                                                                                                                                                                                                    |
| `src/electron/main.ts`, `preload.ts`, `nativeMethods.ts`, `integratedTerminal.ts` | Electron main entry, context-bridge API, the native-only handlers (pickers, reveal, editor/terminal launch, PTY), app menu                                                                                                                                                                                                                                                                                         |
| `src/electronUtils/*`                                                             | Shared plumbing: `mainProloadHelpers` (IPC ↔ HTTP), `browserOnlyHelpers` (browser dev mode + Express dev server + native stubs), `useDatabase` (better-sqlite3 client + `resolveAppDataDir`), `vite-plugin` (generates `apiMethods`, mounts/kills dev servers, builds `dist-electron`), `executeCommand`, `releaseHelpers`, `perfBaseline`, `handleScripts` (the `do.ts` CLI)                                      |
| `src/mainview/App.vue`                                                            | The shell: mounts every modal (`App*Modal.vue`), the sidebar, the views and the error banner                                                                                                                                                                                                                                                                                                                       |
| `src/mainview/composables/*`                                                      | All orchestration/state: `coreState` (reactive bootstrap), `initializeStates` (load, polling, `applyMutation`), `useRepo`/`useRepos` (per-repo and app-wide actions, context menus, dialogs), `useTasks` (the RPC task table), `useSettings`, `useAuth`, `useMerge`, `useToast`, `useConfirmation`, `useDiffViewer`, `useTagEditor`, `useCommitMessageEditor`, `useFileHistory`, `useFileSort`, `useUiPreferences` |
| `src/mainview/components/*`                                                       | Presentational components: `Rep*View.vue` (changes/explorer/history/tags), `Sidebar*`, `Settings*`, `App*Modal.vue`, `CenteredModal`, `Popover`, `Button`, `Alert`, `FileTree`, monaco/diff wrappers                                                                                                                                                                                                               |
| `src/mainview/lib/`, `directives/`                                                | Small helpers (open-with, native paths, loading state) and the `v-loading` / `v-tooltip` / `v-menu` / `v-error` directives                                                                                                                                                                                                                                                                                         |
| `src/shared/types.ts`, `apiMethods.ts`                                            | IPC/renderer types. **`apiMethods.ts` is generated** — see §6                                                                                                                                                                                                                                                                                                                                                      |
| `src/mainview/tests/**`                                                           | Vitest suites, including backend tests (yes, backend specs live here)                                                                                                                                                                                                                                                                                                                                              |
| `playwright/**`                                                                   | Browser specs, their support code (`support/sandbox.ts` is the fixture), and the Electron shell spec                                                                                                                                                                                                                                                                                                               |
| `sandbox/*-lab/`                                                                  | Git fixtures the browser specs drive; each has a `reset-*.mjs` and a README                                                                                                                                                                                                                                                                                                                                        |
| `scripts/dev.ts`                                                                  | The dev launcher: reaps stale dev servers, then spawns Vite                                                                                                                                                                                                                                                                                                                                                        |
| `do.ts` → `src/electronUtils/handleScripts.ts`                                    | `bun do.ts release [--signed] [--notarize]`, `audit`, `perf`                                                                                                                                                                                                                                                                                                                                                       |

## 3. How a request travels

```
Vue component / composable
  └─ tasks.<method>.run(params, optionalKey)        ← src/mainview/composables/useTasks.ts
       └─ appClientRpc.request.<method>(params)      ← src/mainview/appClient.ts
            └─ window.electronAPI.invoke('api:<method>')   (Electron IPC, preload)
               or  fetch POST http://127.0.0.1:<apiPort>/api/<method>  (browser dev mode)
                 └─ Express handler → src/backend/services/app.ts
                      └─ git service / database
                         └─ returns AppMutationApi | AppBootstrapApi | a payload
            └─ component applies the result (usually `applyMutation(nextState)`)
```

Consequences worth internalising:

- A backend handler is **not** called in-process by the renderer, even in the packaged app: it is
  serialised over IPC, then over HTTP, then back. Keep payloads small (that is why the caches and the
  `AppMutationApi` "only what changed" shape exist).
- **Thrown errors become `Backend error (500): {"error":"…"}`** in `tasks.errorMessage` and therefore in
  `AppErrorBanner`. A _recoverable_ domain outcome (a refused push, a pull blocked by local changes, a
  merge conflict) must be returned as a result status, not thrown — see §8.
- `useTasks.isOperationRunning('method:key')` drives every spinner/lock and the "Running: …" indicator in
  `App.vue`; keep the identifiers consistent between the caller and the view.

## 4. Renderer state model

- `_coreState` (`composables/coreState.ts`) holds the reactive bootstrap: repos, groups, accounts,
  `selectedRepoId`, `sandboxLabsAvailable`, and a `stateCounter` bumped on each bootstrap.
- `applyMutation(next)` merges a mutation response **preserving object identity** for rows that did not
  change, so views bound to an untouched repo do not re-render. `applyBootstrapRefresh(next)` replaces
  everything. Both live in `composables/initializeStates.ts`; call one of them after every mutation.
- `useRepos()` wraps `_coreState.repos` in richer `useRepo()` objects (status, changes, commit form,
  selection, per-repo actions). It also owns the app-level modal state and the shared result handling
  (`handleRemoteOperationResult`).
- Status is **polled**, not watched: a 20 s interval plus window focus
  (`initializeStates.ts`), and every mutating git command invalidates the cached sidebar status
  (`git-common.ts`). This is deliberate (`todos.md` `[NOT_PLANNED] Keep interval and focus polling…`).
- Views: `settings.state.activeView` picks Changes / Explorer / History / Tags (`App.vue`).
- Modals are plain reactive flags on the owning composable (e.g. `repos.isPushRejectedModalOpen`),
  bound with `v-model:open` into `CenteredModal`, and mounted **once** in `App.vue`.

## 5. Backend service model

- `export const app = { … }` in `services/app.ts` is the contract. Handlers resolve their repository with
  `requireRepo(ps.repoId)` (missing id → a domain error, not a `TypeError`).
- Mutating handlers return `buildMutationResult()` (changed rows + touched statuses + state lists);
  read-only handlers return their payload directly.
- Ahead/behind/remote state comes from `git status --porcelain=v2 --branch` (`# branch.ab`), i.e. relative
  to the **tracking ref**, so a stale ref hides incoming commits until a fetch. This matters for any
  "behind/ahead" UI.
- Caches: `repoStatusCache` (sidebar status, invalidated by mutating git subcommands) and
  `unpushedCommitCache`; both are dropped on refresh/mutation.
- Errors from git arrive as `GitCommandError` (message, command, stderr, stdout). Classify them with small
  predicates in the owning git service (`isPullMergeConflictError`, `isPullBlockedByLocalChangesError`,
  `isPushRejectedByRemoteError`, `isStashRestoreConflictError`) instead of string-matching in Vue.

## 6. Generated code and code-shape constraints

`src/shared/apiMethods.ts` is generated by `src/electronUtils/vite-plugin.ts` and is committed. **Never
hand-edit it.** It is built by regex from the handler declarations, which imposes the shape:

- Backend: inside `export const app = {`, exactly four spaces of indentation, `name: async (ps) => {` (or
  `name: (ps) => {`), and not an IIFE (`name: ((…) => …)()` is skipped on purpose).
- Native: `name: async (ps) => {` in `src/electron/main.ts` and `src/electron/nativeMethods.ts`.
- The plugin regenerates the file on `buildStart` and when those files change in dev, and it skips the
  write when the contents are identical (an unnecessary rewrite would remount the renderer).

If a handler is written in another style it silently disappears from the API surface **and** from the
renderer's task table, so a `tasks.<name>` call would be `undefined`. If a new method is missing, check
the declaration shape first.

The same plugin also (a) kills stale listeners on the app ports when a dev-mode config loads, (b) mounts
the backend inside Vite (browser mode) or builds `dist-electron/{main,preload,backend}.cjs` with rolldown
and spawns Electron (desktop mode), and (c) kills the running app/dev servers on a production build.

## 7. Persistence, secrets, native boundary

- **Database**: better-sqlite3 at `<APP_DATA_DIR or platform userData>/gitvan.sqlite`
  (`resolveAppDataDir()` in `src/electronUtils/useDatabase.ts`); schema/migrations in
  `src/backend/services/database.ts`. `APP_DATA_DIR` is how every test gets an isolated database.
- **Secrets**: account tokens/passwords live in the **macOS keychain** through
  `src/backend/services/auth.ts`; only non-secret fields go into SQLite. Tests never touch the real
  keychain: the browser run puts a fake `security` on `PATH` (`playwright/support/fakeKeychain.ts`), and
  the keychain unit spec is opt-in with `GITVAN_KEYCHAIN_TESTS=1`.
- **Native boundary** (keep it this way, `AGENTS.md`): `nativeMethods.ts` owns pickers
  (`pickDirectory`, `pickEditorApplication`, `pickTerminalApplication`), `openPathWithDefaultProgram`,
  `openFileInEditor`, `revealPathInFileManager`, `openDirectoryInTerminal`, `openExternalUrl`, the
  integrated terminal PTY session calls, and the application menu. Policy (which path, which label, which
  fallback, which recovery flow) belongs in Vue. Browser dev mode stands these in through
  `GITVAN_NATIVE_STUB_FILE` + `browserOnlyHelpers.ts`; anything with no browser stand-in reports
  `not-available-in-browser`, which the Playwright fixture treats as an expected error code.
- PTY, keychain and direct filesystem mutation must not move into Vue.

## 8. Remote operations (the model to copy)

`runRemoteOperation` / `retryPullAfterStash` in `services/app.ts` resolve auth (`resolveRepoRemoteAuth` →
account + keychain/OAuth secret, mapped by `rethrowRemoteAuthError`), run the git command, and translate
recognised failures into statuses:

| Status                      | Meaning                                   | Renderer reaction                                          |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `completed`                 | fine                                      | success toast (pull mentions a stash when one was taken)   |
| `conflicted`                | pull/merge conflict                       | error toast with the file count; the resolver opens        |
| `blocked-by-local-changes`  | pull would overwrite local files          | `AppPullBlockedByLocalChangesModal` offers stash-and-retry |
| `rejected-non-fast-forward` | push refused because the branch is behind | auto-fetch, then `AppPushRejectedModal` offers Pull/Close  |

`useRepos.handleRemoteOperationResult` is the single place that applies the bootstrap and routes these.
When adding one: add the classification predicate to the git service, add the union member in `app.ts`,
handle it in `handleRemoteOperationResult`, then cover it in `app-remote.spec.ts`, `useRepos.spec.ts`, the
component spec and a browser spec.

## 9. Test harness

**Commands**

| Command                 | What it runs                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `bun run test:ui`       | Vitest: unit + component (jsdom). Config lives in `vite.config.ts` (`root: src/mainview`) |
| `bun run test:validate` | `test:ui` + `vue-tsc --noEmit` (the release gate)                                         |
| `bun run test:e2e`      | Reaps the dev ports, then Playwright browser specs (dev server + fresh temp DB)           |
| `bun run test:electron` | `bun run build`, then the shell spec against the packaged app                             |
| `bun run lint`          | `oxfmt` (writes), `oxlint --fix`, `vue-tsc --noEmit`                                      |
| `bun do.ts perf`        | Backend performance baseline (`src/electronUtils/perfBaseline.ts`)                        |

**Vitest** (`src/mainview/tests/**`, `*.spec.ts`): backend specs sit under `tests/backend/**` even though
the code is in `src/backend`. `App.real.spec.ts` is excluded on purpose. The default 5 s per-test timeout
is a real constraint for git-heavy specs (`tests/backend/services/git/*` spawn git processes); when one
times out, investigate rather than raising it (`AGENTS.md`).

**Playwright** (`playwright/*.spec.ts`, one worker, its own ports 5277/5276, fresh DB per run):

- Import `test`/`expect` from `./support/sandbox`, never from `@playwright/test`: that fixture fails a test
  when the backend logged an unexpected error while it ran.
- `openSandboxRepo(page, '<lab>')` resets the sandbox labs _and_ the persisted settings, then selects the
  lab. Do not re-implement reset/selection.
- Sandbox labs: `merge-conflict`, `pull-conflict`, `pull-stash`, `push-rejected`, `deep-history`,
  `partial-changes`, `cosmetics`, `empty`. Registered in `sandboxResetScripts` (`services/app.ts`); the
  generated repos are gitignored and always recreated by the run.
- The provider stub (`support/providerStub.ts`, port 5278) answers OAuth/token calls; the native picker
  stub is a JSON file (`support/nativeStub.ts`). No spec reaches a real provider or the real keychain.
- Only `bun run test:electron` launches the packaged app; it also covers the application menu and the PTY.
- Extra env: `PLAYWRIGHT_SKIP_BUILD=1` reuses `dist/`, `PLAYWRIGHT_APP_DATA_DIR` keeps the temp DB,
  `PLAYWRIGHT_VUE_PORT`/`PLAYWRIGHT_API_PORT` move the ports.

## 10. Dev loop, ports, environment

- `bun run dev` — **browser dev mode**: Vite serves the renderer on 5177 and the backend devServer is
  mounted inside Vite (SSR module runner) on 5176; the renderer falls back to `fetch` because
  `window.electronAPI` is absent.
- `bun run dev2` — **desktop dev mode**: builds `dist-electron`, spawns Electron with `VITE_DEV2=true`,
  which installs the fetch bridge (`appClientBrowser.ts`).
- `scripts/dev.ts` claims 5176/5177 before Vite binds, so a leftover server cannot be adopted.
- Ports come from `package.json` `config` and are overridable with `GITVAN_VUE_PORT` / `GITVAN_API_PORT`
  (mirrored into the renderer through `vite.config.ts` `define`). The Playwright run uses 5277/5276 and the
  Electron shell spec picks a free 5376+ pair.
- Other env: `APP_DATA_DIR` (database directory), `GITVAN_PROVIDER_BASE` (OAuth base URL),
  `GITVAN_NATIVE_STUB_FILE` (browser picker stub file), `ELECTRON_RUN_AS_NODE` (stripped before launching
  Electron, because it would turn it into a plain Node run).

## 11. Build and release

- `bun run build` = `bun install` + `vite build` (renderer → `dist/`) + `bun run build:electron`
  (electron-builder, `electron.config.js` → `src/electronUtils/electronConfig.ts`, arm64 DMG in `build/`).
- `bun do.ts release [--signed] [--notarize]`, `bun do.ts audit`, `bun do.ts perf`.
- Release is local and gated on `bun run test:validate`; there is no CI (`todos.md` `[NOT_PLANNED] No CI`).
- Distribution is macOS Apple Silicon only.

## 12. Known problems and traps

1. **The README/CHANGELOG do not describe this checkout.** They document Electrobun, `bun:sqlite`,
   `build:canary`/`build:stable`, and a `bun run dev` that starts "the Vite renderer and the Electrobun
   app together". In this repo: Electron 44, better-sqlite3, `build`/`build:electron`/`dev`/`dev2`, and
   `dev` is browser-only. Do not "restore" the documented behaviour without checking with the user; if a
   change touches the runtime story, reconcile the docs instead of trusting them.
2. **The browser suite can lose its dev server mid-run on this machine.** `bun run test:e2e` passed 60
   specs and then the Vite dev server stopped listening (~4 min in); every later spec failed its health
   check with `ECONNREFUSED`, and the same thing reproduced three times at the same boundary. Running the
   specs in chunks with the dev server started _outside_ the Playwright process tree (Playwright adopts it
   via `reuseExistingServer`) passed all of them. It looks like a resource limit on the Playwright job, not
   a spec: see the `[NOT_URGENT] [HARNESS]` item in `todos.md` (which also records the older leftover-server
   cause that was already fixed). Until it is fixed, verify browser changes in chunks and say so.
3. **Handler declaration style is load-bearing** (§6). A backend method written as `name: function (ps) {}`,
   at the wrong indentation, or as an IIFE will not reach `apiMethods`, and `tasks.name` will be
   `undefined` with no error.
4. **Recoverable failures must not be thrown** (§3): a throw surfaces as
   `Backend error (500): {"error":"<git output>"}` in the banner, which is exactly what the
   non-fast-forward push used to do before it became a status.
5. **`AppErrorBanner` is global and per method name.** `useTasks` keeps one error per RPC method, so a
   background failure (for example the auto-fetch after a refused push) can show a banner while another
   flow is on screen; `tasks.dismissError()` clears them all.
6. **The status cache hides remote changes until a fetch.** Ahead/behind is relative to the tracking ref,
   so a repo can look "not behind" while the remote has moved on. Any new remote flow must fetch (or
   invalidate) before reading those numbers.
7. **Dev-server killing is aggressive by design.** `vite-plugin`'s `killStaleServers` and `scripts/dev.ts`
   SIGKILL whatever holds the app ports when a dev-mode config loads; a stray `vite`/`vitest` run can
   therefore take down your dev session.
8. **Unit-suite flakiness under load.** Machine load ~12 with swap nearly exhausted produced a 5 s timeout
   in `git-history.spec.ts` (a spec that spawns 80 git commits) that passed alone in 3.1 s. Re-run before
   blaming the change; do not raise the timeout (`AGENTS.md`).
9. **Deliberate non-goals** are recorded in `todos.md` `[NOT_PLANNED]` items (single HTTP transport, polling
   instead of file watching, full-file diffs with a 1 MB preview cap, git only in the native host). Read
   them before proposing an architecture change: they also say _why_, and the _how it will be implemented_
   line says what would actually be done instead.
10. **`sandbox/*/repo/`, `origin.git/` and `upstream/` are gitignored** and only exist after a reset. The
    in-app "Reset Sandboxes" button (hidden `#hidden-reset-sandboxes` is what specs click) recreates them
    from the scripts; never hand-edit a lab repo and expect it to persist.
11. `dist/`, `dist-electron/`, `build/`, `release/`, `test-results/` and `sandbox/*/repo/` are build or test
    output — do not read them for the app's behaviour. `src/mainview/node_modules/` is an empty leftover
    directory, not a second dependency tree.

## 13. Recipes

- **Add a renderer→backend method**: write `name: async (ps: {…}) => {…}` in `services/app.ts` (§6 style),
  return `buildMutationResult()` if it mutates, call it with `tasks.name.run(params, key)` and
  `applyMutation(...)`; add `src/mainview/tests/backend/services/…` coverage. `apiMethods.ts` regenerates by
  itself on the next dev/build/test run.
- **Add a native method**: `async (ps) => …` in `nativeMethods.ts`, plus a browser stand-in in
  `browserOnlyHelpers.ts` if browser dev mode and the browser specs need it.
- **Add a dialog**: state + `openX`/`closeX` on the owning composable, a component using `CenteredModal`,
  mount it in `App.vue`, stub it in `tests/App.spec.ts`, add a component spec in `tests/components/`, and a
  `playwright/` spec driving it end to end.
- **Add a git scenario fixture**: `sandbox/<name>-lab/` with `reset-<name>-repo.mjs` and a README, register
  it in `sandboxResetScripts`, add the three paths to `.gitignore`, then `openSandboxRepo(page, '<name>')`.
- **Turn a git failure into a recovery flow**: classification predicate in the git service →
  status union member in `app.ts` → branch in `useRepos.handleRemoteOperationResult` → dialog + specs (§8).
- **Change a git service**: keep `runGit`/`executeCommand` usage (timeouts, invalidation and auth env come
  from there), add the parser tests under `tests/backend/services/git/`, and check both
  `app.spec.ts`/handler tests and any browser spec that exercises the flow.

## 14. Conventions that bite

- Commit per logical change, imperative mood, subject ≤ 72 chars, body for the why (`AGENTS.md`).
- Browser specs are required for user-facing changes; run them before committing.
- `oxfmt` (not prettier) decides formatting; run `bunx oxfmt --check <files>` or `bun run lint`.
- No test timeout above 10 s, no `waitForTimeout` in browser specs, no throwaway tests.
- `AGENTS.md` is the source of truth for the architecture direction; this file is the map of how it is
  implemented today.
