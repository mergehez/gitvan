# Push Rejected Lab

This folder contains an isolated script that rebuilds a nested dummy Git repository where `git push`
is rejected as a non-fast-forward because `origin/main` moved on after the last fetch.

## What it does

- Creates a bare `origin.git` remote
- Creates a working repository in `sandbox/push-rejected-lab/repo` and pushes a baseline to `origin`
- Advances `origin/main` from a separate clone with a new `notes.md`
- Leaves `repo` with one local commit of its own and a stale tracking ref, because it never fetched
  that incoming commit

Touching a different file on each side is deliberate: the pull that follows the rejection is a clean
merge, so the lab also covers the recovery path rather than only the rejection.

## Usage

Run the reset script from the project root:

```bash
node ./sandbox/push-rejected-lab/reset-push-rejected-repo.mjs
```

After it finishes, add `sandbox/push-rejected-lab/repo` to Gitvan and click Push.

Expected flow:

1. The repository is one commit ahead, so Push is available while Pull is not.
2. Push is rejected as a non-fast-forward.
3. Gitvan fetches, then explains the rejection and offers Pull or Close.
4. Choosing Pull merges the incoming commit and Push becomes available again.

## Notes

- The generated nested repositories are ignored by the main project `.gitignore`.
- Re-running the script deletes and recreates the lab from scratch.
