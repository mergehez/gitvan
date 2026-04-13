# Electrobun Migration Verdict

## Verdict

Migrating this project from Electron to Electrobun appears possible in principle, but it is not a drop-in migration.

This codebase would require a shell and runtime port rather than a package swap. The Vue renderer and much of the backend logic are likely portable, but the Electron host layer would need to be rewritten around Electrobun's APIs and Bun runtime model.

## Why

- Electrobun documents its own Bun-first application architecture, build pipeline, packaging flow, and runtime APIs rather than an Electron compatibility layer.
- This project currently relies on Electron-specific primitives such as `BrowserWindow`, `app`, `Menu`, `dialog`, `shell`, `ipcMain`, `ipcRenderer`, and `contextBridge`.
- The existing preload and IPC model would need to be replaced with Electrobun's RPC and event mechanisms.
- The current distribution process is built around Electron and `electron-builder`; that would need to move to `electrobun.config.ts` and the Electrobun CLI.
- The integrated terminal is a migration risk because it depends on `node-pty`, and Bun/native-module compatibility needs to be validated rather than assumed.

## What Seems Portable

- The Vue and Vite renderer should be portable with moderate integration changes.
- Much of the backend application logic is regular TypeScript using filesystem access, child processes, git commands, OAuth flow code, and SQLite.
- The product concept and most user-facing behavior should be preservable.

## Main Rewrite Areas

- Main process bootstrap and window creation
- Preload bridge and IPC request handling
- Native dialogs, menus, and shell integration
- Integrated terminal wiring
- Build, signing, notarization, and packaging

## Practical Conclusion

If the goal is to reduce bundle size and move off Electron, Electrobun is a plausible target.

If the goal is a quick or low-risk migration, this project does not fit that profile. The migration should be treated as an intentional platform port with a validation spike first, especially around Bun compatibility for the integrated terminal and release pipeline.

## Recommended Next Step

Build a small spike that proves the following before attempting a full migration:

1. Main window creation
2. Typed RPC between the UI and main process
3. File and shell integrations
4. `node-pty` viability under Bun/Electrobun
5. A minimal packaged macOS build

## Migration Checklist

- [ ] Freeze the host boundary.
      Make `src/electron/rpc.ts` the single inventory of native capabilities. Every method should be either a true OS/runtime primitive or a candidate to move into Vue.
- [ ] Finish removing app policy from the host.
      Keep moving orchestration out of `src/electron/rpc.ts` and into Vue composables such as `src/mainview/composables/useSettings.ts`, `src/mainview/composables/useRepos.ts`, and `src/mainview/composables/useRepo.ts`.
- [x] Lock down current behavior with focused tests.
      Add or extend focused tests around cancel, stale-default fallback, picker fallback, context menus, and modal flows so the migration preserves behavior.
- [x] Separate portable backend code from host-specific runtime code.
      Treat the backend services as mostly portable and the current Electron shell files as the migration surface.
- [x] Define an Electrobun capability map before porting.
      For each current Electron feature, document the Electrobun equivalent or accepted workaround before implementation starts.
- [ ] Spike the integrated terminal in isolation.
      Prove session creation, write, resize, exit events, multiple sessions, and packaged macOS behavior for `node-pty` before broader migration.
- [x] Spike the host bridge in isolation.
      Build a minimal shell that can open the Vue app, perform typed RPC, send one host event back, open a path, and open a directory in a terminal.
- [x] Decouple preload assumptions.
      Introduce a runtime-agnostic bridge contract before replacing the Electron preload and IPC implementation.
- [ ] Delay packaging migration until runtime parity exists.
      Do not start with the release pipeline. First prove development runtime parity, then migrate packaging, signing, notarization, and updates.
- [ ] Preserve UX parity deliberately.
      Keep labels, shortcuts, modals, menus, and interaction flows unchanged unless there is an explicit product decision to change them.
- [ ] Temporary types file.
      Create a temporary `src/shared/gitClientRpc.ts` without using it in Vue. The goal is to validate the old electron RPC agains the new Electrobun RPC. After validation, delete this file.
- [ ] Migrate in this order.
      Main window boot, typed bridge, path/shell primitives, settings/editor/terminal pickers, backend integration, integrated terminal, menus, then packaging.

## Checklist Status Notes

