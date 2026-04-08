# Pull Conflict Lab

This folder contains an isolated script that rebuilds a nested dummy Git repository in a state where pulling is first blocked by local working-tree changes and then continues into a real merge conflict after stashing.

## What it does

- Creates a bare `origin.git` remote
- Creates a working repository in `sandbox/pull-conflict-lab/repo`
- Pushes a baseline commit to `origin`
- Adds one local commit in `repo` that is not pushed
- Advances `origin/main` from a separate clone
- Fetches `origin` in `repo` so its tracking refs show both ahead and behind immediately
- Leaves `repo` both ahead of and behind `origin/main`
- Leaves `repo` with unstaged local edits in the same file that changed upstream

That combination makes the first `git pull --no-rebase` fail with Git's "local changes would be overwritten by merge" error. After stashing, the retried pull enters a merge conflict, which is the state needed to test Gitvan's stash-then-pull flow.

## Usage

Run the reset script from the project root:

```bash
zsh ./sandbox/pull-conflict-lab/reset-pull-conflict-repo.sh
```

After it finishes, add `sandbox/pull-conflict-lab/repo` to Gitvan and click Pull.

Expected flow:

1. The repository already has local changes.
2. `origin/main` is ahead and the local branch has its own unpushed commit.
3. Pull is blocked because the local file would be overwritten.
4. Gitvan prompts with `Stash changes` or `Cancel`.
5. Choosing `Stash changes` stashes the working tree and retries the pull.
6. The retried pull stops in a merge conflict and the stash remains available.

## Notes

- The generated nested repositories are ignored by the main project `.gitignore`.
- Re-running the script deletes and recreates the lab from scratch.
