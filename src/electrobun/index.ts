import type { RPCSchema } from 'electrobun/bun';
import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, Screen, Updater, Utils, type ApplicationMenuItemConfig } from 'electrobun/bun';
import { existsSync } from 'fs';
import { join } from 'path';
import { app } from '../backend/services/app.js';
import { executeTextCommand } from '../backend/services/bunSubprocess.js';
import { useDb } from '../backend/services/database.js';
import type { IntegratedTerminalEvent, NativeCommand, TerminalApp } from '../shared/gitClient.js';
import { closeIntegratedTerminalSession, createIntegratedTerminalSession, resizeIntegratedTerminalSession, writeIntegratedTerminalSession } from './integratedTerminal.js';
import { openDirectoryInTerminal as openDirectoryInSystemTerminal } from './systemShell.js';

export type RendererDiagnosticPayload = {
    type: 'console-error' | 'window-error' | 'unhandled-rejection';
    message: string;
    details?: string;
};

async function pickApplication(options: { defaultPath: string; extensions?: string[]; canChooseDirectory?: boolean }) {
    const paths = await Utils.openFileDialog({
        startingFolder: options.defaultPath,
        allowedFileTypes: ((exts?: string[]) => (exts && exts.length > 0 ? exts.join(',') : '*'))(options.extensions),
        canChooseFiles: options.canChooseDirectory !== true,
        canChooseDirectory: options.canChooseDirectory === true,
        allowsMultipleSelection: false,
    });
    const path = paths.map((value) => value.trim()).find(Boolean);

    if (!path) {
        return undefined;
    }

    let label = path.split('/').pop() || path;
    if (label.endsWith('.app') || label.endsWith('.exe')) {
        label = label.slice(0, -4);
    }

    return { path, label };
}

function _mapNo<TMethod extends () => any>(method: TMethod) {
    return async (): Promise<Awaited<ReturnType<TMethod>>> => await method();
}
function _mapPs<TMethod extends (...args: any) => any>(method: TMethod) {
    return async (ps: Parameters<TMethod>[0]): Promise<Awaited<ReturnType<TMethod>>> => await method(ps);
}
function _mapWindow<TMethod extends (window: BrowserWindow | undefined, ...args: any) => any>(method: TMethod) {
    return async (ps: Parameters<TMethod>[1]): Promise<Awaited<ReturnType<TMethod>>> => await method(window, ps);
}

type GitClientRequestHandler<TParams, TResponse> = (params: TParams) => Promise<TResponse> | TResponse;
const GIT_CLIENT_RPC_MAX_REQUEST_TIME = 120_000;

