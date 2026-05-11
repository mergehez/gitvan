/**
 * Browser-only dev server that exposes backend app methods as HTTP endpoints.
 * Run with: bun run src/backend/devServer.ts
 */

import { homedir } from 'os';
import { join } from 'path';
import type { GitClientRequestApi as Api } from '../electrobun/index';
import { apiMethods } from '../shared/apiMethods';
import { app } from './services/app';
import { useDb } from './services/database';

const PORT = parseInt(process.env.API_PORT || '5174', 10);

// Initialize database (normally done by the Electrobun entrypoint)
const userDataDir = process.env.GITVAN_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'gitvan');
useDb().configureDatabase(userDataDir);

const methodMap: Record<string, (ps?: any) => any> = {
    // getBootstrap: () => app.getBootstrap(),
    // deleteTrackedRepoGroup: (ps: any) => app.deleteTrackedRepoGroup(ps),
    ...(apiMethods.reduce((acc, methodName) => {
        acc[methodName as keyof Api] = app[methodName as keyof typeof app] as any;
        return acc;
    }, {} as any) as Record<string, (ps?: any) => any>),

    // Native-only methods that can't work in browser mode — return safe stubs.
    pickEditorApplication: async () => undefined,
    pickTerminalApplication: async () => undefined,
    pickDirectory: async () => undefined,
    openExternalUrl: async () => undefined,
    openFileInEditor: async () => {
        throw new Error('openFileInEditor is not available in browser dev mode.');
    },
    revealPathInFileManager: async () => undefined,
    openDirectoryInTerminal: async () => undefined,
    openPathWithDefaultProgram: async () => undefined,
    createIntegratedTerminalSession: async () => ({ sessionId: 'browser-stub', error: 'Integrated terminal is not available in browser dev mode.' }),
    writeIntegratedTerminalSession: async () => undefined,
    resizeIntegratedTerminalSession: async () => undefined,
    closeIntegratedTerminalSession: async () => undefined,
    onNativeCommand: () => () => {},
    onIntegratedTerminalEvent: () => () => {},
};

console.log(Object.keys(methodMap));

const REQUEST_TIMEOUT_MS = 65_000;

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: Timer | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    });
}

Bun.serve({
    port: PORT,
    async fetch(req) {
        // CORS for Vite dev server
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        const url = new URL(req.url);

        // Health check
        if (url.pathname === '/health') {
            return Response.json({ ok: true });
        }

        // API endpoint: POST /api/:method
        if (url.pathname.startsWith('/api/') && req.method === 'POST') {
            const method = url.pathname.slice('/api/'.length);
            const handler = methodMap[method];

            if (!handler) {
                return new Response(JSON.stringify({ error: `Unknown method: ${method}` }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            try {
                let params: any = undefined;
                const contentType = req.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const text = await runWithTimeout(req.text(), REQUEST_TIMEOUT_MS);
                    if (text.trim()) {
                        params = JSON.parse(text);
                    }
                }

                const result = await runWithTimeout(handler(params), REQUEST_TIMEOUT_MS);
                return Response.json(result, {
                    headers: { 'Access-Control-Allow-Origin': '*' },
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[devServer] ${method}:`, message);
                return new Response(JSON.stringify({ error: message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                });
            }
        }

        return new Response('Not found', { status: 404 });
    },
});

console.log(`[devServer] Backend API running at http://localhost:${PORT}`);
