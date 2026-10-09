# Pull Stash Lab

This folder contains an isolated script that rebuilds a nested dummy Git repository where pulling is
first blocked by local working-tree changes and then completes cleanly after those changes are
stashed.

## What it does

- Creates a bare `origin.git` remote
- Creates a working repository in `sandbox/pull-stash-lab/repo` and pushes a baseline to `origin`
- Advances `origin/main` from a separate clone with a rewrite of `story.txt`
- Fetches `origin` in `repo` so its tracking refs show it is behind immediately
- Leaves `repo` with an unstaged edit to the same `story.txt`

Because the local branch has no commits of its own, stashing the working tree lets the retried pull
merge cleanly instead of conflicting. That is the counterpart of `pull-conflict-lab`, which keeps a
local commit so the retry ends in conflicts.

## Usage

Run the reset script from the project root:

```bash
node ./sandbox/pull-stash-lab/reset-pull-stash-repo.mjs
```

After it finishes, add `sandbox/pull-stash-lab/repo` to Gitvan and click Pull.

Expected flow:

1. The repository already has local changes.
2. `origin/main` is ahead, so Pull is available.
3. Pull is blocked because `story.txt` would be overwritten.
4. Gitvan prompts with `Stash changes and retry` or `Cancel`.
5. Choosing `Stash changes and retry` stashes the working tree, retries the pull and completes it,
   leaving the stash entry available.

## Notes

- The generated nested repositories are ignored by the main project `.gitignore`.
- Re-running the script deletes and recreates the lab from scratch.
