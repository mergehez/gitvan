import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { defineConfig } from '@playwright/test';
import { installFakeKeychain } from './support/fakeKeychain';

/**
 * The Electron run is its own config because it must not inherit the browser run's `webServer`:
 * that one starts `bun run dev`, and the shell has to talk to the backend it bundles itself.
 *
 * `bun run test:electron` builds the app first, because this spec only ever launches
 * `dist-electron/main.cjs` next to the `dist/index.html` it loads.
 */
const providerStubPort = Number.parseInt(process.env.PLAYWRIGHT_PROVIDER_STUB_PORT ?? '', 10) || 5278;
const providerStubBase = `http://127.0.0.1:${providerStubPort}`;

process.env.PLAYWRIGHT_PROVIDER_STUB_BASE = providerStubBase;

// Each launched app gets its own throwaway database under here, and the shared teardown removes
// whatever is left. The config process sets it because the teardown runs in this process.
const e2eDataDir = mkdtempSync(join(tmpdir(), 'gitvan-electron-run-'));
process.env.GITVAN_E2E_DATA_DIR = e2eDataDir;

// Creating an account writes to the macOS keychain, which a run cannot undo afterwards. A fake
// `security` on PATH keeps those writes in a temp directory, exactly as the browser run does.
installFakeKeychain();

export default defineConfig({
    // Paths in this file resolve relative to it, which is why `testDir` is not `./playwright`.
    testDir: '.',
    testMatch: 'electron.spec.ts',
    timeout: 120_000,
    retries: 0,
    reporter: 'list',
    // One app instance, one sandbox reset, one window: the spec is serial by construction.
    fullyParallel: false,
    workers: 1,
    // Resolved relative to this config file, not to the project root.
    globalTeardown: './support/teardown.ts',
    use: {
        headless: true,
    },
    webServer: [
        {
            // The sign-in and discovery flows must never reach a real provider, so the stub the
            // app is pointed at has to be up even though this spec does not drive it.
            command: `bun run playwright/support/providerStub.ts`,
            url: `${providerStubBase}/__control`,
            reuseExistingServer: true,
            timeout: 30_000,
        },
    ],
});
