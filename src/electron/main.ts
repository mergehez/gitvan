import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { app as AppService } from '../backend/services/app.ts';
import { apiMethods } from '../shared/apiMethods.ts';

// __dirname: CJS provides it directly; ESM needs fileURLToPath(import.meta.url)
const __dirname = typeof __filename !== 'undefined' ? dirname(__filename) : dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const API_PORT = process.env.API_PORT || '5176';

let mainWindow: BrowserWindow | null = null;

// ── Backend (run in-process) ──

const _require = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);

function startBackend(): Promise<void> {
    const mod = _require('./backend.cjs') as { ready?: Promise<void> };
    return mod.ready ?? Promise.resolve();
}

function stopBackend() {}

// ── Backend API proxy ──

const API_BASE = `http://127.0.0.1:${API_PORT}`;

async function apiPost(method: string, params?: unknown): Promise<unknown> {
    const response = await fetch(`${API_BASE}/api/${method}`, {
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
// ── Backend handler factory ──

type AppServiceType = typeof AppService;
type AppMethodKeys = { [K in keyof AppServiceType]: AppServiceType[K] extends (...args: any[]) => any ? K : never }[keyof AppServiceType];
type BackendHandlers = {
    [K in AppMethodKeys]: (ps: Parameters<AppServiceType[K]>[0]) => Promise<Awaited<ReturnType<AppServiceType[K]>>>;
};
function createHandlers(getWindow: () => BrowserWindow | null) {
    const handlers: any = {};
    for (const name of apiMethods) {
        handlers[name] = async (ps?: unknown) => apiPost(name, ps);
    }
    return {
        ...(handlers as BackendHandlers),
        pickEditorApplication: async () => {
            const result = await dialog.showOpenDialog(getWindow()!, {
                defaultPath: process.platform === 'darwin' ? '/Applications' : require('os').homedir(),
                filters: process.platform === 'darwin' ? [{ name: 'Applications', extensions: ['app'] }] : undefined,
                properties: ['openFile'],
            });
            if (result.canceled || !result.filePaths[0]) return undefined;
            const path = result.filePaths[0];
            let label = path.split('/').pop() || path;
            if (label.endsWith('.app') || label.endsWith('.exe')) label = label.slice(0, -4);
            return { path, label };
        },

        pickTerminalApplication: async () => {
            const result = await dialog.showOpenDialog(getWindow()!, {
                defaultPath:
                    process.platform === 'darwin' ? '/bin' : process.platform === 'win32' ? `${process.env.SystemRoot || 'C:\\Windows'}\\System32` : require('os').homedir(),
                properties: ['openFile'],
            });
            if (result.canceled || !result.filePaths[0]) return undefined;
            const path = result.filePaths[0];
            let label = path.split('/').pop() || path;
            if (label.endsWith('.app') || label.endsWith('.exe')) label = label.slice(0, -4);
            return { path, label, locked: false };
        },

        pickDirectory: async (ps?: { defaultPath?: string; title?: string; buttonLabel?: string }) => {
            const result = await dialog.showOpenDialog(getWindow()!, {
                defaultPath: ps?.defaultPath || require('os').homedir(),
                properties: ['openDirectory'],
            });
            return result.canceled ? undefined : result.filePaths[0]?.trim();
        },

        openExternalUrl: async (ps: { url: string }) => {
            await shell.openExternal(ps.url);
        },

        openFileInEditor: async (ps: { repoId: number; path: string; editorPath: string }) => {
            const response = await apiPost('resolveRepoFilePath', { repoId: ps.repoId, path: ps.path });
            if (typeof response !== 'string') throw new Error('Invalid response from resolveRepoFilePath');
            const filePath: string = response;
            if (!existsSync(filePath)) throw new Error('The selected file no longer exists in the working tree.');
            if (!existsSync(ps.editorPath)) throw new Error('The selected editor no longer exists on disk.');
            if (process.platform === 'darwin') {
                await shell.openPath(filePath);
            } else {
                const { execFileSync } = await import('child_process');
                execFileSync(ps.editorPath, [filePath]);
            }
        },

        revealPathInFileManager: async (ps: { path: string; mode: string }) => {
            if (ps.mode === 'reveal-item') shell.showItemInFolder(ps.path);
            else await shell.openPath(ps.path);
        },

        openPathWithDefaultProgram: async (ps: { path: string }) => {
            await shell.openPath(ps.path);
        },

        openDirectoryInTerminal: async (ps: { directoryPath: string; applicationPath?: string }) => {
            const { openDirectoryInTerminal } = await import('./systemShell.ts');
            return openDirectoryInTerminal(ps);
        },

        createIntegratedTerminalSession: async (ps: { repoId: number; terminalPath?: string; cols?: number; rows?: number }) => {
            const { createIntegratedTerminalSession } = await import('./integratedTerminal.ts');
            const repoPathResponse = await apiPost('resolveRepoFilePath', { repoId: ps.repoId, path: '' });
            if (typeof repoPathResponse !== 'string') throw new Error('Invalid response from resolveRepoFilePath');
            const repoPath: string = repoPathResponse;
            const size = ps.cols !== undefined ? { cols: ps.cols, rows: ps.rows } : undefined;
            return createIntegratedTerminalSession(
                {
                    emitIntegratedTerminalEvent(event: any) {
                        getWindow()?.webContents.send('integrated-terminal-event', event);
                    },
                },
                repoPath,
                ps.terminalPath,
                size
            );
        },

        writeIntegratedTerminalSession: async (ps: { sessionId: string; data: string }) => {
            const { writeIntegratedTerminalSession } = await import('./integratedTerminal.ts');
            return writeIntegratedTerminalSession(ps);
        },

        resizeIntegratedTerminalSession: async (ps: { sessionId: string; cols: number; rows: number }) => {
            const { resizeIntegratedTerminalSession } = await import('./integratedTerminal.ts');
            return resizeIntegratedTerminalSession(ps);
        },

        closeIntegratedTerminalSession: async (ps: { sessionId: string }) => {
            const { closeIntegratedTerminalSession } = await import('./integratedTerminal.ts');
            return closeIntegratedTerminalSession(ps);
        },
    };
}
export type HandlersMap = ReturnType<typeof createHandlers>;

export type GitClientRequestApi = {
    [K in keyof HandlersMap]: undefined extends Parameters<HandlersMap[K]>[0]
        ? (params?: Parameters<HandlersMap[K]>[0]) => Promise<Awaited<ReturnType<HandlersMap[K]>>>
        : (params: Parameters<HandlersMap[K]>[0]) => Promise<Awaited<ReturnType<HandlersMap[K]>>>;
};

export type RendererDiagnosticPayload = {
    type: 'console-error' | 'window-error' | 'unhandled-rejection';
    message: string;
    details?: string;
};

// ── IPC handler registration ──

function registerIpcHandlers() {
    const handlers = createHandlers(() => mainWindow);

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

// ── Menu ──

function buildMenu() {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: 'Gitvan',
            submenu: [
                { role: 'about' },
                { label: 'Open Settings', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('native-command', { kind: 'open-settings' }) },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                {
                    label: 'Show All',
                    click: () => {
                        for (const win of BrowserWindow.getAllWindows()) win.show();
                    },
                },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
        },
        {
            label: 'View',
            submenu: [
                { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Alt+I', click: () => mainWindow?.webContents.toggleDevTools() },
                { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Window ──

async function createWindow() {
    buildMenu();
    registerIpcHandlers();

    const primaryDisplay = screen.getPrimaryDisplay();
    const width = 1440,
        height = 920;
    const x = Math.round(primaryDisplay.workArea.x + (primaryDisplay.workArea.width - width) / 2);
    const y = Math.round(primaryDisplay.workArea.y + (primaryDisplay.workArea.height - height) / 2);

    mainWindow = new BrowserWindow({
        title: 'Gitvan',
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

// ── App lifecycle ──

app.whenReady().then(async () => {
    console.log('Starting backend server...');
    await startBackend();
    console.log('Backend started. Creating window...');
    await createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    stopBackend();
    if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
    stopBackend();
});
