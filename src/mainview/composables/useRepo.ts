import { reactive } from 'vue';
import type {
    BranchesData,
    CommitDetail,
    CommitFormState,
    CommitSummary,
    CommittedFileData,
    CommittedTreeData,
    FileChangeEntry,
    FileDiffData,
    FileDiffRequestKind,
    HistoryData,
    IgnoreRepoPathMode,
    Repo,
    RepoChangesData,
    RepoStashDetail,
    TagsData,
    RepoStashEntry,
} from '../../shared/types.ts';
import { isButtonBusyStateSilenced } from '../lib/loadingIndicatorState.ts';
import { joinNativePath, writeClipboardText } from '../lib/nativePaths.ts';
import { confirmAction } from '../lib/utils.ts';
import { applyMutation } from './initializeStates.ts';
import { useAuth } from './useAuth.ts';
import { useSettings } from './useSettings.ts';
import { tasks } from './useTasks.ts';
import { toast } from './useToast.ts';
import { confirmDiscards } from './useUiPreferences.ts';

const LOCKED_FILES_KEY_PREFIX = 'gitvan-locked-files-';

function loadLockedFiles(repoId: number): Set<string> {
    try {
        const raw = localStorage.getItem(`${LOCKED_FILES_KEY_PREFIX}${repoId}`);
        if (raw) {
            return new Set(JSON.parse(raw) as string[]);
        }
    } catch {
        // ignore parse errors
    }
    return new Set<string>();
}

