/**
 * Browser-only dev server that exposes backend app methods as HTTP endpoints.
 * Run with: tsx src/backend/devServer.ts
 */

import express from 'express';
import { homedir } from 'os';
import { join } from 'path';
import type { GitClientRequestApi as Api } from '../electrobun/index';
import { apiMethods } from '../shared/apiMethods';
import { app } from './services/app';
import { useDb } from './services/database';

const PORT = parseInt(process.env.API_PORT || '5176', 10);

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
const serverApp = express();

serverApp.use(express.text({ type: '*/*', limit: '10mb' }));
serverApp.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (_req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    next();
});

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

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

serverApp.get('/health', (_req, res) => {
    res.json({ ok: true });
});

serverApp.post('/api/:method', async (req, res) => {
    const method = req.params.method;
    const handler = method ? methodMap[method] : undefined;

    if (!handler) {
        res.status(404).json({ error: `Unknown method: ${method}` });
        return;
    }

    try {
        let params: any = undefined;
        const contentType = req.header('content-type') || '';
        const text = typeof req.body === 'string' ? req.body : '';
        if (contentType.includes('application/json') && text.trim()) {
            params = JSON.parse(text);
        }

        const result = await runWithTimeout(Promise.resolve(handler(params)), REQUEST_TIMEOUT_MS);
        res.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[devServer] ${method}:`, message);
        res.status(500).json({ error: message });
    }
});

serverApp.use((_req, res) => {
    res.status(404).send('Not found');
});

serverApp.listen(PORT, () => {
    console.log(`[devServer] Backend API running at http://localhost:${PORT}`);
});

