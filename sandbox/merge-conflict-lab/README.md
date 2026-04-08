# Merge Conflict Lab

This folder contains an isolated script that rebuilds a nested dummy Git repository in a known merge-conflict state.

## What it does

- Creates a fresh Git repository in `sandbox/merge-conflict-lab/repo`
- Creates a `feature/conflicting-copy` branch
- Changes the same content differently on `main` and `feature/conflicting-copy`
- Merges the branch back into `main`
- Leaves the repository with three unresolved merge conflicts
- Includes two untouched files
- Includes two files with clean non-conflicting changes

## Usage

Run the reset script from the project root:

```bash
zsh ./sandbox/merge-conflict-lab/reset-conflict-repo.sh
```

After it finishes, the repository at `sandbox/merge-conflict-lab/repo` will be in a merge-conflict state and ready for testing.

The script currently creates conflicts in:

- `story.txt`
- `config.json`
- `notes.md`

`story.txt` is intentionally rewritten after the merge so it contains multiple adjacent conflict blocks with no unchanged lines between them. This is useful for testing conflict UIs against tightly packed conflict sections.

It also creates unchanged files:

- `unchanged-one.txt`
- `unchanged-two.txt`

And files with clean merged changes:

- `feature-only.txt`
- `main-only.txt`

## Notes

- The generated nested repository is ignored by the main project `.gitignore`.
- Re-running the script deletes and recreates the dummy repository from scratch.
