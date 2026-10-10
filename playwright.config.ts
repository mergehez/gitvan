import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { defineConfig } from '@playwright/test';
import { installFakeKeychain } from './playwright/support/fakeKeychain';

// Browser specs never share the ports a developer's `bun run dev` uses, so a server started by
// hand can never be adopted — which matters, because that server holds the real app database.
const vuePort = Number.parseInt(process.env.PLAYWRIGHT_VUE_PORT ?? '', 10) || 5277;
const apiPort = Number.parseInt(process.env.PLAYWRIGHT_API_PORT ?? '', 10) || 5276;
const providerStubPort = Number.parseInt(process.env.PLAYWRIGHT_PROVIDER_STUB_PORT ?? '', 10) || 5278;
const vueBaseUrl = `http://127.0.0.1:${vuePort}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const providerStubBase = `http://127.0.0.1:${providerStubPort}`;

// A fresh database for every run. Reusing one path let settings a spec changed — ignored
// characters, whitespace handling, the active view — survive into the next run and fail it.
const e2eDataDir = process.env.PLAYWRIGHT_APP_DATA_DIR || mkdtempSync(join(tmpdir(), 'gitvan-playwright-'));

// globalTeardown runs in this same process, so it reads the directory we created here.
process.env.GITVAN_E2E_DATA_DIR = e2eDataDir;
// Support files run in the worker, so they read the backend they must talk to from here too.
process.env.PLAYWRIGHT_API_BASE = apiBaseUrl;
process.env.PLAYWRIGHT_PROVIDER_STUB_BASE = providerStubBase;

// Creating an account writes to the macOS keychain, which a run cannot undo afterwards. A fake
// `security` on PATH keeps those writes in a temp directory.
const fakeKeychainBinDir = installFakeKeychain();

export default defineConfig({
    testDir: './playwright',
    timeout: 30_000,
    retries: 0,
    reporter: 'list',
    // Every spec drives the same app instance and the same sandbox repositories,
    // so running files in parallel makes them fight over that shared state.
    fullyParallel: false,
    workers: 1,
    globalTeardown: './playwright/support/teardown.ts',
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || vueBaseUrl,
        headless: true,
    },
    // The provider stub answers the OAuth and token endpoints `oauth.ts` points at when
    // `GITVAN_PROVIDER_BASE` is set, so no spec reaches GitHub or GitLab.
    webServer: [
        {
            command: `bun run playwright/support/providerStub.ts`,
            url: `${providerStubBase}/__control`,
            reuseExistingServer: true,
            timeout: 30_000,
        },
        {
            // `bun run dev` serves the renderer and mounts the backend devServer inside Vite,
            // so the specs need no separately started server.
            command: 'bun run dev',
            // The UI port answers before the backend is mounted, and the app cannot bootstrap
            // without it, so wait on the backend health endpoint instead.
            url: `${apiBaseUrl}/health`,
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
                APP_DATA_DIR: e2eDataDir,
                GITVAN_VUE_PORT: String(vuePort),
                GITVAN_API_PORT: String(apiPort),
                GITVAN_PROVIDER_BASE: providerStubBase,
                // Prepended, so the fake `security` wins over the real one.
                PATH: `${fakeKeychainBinDir}:${process.env.PATH ?? ''}`,
            },
        },
    ],
});
