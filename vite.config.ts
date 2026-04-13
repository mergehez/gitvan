import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';
import electronApiMethods from './vite-export-api-methods.ts';

export default defineConfig({
    base: './',
    plugins: [vue(), tailwindcss(), electronApiMethods],
    root: 'src/mainview',
    build: {
        outDir: '../../dist',
        emptyOutDir: true,
    },
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        watch: {
            ignored: ['**/sandbox/**', 'scripts/**'],
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['**/*.spec.ts'],
        exclude: ['**/App.real.spec.ts'],
        setupFiles: ['./tests/setup.ts'],
    },
});