function displayBranchName(branchName: string): string {
    // `checkoutBranch` may receive a remote-tracking ref (refs/remotes/<remote>/<branch>).
    // Strip the remote prefix so the toast reads like a local branch name.
    if (branchName.startsWith('refs/remotes/')) {
        return branchName.slice('refs/remotes/'.length).replace(/^[^/]+\//, '');
    }
    return branchName;
}

function saveLockedFiles(repoId: number, files: Set<string>) {
    try {
        localStorage.setItem(`${LOCKED_FILES_KEY_PREFIX}${repoId}`, JSON.stringify([...files]));
    } catch {
        // ignore storage errors
    }
}

/** Discards only ask for confirmation while the changes view menu toggle is on. */
async function confirmDiscard(params: { title: string; message: string; detail?: string; confirmLabel?: string }) {
    if (!confirmDiscards.value) {
        return true;
    }

    return await confirmAction(params);
}

export type ChangeSelection = {
    path: string;
    kind: FileDiffRequestKind;
};

function fileNameFromPath(path: string) {
    return path.split('/').filter(Boolean).at(-1) ?? path;
}

function suggestedCommitSummaryForChange(change: FileChangeEntry | undefined) {
    if (!change) {
        return '';
    }

    const fileName = fileNameFromPath(change.path);

    switch (change.stagedStatus) {
        case 'added':
        case 'untracked':
        case 'copied':
            return `Add ${fileName}`;
        case 'deleted':
            return `Remove ${fileName}`;
        case 'renamed':
            return `Rename ${fileName}`;
        case 'modified':
        case 'type-changed':
        default:
            return `Update ${fileName}`;
    }
}

const _useRepository = (repo: Repo) => {
    if (!repo.id) {
        throw new Error('Repository must have an id');
    }

    const settings = useSettings();
    const auth = useAuth();

    // Monotonic token so a slow history search cannot overwrite a newer one.
    let historySearchToken = 0;
    let fileHistoryToken = 0;

    const state = reactive({
        ...repo,

        update(nv: Repo) {
            state.id = nv.id;
            state.name = nv.name;
            state.path = nv.path;
            state.sequence = nv.sequence;
            state.groupId = nv.groupId;
            state.groupName = nv.groupName;
            state.accountId = nv.accountId;
            state.accountLabel = nv.accountLabel;
            state.terminalPath = nv.terminalPath;
            state.addedAt = nv.addedAt;
            state.lastOpenedAt = nv.lastOpenedAt;
            state.status = nv.status;
        },

        stashes: [] as RepoStashEntry[],
        currStashRef: undefined as string | undefined,
        currStash: undefined as RepoStashDetail | undefined,
        currStashFilePath: undefined as string | undefined,
        currStashDiff: undefined as FileDiffData | undefined,

        changes: undefined as RepoChangesData | undefined,
        currChangePath: undefined as string | undefined,
        currChangeKind: undefined as FileDiffRequestKind | undefined,
        curDiff: undefined as FileDiffData | undefined,

        history: undefined as HistoryData | undefined,
        isLoadingMoreHistory: false,
        historySearchQuery: '',
        historySearchResults: undefined as HistoryData | undefined,
        isSearchingHistory: false,
        isLoadingMoreHistorySearch: false,
        tags: undefined as TagsData | undefined,
        isLoadingTags: false,
        selectedTagName: undefined as string | undefined,
        fileHistoryPath: undefined as string | undefined,
        fileHistoryFollowRenames: false,
        fileHistoryResults: undefined as HistoryData | undefined,
        isLoadingFileHistory: false,
        isLoadingMoreFileHistory: false,
        isIncludingFileHistoryRenames: false,
        currCommitSha: undefined as string | undefined,
        currCommit: undefined as CommitDetail | undefined,
        currCommitFilePath: undefined as string | undefined,
        currCommitDiff: undefined as FileDiffData | undefined,

        committedTree: undefined as CommittedTreeData | undefined,
        explorerCommitSha: undefined as string | undefined,
        currCommittedFilePath: undefined as string | undefined,
        currCommittedFile: undefined as CommittedFileData | undefined,

        commitForm: { summary: '', description: '', amend: false } as CommitFormState,
        resetCommitForm() {
            this.commitForm.summary = '';
            this.commitForm.description = '';
            this.commitForm.amend = false;
        },

        // Per-file locking to prevent accidental staging (persisted in localStorage)
        lockedFiles: loadLockedFiles(repo.id),
        isFileLocked(path: string) {
            return this.lockedFiles.has(path);
        },
        lockFile(path: string) {
            this.lockedFiles.add(path);
            saveLockedFiles(this.id, this.lockedFiles);
        },
        unlockFile(path: string) {
            this.lockedFiles.delete(path);
            saveLockedFiles(this.id, this.lockedFiles);
        },

        branches: undefined as BranchesData | undefined,
        branchesLastLoadedAt: undefined as string | undefined,

        assignedAccountName() {
            const accId = this.accountId;
            if (!accId) {
                return undefined;
            }

            return auth.accounts.find((account) => account.id === accId)?.label ?? this.accountLabel ?? 'Unassigned';
        },
        get _isBusy() {
            return tasks.isBusy && !isButtonBusyStateSilenced.value;
        },
        suggestedCommitSummary() {
            if (this.commitForm.amend || (this.changes?.staged.length ?? 0) !== 1) {
                return '';
            }

            return suggestedCommitSummaryForChange(this.changes?.staged[0]);
        },
        resolvedCommitSummary() {
            return this.commitForm.summary.trim() || this.suggestedCommitSummary();
        },
        canCommit() {
            return this.resolvedCommitSummary().trim() && !tasks.isOperationRunning('commitRepo') && (this.changes?.staged.length || this.commitForm.amend);
        },
        canFetch() {
            return this.status.hasRemote && !this.status.error && !tasks.isOperationRunning(`runRemoteOperation:fetch-${this.id}`);
        },
        canPull() {
            return this.status.behind > 0 && !this.status.error && !tasks.isOperationRunning(`runRemoteOperation:pull-${this.id}`);
        },
        canPush() {
            return this.status.ahead > 0 && !this.status.error && !tasks.isOperationRunning(`runRemoteOperation:push-${this.id}`);
        },
        async stageFile(path: string) {
            const nextBootstrap = await tasks.stageFile.run({ repoId: this.id, path }, path);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('File staged.');
        },
        async openFileInEditor(path: string) {
            await settings.openRepoPathInEditor({ repoId: this.id, path }, path);
        },
        async stageAllFiles() {
            const nextBootstrap = await tasks.stageAllFiles.run({ repoId: this.id });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('All files staged.');
        },
        async stageFiles(paths: string[]) {
            const finalPaths = [...new Set(paths)];
            if (!finalPaths.length) {
                return;
            }

            const nextBootstrap =
                finalPaths.length === 1
                    ? await tasks.stageFile.run({ repoId: this.id, path: finalPaths[0]! }, finalPaths[0])
                    : await tasks.stageRepoFiles.run({ repoId: this.id, paths: finalPaths });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(finalPaths.length === 1 ? 'File staged.' : `${finalPaths.length} files staged.`);
        },
        async unstageFile(path: string) {
            const nextBootstrap = await tasks.unstageFile.run({ repoId: this.id, path }, path);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('File unstaged.');
        },
        async unstageFiles(paths: string[]) {
            const finalPaths = [...new Set(paths)];
            if (!finalPaths.length) {
                return;
            }

            const nextBootstrap =
                finalPaths.length === 1
                    ? await tasks.unstageFile.run({ repoId: this.id, path: finalPaths[0]! }, finalPaths[0])
                    : await tasks.unstageRepoFiles.run({ repoId: this.id, paths: finalPaths });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(finalPaths.length === 1 ? 'File unstaged.' : `${finalPaths.length} files unstaged.`);
        },
        async applyPatch(patch: string, mode: 'stage' | 'unstage' | 'discard', label: string) {
            const nextBootstrap = await tasks.applyPatch.run({ repoId: this.id, patch, mode }, `${mode}:${label}`);
            await applyMutation(nextBootstrap);
            const verb = mode === 'stage' ? 'staged' : mode === 'unstage' ? 'unstaged' : 'discarded';
            toast.showSuccessToast(`Change ${verb}.`);
        },
        async discardFile(path: string) {
            const confirmed = await confirmDiscard({
                title: 'Discard file changes',
                message: `Discard changes in '${path}'?`,
                detail: 'This permanently removes the current uncommitted changes in that file.',
                confirmLabel: 'Discard',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.discardFile.run({ repoId: this.id, path }, path);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('File discarded.');
        },
        async discardFiles(paths: string[]) {
            const finalPaths = [...new Set(paths)];
            if (!finalPaths.length) {
                return;
            }

            const confirmed = await confirmDiscard({
                title: 'Discard file changes',
                message: finalPaths.length === 1 ? `Discard changes in '${finalPaths[0]}'?` : `Discard changes in ${finalPaths.length} files?`,
                detail: 'This permanently removes the current uncommitted changes in the selected files.',
                confirmLabel: 'Discard',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap =
                finalPaths.length === 1
                    ? await tasks.discardFile.run({ repoId: this.id, path: finalPaths[0]! }, finalPaths[0])
                    : await tasks.discardRepoFiles.run({ repoId: this.id, paths: finalPaths });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(finalPaths.length === 1 ? 'File discarded.' : `${finalPaths.length} files discarded.`);
        },
        async unstageAllFiles() {
            const nextBootstrap = await tasks.unstageAllFiles.run({ repoId: this.id });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('All files unstaged.');
        },
        async discardAllChanges() {
            const lockedPaths = this.changes?.unstaged?.filter((e) => this.isFileLocked(e.path)).map((e) => e.path) ?? [];
            const unlockedPaths = this.changes?.unstaged?.filter((e) => !this.isFileLocked(e.path)).map((e) => e.path) ?? [];

            if (unlockedPaths.length === 0) {
                toast.showSuccessToast('No unlocked changes to discard.');
                return;
            }

            const confirmed = await confirmDiscard({
                title: 'Discard all changes',
                message:
                    lockedPaths.length == 0
                        ? 'Discard all unstaged changes in this repository?'
                        : `Discard unstaged changes? ${lockedPaths.length} locked file${lockedPaths.length === 1 ? '' : 's'} will be skipped.`,
                detail: 'This permanently removes all current unstaged edits and untracked files.',
                confirmLabel: 'Discard all',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.discardRepoFiles.run({ repoId: this.id, paths: unlockedPaths });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(lockedPaths.length == 0 ? 'All changes discarded.' : 'All unlocked changes discarded.');
        },
        async deleteFile(path: string, kind: 'staged' | 'unstaged') {
            const confirmed = await confirmAction({
                title: 'Delete file',
                message: `Delete '${path}'?`,
                detail:
                    kind === 'staged'
                        ? 'This removes the file from both the working tree and the staged changes.'
                        : 'This permanently deletes the uncommitted file from the working tree.',
                confirmLabel: 'Delete file',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap =
                kind === 'staged' ? await tasks.deleteStagedRepoFile.run({ repoId: this.id, path }, path) : await tasks.discardFile.run({ repoId: this.id, path }, path);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('File deleted.');
        },
        async deleteFiles(paths: string[], kind: 'staged' | 'unstaged') {
            const finalPaths = [...new Set(paths)];
            if (!finalPaths.length) {
                return;
            }

            const confirmed = await confirmAction({
                title: 'Delete file',
                message: finalPaths.length === 1 ? `Delete '${finalPaths[0]}'?` : `Delete ${finalPaths.length} files?`,
                detail:
                    kind === 'staged'
                        ? 'This removes the selected files from both the working tree and the staged changes.'
                        : 'This permanently deletes the selected uncommitted files from the working tree.',
                confirmLabel: 'Delete file',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap =
                kind === 'staged'
                    ? finalPaths.length === 1
                        ? await tasks.deleteStagedRepoFile.run({ repoId: this.id, path: finalPaths[0]! }, finalPaths[0])
                        : await tasks.deleteStagedRepoFiles.run({ repoId: this.id, paths: finalPaths })
                    : finalPaths.length === 1
                      ? await tasks.discardFile.run({ repoId: this.id, path: finalPaths[0]! }, finalPaths[0])
                      : await tasks.discardRepoFiles.run({ repoId: this.id, paths: finalPaths });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(finalPaths.length === 1 ? 'File deleted.' : `${finalPaths.length} files deleted.`);
        },
        async revertDeletion(path: string, kind: 'staged' | 'unstaged') {
            const confirmed = await confirmAction({
                title: 'Revert deletion',
                message: `Restore '${path}'?`,
                detail: kind === 'staged' ? 'This restores the file in the working tree and removes the staged deletion.' : 'This restores the deleted file in the working tree.',
                confirmLabel: 'Restore file',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.restoreRepoFile.run({ repoId: this.id, path, kind }, `${kind}:${path}`);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('Deletion reverted.');
        },
        async revertDeletions(paths: string[], kind: 'staged' | 'unstaged') {
            const finalPaths = [...new Set(paths)];
            if (!finalPaths.length) {
                return;
            }

            const confirmed = await confirmAction({
                title: 'Revert deletion',
                message: finalPaths.length === 1 ? `Restore '${finalPaths[0]}'?` : `Restore ${finalPaths.length} files?`,
                detail:
                    kind === 'staged'
                        ? 'This restores the selected files in the working tree and removes the staged deletions.'
                        : 'This restores the selected deleted files in the working tree.',
                confirmLabel: 'Restore file',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap =
                finalPaths.length === 1
                    ? await tasks.restoreRepoFile.run({ repoId: this.id, path: finalPaths[0]!, kind }, `${kind}:${finalPaths[0]}`)
                    : await tasks.restoreRepoFiles.run({ repoId: this.id, paths: finalPaths, kind });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(finalPaths.length === 1 ? 'Deletion reverted.' : `${finalPaths.length} deletions reverted.`);
        },
        async ignorePath(path: string, mode: IgnoreRepoPathMode) {
            const nextBootstrap = await tasks.ignoreRepoPath.run({ repoId: this.id, path, mode }, `${mode}:${path}`);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(mode === 'directory' ? 'Folder added to .gitignore.' : 'Ignore rule added to .gitignore.');
        },
        async copyFilePath(path: string, mode: 'absolute' | 'relative') {
            await writeClipboardText(mode === 'absolute' ? joinNativePath(this.path, path) : path);
            toast.showSuccessToast(mode === 'absolute' ? 'File path copied.' : 'Relative path copied.');
        },
        async revealFileInFinder(path: string) {
            await tasks.revealPathInFileManager.run({ path: joinNativePath(this.path, path), mode: 'reveal-item' }, path);
        },
        async openFileWithDefaultProgram(path: string) {
            await tasks.openPathWithDefaultProgram.run({ path: joinNativePath(this.path, path) }, path);
        },
        clearSelectedRepositoryStash() {
            this.currStashRef = undefined;
            this.currStash = undefined;
            this.currStashFilePath = undefined;
            this.currStashDiff = undefined;
        },

        async loadChanges() {
            const nextChanges = await tasks.getChanges.run({
                repoId: this.id,
                ignoredChars: settings.state.diffIgnoredCharsEnabled ? settings.state.diffIgnoredChars : '',
                showWhitespaceChanges: settings.state.showWhitespaceChanges,
            });

            this.changes = nextChanges;

            // Remove locked files that no longer exist in the repo
            const currentPaths = new Set([...nextChanges.staged.map((e) => e.path), ...nextChanges.unstaged.map((e) => e.path)]);
            let lockedChanged = false;
            for (const lockedPath of this.lockedFiles) {
                if (!currentPaths.has(lockedPath)) {
                    this.lockedFiles.delete(lockedPath);
                    lockedChanged = true;
                }
            }
            if (lockedChanged) {
                saveLockedFiles(this.id, this.lockedFiles);
            }

            const nextSelection = ((): ChangeSelection | undefined => {
                const hasChangeForSelection = (s: ChangeSelection) => nextChanges[s.kind].some((entry) => entry.path === s.path);

                if (this.currChangePath && this.currChangeKind) {
                    const currentSelection: ChangeSelection = {
                        path: this.currChangePath,
                        kind: this.currChangeKind,
                    };
                    if (hasChangeForSelection(currentSelection)) {
                        return currentSelection;
                    }

                    const movedSelection: ChangeSelection = {
                        path: this.currChangePath,
                        kind: this.currChangeKind === 'staged' ? 'unstaged' : 'staged',
                    };
                    if (hasChangeForSelection(movedSelection)) {
                        return movedSelection;
                    }
                }

                const firstUnstaged = nextChanges.unstaged[0];
                const firstStaged = nextChanges.staged[0];

                return firstUnstaged ? { path: firstUnstaged.path, kind: 'unstaged' } : firstStaged ? { path: firstStaged.path, kind: 'staged' } : undefined;
            })();

            if (!nextSelection) {
                this.currChangePath = undefined;
                this.currChangeKind = undefined;
                this.curDiff = undefined;
                return;
            }

            await this.selectChange(nextSelection);
        },
        async loadActiveViewData() {
            await this.loadBranches();
            if (settings.state.activeView === 'changes') {
                await this.loadChanges();
                return;
            }

            if (settings.state.activeView === 'explorer') {
                await this.loadCommittedTree();
                return;
            }

            if (settings.state.activeView === 'tags') {
                await this.loadTags();
                return;
            }

            if (settings.state.activeView === 'history') {
                // A pinned file history owns the commit list, then an active search, and
                // only otherwise the recent-commit page.
                if (this.fileHistoryPath) {
                    if (this.fileHistoryResults) {
                        await this.refreshFileHistory();
                    } else {
                        await this.loadFileHistory();
                    }
                    return;
                }

                if (this.historySearchQuery) {
                    await this.refreshHistorySearch();
                } else {
                    await this.loadHistory();
                }
                return;
            }
        },

        async loadCommittedTree(commitSha?: string, refreshHistory = true) {
            const nextHistory = refreshHistory || !this.history ? await tasks.getHistory.run({ repoId: this.id }) : this.history;

            this.history = nextHistory;
            const nextExplorerCommitSha =
                (commitSha && nextHistory.commits.some((commit) => commit.sha === commitSha) && commitSha) ||
                (this.explorerCommitSha && nextHistory.commits.some((commit) => commit.sha === this.explorerCommitSha) && this.explorerCommitSha) ||
                nextHistory.commits[0]?.sha;

            if (!nextExplorerCommitSha) {
                this.explorerCommitSha = undefined;
                this.committedTree = undefined;
                this.currCommittedFilePath = undefined;
                this.currCommittedFile = undefined;
                return;
            }

            this.explorerCommitSha = nextExplorerCommitSha;
            const nextCommittedTree = await tasks.getCommittedTree.run({ repoId: this.id, commitSha: nextExplorerCommitSha });

            this.committedTree = nextCommittedTree;
            const nextSelectedPath =
                (this.currCommittedFilePath && nextCommittedTree.files.some((file) => file.path === this.currCommittedFilePath) && this.currCommittedFilePath) ||
                nextCommittedTree.files[0]?.path;

            if (!nextSelectedPath) {
                this.currCommittedFilePath = undefined;
                this.currCommittedFile = undefined;
                return;
            }

            await this.selectCommittedFile(nextSelectedPath);
        },
        async selectExplorerCommit(commitSha: string) {
            await this.loadCommittedTree(commitSha, false);
        },

        async loadHistory() {
            // Re-request every commit the user has already scrolled to so refreshes
            // (polling, mutations) do not collapse the list back to the first page.
            const loadedCount = this.history?.commits.length ?? 0;
            const nextHistory = await tasks.getHistory.run({
                repoId: this.id,
                limit: loadedCount || undefined,
            });

            this.history = nextHistory;
            const nextCommitSha =
                (this.currCommitSha && nextHistory.commits.some((commit) => commit.sha === this.currCommitSha) && this.currCommitSha) || nextHistory.commits[0]?.sha || undefined;

            if (!nextCommitSha) {
                this.currCommitSha = undefined;
                this.currCommit = undefined;
                this.currCommitFilePath = undefined;
                this.currCommitDiff = undefined;
                return;
            }

            await this.selectCommit(nextCommitSha);
        },
        async loadMoreHistory() {
            const history = this.history;

            if (!history?.hasMore || this.isLoadingMoreHistory) {
                return false;
            }

            this.isLoadingMoreHistory = true;

            try {
                const nextPage = await tasks.getHistory.run({
                    repoId: this.id,
                    skip: history.commits.length,
                });

                // A refresh (polling or a mutation) replaced the list while this page was loading.
                if (this.history !== history) {
                    return false;
                }

                const knownShas = new Set(history.commits.map((commit) => commit.sha));
                const appendedCommits = nextPage.commits.filter((commit) => !knownShas.has(commit.sha));

                this.history = {
                    commits: [...history.commits, ...appendedCommits],
                    hasMore: nextPage.hasMore,
                };

                return appendedCommits.length > 0;
            } finally {
                this.isLoadingMoreHistory = false;
            }
        },
        async searchHistory(query: string) {
            const normalizedQuery = query.trim();
            const token = ++historySearchToken;
            this.historySearchQuery = normalizedQuery;

            if (!normalizedQuery) {
                this.historySearchResults = undefined;
                this.isSearchingHistory = false;
                this.isLoadingMoreHistorySearch = false;
                return;
            }

            this.isSearchingHistory = true;

            try {
                const nextResults = await tasks.getHistory.run({ repoId: this.id, search: normalizedQuery });

                if (token !== historySearchToken) {
                    return;
                }

                this.historySearchResults = nextResults;
            } finally {
                if (token === historySearchToken) {
                    this.isSearchingHistory = false;
                }
            }
        },
        async refreshHistorySearch() {
            const query = this.historySearchQuery;

            if (!query) {
                return;
            }

            const token = ++historySearchToken;
            // Re-request the pages already loaded so background refreshes do not collapse
            // the visible result list back to its first page.
            const loadedCount = this.historySearchResults?.commits.length ?? 0;

            try {
                const nextResults = await tasks.getHistory.run({
                    repoId: this.id,
                    search: query,
                    limit: loadedCount || undefined,
                });

                if (token !== historySearchToken) {
                    return;
                }

                this.historySearchResults = nextResults;
            } finally {
                // A refresh supersedes any query still in flight, so it owns the pending flag.
                if (token === historySearchToken) {
                    this.isSearchingHistory = false;
                }
            }
        },
        async loadMoreHistorySearch() {
            const results = this.historySearchResults;
            const query = this.historySearchQuery;

            if (!results?.hasMore || !query || this.isLoadingMoreHistorySearch || this.isSearchingHistory) {
                return false;
            }

            this.isLoadingMoreHistorySearch = true;

            try {
                const nextPage = await tasks.getHistory.run({
                    repoId: this.id,
                    search: query,
                    skip: results.commits.length,
                });

                // A new search (or a refresh) replaced the results while this page was loading.
                if (this.historySearchResults !== results) {
                    return false;
                }

                const knownShas = new Set(results.commits.map((commit) => commit.sha));
                const appendedCommits = nextPage.commits.filter((commit) => !knownShas.has(commit.sha));

                this.historySearchResults = {
                    commits: [...results.commits, ...appendedCommits],
                    hasMore: nextPage.hasMore,
                };

                return appendedCommits.length > 0;
            } finally {
                this.isLoadingMoreHistorySearch = false;
            }
        },
        clearHistorySearch() {
            historySearchToken += 1;
            this.historySearchQuery = '';
            this.historySearchResults = undefined;
            this.isSearchingHistory = false;
            this.isLoadingMoreHistorySearch = false;
        },
        beginFileHistory(path: string) {
            fileHistoryToken += 1;
            this.fileHistoryPath = path;
            this.fileHistoryFollowRenames = false;
            this.fileHistoryResults = undefined;
            this.isLoadingFileHistory = false;
            this.isLoadingMoreFileHistory = false;
            this.isIncludingFileHistoryRenames = false;
        },
        async includeFileHistoryRenames() {
            if (!this.fileHistoryPath || this.fileHistoryFollowRenames) {
                return;
            }

            // The followed list can contain commits the plain path history did not, so
            // start again from the newest page instead of appending to the old rows.
            this.fileHistoryFollowRenames = true;
            this.isIncludingFileHistoryRenames = true;

            try {
                await this.loadFileHistory();
            } finally {
                this.isIncludingFileHistoryRenames = false;
            }
        },
        closeFileHistory() {
            fileHistoryToken += 1;
            this.fileHistoryPath = undefined;
            this.fileHistoryFollowRenames = false;
            this.fileHistoryResults = undefined;
            this.isLoadingFileHistory = false;
            this.isLoadingMoreFileHistory = false;
            this.isIncludingFileHistoryRenames = false;
        },
        async loadFileHistory() {
            const path = this.fileHistoryPath;

            if (!path) {
                return;
            }

            const token = ++fileHistoryToken;
            this.isLoadingFileHistory = true;

            try {
                const nextResults = await tasks.getHistory.run({
                    repoId: this.id,
                    path,
                    followRenames: this.fileHistoryFollowRenames || undefined,
                });

                if (token !== fileHistoryToken) {
                    return;
                }

                this.fileHistoryResults = nextResults;
                await this.selectFileHistoryCommit(nextResults.commits[0]?.sha);
            } finally {
                if (token === fileHistoryToken) {
                    this.isLoadingFileHistory = false;
                }
            }
        },
        async refreshFileHistory() {
            const path = this.fileHistoryPath;

            if (!path) {
                return;
            }

            const token = ++fileHistoryToken;
            // Re-request the pages already loaded so background refreshes do not collapse
            // the visible list back to its first page.
            const loadedCount = this.fileHistoryResults?.commits.length ?? 0;

            try {
                const nextResults = await tasks.getHistory.run({
                    repoId: this.id,
                    path,
                    followRenames: this.fileHistoryFollowRenames || undefined,
                    limit: loadedCount || undefined,
                });

                if (token !== fileHistoryToken) {
                    return;
                }

                this.fileHistoryResults = nextResults;
            } finally {
                // A refresh supersedes a load still in flight, so it owns the pending flag.
                if (token === fileHistoryToken) {
                    this.isLoadingFileHistory = false;
                }
            }
        },
        async loadMoreFileHistory() {
            const results = this.fileHistoryResults;
            const path = this.fileHistoryPath;

            if (!results?.hasMore || !path || this.isLoadingMoreFileHistory || this.isLoadingFileHistory) {
                return false;
            }

            this.isLoadingMoreFileHistory = true;

            try {
                const nextPage = await tasks.getHistory.run({
                    repoId: this.id,
                    path,
                    followRenames: this.fileHistoryFollowRenames || undefined,
                    skip: results.commits.length,
                });

                // A refresh (or a new file history) replaced the list while this page was loading.
                if (this.fileHistoryResults !== results) {
                    return false;
                }

                const knownShas = new Set(results.commits.map((commit) => commit.sha));
                const appendedCommits = nextPage.commits.filter((commit) => !knownShas.has(commit.sha));

                this.fileHistoryResults = {
                    commits: [...results.commits, ...appendedCommits],
                    hasMore: nextPage.hasMore,
                };

                return appendedCommits.length > 0;
            } finally {
                this.isLoadingMoreFileHistory = false;
            }
        },
        async selectFileHistoryCommit(commitSha: string | undefined) {
            if (!commitSha) {
                return;
            }

            const path = this.fileHistoryPath;
            await this.selectCommit(commitSha);

            if (!path || !this.currCommit) {
                return;
            }

            // With `--follow` older rows can carry the file under its previous path, so
            // match on the rename pair and fall back to the same file name.
            const matchedFile =
                this.currCommit.files.find((file) => file.path === path) ??
                this.currCommit.files.find((file) => file.previousPath === path) ??
                this.currCommit.files.find((file) => file.path.split('/').pop() === path.split('/').pop());

            if (matchedFile && matchedFile.path !== this.currCommitFilePath) {
                await this.selectCommitFile(matchedFile.path);
            }
        },
        async selectCommit(commitSha: string) {
            this.currCommitSha = commitSha;
            this.currCommit = await tasks.getCommitDetail.run({
                repoId: this.id,
                commitSha,
            });

            const nextSelectedFile =
                this.currCommitFilePath && this.currCommit.files.some((file) => file.path === this.currCommitFilePath) ? this.currCommitFilePath : this.currCommit.files[0]?.path;

            if (!nextSelectedFile) {
                this.currCommitFilePath = undefined;
                this.currCommitDiff = undefined;
                return;
            }

            await this.selectCommitFile(nextSelectedFile);
        },
        async selectCommitFile(path: string) {
            if (!this.currCommitSha || !this.currCommit) {
                return;
            }

            const selectedFile = this.currCommit.files.find((file) => file.path === path);
            if (!selectedFile) {
                this.currCommitFilePath = undefined;
                this.currCommitDiff = undefined;
                return;
            }

            this.currCommitFilePath = path;
            this.currCommitDiff = await tasks.getCommitFileDiff.run({
                repoId: this.id,
                commitSha: this.currCommitSha!,
                path,
                previousPath: selectedFile.previousPath,
            });
        },
        async selectCommittedFile(path: string) {
            if (!this.committedTree?.files.some((file) => file.path === path)) {
                this.currCommittedFilePath = undefined;
                this.currCommittedFile = undefined;
                return;
            }

            this.currCommittedFilePath = path;
            this.currCommittedFile = await tasks.getCommittedFile.run({
                repoId: this.id,
                path,
                commitSha: this.explorerCommitSha,
            });
        },
        clearViewState() {
            this.changes = undefined;
            this.currChangePath = undefined;
            this.currChangeKind = undefined;
            this.curDiff = undefined;
            this.committedTree = undefined;
            this.explorerCommitSha = undefined;
            this.currCommittedFilePath = undefined;
            this.currCommittedFile = undefined;
            this.closeFileHistory();
            this.clearHistorySearch();
            this.tags = undefined;
            this.selectedTagName = undefined;
            this.isLoadingTags = false;
            this.history = undefined;
            this.currCommitSha = undefined;
            this.currCommit = undefined;
            this.currCommitFilePath = undefined;
            this.currCommitDiff = undefined;
            this.branches = undefined;
            this.branchesLastLoadedAt = undefined;
        },
        async loadBranches() {
            if (this.branches && this.status.lastScannedAt && this.branchesLastLoadedAt === this.status.lastScannedAt) {
                return;
            }

            this.branches = await tasks.getBranches.run({ repoId: this.id });
            this.branchesLastLoadedAt = this.status.lastScannedAt;
        },
        async selectChange(selection: ChangeSelection) {
            this.currChangePath = selection.path;
            this.currChangeKind = selection.kind;
            this.curDiff = await tasks.getFileDiff.run({
                repoId: this.id,
                path: selection.path,
                kind: selection.kind,
            });
        },
        async selectRepositoryStash(stashRef: string, preserveSelectedFile = false) {
            this.currStashRef = stashRef;
            this.currStash = await tasks.getStashDetail.run({
                repoId: this.id,
                stashRef,
            });

            const currentStash = this.currStash;

            const nextPath =
                preserveSelectedFile && this.currStashFilePath ? currentStash?.files.find((file) => file.path === this.currStashFilePath)?.path : currentStash?.files[0]?.path;

            if (!nextPath) {
                this.currStashFilePath = undefined;
                this.currStashDiff = undefined;
                return;
            }

            this.selectRepositoryStashFile(nextPath);
        },
        async selectRepositoryStashFile(path: string) {
            if (!this.currStashRef || !this.currStash) {
                return;
            }

            const selectedFile = this.currStash.files.find((file) => file.path === path);
            if (!selectedFile) {
                this.currStashFilePath = undefined;
                this.currStashDiff = undefined;
                return;
            }

            this.currStashFilePath = path;
            this.currStashDiff = await tasks.getStashFileDiff.run({
                repoId: this.id,
                stashRef: this.currStashRef!,
                path,
                previousPath: selectedFile.previousPath,
            });
        },
        async restoreRepositoryStash(stashRef: string) {
            const nextResult = await tasks.restoreStash.run({ repoId: this.id, stashRef }, stashRef);

            await applyMutation(nextResult.bootstrap);

            if (nextResult.status === 'conflicted') {
                const conflictingFileCount = nextResult.conflictingFiles.length;

                toast.showErrorToast(
                    conflictingFileCount > 0
                        ? `Stash restored with conflicts in ${conflictingFileCount} file${conflictingFileCount === 1 ? '' : 's'}. Resolve them in Changes; the stash entry was kept.`
                        : 'Stash restored with conflicts. Resolve them in Changes; the stash entry was kept.'
                );
                return;
            }

            toast.showSuccessToast('Stash restored.');
        },
        async discardRepositoryStash(stashRef: string) {
            const stashMessage = this.stashes.find((stash) => stash.ref === stashRef)?.message ?? stashRef;
            const confirmed = await confirmAction({
                title: 'Discard stash',
                message: `Discard stash ${stashRef}?`,
                detail: `This permanently deletes the stashed changes${stashMessage ? `: ${stashMessage}` : ''}.`,
                confirmLabel: 'Discard stash',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.discardStash.run({ repoId: this.id, stashRef }, stashRef);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('Stash discarded.');
        },
        async commitRepository() {
            const isAmending = this.commitForm.amend;
            const nextBootstrap = await tasks.commitRepo.run({
                repoId: this.id,
                summary: this.resolvedCommitSummary(),
                description: this.commitForm.description,
                amend: isAmending,
            });

            this.resetCommitForm();
            await applyMutation(nextBootstrap);
            toast.showSuccessToast(isAmending ? 'Commit amended.' : 'Commit created.');
        },
        async beginAmendSelectedCommit() {
            if (!this.history?.commits.length) {
                await this.loadHistory();
            }

            const latestCommit = this.history?.commits[0];
            if (!latestCommit?.isUnpushed) {
                return;
            }

            if (this.currCommitSha !== latestCommit.sha) {
                await this.selectCommit(latestCommit.sha);
            }

            if (!this.currCommit || this.currCommit.sha !== latestCommit.sha) {
                return;
            }

            this.commitForm.summary = this.currCommit.summary;
            this.commitForm.description = this.currCommit.body;
            this.commitForm.amend = true;
            await settings.setActiveView('changes');
            toast.showSuccessToast('Amend mode enabled.');
        },
        cancelAmendCommit() {
            this.commitForm.amend = false;
            this.commitForm.summary = '';
            this.commitForm.description = '';
        },
        async getCommitMessage(commitSha: string) {
            return await tasks.getCommitMessage.run({ repoId: this.id, commitSha });
        },
        /** Rewrites an unpushed commit's message and replays its descendants. */
        async rewordCommit(params: { commitSha: string; summary: string; description: string }) {
            const nextBootstrap = await tasks.rewordCommit.run({ repoId: this.id, ...params });

            // The rewrite replaces the commit an amend form may still be holding on to.
            this.resetCommitForm();
            await applyMutation(nextBootstrap);
        },
        async undoSelectedCommit() {
            const canRewriteSelectedCommit = Boolean(this.currCommit && this.currCommit.sha === this.history?.commits[0]?.sha && this.currCommit.isUnpushed);

            if (!canRewriteSelectedCommit || (this.history?.commits.length ?? 0) < 2) {
                return;
            }

            const confirmed = await confirmAction({
                title: 'Undo latest commit',
                message: 'Undo the latest commit and keep its changes staged?',
                detail: 'This rewrites local history for the current branch.',
                confirmLabel: 'Undo commit',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.undoLastCommit.run({ repoId: this.id });

            this.resetCommitForm();
            await applyMutation(nextBootstrap);
            toast.showSuccessToast('Last commit undone. Changes are staged.');
        },
        latestUnpushedCommit() {
            const latestCommit = this.history?.commits[0];
            return latestCommit?.isUnpushed ? latestCommit : undefined;
        },
        selectedTag() {
            return this.tags?.tags.find((tag) => tag.name === this.selectedTagName);
        },
        async loadTags() {
            this.isLoadingTags = true;

            try {
                const nextTags = await tasks.getTags.run({ repoId: this.id });
                this.tags = nextTags;

                const nextSelectedTagName =
                    (this.selectedTagName && nextTags.tags.some((tag) => tag.name === this.selectedTagName) && this.selectedTagName) || nextTags.tags[0]?.name;

                if (!nextSelectedTagName) {
                    // Nothing to inspect, so do not leave another view's commit in the pane.
                    this.selectedTagName = undefined;
                    this.currCommitSha = undefined;
                    this.currCommit = undefined;
                    this.currCommitFilePath = undefined;
                    this.currCommitDiff = undefined;
                    return;
                }

                await this.selectTag(nextSelectedTagName);
            } finally {
                this.isLoadingTags = false;
            }
        },
        async selectTag(tagName: string) {
            this.selectedTagName = tagName;

            const tag = this.tags?.tags.find((candidate) => candidate.name === tagName);
            if (!tag) {
                return;
            }

            await this.selectCommit(tag.commitSha);
        },
        /** Every local tag can be managed, whether or not its commit has been pushed. */
        editableTagsForCommit(commit: CommitSummary | undefined) {
            return commit?.tags ?? [];
        },
        async createTag(commitSha: string, tagName: string, message?: string) {
            const normalizedTagName = tagName.trim();
            const normalizedMessage = message?.trim() || undefined;

            if (!normalizedTagName) {
                return;
            }

            if (settings.state.activeView === 'tags') {
                // The reload that follows the mutation keeps this tag selected.
                this.selectedTagName = normalizedTagName;
            }

            const nextBootstrap = await tasks.createTag.run(
                { repoId: this.id, commitSha, tagName: normalizedTagName, message: normalizedMessage },
                `${commitSha}:${normalizedTagName}`
            );

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(normalizedMessage ? `Annotated tag "${normalizedTagName}" created.` : `Tag "${normalizedTagName}" created.`);
        },
        async renameTag(tagName: string, nextTagName: string) {
            const normalizedTagName = tagName.trim();
            const normalizedNextTagName = nextTagName.trim();

            if (!normalizedTagName || !normalizedNextTagName || normalizedTagName === normalizedNextTagName) {
                return;
            }

            if (settings.state.activeView === 'tags' && this.selectedTagName === normalizedTagName) {
                this.selectedTagName = normalizedNextTagName;
            }

            const nextBootstrap = await tasks.renameTag.run(
                { repoId: this.id, tagName: normalizedTagName, nextTagName: normalizedNextTagName },
                `${normalizedTagName}:${normalizedNextTagName}`
            );

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Tag "${normalizedTagName}" renamed to "${normalizedNextTagName}".`);
        },
        async deleteTag(tagName: string) {
            const normalizedTagName = tagName.trim();
            if (!normalizedTagName) {
                return;
            }

            const confirmed = await confirmAction({
                title: 'Delete tag',
                message: `Delete tag '${normalizedTagName}'?`,
                detail: 'This removes the local tag reference from the repository. A tag already pushed to the remote is not affected.',
                confirmLabel: 'Delete tag',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.deleteTag.run({ repoId: this.id, tagName: normalizedTagName }, normalizedTagName);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Tag "${normalizedTagName}" deleted.`);
        },
        async pushTag(tagName: string) {
            const normalizedTagName = tagName.trim();
            if (!normalizedTagName) {
                return;
            }

            const nextBootstrap = await tasks.pushTag.run({ repoId: this.id, tagName: normalizedTagName }, normalizedTagName);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Tag "${normalizedTagName}" pushed.`);
        },
        async pushAllTags() {
            const nextBootstrap = await tasks.pushAllTags.run({ repoId: this.id });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('Tags pushed.');
        },
        async deleteRemoteTag(tagName: string) {
            const normalizedTagName = tagName.trim();
            if (!normalizedTagName) {
                return;
            }

            const confirmed = await confirmAction({
                title: 'Delete remote tag',
                message: `Delete tag '${normalizedTagName}' on the remote?`,
                detail: 'This removes the tag from the remote repository. The local tag is kept.',
                confirmLabel: 'Delete remote tag',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.deleteRemoteTag.run({ repoId: this.id, tagName: normalizedTagName }, normalizedTagName);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Tag "${normalizedTagName}" deleted on the remote.`);
        },
        async createBranch(branchName: string) {
            branchName = branchName.trim();
            const nextBootstrap = await tasks.createBranch.run({ repoId: this.id, branchName }, branchName);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(branchName ? `Branch "${branchName}" created.` : 'Branch created.');
        },
        async createRemoteBranch(branchName: string) {
            branchName = branchName.trim();
            const nextBootstrap = await tasks.createRemoteBranch.run({ repoId: this.id, branchName }, branchName);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(branchName ? `Remote branch "${branchName}" created.` : 'Remote branch created.');
        },
        async checkoutBranch(branchName: string) {
            const nextBootstrap = await tasks.checkoutBranch.run({ repoId: this.id, branchName }, branchName);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Switched to ${displayBranchName(branchName)}.`);
        },

        async loadRepositoryStashes() {
            this.stashes = await tasks.getStashes.run({ repoId: this.id });

            if (!this.currStashRef) {
                return;
            }

            if (!this.stashes.some((stash) => stash.ref === this.currStashRef)) {
                this.clearSelectedRepositoryStash();
                return;
            }

            await this.selectRepositoryStash(this.currStashRef, true);
        },
    });

    return state;
};

export type RepositoryState = ReturnType<typeof _useRepository>;

const instances = reactive({} as Record<number, RepositoryState>);

export function useRepo(repo: Repo) {
    const repoId = repo.id;
    if (repoId === undefined) {
        return _useRepository(repo);
    }

    if (!instances[repoId]) {
        instances[repoId] = _useRepository(repo);
    }

    return instances[repoId];
}
