import { reactive } from 'vue';
import type { MergeConflictFileDetails, MergeConflictState } from '../../shared/gitClient';
import { confirmAction } from '../lib/utils';
import { _coreState } from './coreState';
import { applyMutation } from './initializeStates';
import { tasks } from './useTasks';
import { toast } from './useToast';

function _useMergeHelper() {
    return reactive({
        mergeConflictModalRepositoryId: undefined as number | undefined,
        mergeConflictState: undefined as MergeConflictState | undefined,
        isMergeConflictModalOpen: false,
        activeMergeConflictEditor: undefined as MergeConflictFileDetails | undefined,
        resolvedMergeConflictPaths: new Set<string>(),
        _syncMergeConflictModal(nextState: MergeConflictState | undefined) {
            if (!_coreState.selectedRepoId || !nextState?.isMerging) {
                this.mergeConflictState = nextState;
                this.isMergeConflictModalOpen = false;
                this.mergeConflictModalRepositoryId = undefined;
                this.activeMergeConflictEditor = undefined;
                this.resolvedMergeConflictPaths = new Set<string>();
                return;
            }

            this.mergeConflictState = nextState;
            const nextResolvedPaths = new Set([...this.resolvedMergeConflictPaths].filter((path) => nextState.mergedFiles.some((file) => file.path === path)));
            this.resolvedMergeConflictPaths = nextResolvedPaths;

            if (this.mergeConflictModalRepositoryId !== _coreState.selectedRepoId) {
                this.mergeConflictModalRepositoryId = _coreState.selectedRepoId;
                this.isMergeConflictModalOpen = true;
                this.activeMergeConflictEditor = undefined;
            }
        },
        async loadMergeConflictState() {
            if (!_coreState.selectedRepoId) {
                this._syncMergeConflictModal(undefined);
                return;
            }

            const nextState = await tasks.getMergeConflictState.run({ repoId: _coreState.selectedRepoId! });

            this._syncMergeConflictModal(nextState);
        },
        openMergeConflictModal() {
            if (!this.mergeConflictState?.isMerging && !this.activeMergeConflictEditor) {
                return;
            }

            this.isMergeConflictModalOpen = true;
        },
        dismissMergeConflictModal() {
            this.isMergeConflictModalOpen = false;
        },
        async openInlineMergeEditor(path: string) {
            if (!_coreState.selectedRepoId) {
                return;
            }

            const details = await tasks.getMergeConflictFileDetails.run({
                repoId: _coreState.selectedRepoId!,
                path,
            });

            this.activeMergeConflictEditor = details;
            this.isMergeConflictModalOpen = true;
        },
        closeInlineMergeEditor() {
            this.activeMergeConflictEditor = undefined;

            if (!this.mergeConflictState?.isMerging) {
                this.isMergeConflictModalOpen = false;
            }
        },
        async resolveMergeConflictFile(path: string, resolution: 'ours' | 'theirs') {
            if (!_coreState.selectedRepoId) {
                return;
            }

            const nextBootstrap = await tasks.resolveMergeConflictFile.run({ repoId: _coreState.selectedRepoId!, path, resolution }, `${resolution}:${path}`);

            await applyMutation(nextBootstrap);
            this.resolvedMergeConflictPaths = new Set([...this.resolvedMergeConflictPaths, path]);
            if (this.activeMergeConflictEditor?.path === path) {
                this.closeInlineMergeEditor();
            }
            toast.showSuccessToast(`Used ${resolution === 'ours' ? 'my' : 'incoming'} version for ${path}.`);
        },
        async markMergeConflictResolved(path: string) {
            if (!_coreState.selectedRepoId) {
                return;
            }

            const nextBootstrap = await tasks.markMergeConflictResolved.run({ repoId: _coreState.selectedRepoId!, path }, path);

            await applyMutation(nextBootstrap);
            this.resolvedMergeConflictPaths = new Set([...this.resolvedMergeConflictPaths, path]);
            if (this.activeMergeConflictEditor?.path === path) {
                this.closeInlineMergeEditor();
            }
            toast.showSuccessToast(`${path} marked as resolved.`);
        },
        async saveMergeConflictResolution(path: string, resolvedContent: string) {
            if (!_coreState.selectedRepoId) {
                return;
            }

            const nextBootstrap = await tasks.saveMergeConflictResolution.run({ repoId: _coreState.selectedRepoId!, path, resolvedContent }, path);

            await applyMutation(nextBootstrap);
            this.resolvedMergeConflictPaths = new Set([...this.resolvedMergeConflictPaths, path]);
            this.closeInlineMergeEditor();
            toast.showSuccessToast(`${path} resolved inline.`);
        },
        async abortMerge() {
            if (!_coreState.selectedRepoId) {
                return;
            }

            const confirmed = await confirmAction({
                title: 'Abort merge',
                message: 'Abort the current merge?',
                detail: 'This discards the in-progress merge state and any unresolved merge results in the working tree.',
                confirmLabel: 'Abort merge',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.abortMerge.run({ repoId: _coreState.selectedRepoId! });

            await applyMutation(nextBootstrap);
            this.closeInlineMergeEditor();
            toast.showSuccessToast('Merge aborted.');
        },
        async commitMerge() {
            if (!_coreState.selectedRepoId) {
                return;
            }

            const nextBootstrap = await tasks.commitMerge.run({ repoId: _coreState.selectedRepoId! });

            await applyMutation(nextBootstrap);
            this.closeInlineMergeEditor();
            toast.showSuccessToast('Merge committed.');
        },
    });
}

let instance: ReturnType<typeof _useMergeHelper> | undefined = undefined;

export function useMergeHelper() {
    return (instance ??= _useMergeHelper());
}
