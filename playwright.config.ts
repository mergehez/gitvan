import { defineConfig } from '@playwright/test';
import { appConfig } from './src/electronUtils/helpers.ts';

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
});