export const gitClientRequestHandlers = {
    getEditorSettings: _mapNo(() => app.getEditorSettings()),
    pickEditorApplication: _mapWindow(async function () {
        return await pickApplication({
            defaultPath: process.platform === 'darwin' ? '/Applications' : Utils.paths.home,
            extensions: process.platform === 'darwin' ? ['app'] : process.platform === 'win32' ? ['exe'] : undefined,
        });
    }),
    pickTerminalApplication: _mapWindow(async function () {
        const selection = await pickApplication({
            defaultPath: process.platform === 'darwin' ? '/bin' : process.platform === 'win32' ? `${process.env.SystemRoot || 'C:\\Windows'}\\System32` : Utils.paths.home,
            extensions: process.platform === 'win32' ? ['exe', 'cmd', 'bat'] : undefined,
        });

        return selection ? ({ ...selection, locked: false } satisfies TerminalApp) : undefined;
    }),
    updateEditorSettings: _mapPs(app.updateEditorSettings),
    getBootstrap: _mapNo(app.getBootstrap),
    getCloneRepoDefaults: _mapNo(async () => {
        return {
            parentDirectory: app.getCloneRepoDefaults().parentDirectory || join(Utils.paths.documents, 'GitHub'),
        };
    }),
    pickDirectory: _mapPs(async (ps) => {
        const paths = await Utils.openFileDialog({
            startingFolder: ps?.defaultPath || Utils.paths.home,
            allowedFileTypes: '*',
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
        });

        return paths.map((value) => value.trim()).find(Boolean);
    }),
    listCloneableRepos: _mapPs(app.listCloneableRepos),
    addTrackedRepoFromPath: _mapPs(app.addTrackedRepoFromPath),
    cloneTrackedRepo: _mapPs(app.cloneTrackedRepo),
    createTrackedLocalRepo: _mapPs(app.createTrackedLocalRepo),
    createRepoGroup: _mapPs(app.createTrackedRepoGroup),
    deleteTrackedRepoGroup: _mapPs(app.deleteTrackedRepoGroup),
    moveRepo: _mapPs(app.moveTrackedRepo),
    reorderRepo: _mapPs(app.reorderTrackedRepo),
    moveRepoGroup: _mapPs(app.moveTrackedRepoGroup),
    renameRepoGroup: _mapPs(app.renameTrackedRepoGroup),
    renameRepo: _mapPs(app.renameTrackedRepo),
    selectRepo: _mapPs(app.selectRepo),
    updateRepoGroup: _mapPs(app.updateTrackedRepoGroup),
    updateRepoGroups: _mapPs(app.updateTrackedRepoGroups),
    refreshRepos: _mapNo(app.refreshRepos),
    resetSandboxRepos: _mapNo(app.resetSandboxRepos),
    removeRepo: _mapPs(app.removeTrackedRepo),
    createAccount: _mapPs(app.createAccountRecord),
    updateAccount: _mapPs(app.updateAccountRecord),
    deleteAccount: _mapPs(app.deleteAccountRecord),
    reorderAccount: _mapPs(app.reorderAccountRecord),
    getOAuthProviderSettings: _mapNo(app.getOAuthProviderSettings),
    updateOAuthProviderSettings: _mapPs(app.updateOAuthProviderSettings),
    openExternalUrl: _mapPs(async (ps) => {
        Utils.openExternal(ps.url);
    }),
    startOAuthDeviceFlow: _mapPs(app.startOAuthAccountDeviceFlow),
    pollOAuthDeviceFlow: _mapPs(app.pollOAuthAccountDeviceFlow),
    assignRepoAccount: _mapPs(app.assignAccountToRepo),
    assignRepoTerminal: _mapPs(app.assignTerminalToRepo),
    getChanges: _mapPs(app.getChanges),
    getStashes: _mapPs(app.getStashes),
    getStashDetail: _mapPs(app.getStashDetail),
    getStashFileDiff: _mapPs(app.getStashFileDiff),
    getMergeConflictState: _mapPs(app.getMergeConflictState),
    getMergeConflictFileDetails: _mapPs(app.getMergeConflictFileDetails),
    getFileDiff: _mapPs(app.getDiff),
    openFileInEditor: _mapPs(async function (ps: { repoId: number; path: string; editorPath: string }) {
        const filePath = app.resolveRepoFilePath({ repoId: ps.repoId, path: ps.path });

        if (!existsSync(filePath)) {
            throw new Error('The selected file no longer exists in the working tree.');
        }

        if (!existsSync(ps.editorPath)) {
            throw new Error('The selected editor no longer exists on disk.');
        }

        const command = process.platform === 'darwin' ? 'open' : ps.editorPath;
        const args = process.platform === 'darwin' ? ['-a', ps.editorPath, filePath] : [filePath];
        const [, , exitCode] = await executeTextCommand({
            command,
            args,
        });

        if (exitCode !== 0) {
            throw new Error('Failed to open the file in the selected application.');
        }
    }),
    stageFile: _mapPs(app.stageFile),
    stageFileHunks: _mapPs(app.stageFileHunks),
    stageRepoFiles: _mapPs(app.stageRepoFiles),
    stageAllFiles: _mapPs(app.stageAllFiles),
    unstageFile: _mapPs(app.unstageFile),
    unstageFileHunks: _mapPs(app.unstageFileHunks),
    unstageRepoFiles: _mapPs(app.unstageRepoFiles),
    discardFile: _mapPs(app.discardFile),
    discardFileHunks: _mapPs(app.discardFileHunks),
    discardRepoFiles: _mapPs(app.discardRepoFiles),
    unstageAllFiles: _mapPs(app.unstageAllFiles),
    discardAllChanges: _mapPs(app.discardAllChanges),
    restoreRepoFile: _mapPs(app.restoreRepoFile),
    restoreRepoFiles: _mapPs(app.restoreRepoFiles),
    deleteStagedRepoFile: _mapPs(app.deleteStagedRepoFile),
    deleteStagedRepoFiles: _mapPs(app.deleteStagedRepoFiles),
    ignoreRepoPath: _mapPs(app.ignoreRepoPath),
    restoreStash: _mapPs(app.restoreStash),
    discardStash: _mapPs(app.discardStash),
    resolveMergeConflictFile: _mapPs(app.resolveMergeConflictFile),
    markMergeConflictResolved: _mapPs(app.markMergeConflictResolved),
    saveMergeConflictResolution: _mapPs(app.saveMergeConflictResolution),
    abortMerge: _mapPs(app.abortMerge),
    commitMerge: _mapPs(app.commitMerge),
    commitRepo: _mapPs(app.commitRepo),
    undoLastCommit: _mapPs(app.undoLastCommit),
    getHistory: _mapPs(app.getHistory),
    getCommittedTree: _mapPs(app.getCommittedTree),
    getCommittedFile: _mapPs(app.getCommittedFile),
    getCommitDetail: _mapPs(app.getCommit),
    getCommitFileDiff: _mapPs(app.getCommitDiff),
    getBranches: _mapPs(app.getBranches),
    checkoutBranch: _mapPs(app.checkoutBranch),
    createBranch: _mapPs(app.createBranch),
    createRemoteBranch: _mapPs(app.createRemoteBranch),
    publishBranch: _mapPs(app.publishBranch),
    runRemoteOperation: _mapPs(app.runRemoteOperation),
    retryPullAfterStash: _mapPs(app.retryPullAfterStash),
    revealPathInFileManager: _mapPs(async (ps) => {
        if (ps.mode === 'reveal-item') {
            Utils.showItemInFolder(ps.path);
            return;
        }
        Utils.openPath(ps.path);
    }),
    openDirectoryInTerminal: _mapPs(openDirectoryInSystemTerminal),
    createIntegratedTerminalSession: _mapPs(async (ps) => {
        return createIntegratedTerminalSession(
            {
                emitIntegratedTerminalEvent(event) {
                    rpc?.send.integratedTerminalEvent(event);
                },
            },
            app.resolveRepoFilePath({ repoId: ps.repoId, path: '' }),
            ps.terminalPath,
            ps
        );
    }),
    writeIntegratedTerminalSession: _mapPs(writeIntegratedTerminalSession),
    resizeIntegratedTerminalSession: _mapPs(resizeIntegratedTerminalSession),
    closeIntegratedTerminalSession: _mapPs(closeIntegratedTerminalSession),
    openPathWithDefaultProgram: _mapPs(async (ps) => {
        Utils.openPath(ps.path);
    }),
} as const satisfies Record<string, GitClientRequestHandler<any, any>>;

