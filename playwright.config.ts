import { tmpdir } from 'os';
import { join } from 'path';
import { defineConfig } from '@playwright/test';
import { appConfig } from './src/electronUtils/helpers.ts';

// A dedicated database per browser-spec run. The specs reset the sandbox labs, which deletes
// and re-adds repositories, so pointing them at the real app database would mutate the
// developer's own repositories and inherit whatever settings they last used.
const e2eDataDir = process.env.PLAYWRIGHT_APP_DATA_DIR || join(tmpdir(), 'gitvan-playwright-data');

export default defineConfig({
    testDir: './playwright',
    timeout: 30_000,
    retries: 0,
    reporter: 'list',
    // Every spec drives the same app instance and the same sandbox repositories,
    // so running files in parallel makes them fight over that shared state.
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || appConfig.vueBaseUrl,
        headless: true,
    },
    webServer: {
        // `bun run dev` serves the renderer and mounts the backend devServer inside Vite,
        // so the specs need no separately started server.
        command: 'bun run dev',
        // The UI port answers before the backend is mounted, and the app cannot bootstrap
        // without it, so wait on the backend health endpoint instead.
        url: `${appConfig.apiBaseUrl}/health`,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { APP_DATA_DIR: e2eDataDir },
    },
});
