# Releasing

This document covers the maintainer-side steps for preparing a public-safe release of Gitvan.

The Electron release flow has been removed. The current release path is the Electrobun macOS app build.

## Before You Start

Make sure the working tree does not contain local-only artifacts or secrets.

Suggested checks:

```bash
rg -n '/Users/|Apple Development:|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' . --glob '!.git' --glob '!node_modules' --glob '!dist' --glob '!build' --glob '!release'
git status --short
git ls-files | rg '^(release|build|dist|node_modules|\.vite)/'
```

Review [PUBLIC_PUBLISH_CHECKLIST.md](PUBLIC_PUBLISH_CHECKLIST.md) and resolve any unchecked release blockers first.

## Local Config

Create a local `.env` file if you need signing, notarization, or a local real-database path for development-only tests.

Supported values are documented in [.env.example](.env.example).

Do not commit `.env`.

## Development Validation

Install dependencies:

```bash
bun install
```

Bun is the primary app runtime and script runner.

Run tests:

```bash
bun run test:ui        # unit and component specs
bun run test:e2e       # browser specs; owns its ports and a fresh database per run
```

Build the app:

```bash
bun run build
```

Or use the combined validation script:

```bash
bun run release:validate
```

This runs `bun run test:validate` (the unit and component suites plus `vue-tsc --noEmit`) and then the production build. It is the gate a release has to pass: `bun do.ts release` runs it for you before it builds, unless `--skip-tests` is passed.

## Build A macOS Release

Current local build:

```bash
bun run release:mac
```

This runs the validation gate above, ensures the macOS iconset exists in `assets/`, builds with electron-builder, installs the app bundle to `/Applications`, and produces the DMG under `build/`.

For a signed local build:

```bash
bun run release:mac:signed
```

For a signed and notarized local build:

```bash
bun run release:mac:notarize
```

## Release Hygiene

Run the release audit:

```bash
bun run release:audit
```

This audit scans tracked files for publish-sensitive text, shows the current git status, and fails only when it finds actual blockers.

Before pushing a release branch or tag:

- make sure `release/` is not tracked
- make sure `dist/` and `build/` are not tracked
- make sure sandbox fixtures do not contain nested `.git` metadata
- make sure no real local database files are staged
- make sure no real client IDs, tokens, or signing values appear in tracked files

## Publish A GitHub Release

Use GitHub Releases for public DMG distribution. Do not commit generated binaries to the repository.

Recommended flow:

1. Update the version in `package.json`.
2. Update `CHANGELOG.md` for the release.
3. Run `bun install` if dependencies changed.
4. Run `bun do.ts release:audit`.
5. Build the public artifact with `bun run release:mac`; it runs `bun run release:validate` first and stops if a spec or the typecheck fails.
6. Confirm the app bundle exists under `build/` and the DMG exists next to it.
7. Create and push the matching git tag, for example `v0.0.1`.
8. Create a GitHub Release from that tag.
9. Use the matching `CHANGELOG.md` entry as the release notes.
10. Upload the generated DMG from `build/` to the release.

## Signing And Notarization

The macOS release wrapper now drives Electrobun's native signing and notarization flow.

Preferred environment variables:

- `ELECTRON_DEVELOPER_ID`
- `ELECTRON_TEAMID`
- `ELECTRON_APPLEID`
- `ELECTRON_APPLEIDPASS`

Unsigned builds remain useful for local testing, but they are not suitable for internet distribution because Gatekeeper will quarantine them.

## Publishing Recommendation

Use GitHub Releases for DMG and ZIP distribution rather than committing generated binaries to the repository.

Keep source control focused on source, docs, tests, and reproducible build scripts.
