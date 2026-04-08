# Releasing

This document covers the maintainer-side steps for preparing a public-safe release of Gitvan.

## Before You Start

Make sure the working tree does not contain local-only artifacts or secrets.

Suggested checks:

```bash
rg -n '/Users/|Apple Development:|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' . --glob '!.git' --glob '!node_modules' --glob '!dist' --glob '!dist-electron' --glob '!release'
git status --short
git ls-files | rg '^(release|dist|dist-electron|node_modules|\.vite)/'
```

Review [PUBLIC_PUBLISH_CHECKLIST.md](PUBLIC_PUBLISH_CHECKLIST.md) and resolve any unchecked release blockers first.

## Local Config

Create a local `.env` file if you need signing, notarization, or a local real-database path for development-only tests.

Supported values are documented in [.env.example](.env.example).

Do not commit `.env`.

## Development Validation

Install dependencies:

```bash
npm install
```

npm is used here as both the package manager and the script runner.

Run tests:

```bash
npm run test:ui
```

Build the app:

```bash
npm run b
```

Or use the combined validation script:

```bash
npm run release:validate
```

This runs the stable release-facing test suite and the production build. It intentionally excludes `tests/App.real.spec.ts`, which depends on local real-app fixture data and is better treated as an environment-specific integration check.

## Prepare A Release Build

Use the single preparation entrypoint when you want one command for the normal local release flow.

Default notarized flow:

```bash
npm run release:prepare
```

Run the same flow with release-facing tests first:

```bash
npm run release:prepare:test
```

Other supported modes:

```bash
npm run release:prepare -- --unsigned
npm run release:prepare -- --signed
npm run release:prepare -- --notarize
```

Convenience scripts:

```bash
npm run release:prepare
npm run release:prepare:test
```

What `scripts/prepare.ts` does:

- runs `npm run release:audit`
- optionally runs `npm run test:release` when `--test` is provided
- builds the macOS release artifact in the selected mode

## Build A macOS Release

Unsigned local build:

```bash
npm run release:mac
```

Signed build, after configuring `APPLE_SIGNING_ID` locally:

```bash
npm run release:mac:signed
```

`APPLE_SIGNING_ID` should be the signer name that `electron-builder` expects, such as `Your Name (TEAMID)`. If you paste the full Keychain label like `Developer ID Application: Your Name (TEAMID)`, the build script will strip the prefix automatically.

Signed and notarized build, after also configuring `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD` locally:

```bash
npm run release:mac:notarized
```

Equivalent scripts:

```bash
npm run release:mac
npm run release:mac:signed
npm run release:mac:notarized
```

## Release Hygiene

Run the release audit:

```bash
npm run release:audit
```

This audit scans tracked files for publish-sensitive text, shows the current git status, and fails only when it finds actual blockers.

Before pushing a release branch or tag:

- make sure `release/` is not tracked
- make sure `dist/` and `dist-electron/` are not tracked
- make sure sandbox fixtures do not contain nested `.git` metadata
- make sure no real local database files are staged
- make sure no real client IDs, tokens, or signing values appear in tracked files

## Publish A GitHub Release

Use GitHub Releases for public DMG distribution. Do not commit generated binaries to the repository.

Recommended flow:

1. Update the version in `package.json`.
2. Update `CHANGELOG.md` for the release.
3. Run `npm install` if dependencies changed.
   This is only for dependency installation and `package-lock.json` updates.
4. Run `npm run release:audit`.
5. Run `npm run release:validate`.
6. Build the public artifact with `npm run release:mac:notarized`.
7. Confirm the DMG exists under `release/mac/` with a name like `Gitvan-0.0.1-mac-arm64.dmg`.
8. Create and push the matching git tag, for example `v0.0.1`.
9. Create a GitHub Release from that tag.
10. Use the matching `CHANGELOG.md` entry as the release notes.
11. Upload the DMG as the release asset.

If you want to keep public distribution limited to the DMG, upload only the `.dmg` file even though the build currently also produces a ZIP.

## Notarization Support

The release script supports macOS notarization through `electron-builder`'s notarization flow when the Apple credentials are present in the environment.

Current behavior:

- `npm run release:mac:signed` signs the app for local signed artifacts.
- `npm run release:mac:notarized` signs the app, lets `electron-builder` notarize it during packaging, staples the app bundle, then verifies both the packaged app bundle and the app mounted from the DMG with `codesign` and Gatekeeper.

Required local values:

- `APPLE_SIGNING_ID`
- `APPLE_ID`
- `APPLE_TEAM_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`

Important constraints:

- the signing identity should be a public distribution identity, typically `Developer ID Application`, not a local development certificate
- this implementation relies on `electron-builder` to notarize the packaged app during the release build
- the local copy placed into `/Applications` is still just a convenience step for your machine; the public deliverable is the notarized DMG in `release/mac/`

The script now performs the main post-notarization verification automatically. If you want to rerun those checks manually, use:

```bash
codesign --verify --deep --strict --verbose=2 release/mac/mac-arm64/Gitvan.app
spctl -a -t exec -v release/mac/mac-arm64/Gitvan.app

hdiutil attach release/mac/Gitvan-0.0.1-mac-arm64.dmg -readonly -nobrowse -mountpoint /tmp/gitvan-dmg-check
codesign --verify --deep --strict --verbose=2 /tmp/gitvan-dmg-check/Gitvan.app
spctl -a -t exec -v /tmp/gitvan-dmg-check/Gitvan.app
hdiutil detach /tmp/gitvan-dmg-check
```

## Publishing Recommendation

Use GitHub Releases for DMG and ZIP distribution rather than committing generated binaries to the repository.

Keep source control focused on source, docs, tests, and reproducible build scripts.
