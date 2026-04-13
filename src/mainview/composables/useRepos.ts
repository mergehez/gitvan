import { reactive, watch } from 'vue';
import type { CloneRepoDefaults, RemoteOperation, Repo } from '../../shared/gitClient.ts';
import type { ContextMenuEntry } from '../components/contextMenuTypes';
import { buildOpenWithEntries } from '../lib/buildOpenWithEntries.ts';
import { gitClientRpc } from '../lib/gitClient.ts';
import { isButtonBusyStateSilenced, runWithButtonBusyStateSilenced } from '../lib/loadingIndicatorState.ts';
import { writeClipboardText } from '../lib/nativePaths.ts';
import { confirmAction } from '../lib/utils.ts';
import { _coreState } from './coreState.ts';
import { applyMutation } from './initializeStates.ts';
import { useContextMenu } from './useContextMenu.ts';
import { useRepo } from './useRepo.ts';
import { useSettings } from './useSettings.ts';
import { tasks } from './useTasks.ts';
import { toast } from './useToast.ts';

type RemoteOperationResult = Awaited<ReturnType<typeof tasks.runRemoteOperation.run>>;
type RetryPullAfterStashResult = Awaited<ReturnType<typeof tasks.retryPullAfterStash.run>>;

export function _useRepositories() {
    const settings = useSettings();
    const contextMenu = useContextMenu();

    watch(
        [() => _coreState.stateCounter],
        () => {
            state.repos = _coreState.repos.map((repo) => useRepo(repo));
            state.repos.forEach((repo) => {
                repo.update(_coreState.repos.find((r) => r.id === repo.id) ?? repo);
            });
        },
        { deep: true }
    );
    const state = reactive({
        repos: _coreState.repos.map((repo) => useRepo(repo)),
        get repoGroups() {
            return _coreState.repoGroups;
        },
        get selectedRepoId() {
            return _coreState.selectedRepoId;
        },
        getSelectedRepo() {
            return this.repos.find((repo) => repo.id === this.selectedRepoId);
        },
        isCreateRepoModalOpen: false,
        isCloneRepoModalOpen: false,
        integratedTerminalRepoId: undefined as number | undefined,
        integratedTerminalRepoName: undefined as string | undefined,
        isPullBlockedByLocalChangesModalOpen: false,
        pullBlockedRepoId: undefined as number | undefined,
        pullBlockedConflictingFiles: [] as string[],

        canFetch: (repo: Repo | undefined, forIcon = false) =>
            Boolean(repo?.status.hasRemote && !repo.status.error && (forIcon || !tasks.isBusy || isButtonBusyStateSilenced.value)),
        canPull: (repo: Repo | undefined, forIcon = false) =>
            Boolean(repo && repo.status.behind > 0 && !repo.status.error && (forIcon || !tasks.isBusy || isButtonBusyStateSilenced.value)),
        canPush: (repo: Repo | undefined, forIcon = false) =>
            Boolean(repo && repo.status.ahead > 0 && !repo.status.error && (forIcon || !tasks.isBusy || isButtonBusyStateSilenced.value)),
        async refreshRepositories() {
            await runWithButtonBusyStateSilenced(async () => {
                const nextBootstrap = await tasks.refreshRepos.run(undefined);

                await applyMutation(nextBootstrap);
                toast.showSuccessToast('Repositories refreshed.');
            });
        },
        async getCloneRepoDefaults(): Promise<CloneRepoDefaults> {
            return await gitClientRpc.request.getCloneRepoDefaults(undefined);
        },
        async pickCloneRepoDirectory() {
            return await gitClientRpc.request.pickCloneRepoDirectory(undefined);
        },
        async cloneTrackedRepo(params: { accountId: number | undefined; cloneUrl: string; parentDirectory: string; repoName?: string | undefined; groupId?: number | undefined }) {
            const nextBootstrap = await tasks.cloneTrackedRepo.run(params);

            await applyMutation(nextBootstrap);
            this.isCloneRepoModalOpen = false;
            toast.showSuccessToast('Repository cloned.');
        },
        async createTrackedLocalRepo(params: { name: string; parentDirectory: string; groupId?: number | undefined }) {
            const nextBootstrap = await tasks.createTrackedLocalRepo.run(params);

            await applyMutation(nextBootstrap);
            this.isCreateRepoModalOpen = false;
            toast.showSuccessToast('Repository created.');
        },
        async resetSandboxRepos() {
            const confirmed = await confirmAction({
                title: 'Reset sandboxes',
                message: 'Reset both sandbox repositories?',
                detail: 'This recreates the sandbox repositories from scratch and discards any changes inside them.',
                confirmLabel: 'Reset sandboxes',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.resetSandboxRepos.run(undefined);

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('Sandboxes reset and re-added.');
        },
        async pickRepo(targetGroupId?: number) {
            const nextBootstrap = await tasks.pickRepo.run({ targetGroupId });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('Repository added.');
        },
        async selectRepo(repoId: number) {
            await runWithButtonBusyStateSilenced(async () => {
                const nextBootstrap = await tasks.selectRepo.run({ repoId });

                this.getSelectedRepo()?.clearViewState();
                await applyMutation(nextBootstrap);
            });
        },
        async removeRepo(repoId: number) {
            const repo = this.repos.find((t) => t.id === repoId);
            if (!repo) return;

            const confirmed = await confirmAction({
                title: 'Remove repository',
                message: `Remove ${repo?.name ?? 'this repository'} from Gitvan?`,
                detail: 'This only removes it from Gitvan. The repository files on disk are not deleted.',
                confirmLabel: 'Remove',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.removeRepo.run({ repoId });

            this.getSelectedRepo()?.clearViewState();
            repo.stashes = [];
            await applyMutation(nextBootstrap);
            toast.showSuccessToast('Repository removed.');
        },
        async createRepoGroup(name: string) {
            const normalizedName = name.trim();
            const nextBootstrap = await tasks.createRepoGroup.run({ name: normalizedName });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Group ${normalizedName} created.`);
            return nextBootstrap.groups.find((group) => group.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0);
        },
        async deleteRepoGroup(groupId: number) {
            const group = this.repoGroups.find((entry) => entry.id === groupId);
            const confirmed = await confirmAction({
                title: 'Delete repository group',
                message: `Are you sure you want to delete the group "${group?.name ?? 'this group'}"?`,
                detail: 'This action cannot be undone.',
                confirmLabel: 'Delete',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.deleteTrackedRepoGroup.run({ groupId });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Group "${group?.name ?? 'Unnamed'}" deleted.`);
        },
        async renameRepoGroup(groupId: number, name: string) {
            const normalizedName = name.trim();
            const nextBootstrap = await tasks.renameRepoGroup.run({
                groupId,
                name: normalizedName,
            });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Group renamed to ${normalizedName}.`);
            return nextBootstrap.groups.find((group) => group.id === groupId);
        },
        openPullBlockedByLocalChangesModal(repoId: number, conflictingFiles: string[]) {
            this.pullBlockedRepoId = repoId;
            this.pullBlockedConflictingFiles = conflictingFiles;
            this.isPullBlockedByLocalChangesModalOpen = true;
        },
        closePullBlockedByLocalChangesModal() {
            this.isPullBlockedByLocalChangesModalOpen = false;
            this.pullBlockedRepoId = undefined;
            this.pullBlockedConflictingFiles = [];
        },
        async handleRemoteOperationResult(repoId: number, operation: RemoteOperation, nextResult: RemoteOperationResult | RetryPullAfterStashResult) {
            await applyMutation(nextResult.bootstrap);

            if (operation === 'pull' && nextResult.status === 'blocked-by-local-changes') {
                this.openPullBlockedByLocalChangesModal(repoId, nextResult.conflictingFiles);
                return;
            }

            this.closePullBlockedByLocalChangesModal();

            if (operation === 'pull' && nextResult.status === 'conflicted') {
                toast.showSuccessToast(nextResult.stashed ? 'Changes stashed. Pull stopped with merge conflicts.' : 'Pull stopped with merge conflicts.');
                return;
            }

            toast.showSuccessToast(
                operation === 'pull' && nextResult.stashed
                    ? 'Changes stashed. Pull completed.'
                    : {
                          fetch: 'Fetch completed.',
                          pull: 'Pull completed.',
                          push: 'Push completed.',
                      }[operation]
            );
        },
        async renameRepo(repoId: number, name: string) {
            const normalizedName = name.trim();
            const nextBootstrap = await tasks.renameRepo.run({
                repoId,
                name: normalizedName,
            });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(`Repository renamed to ${normalizedName}.`);
            return nextBootstrap.repos.find((repo) => repo.id === repoId);
        },
        async moveRepo(repoId: number, direction: 'up' | 'down') {
            const nextBootstrap = await tasks.moveRepo.run({ repoId, direction });

            await applyMutation(nextBootstrap);
        },
        async reorderRepo(repoId: number, toIndex: number) {
            const nextBootstrap = await tasks.reorderRepo.run({ repoId, toIndex });

            await applyMutation(nextBootstrap);
        },
        async moveRepoGroup(groupId: number, direction: 'up' | 'down') {
            const nextBootstrap = await tasks.moveRepoGroup.run({ groupId, direction });

            await applyMutation(nextBootstrap);
        },
        async updateRepoGroup(repoId: number, groupId: number | undefined) {
            const nextBootstrap = await tasks.updateRepoGroup.run({ repoId, groupId });

            await applyMutation(nextBootstrap);
            const nextGroup = groupId === undefined ? undefined : nextBootstrap.groups.find((group) => group.id === groupId);
            toast.showSuccessToast(nextGroup ? `Moved to ${nextGroup.name}.` : 'Repository removed from its group.');
        },
        async updateRepoGroups(updates: Array<{ repoId: number; groupId: number | undefined }>, successMessage = 'Repository groups updated.') {
            if (updates.length === 0) {
                return;
            }

            const nextBootstrap = await tasks.updateRepoGroups.run({ updates });

            await applyMutation(nextBootstrap);
            toast.showSuccessToast(successMessage);
        },
        async copyRepoPath(repoId: number) {
            const repo = this.repos.find((entry) => entry.id === repoId);
            if (!repo) {
                return;
            }

            await writeClipboardText(repo.path);
            toast.showSuccessToast('Repository path copied.');
        },
        async revealRepoInFinder(repoId: number) {
            const repo = this.repos.find((entry) => entry.id === repoId);
            if (!repo) {
                return;
            }

            await tasks.revealPathInFileManager.run({ path: repo.path, mode: 'open-directory' }, String(repoId));
        },
        async openRepoInTerminal(repoId: number) {
            const repo = this.repos.find((entry) => entry.id === repoId);
            if (!repo) {
                return;
            }

            await tasks.openDirectoryInTerminal.run({ directoryPath: repo.path }, String(repoId));
        },
        async assignRepoTerminal(repoId: number, terminalPath: string | undefined) {
            const nextBootstrap = await tasks.assignRepoTerminal.run({ repoId, terminalPath });
            await applyMutation(nextBootstrap);
        },
        openRepoInIntegratedTerminal(repoId: number) {
            const repo = this.repos.find((entry) => entry.id === repoId);
            if (!repo) {
                return;
            }

            this.integratedTerminalRepoId = repo.id;
            this.integratedTerminalRepoName = repo.name;
        },
        closeIntegratedTerminal() {
            this.integratedTerminalRepoId = undefined;
            this.integratedTerminalRepoName = undefined;
        },
        async runRepoRemoteOperation(repoId: number, operation: RemoteOperation) {
            const nextResult = await tasks.runRemoteOperation.run({ repoId, operation }, operation + '-' + String(repoId));
            await this.handleRemoteOperationResult(repoId, operation, nextResult);
        },
        async retryPullAfterStash() {
            if (this.pullBlockedRepoId === undefined) {
                return;
            }

            const repoId = this.pullBlockedRepoId;
            const nextResult = await tasks.retryPullAfterStash.run({ repoId }, String(repoId));
            await this.handleRemoteOperationResult(repoId, 'pull', nextResult);
        },
        async publishRepoBranch(repoId: number) {
            const nextBootstrap = await tasks.publishBranch.run({ repoId }, String(repoId));

            await applyMutation(nextBootstrap);
            toast.showSuccessToast('Branch published.');
        },
        async openRepoContextMenu(repoId: number, onRename?: (repo: Repo) => void, event?: MouseEvent) {
            const repo = this.repos.find((r) => r.id === repoId);
            if (!repo) {
                return;
            }

            const openWithEditors = settings.getOpenWithEditors();

            const items: ContextMenuEntry[] = [
                {
                    id: `repo-fetch:${repo.id}`,
                    label: 'Fetch',
                    disabled: !this.canFetch(repo),
                    action: async () => {
                        await this.runRepoRemoteOperation(repo.id, 'fetch');
                    },
                },
                {
                    id: `repo-pull:${repo.id}`,
                    label: 'Pull',
                    disabled: !this.canPull(repo),
                    action: async () => {
                        await this.runRepoRemoteOperation(repo.id, 'pull');
                    },
                },
                {
                    id: `repo-push:${repo.id}`,
                    label: 'Push',
                    disabled: !this.canPush(repo),
                    action: async () => {
                        await this.runRepoRemoteOperation(repo.id, 'push');
                    },
                },
                ...(!repo.status.error && !repo.status.hasUpstream && repo.status.publishableCommits > 0
                    ? [
                          {
                              id: `repo-publish:${repo.id}`,
                              label: repo.status.hasRemote ? 'Publish Branch' : 'Publish Branch (No Remote Configured)',
                              disabled: !repo.status.hasRemote,
                              action: async () => {
                                  await this.publishRepoBranch(repo.id);
                              },
                          } satisfies ContextMenuEntry,
                      ]
                    : []),
                { type: 'separator' as const, id: `repo-separator-open:${repo.id}` },
                {
                    id: `repo-open-with:${repo.id}`,
                    label: 'Open with...',
                    children: buildOpenWithEntries({
                        keyPrefix: `repo-open-with:${repo.id}`,
                        editors: openWithEditors,
                        onOpenWithEditor: async (editorPath) => {
                            await settings.openRepoPathInEditor({ repoId: repo.id, path: '', editorPath }, `repo:${repo.id}:editor:${editorPath}`);
                        },
                        onPickProgram: async () => {
                            await settings.openRepoPathInEditor({ repoId: repo.id, path: '', mode: 'pick' }, `repo:${repo.id}:pick-editor`);
                        },
                    }),
                },
                { type: 'separator' as const, id: `repo-separator-edit:${repo.id}` },
                {
                    id: `repo-rename:${repo.id}`,
                    label: 'Rename',
                    action: async () => {
                        onRename?.(repo);
                    },
                },
                {
                    id: `repo-delete:${repo.id}`,
                    label: 'Delete',
                    danger: true,
                    action: async () => {
                        await this.removeRepo(repo.id);
                    },
                },
            ];

            if (event) {
                contextMenu.openAtEvent(event, items);
                return;
            }

            contextMenu.openAtViewportCenter(items);
        },
    });

    return state;
}

let instance: ReturnType<typeof _useRepositories> | undefined = undefined;

export function useRepos() {
    if (!instance) {
        instance = _useRepositories();
    }

    return instance;
}
