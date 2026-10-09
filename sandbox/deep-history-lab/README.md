# Deep History Lab

This folder contains an isolated script that rebuilds a nested dummy Git repository with a history
deep enough to exercise paging, search and snapshot selection.

## What it does

- Creates a fresh Git repository in `sandbox/deep-history-lab/repo`
- Builds **70 commits** through a single `git fast-import` stream, so rebuilding the lab stays cheap
- Leaves the root commit with an **empty tree**, so the Explorer has a snapshot with no files
- Adds one file (`notes/note-NN.txt`, containing `note NN`) per later commit

The default history page holds 60 commits, so the view offers a load-more action until all 70 are
loaded. The empty root commit is what the Explorer shows when no file can be previewed.

## Usage

Run the reset script from the project root:

```bash
node ./sandbox/deep-history-lab/reset-deep-history-repo.mjs
```

## Notes

- The generated nested repository is ignored by the main project `.gitignore`.
- Re-running the script deletes and recreates the lab from scratch.