type GitClientRequestMapFromHandlers<THandlers extends Record<string, GitClientRequestHandler<any, any>>> = {
    [K in keyof THandlers]: {
        params: Parameters<THandlers[K]>[0];
        response: Awaited<ReturnType<THandlers[K]>>;
    };
};

type GitClientRequestApiFromMap<TMap extends Record<string, { params: unknown; response: unknown }>> = {
    [K in keyof TMap]: undefined extends TMap[K]['params']
        ? (params?: TMap[K]['params']) => Promise<TMap[K]['response']>
        : (params: TMap[K]['params']) => Promise<TMap[K]['response']>;
};
export type GitClientRequestMap = GitClientRequestMapFromHandlers<typeof gitClientRequestHandlers>;

export type GitClientRequestApi = GitClientRequestApiFromMap<GitClientRequestMap>;

export type GitClientRequestDefinition = {
    params: unknown;
    response: unknown;
};
type GitClientRequestMapConstraint<TMap> = {
    [K in keyof TMap]: GitClientRequestDefinition;
};

export type GitClientBridge<TMap extends GitClientRequestMapConstraint<TMap>> = {
    invoke<K extends keyof TMap>(name: K, params: TMap[K]['params']): Promise<TMap[K]['response']>;
    onNativeCommand(listener: (command: NativeCommand) => void): () => void;
    onIntegratedTerminalEvent(listener: (event: IntegratedTerminalEvent) => void): () => void;
};