- `Freeze the host boundary`: close, but not complete. `src/electron/rpc.ts` is now the main request inventory, app-specific shell methods have largely been replaced with generic primitives, and the backend service layer no longer depends on host callback wiring. It stays unchecked until the preload/bridge assumptions are fully decoupled.
- `Finish removing app policy from the host`: in progress, but much closer. The meaningful wins are the behaviors moved into Vue, such as confirmations, editor selection, path composition, copy-path behavior, repository-directory picking, OAuth browser-launch orchestration, and window-title policy. The remaining host-facing work is now concentrated in the bridge layer and true OS/runtime primitives.
- `Lock down current behavior with focused tests`: done for the current refactor surface. Focused coverage now exists for repo context-menu editor actions, stale-default editor fallback, picker cancellation after fallback, clone modal flows, and frontend confirmation cancel/queue behavior.
- `Spike the host bridge in isolation`: done at source/build level. The shared bridge contract now lives outside the Electron runtime, the renderer can install `window.gitClient` from Electrobun without changing Vue code, and an Electrobun host/build path now produces a development macOS app bundle.
- `Decouple preload assumptions`: done. The renderer and preload are now typed through a shared bridge contract instead of importing request types from `src/electron/rpc.ts`.
- `Keep one shared API contract`: partially done. The request surface is shared and stable enough for both Electron and Electrobun implementations, but it still relies on the current request-map augmentation pattern from the Electron request inventory.
- `Preserve UX parity deliberately`: in progress and should remain enforced through the rest of the migration. The refactors so far kept the same labels, menus, modals, and flows.
- `Current migration state`: the codebase now has a parallel Electrobun runtime path. `bun run b:electrobun` completes through renderer build and Electrobun packaging, producing `build/dev-macos-arm64/Gitvan-dev.app`. The remaining unproven area is runtime smoke, especially integrated-terminal behavior under Bun and full parity verification after launch.

## Portable vs Host-Specific Surface

Treat these areas as clearly portable application code:

- `src/mainview/**`
- `src/backend/services/app.ts`
- `src/backend/services/auth.ts`
- `src/backend/services/database.ts`
- `src/backend/services/git.ts`
- `src/backend/services/oauth.ts`
- `src/shared/**`

Treat these areas as the host/runtime migration surface:

- `src/electron/main.ts`
- `src/electron/preload.ts`
- `src/electron/rpc.ts`
- `src/electron/extEditors.ts`
- `src/electron/systemShell.ts`
- `src/electron/integratedTerminal.ts`

That split is already reflected in the recent changes: Vue now decides confirmation UX, editor-selection policy, path composition, clipboard writes, and directory-picking flows, while the host is increasingly limited to OS/runtime primitives.

## Electrobun Capability Map

| Current capability                       | Current implementation                                                                                 | Electrobun target or workaround                                                 | Status                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Main window boot                         | `src/electron/main.ts` with Electron `app` and `BrowserWindow`                                         | Electrobun window bootstrap and lifecycle APIs                                  | Port required, but conceptually straightforward |
| Typed host bridge                        | `src/electron/preload.ts` and `src/electron/rpc.ts` over `ipcMain`, `ipcRenderer`, and `contextBridge` | Electrobun RPC plus event bridge                                                | Source-level port exists; runtime smoke remains |
| Directory picking                        | `pickDirectory` in `src/electron/rpc.ts` via Electron `dialog.showOpenDialog`                          | Electrobun picker API or a thin native wrapper                                  | Already reduced to a generic primitive          |
| Reveal path in file manager              | `revealPathInFileManager` in `src/electron/rpc.ts` via Electron `shell`                                | Electrobun equivalent or host shell wrapper                                     | Already reduced to a generic primitive          |
| Open path with default program           | `openPathWithDefaultProgram` in `src/electron/rpc.ts` via Electron `shell.openPath`                    | Electrobun equivalent or host shell wrapper                                     | Already reduced to a generic primitive          |
| Open directory in system terminal        | `openDirectoryInTerminal` in `src/electron/rpc.ts` backed by `src/electron/systemShell.ts`             | Electrobun equivalent or host process wrapper                                   | Already reduced to a generic primitive          |
| External editor and terminal app picking | `src/electron/extEditors.ts`                                                                           | Electrobun picker API or host wrapper returning selected app paths              | Vue already owns the selection policy           |
| Repository/backend operations            | `src/backend/services/*.ts`                                                                            | Keep as portable TypeScript with minimal runtime adaptation                     | Mostly portable already                         |
| Context menus and confirmations          | Vue components and composables under `src/mainview/**`                                                 | Keep in Vue                                                                     | Already aligned with the target architecture    |
| Integrated terminal                      | `src/electron/integratedTerminal.ts` plus `node-pty`                                                   | Dedicated Electrobun spike with Bun/native-module validation                    | Highest-risk item                               |
| Packaging, signing, notarization         | `scripts/build.ts`, Electron packaging flow, and release artifacts                                     | `electrobun.config.ts` plus Electrobun CLI and macOS signing/notarization setup | Delay until runtime parity exists               |

## Migration Gate

Do not commit to a full migration until these spikes are green:

1. Main window plus typed bridge
2. Path and shell primitives
3. Integrated terminal in a packaged macOS build

## Current Implementation Snapshot

- Shared bridge types now live in `src/shared/gitClientBridge.ts` and the renderer no longer imports request types from `src/electron/rpc.ts`.
- The renderer bootstrap can install `window.gitClient` from Electrobun automatically, preserving the existing Vue-side API.
- A parallel Electrobun host exists under `src/electrobun/**`.
- The Electrobun build config exists at `electrobun.config.ts` and currently reuses the Vite-built renderer output rather than replacing the Vue/Vite pipeline.
- `bun run b:electrobun` now builds the renderer and produces an Electrobun development app bundle on macOS.
- The highest-risk unvalidated area is still `node-pty` behavior after actually launching the Electrobun app.
