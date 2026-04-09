# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

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

- Electron desktop app shell with Vue-based renderer for local Git workflows.
- Repository management for adding existing repositories, creating new repositories, and cloning into tracked locations.
- Repository grouping and persistent local repository catalog backed by SQLite.
- Changes view with staged and unstaged file lists, built-in diff viewer, and common file actions.
- Commit workflow with commit validation, commit history browsing, and file-level history diffs.
- Branch and remote operations including branch switching, branch creation, fetch, pull, push, and publish.
- Stash browsing and merge-conflict resolution with an embedded conflict editor.
- Account management for GitHub, GitLab, custom hosts, and system Git integration.
- External editor configuration for opening files from the app.
- Public project documentation covering installation, source builds, releasing, and security reporting.
