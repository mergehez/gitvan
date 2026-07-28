// NOTE:
// this file shouldn't contain project-specific logic. It should only contain generic helpers for Electron apps that use a backend server and a frontend built with Vite.
// we should be able to copy this file into another project and use it without any modifications.

import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// __dirname: CJS provides it directly; ESM needs fileURLToPath(import.meta.url)
const __dirname = typeof __filename !== 'undefined' ? dirname(__filename) : dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

export type RendererDiagnosticPayload = {
    type: 'console-error' | 'window-error' | 'unhandled-rejection';
    message: string;
    details?: string;
};
export type CreateGitClientRequestApi<HandlersMap extends Record<string, any>> = {
    [K in keyof HandlersMap]: undefined extends Parameters<HandlersMap[K]>[0]
        ? (params?: Parameters<HandlersMap[K]>[0]) => Promise<Awaited<ReturnType<HandlersMap[K]>>>
        : (params: Parameters<HandlersMap[K]>[0]) => Promise<Awaited<ReturnType<HandlersMap[K]>>>;
};

export function createElectronHelpers(appName: string, defaultApiPort: string) {
    const apiPort = process.env.API_PORT || defaultApiPort;

    function generateHandlers<AppServiceType extends Record<string, any>>(apiMethods: readonly string[]) {
        type AppMethodKeys = { [K in keyof AppServiceType]: AppServiceType[K] extends (...args: any[]) => any ? K : never }[keyof AppServiceType];
        type BackendHandlers = {
            [K in AppMethodKeys]: (ps: Parameters<AppServiceType[K]>[0]) => Promise<Awaited<ReturnType<AppServiceType[K]>>>;
        };
        async function callApiPost(method: string, params?: unknown): Promise<unknown> {
            const response = await fetch(`http://127.0.0.1:${apiPort}/api/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: params !== undefined ? JSON.stringify(params) : undefined,
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Backend error (${response.status}): ${text}`);
            }
            return response.json();
        }

        const handlers: any = {};
        for (const name of apiMethods) {
            handlers[name] = async (ps?: unknown) => callApiPost(name as string, ps);
        }

        return {
            mergeWithNative: <NativeMethods extends Record<string, any>>(nativeMethods: (apiPost: typeof callApiPost) => NativeMethods) => {
                return {
                    ...handlers,
                    ...nativeMethods(callApiPost),
                } as BackendHandlers & NativeMethods;
            },
        };
    }

    function registerIpcHandlers(handlers: Record<string, any>) {
        for (const [name, handler] of Object.entries(handlers)) {
            ipcMain.handle(name, async (_event, ps) => (handler as (ps?: unknown) => Promise<unknown>)(ps));
        }

        ipcMain.on('renderer-diagnostic', (_event, diagnostic: RendererDiagnosticPayload) => {
            const header = `[renderer:${diagnostic.type}] ${diagnostic.message}`;
            if (diagnostic.details) {
                console.error(header);
                console.error(diagnostic.details);
            } else {
                console.error(header);
            }
        });
    }

    type StartOpts = {
        createHandlers: (window: BrowserWindow) => Record<string, any>;
        getMenu: (mainWindow: BrowserWindow) => Electron.MenuItemConstructorOptions[];
    };
    async function createWindow(opts: StartOpts) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        const width = Math.max(screenWidth * 0.5, 1440);
        const height = Math.max(screenHeight * 0.8, 720);
        const x = Math.round((screenWidth - width) / 2);
        const y = Math.round((screenHeight - height) / 2);

        const mainWindow = new BrowserWindow({
            title: appName,
            x,
            y,
            width,
            height,
            webPreferences: {
                preload: join(__dirname, 'preload.cjs'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        Menu.setApplicationMenu(Menu.buildFromTemplate(opts.getMenu(mainWindow)));
        registerIpcHandlers(opts.createHandlers(mainWindow));

        if (isDev) {
            try {
                await fetch('http://127.0.0.1:5173', { method: 'HEAD' });
                await mainWindow.loadURL('http://127.0.0.1:5173');
                console.log('Using Vite dev server');
                return;
            } catch {
                /* fall through */
            }
        }

        const indexPath = join(projectRoot, 'dist', 'index.html');
        if (existsSync(indexPath)) await mainWindow.loadFile(indexPath);
        else throw new Error(`Frontend build not found at ${indexPath}. Run 'vp build' first.`);
    }

    function start(opts: StartOpts) {
        const _require = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);

        app.whenReady().then(async () => {
            console.log('Starting backend server...');
            await ((): Promise<void> => {
                const mod = _require('./backend.cjs') as { ready?: Promise<void> };
                return mod.ready ?? Promise.resolve();
            })();
            console.log('Backend started. Creating window...');
            await createWindow(opts);
            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) createWindow(opts);
            });
        });

        function stopBackend() {}
        app.on('window-all-closed', () => {
            stopBackend();
            if (process.platform !== 'darwin') app.quit();
        });
        app.on('will-quit', () => {
            stopBackend();
        });
    }
    return {
        generateHandlers,
        start,
    };
}
