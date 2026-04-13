import { app, BrowserWindow, Menu } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useDb } from '../backend/services/database.js';
import type { NativeCommand } from '../shared/gitClient.js';
import { registerGitClientIpcHandlers } from './rpc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');
const preloadPath = join(__dirname, 'preload.js');
const rendererIndexPath = join(projectRoot, 'dist', 'index.html');
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
const brandedUserDataPath = join(app.getPath('appData'), 'gitvan');
const nativeCommandChannel = 'gitvan:native-command';

app.setName('Gitvan');
app.setPath('userData', brandedUserDataPath);

let mainWindow: BrowserWindow | undefined = undefined;

function sendNativeCommand(command: NativeCommand) {
    const targetWindow = mainWindow ?? BrowserWindow.getAllWindows()[0];

    if (!targetWindow || targetWindow.isDestroyed()) {
        return;
    }

    if (targetWindow.isMinimized()) {
        targetWindow.restore();
    }

    targetWindow.show();
    targetWindow.focus();
    targetWindow.webContents.send(nativeCommandChannel, command);
}

async function loadRenderer(window: BrowserWindow, view?: string, query: Record<string, string> = {}) {
    if (devServerUrl) {
        const url = new URL(devServerUrl);

        if (view) {
            url.searchParams.set('view', view);
        }

        for (const [key, value] of Object.entries(query)) {
            url.searchParams.set(key, value);
        }

        await window.loadURL(url.toString());
        return;
    }

    if (view) {
        await window.loadFile(rendererIndexPath, { query: { view, ...query } });
        return;
    }

    await window.loadFile(rendererIndexPath, { query });
}

async function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1180,
        minHeight: 760,
        title: 'Gitvan',
        titleBarStyle: 'default',
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    await loadRenderer(mainWindow);

    mainWindow.on('closed', () => {
        mainWindow = undefined;
    });

    if (devServerUrl) {
        mainWindow.webContents.openDevTools();
    }
}

function installMenu() {
    const menu = Menu.buildFromTemplate([
        {
            label: 'Gitvan',
            submenu: [
                { role: 'about' },
                {
                    label: 'Open Settings',
                    accelerator: 'CmdOrCtrl+,',
                    click() {
                        sendNativeCommand({ kind: 'open-settings' });
                    },
                },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
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
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'CmdOrCtrl+Alt+I',
                    click() {
                        mainWindow?.webContents.toggleDevTools();
                    },
                },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click() {
                        mainWindow?.webContents.reload();
                    },
                },
            ],
        },
    ]);

    Menu.setApplicationMenu(menu);
}

void app.whenReady().then(async () => {
    useDb().configureDatabase(app.getPath('userData'));
    registerGitClientIpcHandlers();
    installMenu();
    await createMainWindow();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    app.quit();
});
