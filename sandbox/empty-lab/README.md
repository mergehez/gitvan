# Empty Lab

This folder contains an isolated script that rebuilds a nested dummy Git repository that has been
created but never committed to — the state a user is in right after **Create New Repository**.

## What it does

- Creates a fresh Git repository in `sandbox/empty-lab/repo` on `main`
- Writes one untracked `README.md`
- Creates **no commits at all**

That is what makes the empty History and Explorer states reachable: with no commits there is no
history page and no snapshot file tree to show.

## Usage

Run the reset script from the project root:

```bash
node ./sandbox/empty-lab/reset-empty-repo.mjs
```

## Notes

- The generated nested repository is ignored by the main project `.gitignore`.
- Re-running the script deletes and recreates the lab from scratch.
