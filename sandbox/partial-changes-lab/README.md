# Partial Changes Lab

This folder contains an isolated script that rebuilds a nested dummy Git repository designed for testing partial stage / unstage / discard actions across all three hunk types.

## What it does

- Creates a fresh Git repository in `sandbox/partial-changes-lab/repo`
- Creates **two files** (`first.txt` and `second.txt`), each 300 lines
- Applies changes of every hunk type: **modification** (deletion + addition), **pure deletion**, and **pure addition**
- Leaves `second.txt` with unstaged changes and `first.txt` with fully staged changes

## Files

| File         | State    | Hunks | Types                        |
| ------------ | -------- | ----- | ---------------------------- |
| `first.txt`  | staged   | 6     | 2× modify, 2× delete, 2× add |
| `second.txt` | unstaged | 9     | 3× modify, 3× delete, 3× add |

## Usage

Run the reset script from the project root:

```zsh
node ./sandbox/partial-changes-lab/reset-partial-repo.mjs
```

After it finishes, the repository at `sandbox/partial-changes-lab/repo` will have both unstaged and staged changes ready for testing.

- **Partial stage / discard** → use the unstaged `second.txt`
- **Partial unstage** → use the staged `first.txt`
