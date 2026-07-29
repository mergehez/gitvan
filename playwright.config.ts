import { defineConfig } from '@playwright/test';
import { appConfig } from './src/electronUtils/helpers';

export default defineConfig({
    testDir: './playwright',
    timeout: 30_000,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || appConfig.vueBaseUrl,
        headless: true,
    },
});
