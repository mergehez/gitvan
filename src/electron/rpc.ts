import { BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import { app } from '../backend/services/app.js';
import { git } from '../backend/services/git.js';
import type { RemoteOperation } from '../shared/gitClient.js';
import { showAccountAssignmentMenu, showChangeFileContextMenu, showConfirmationDialog, showRepoContextMenu } from './dialogs.js';
import { openFileInEditor, pickEditorApplication } from './extEditors.js';

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
    confirmAction: _mapWindow(showConfirmationDialog),
    pickEditorApplication: _mapWindow(pickEditorApplication),
    updateEditorSettings: _mapPs(app.updateEditorSettings),
    showAccountAssignmentMenu: _mapWindow(showAccountAssignmentMenu),
    getBootstrap: _mapNo(app.getBootstrap),
    getCloneRepoDefaults: _mapNo(app.getCloneRepoDefaults),
    pickCloneRepoDirectory: _mapNo(app.pickCloneRepoDirectory),
    listCloneableRepos: _mapPs(app.listCloneableRepos),
    listCloneableRepos2: _mapPs(app.listCloneableRepos),
    pickRepo: _mapPs(app.pickRepo),
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
    getOAuthProviderSettings: _mapNo(app.getOAuthProviderSettings),
    updateOAuthProviderSettings: _mapPs(app.updateOAuthProviderSettings),
    startOAuthDeviceFlow: _mapPs(app.startOAuthAccountDeviceFlow),
    pollOAuthDeviceFlow: _mapPs(app.pollOAuthAccountDeviceFlow),
    assignRepoAccount: _mapPs(app.assignAccountToRepo),
    getChanges: _mapPs(app.getChanges),
    getStashes: _mapPs(app.getStashes),
    getStashDetail: _mapPs(app.getStashDetail),
    getStashFileDiff: _mapPs(app.getStashFileDiff),
    getMergeConflictState: _mapPs(app.getMergeConflictState),
    getMergeConflictFileDetails: _mapPs(app.getMergeConflictFileDetails),
    getFileDiff: _mapPs(app.getDiff),
    showChangeFileContextMenu: _mapWindow(showChangeFileContextMenu),
    openFileInEditor: _mapWindow(openFileInEditor),
    stageFile: _mapPs(app.stageFile),
    stageRepoFiles: _mapPs(app.stageRepoFiles),
    stageAllFiles: _mapPs(app.stageAllFiles),
    unstageFile: _mapPs(app.unstageFile),
    unstageRepoFiles: _mapPs(app.unstageRepoFiles),
    discardFile: _mapPs(app.discardFile),
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
    getCommitDetail: _mapPs(app.getCommit),
    getCommitFileDiff: _mapPs(app.getCommitDiff),
    getBranches: _mapPs(app.getBranches),
    checkoutBranch: _mapPs(app.checkoutBranch),
    createBranch: _mapPs(app.createBranch),
    createRemoteBranch: _mapPs(app.createRemoteBranch),
    publishBranch: _mapPs(app.publishBranch),
    showRepoContextMenu: _mapWindow(showRepoContextMenu),
    runRemoteOperation: async (_: Ctx, ps: { repoId: number; operation: RemoteOperation }) => {
        try {
            return {
                bootstrap: await app.runRemoteOperation(ps),
                status: 'completed' as const,
                stashed: false,
            };
        } catch (error) {
            if (ps.operation === 'pull' && git.isPullMergeConflictError(error)) {
                return {
                    bootstrap: await app.getBootstrap(),
                    status: 'conflicted' as const,
                    stashed: false,
                };
            }

            if (ps.operation !== 'pull' || !git.isPullBlockedByLocalChangesError(error)) {
                throw error;
            }

            return {
                bootstrap: await app.getBootstrap(),
                status: 'blocked-by-local-changes' as const,
                stashed: false,
                conflictingFiles: git.getPullBlockedByLocalChangesFiles(error),
            };
        }
    },
    retryPullAfterStash: async (_ctx: Ctx, ps: { repoId: number }) => {
        await app.stashRepo({ repoId: ps.repoId });

        try {
            return {
                bootstrap: await app.runRemoteOperation({ repoId: ps.repoId, operation: 'pull' }),
                status: 'completed' as const,
                stashed: true,
            };
        } catch (error) {
            if (git.isPullMergeConflictError(error)) {
                return {
                    bootstrap: await app.getBootstrap(),
                    status: 'conflicted' as const,
                    stashed: true,
                };
            }

            throw error;
        }
    },
    copyRepoFilePath: async (_ctx: Ctx, ps: { repoId: number; path: string; mode: 'absolute' | 'relative' }) => {
        clipboard.writeText(ps.mode === 'absolute' ? app.resolveRepoFilePath({ repoId: ps.repoId, path: ps.path }) : ps.path);
    },
    revealRepoFileInFinder: async (_ctx: Ctx, ps: { repoId: number; path: string }) => {
        shell.showItemInFolder(app.resolveRepoFilePath({ repoId: ps.repoId, path: ps.path }));
    },
    openRepoFileWithDefaultProgram: async (_ctx: Ctx, ps: { repoId: number; path: string }) => {
        const result = await shell.openPath(app.resolveRepoFilePath({ repoId: ps.repoId, path: ps.path }));

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
