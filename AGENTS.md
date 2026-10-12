# AGENTS.md

## Purpose

This repository should evolve toward a thin native shell and a Vue-owned application layer.

When working in this codebase, preserve the current product feel. Refactors should reduce Electrobun/native coupling without changing anything user-facing unless the user explicitly asks for a UX change.

## Handoff Notes

- Read `HANDOFF.md` first. It is the map of the repository: layout, how a request travels, the state
  model, the test harness, the dev/release commands, known problems and the recipes for common changes.
  It exists so a fresh session does not have to scan the tree.
- Keep it current. When a change moves a file, changes a convention, the test harness, a command, or one
  of the problems it lists, update the matching section of `HANDOFF.md` in the same commit.
- It describes how the project is now: no changelog, no history, no "recently changed" notes. Prefer
  paths over line numbers, because those drift.

## Product Expectations

- Do not redesign the app unless explicitly asked.
- Preserve current labels, flows, shortcuts, modal behavior, and overall interaction patterns.
- Prefer invisible architectural improvement over visible polish work.
- If a native Electrobun dialog or menu can be replaced with an in-app Vue equivalent without users noticing, prefer the Vue implementation.
- Keep the existing visual language consistent with the current app: dark desktop UI, compact controls, modal-driven workflows, and utility-first layout patterns.

## Architecture Direction

Prefer this split:

- Vue owns orchestration, state transitions, validation, prompts, menu composition, selection logic, path composition, clipboard behavior, and user-facing recovery flows.
- The native host owns only true OS/runtime primitives: PTY lifecycle, native file/app pickers, shell launching, opening files with external programs, file-manager reveal/open behavior, keychain access, process spawning, git execution, and filesystem mutation.

In practice:

- Move policy into Vue.
- Keep RPC methods thin and explicit.
- Prefer generic host primitives over app-specific Electrobun wrappers.

Good example:

- Better: Vue decides what path to open and calls a generic host method like "open this path".
- Worse: Electrobun receives repo ids and decides labels, fallbacks, or user-flow branching.

## Vue Preferences

- Prefer Vue 3 Composition API with focused composables.
- Keep components presentational when possible and move reusable behavior into composables or small shared helpers.
- Centralize duplicated menu-building and action-planning logic.
- Prefer frontend-owned modals over native Electrobun dialogs when parity is possible.
- Keep user-visible behavior stable while moving logic across the boundary.
- Normalize and sort UI state in Vue instead of relying on the host to do it.

## Native Boundary Rules

- Do not move integrated terminal PTY logic into Vue.
- Do not move secure secret storage into Vue.
- Do not move actual git execution or direct filesystem mutation into Vue.
- Do not make the native layer decide user-flow policy when Vue can decide it first.
- Avoid app-specific RPC methods when a generic primitive is enough.

Examples:

- Prefer `openPathWithDefaultProgram({ path })` over `openRepoFileWithDefaultProgram({ repoId, path })`.
- Prefer `openDirectoryInTerminal({ directoryPath })` over `openRepoInTerminal({ repoId })` when Vue already knows the directory.
- Prefer frontend clipboard writes when no native capability is required.

## Packaging Rules

- The macOS bundle is signed ad-hoc after packing (`electronConfig.afterPack` → `signMacApp.ts`): without a
  signature that carries `com.apple.security.inherit`, the renamed helper bundles cannot inherit a sandbox
  and Chromium aborts the app about a second after launch (white window, then the app is gone).
- Copy a built app bundle with `ditto` (`installMacApp.ts`), never `fs.cp`: it resolves the framework's
  relative symlinks into absolute paths into `build/`, which unseals the signature the build just made.

## Refactor Style

- Make incremental changes, not broad rewrites.
- Preserve behavior first, then simplify structure.
- Remove duplication when touching an area.
- Introduce shared helpers only when they reduce repeated logic in active use.
- Keep public data shapes stable unless there is a strong reason to change them.

## Tests

- Never set timeouts for tests greater than 10 seconds. If something takes longer, that means it is a bug:
  instead of increasing the timeout, investigate and fix the issue causing the test to take longer than expected.
  Setting huge timeouts makes your work slower and the whole test suite less reliable.
    - Try to use the least possible timeout necessary for the test to pass.
    - When something times out, first check if you added a visibility check for the element you are interacting with.
    - If a really large test really requires a longer timeout, do not blindly set a huge value. Just increase it to the minimum necessary.
- Never blindly add inline timeouts (e.g. `toBeVisible({timeout: 10_000})`). This almost never fixes the real issue.
- Never create temporary tests if a test can be used later. We need to integrate it properly into the test suite
  rather than leaving it as a throwaway or provisional test.
- Every user-facing feature gets a browser spec under `./playwright/` or `./src/mainview/tests/e2e/`, however small it is — a new control, a dialog, a field, a public page's behaviour. A server test says the endpoint answers; only the browser says the screen actually draws the control, wires it to that endpoint and shows what came back.
- Run the browser specs after every UI change, before committing:

    ```bash
    bun run test:e2e     # the browser suite, a few minutes
    ```

    Nothing has to be started first: `playwright.config.ts` boots `bun run dev` itself and waits on the
    backend health endpoint. The specs share a single app instance and run one at a time.
    - `bunx playwright install chromium` once, and again after `@playwright/test` updates.
    - The run uses its own ports (5277/5276; override with `PLAYWRIGHT_VUE_PORT`/`PLAYWRIGHT_API_PORT`),
      so it never adopts a `bun run dev` you started by hand — that server holds the real app database.
    - It also uses a fresh database in a temp directory for every run (`PLAYWRIGHT_APP_DATA_DIR` to keep
      one instead), so a run never depends on, or disturbs, local repositories and settings.
    - Use `openSandboxRepo(page, name)` from `./playwright/support/sandbox.ts` to open a lab; do not
      re-implement the reset and repository selection in a spec. It resets the sandbox labs and the
      persisted settings, so every test starts from a known state and none depends on the one before it.
    - Import `test` and `expect` from `./playwright/support/sandbox` rather than `@playwright/test`. That
      fixture fails a test when the backend logged an unexpected error while it ran.
    - Wait for the app instead of sleeping: the specs use no `waitForTimeout` and no inline assertion
      timeouts, and assertions retry against the real condition.

## Git

- After finishing a task, commit the changes with clear and descriptive messages.
    - No batch commits; each commit should represent a single logical change unless it requires too much hunting
      for related changes.
    - No huge commit messages; max 72 characters. If you need to provide more details, include them in the body
      of the commit message.
    - Use imperative mood in commit messages (e.g. "fix bug" instead of "fixed bug" or "fixes bug").
    - Avoid vague commit messages like "update" or "changes"; be specific about what was changed and why.
- You are allowed to commit changes on behalf of the user if they are not in-progress and have been reviewed.

## Comments

- Do not write huge comments; keep them concise and relevant to the code they describe. My experience shows that
  AI agents tend to write overly verbose comments if not guided properly.

## Change Priorities

When choosing between possible improvements, prefer this order:

1. Move orchestration from Electron/native code into Vue.
2. Replace app-specific host RPC methods with thinner generic primitives.
3. Deduplicate frontend logic that is currently split across components/composables.
4. Preserve the UX exactly while improving maintainability.
5. Only then consider larger runtime-migration steps such as Electrobun-related work.

## Communication Style For Future Agents

- Be direct and pragmatic.
- Explain tradeoffs briefly.
- Prefer doing the change over proposing it, unless the risk is user-facing or architectural.
- Call out when something cannot move to Vue without changing behavior.
- Default to preserving the current experience.
