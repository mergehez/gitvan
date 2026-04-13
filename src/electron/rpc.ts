import { BrowserWindow, dialog, app as electronApp, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { app } from '../backend/services/app.js';
import { openFileInEditor, pickEditorApplication, pickTerminalApplication } from './extEditors.js';
import { closeIntegratedTerminalSession, createIntegratedTerminalSession, resizeIntegratedTerminalSession, writeIntegratedTerminalSession } from './integratedTerminal.js';
import { openDirectoryInTerminal as openDirectoryInSystemTerminal } from './systemShell.js';

type Ctx = {
    window: BrowserWindow | undefined;
};

type GitClientRequestHandler<TParams, TResponse> = (context: Ctx, params: TParams) => Promise<TResponse> | TResponse;

function _mapNo<TMethod extends () => any>(method: TMethod) {
    return async (): Promise<Awaited<ReturnType<TMethod>>> => await method();
}
function _mapPs<TMethod extends (...args: any) => any>(method: TMethod) {
    return async (_: Ctx, ps: Parameters<TMethod>[0]): Promise<Awaited<ReturnType<TMethod>>> => await method(ps);
}
function _mapWindow<TMethod extends (window: BrowserWindow | undefined, ...args: any) => any>(method: TMethod) {
    return async (ctx: Ctx, ps: Parameters<TMethod>[1]): Promise<Awaited<ReturnType<TMethod>>> => await method(ctx.window, ps);
}
export const gitClientRequestHandlers = {
    getEditorSettings: _mapNo(() => app.getEditorSettings()),
    pickEditorApplication: _mapWindow(pickEditorApplication),
    pickTerminalApplication: _mapWindow(pickTerminalApplication),
    updateEditorSettings: _mapPs(app.updateEditorSettings),
    getBootstrap: _mapNo(app.getBootstrap),
    getCloneRepoDefaults: async () => {
        const storedDefaults = app.getCloneRepoDefaults();
        const fallbackParentDirectory = join(electronApp.getPath('documents'), 'GitHub');

        return {
            parentDirectory: storedDefaults.parentDirectory || fallbackParentDirectory,
        };
    },
    pickDirectory: async (ctx: Ctx, ps?: { title?: string; buttonLabel?: string; defaultPath?: string }) => {
        const options = {
            title: ps?.title,
            buttonLabel: ps?.buttonLabel,
            defaultPath: ps?.defaultPath,
            properties: ['openDirectory'] as Array<'openDirectory'>,
        };

        const result = ctx.window ? await dialog.showOpenDialog(ctx.window, options) : await dialog.showOpenDialog(options);

        return result.canceled ? undefined : (result.filePaths[0] ?? undefined);
    },
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
    openExternalUrl: async (_ctx: Ctx, ps: { url: string }) => {
        await shell.openExternal(ps.url);
    },
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
    openFileInEditor: _mapPs(openFileInEditor),
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
    revealPathInFileManager: async (_ctx: Ctx, ps: { path: string; mode: 'open-directory' | 'reveal-item' }) => {
        if (ps.mode === 'reveal-item') {
            shell.showItemInFolder(ps.path);
            return;
        }

        const result = await shell.openPath(ps.path);

        if (result) {
            throw new Error(result);
        }
    },
    openDirectoryInTerminal: async (_ctx: Ctx, ps: { directoryPath: string }) => {
        await openDirectoryInSystemTerminal(ps.directoryPath);
    },
    createIntegratedTerminalSession: async (ctx: Ctx, ps: { repoId: number; cols?: number; rows?: number; terminalPath?: string }) => {
        if (!ctx.window) {
            throw new Error('A window is required to create an integrated terminal session.');
        }

        return createIntegratedTerminalSession(ctx.window, app.resolveRepoFilePath({ repoId: ps.repoId, path: '' }), ps.terminalPath, ps);
    },
    writeIntegratedTerminalSession: async (_ctx: Ctx, ps: { sessionId: string; data: string }) => {
        writeIntegratedTerminalSession(ps.sessionId, ps.data);
    },
    resizeIntegratedTerminalSession: async (_ctx: Ctx, ps: { sessionId: string; cols: number; rows: number }) => {
        resizeIntegratedTerminalSession(ps.sessionId, ps.cols, ps.rows);
    },
    closeIntegratedTerminalSession: async (_ctx: Ctx, ps: { sessionId: string }) => {
        closeIntegratedTerminalSession(ps.sessionId);
    },
    openPathWithDefaultProgram: async (_ctx: Ctx, ps: { path: string }) => {
        const result = await shell.openPath(ps.path);

        if (result) {
            throw new Error(result);
        }
    },
} satisfies Record<string, GitClientRequestHandler<any, any>>;

type GitClientRequestMapFromHandlers<THandlers extends Record<string, GitClientRequestHandler<any, any>>> = {
    [K in keyof THandlers]: {
        params: Parameters<THandlers[K]>[1];
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

function registerGitClientIpcHandler<K extends keyof typeof gitClientRequestHandlers>(name: K) {
    const handler = gitClientRequestHandlers[name] as GitClientRequestHandler<
        Parameters<(typeof gitClientRequestHandlers)[K]>[1],
        Awaited<ReturnType<(typeof gitClientRequestHandlers)[K]>>
    >;

    ipcMain.handle(`gitvan:${String(name)}`, (event, ps: Parameters<typeof handler>[1]) => handler({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined }, ps));
}

export function registerGitClientIpcHandlers() {
    for (const name of Object.keys(gitClientRequestHandlers) as Array<keyof typeof gitClientRequestHandlers>) {
        registerGitClientIpcHandler(name);
    }
}