function installMenu() {
    const menu: ApplicationMenuItemConfig[] = [
        {
            label: 'Gitvan',
            submenu: [
                { role: 'about' },
                {
                    label: 'Open Settings',
                    action: 'open-settings',
                    accelerator: 'CmdOrCtrl+,',
                },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'showAll' },
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
                    action: 'toggle-devtools',
                    accelerator: 'CmdOrCtrl+Alt+I',
                },
                {
                    label: 'Reload',
                    action: 'reload-window',
                    accelerator: 'CmdOrCtrl+R',
                },
            ],
        },
    ];

    ApplicationMenu.setApplicationMenu(menu);

    Electrobun.events.on('application-menu-clicked', (event) => {
        switch (event.data.action) {
            case 'open-settings':
                if (window.isMinimized()) {
                    window.unminimize();
                }

                window.show();
                window.focus();

                rpc.send.nativeCommand({ kind: 'open-settings' });
                break;
            case 'toggle-devtools':
                window?.webview.toggleDevTools();
                break;
            case 'reload-window':
                window?.webview.executeJavascript('window.location.reload()');
                break;
        }
    });
}

useDb().configureDatabase(join(Utils.paths.appData, 'gitvan'));
installMenu();

export type GitClientElectrobunRpc = {
    bun: RPCSchema<{
        requests: GitClientRequestMap;
        messages: {
            rendererDiagnostic: RendererDiagnosticPayload;
        };
    }>;
    webview: RPCSchema<{
        requests: {};
        messages: {
            nativeCommand: NativeCommand;
            integratedTerminalEvent: IntegratedTerminalEvent;
        };
    }>;
};
const rpc = BrowserView.defineRPC<GitClientElectrobunRpc>({
    maxRequestTime: GIT_CLIENT_RPC_MAX_REQUEST_TIME,
    handlers: {
        requests: gitClientRequestHandlers,
        messages: {
            rendererDiagnostic(diagnostic: RendererDiagnosticPayload) {
                const header = `[renderer:${diagnostic.type}] ${diagnostic.message}`;

                if (diagnostic.details) {
                    console.error(header);
                    console.error(diagnostic.details);
                    return;
                }

                console.error(header);
            },
        },
    },
});

const DEV_SERVER_URL = `http://127.0.0.1:5173`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
    const channel = await Updater.localInfo.channel();
    if (channel === 'dev') {
        try {
            await fetch(DEV_SERVER_URL, { method: 'HEAD' });
            console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
            return DEV_SERVER_URL;
        } catch {
            console.log("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
        }
    }
    return 'views://mainview/index.html';
}

const window = new BrowserWindow({
    title: 'Gitvan',
    frame: (() => {
        const display = Screen.getPrimaryDisplay();
        const width = 1440;
        const height = 920;
        const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
        const y = Math.round(display.workArea.y + (display.workArea.height - height) / 2);

        return { x, y, width, height };
    })(),
    titleBarStyle: 'default',
    url: await getMainViewUrl(),
    rpc: rpc,
});

// showWindow(mainWindow);
// if (process.env.ELECTROBUN_RENDERER_URL) {
//     console.log('[electrobun] opening devtools');
// mainWindow.webview.openDevTools();
// }
