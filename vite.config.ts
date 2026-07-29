/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { appConfig } from './src/electronUtils/helpers';
import electronApiMethods from './src/electronUtils/vite-plugin';

export default defineConfig({
    base: './',
    plugins: [
        vue(),
        tailwindcss(),
        electronApiMethods({
            app: 'src/backend/services/app.ts',
            main: 'src/electron/main.ts',
            preload: 'src/electron/preload.ts',
            devServer: 'src/backend/devServer.ts',
            apiMethods: 'src/shared/apiMethods.ts',
            externalize: ['node-pty'],
        }),
    ],
    root: 'src/mainview',
    build: {
        outDir: '../../dist',
    },
    server: {
        host: '127.0.0.1',
        port: appConfig.vuePort,
        strictPort: true,
        proxy: {
            '/api': {
                target: appConfig.apiBaseUrl,
                changeOrigin: true,
            },
        },
        watch: {
            ignored: ['**/sandbox/**'],
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['**/*.spec.ts'],
        exclude: ['**/App.real.spec.ts', '**/playwright/**'],
        setupFiles: ['./tests/setup.ts'],
    },
});
