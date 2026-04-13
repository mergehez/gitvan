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
    RepoStashEntry,
} from '../../shared/gitClient.ts';
import { isButtonBusyStateSilenced } from '../lib/loadingIndicatorState.ts';
import { joinNativePath, writeClipboardText } from '../lib/nativePaths.ts';
import { confirmAction } from '../lib/utils.ts';
import { applyMutation } from './initializeStates.ts';
import { useAuth } from './useAuth.ts';
import { useSettings } from './useSettings.ts';
import { tasks } from './useTasks.ts';
import { toast } from './useToast.ts';

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
        async stageFileHunks(path: string, hunkIds: string[]) {
            const nextBootstrap = await tasks.stageFileHunks.run({ repoId: this.id, path, hunkIds }, `${path}:${hunkIds.join(',')}`);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(hunkIds.length === 1 ? 'Change staged.' : `${hunkIds.length} changes staged.`);
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
        async unstageFileHunks(path: string, hunkIds: string[]) {
            const nextBootstrap = await tasks.unstageFileHunks.run({ repoId: this.id, path, hunkIds }, `${path}:${hunkIds.join(',')}`);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(hunkIds.length === 1 ? 'Change unstaged.' : `${hunkIds.length} changes unstaged.`);
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
        async discardFile(path: string) {
            const confirmed = await confirmAction({
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
        async discardFileHunks(path: string, hunkIds: string[]) {
            const confirmed = await confirmAction({
                title: 'Discard selected change',
                message: hunkIds.length === 1 ? `Discard the selected change in '${path}'?` : `Discard ${hunkIds.length} selected changes in '${path}'?`,
                detail: 'This permanently removes the selected uncommitted changes from the file.',
                confirmLabel: 'Discard change',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.discardFileHunks.run({ repoId: this.id, path, hunkIds }, `${path}:${hunkIds.join(',')}`);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(hunkIds.length === 1 ? 'Change discarded.' : `${hunkIds.length} changes discarded.`);
        },
        async discardFiles(paths: string[]) {
            const finalPaths = [...new Set(paths)];
            if (!finalPaths.length) {
                return;
            }

            const confirmed = await confirmAction({
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
            const confirmed = await confirmAction({
                title: 'Discard all changes',
                message: 'Discard all unstaged changes in this repository?',
                detail: 'This permanently removes all current unstaged edits and untracked files.',
                confirmLabel: 'Discard all',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.discardAllChanges.run({ repoId: this.id });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('All changes discarded.');
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
            const nextChanges = await tasks.getChanges.run({ repoId: this.id });

            this.changes = nextChanges;

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

            if (settings.state.activeView === 'history') {
                await this.loadHistory();
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
            const nextHistory = await tasks.getHistory.run({ repoId: this.id });

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
                toast.showSuccessToast('Stash restore stopped with conflicts. The stash was kept.');
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
        editableTagsForCommit(commit: CommitSummary | undefined) {
            if (!commit?.isUnpushed) {
                return [];
            }

            return commit.tags.filter((tag) => tag.isUnpushed);
        },
        async createTag(commitSha: string, tagName: string) {
            const normalizedTagName = tagName.trim();
            if (!normalizedTagName) {
                return;
            }

            const nextBootstrap = await tasks.createTag.run({ repoId: this.id, commitSha, tagName: normalizedTagName }, `${commitSha}:${normalizedTagName}`);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Tag "${normalizedTagName}" created.`);
        },
        async renameTag(tagName: string, nextTagName: string) {
            const normalizedTagName = tagName.trim();
            const normalizedNextTagName = nextTagName.trim();

            if (!normalizedTagName || !normalizedNextTagName || normalizedTagName === normalizedNextTagName) {
                return;
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
                detail: 'This removes the local tag reference from the repository.',
                confirmLabel: 'Delete tag',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.deleteTag.run({ repoId: this.id, tagName: normalizedTagName }, normalizedTagName);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Tag "${normalizedTagName}" deleted.`);
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
            toast.showSuccessToast(`Switched to ${branchName}.`);
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
