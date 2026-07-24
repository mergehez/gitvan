import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './playwright',
    timeout: 30_000,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
        headless: true,
    },
});
