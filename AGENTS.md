# AGENTS.md

## Purpose

This repository should evolve toward a thin native shell and a Vue-owned application layer.

When working in this codebase, preserve the current product feel. Refactors should reduce Electrobun/native coupling without changing anything user-facing unless the user explicitly asks for a UX change.

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

## Refactor Style

- Make incremental changes, not broad rewrites.
- Preserve behavior first, then simplify structure.
- Remove duplication when touching an area.
- Introduce shared helpers only when they reduce repeated logic in active use.
- Keep public data shapes stable unless there is a strong reason to change them.

## Testing And Validation

For non-trivial changes:

- Run focused Vitest coverage for the touched composables/components.
- Run `vp build` and `vp check --fix` after boundary or UI refactors.

When changing orchestration:

- Verify stale-default, cancel, fallback, and error-path behavior stays the same.
- Verify context-menu actions and modal flows still expose the same user-facing options.

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
