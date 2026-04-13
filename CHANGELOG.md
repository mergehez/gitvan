# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [0.0.3] - 2026-04-13

Alpha update focused on repository actions, partial change workflows, and in-app terminal support.

### Added

- Integrated terminal support for opening repositories inside Gitvan.
- Partial hunk actions in Changes view for staging, unstaging, and discarding individual changes.
- Repository context menus now support moving repositories between groups.
- Repository context menus now support assigning accounts.
- Repository context menus now support opening repositories in terminal or Finder.
- Repository context menus now support copying repository paths.
- Changes view context menus now support opening files with configured editors.
- Whitespace-only diff indicator in DiffViewer.
- Better clone modal guidance when no compatible account is available.
- Repository group deletion from Settings.
- Group context-menu actions for renaming, deleting, and reordering repository groups.

### Changed

- Replaced remaining native context menus with Vue-based menus for more consistent in-app interactions.
- Settings accounts can now be reordered.
- Centered input modals now autofocus their primary input.
- Simplified tooltip behavior and refined running-operation feedback placement and fetch icon behavior.

## [0.0.2] - 2026-04-09

Focused alpha update for committed-file exploration and repository browsing.

### Added

- Explorer view for browsing the committed file tree of the selected repository.
- Commit snapshot selector in Explorer for viewing repository state at any commit from history.

### Changed

- File tree component now supports nested folders and collapsible grouped entries.

## [0.0.1] - 2026-04-08

Initial public alpha release.

### Added

- Electrobun desktop app shell with Vue-based renderer for local Git workflows.
- Repository management for adding existing repositories, creating new repositories, and cloning into tracked locations.
- Repository grouping and persistent local repository catalog backed by SQLite.
- Changes view with staged and unstaged file lists, built-in diff viewer, and common file actions.
- Commit workflow with commit validation, commit history browsing, and file-level history diffs.
- Branch and remote operations including branch switching, branch creation, fetch, pull, push, and publish.
- Stash browsing and merge-conflict resolution with an embedded conflict editor.
- Account management for GitHub, GitLab, custom hosts, and system Git integration.
- External editor configuration for opening files from the app.
- Public project documentation covering installation, source builds, releasing, and security reporting.
