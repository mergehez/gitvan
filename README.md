# Gitvan

Gitvan is a better Git client app for people who want everyday Git work to feel clear, fast, and less annoying.

It is a desktop app built around local repository workflows: checking changes, reviewing diffs, making commits, switching branches, handling remotes, and getting through merge conflicts without bouncing between five different tools.

Gitvan is currently in alpha.

## Why Gitvan

Git is powerful, but a lot of desktop clients either feel too limited, too noisy, or too tied to hosting-platform workflows. Gitvan is meant to be a calmer middle ground: a desktop app that stays focused on the repository in front of you.

The goal is simple:

- make repository state easy to understand
- keep common Git actions close at hand
- make risky actions feel safer
- keep the UI focused on local work instead of dashboards and clutter

## Screenshots

Screenshots are not included yet. This section will be updated once the first public-safe UI captures are available.

## What Gitvan Does

Gitvan helps you manage local repositories from a desktop app with a repository-first workflow.

Right now, Gitvan can:

- add existing local repositories to the app
- create a new local Git repository from the app
- clone repositories into a tracked workspace folder
- organize repositories into groups
- track repository state across all added repositories
- review staged and unstaged changes with a built-in diff viewer
- stage, unstage, discard, restore, and ignore files
- write commits with validation
- browse commit history and inspect file-level commit diffs
- switch branches, create branches, and publish branches
- fetch, pull, and push
- browse stashes and inspect stash diffs
- resolve merge conflicts in an embedded editor
- assign stored accounts to repositories for authenticated remote operations
- configure external editor integration for opening files from Gitvan

## Status

Gitvan is an alpha release. The core workflows are in place and usable, but the app is still evolving and some behavior will change as the project matures.

The current focus is local Git work, not hosting-platform features. That means things like pull requests, issue tracking, and other provider-specific workflows are intentionally not the center of the app yet.

## What Gitvan Is Trying To Be

Gitvan is intentionally not trying to be an IDE panel or a Git hosting dashboard.

The project is moving toward:

- repository-first navigation
- clear separation between changes, history, and branches
- safe defaults around destructive actions
- fast feedback during Git operations
- readable diffs and repository status at a glance

## Supported Platform

Gitvan is currently documented and distributed for:

- macOS on Apple Silicon

Other platforms may work during development, but this repository only documents and supports macOS Apple Silicon right now.

## Installation

The current install path is a macOS DMG release.

### Requirements

Before running Gitvan, make sure you have:

- macOS on Apple Silicon
- Git installed on your machine

Gitvan uses your local Git CLI for repository operations. On macOS, the packaged app checks common install locations such as Homebrew paths and the standard system path.

### Install From DMG

1. Download the latest Gitvan DMG.
2. Open the DMG and move Gitvan to your Applications folder.
3. Launch Gitvan.
4. Add an existing repository, create a new one, or clone one into your preferred parent directory.

## First-Time Setup

Once the app is open, the usual setup flow is:

1. Add or create a repository.
2. Open Settings and configure any accounts you want Gitvan to use.
3. Choose an external editor if you want one-click file opening from diffs and change lists.
4. Start working from the Changes, History, and Branches views.

Gitvan currently supports stored account records for GitHub, GitLab, and custom hosts, along with a system Git option where appropriate.

## Main Workflows

### Repository Management

Gitvan keeps a persistent list of repositories and repository groups in the app. The sidebar shows branch and working-tree status so you can see what needs attention before you even open a repository.

### Changes and Diffs

The Changes view separates staged and unstaged files, supports multi-file actions, and includes a built-in diff viewer. Non-code assets such as images can be previewed when supported.

### History

The History view shows commit summaries, commit details, and file-level diffs for selected commits. Gitvan also includes amend and undo support for eligible recent commits.

### Branching and Remote Operations

Gitvan supports branch switching, branch creation, publish, fetch, pull, and push. Repository status includes ahead/behind information to make remote state visible without dropping to the terminal.

### Stashes and Merge Conflicts

Gitvan includes stash browsing and stash diff inspection, plus an embedded merge conflict resolver with conflict-aware editing controls.

## Data and Storage

Gitvan is a desktop app with local persistence.

- application data is stored in the Electron user data directory under the Gitvan app name
- app metadata is stored in a local SQLite database
- Git operations run through your installed Git executable

Gitvan does not require a separate backend service for its core desktop workflows.

## Build From Source

> I use Bun as the package manager in this repo.
>
> Runtime, test, and build commands are run through Bun scripts.
>
> If you want to use another package manager, do these first:
>
> 1. Install dependencies with that package manager so it creates the lockfile and layout you expect.
> 2. Review any package-manager-specific workflow before assuming it will run unchanged.
>
> For normal local development, using another package manager is completely reasonable.

### Prerequisites

- Bun
- Git
- macOS on Apple Silicon for the documented app build flow

### Install Dependencies

```bash
bun install
```

This repo currently keeps `package-lock.json`, but the app runtime and primary dev flow are Bun-based.

### Start Development Mode

```bash
bun run dev
```

This starts the Vite renderer and the Electrobun app together.

### Run Tests

```bash
bun run test:ui
```

### Build The App

```bash
bun run b:electrobun
```

### Build A macOS Release

```bash
bun run release:mac
```

The Electrobun build generates the macOS app bundle.

## Maintainer Notes

If you are preparing a public build or release, read these docs first:

- [CHANGELOG.md](CHANGELOG.md)
- [RELEASING.md](RELEASING.md)
- [SECURITY.md](SECURITY.md)

Generated outputs such as `build/`, `release/`, `dist/`, `.vite/`, local databases, and local `.env` files should stay out of source control.

## Tech Stack

- Electrobun
- Vue 3
- Vite
- TypeScript
- Tailwind CSS
- Monaco Editor
- SQLite via `bun:sqlite`

## Roadmap

The current version is focused on stable desktop Git workflows. Some things intentionally left for later include:

- pull request workflows
- issue tracking
- interactive rebase UI
- submodule UI
- broader provider-specific features

## Contributing

Gitvan is being written as an open-source project, and contributions are welcome.

If you want to contribute:

1. Open an issue or start a discussion before larger changes.
2. Keep pull requests focused and easy to review.
3. Add or update tests when behavior changes.
4. Update this README when the user-facing workflow changes.

Bug reports, UX feedback, small fixes, and feature discussions are all useful.

## License

Gitvan is licensed under the MIT License. See [LICENSE](LICENSE) for details.
