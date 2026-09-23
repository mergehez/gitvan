import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MergeConflictState } from '../../../shared/types';
import { _useMergeHelper } from '../../composables/useMerge';
const { mockCoreState, mockTasks, mockApplyMutation, mockToast, mockConfirmAction } = vi.hoisted(() => ({
    mockCoreState: { selectedRepoId: 1 as number | undefined },
    mockTasks: {
        getMergeConflictState: { run: vi.fn() },
        getMergeConflictFileDetails: { run: vi.fn() },
        abortMerge: { run: vi.fn() },
        commitMerge: { run: vi.fn() },
        markMergeConflictResolved: { run: vi.fn() },
        resolveMergeConflictFile: { run: vi.fn() },
        saveMergeConflictResolution: { run: vi.fn() },
    },
    mockApplyMutation: vi.fn(async () => undefined),
    mockToast: {
        showSuccessToast: vi.fn(),
        showErrorToast: vi.fn(),
    },
    mockConfirmAction: vi.fn(async () => true),
}));

vi.mock('../../composables/coreState.ts', () => ({
    _coreState: mockCoreState,
}));

vi.mock('../../composables/useTasks.ts', () => ({
    tasks: mockTasks,
}));

vi.mock('../../composables/initializeStates.ts', () => ({
    applyMutation: mockApplyMutation,
}));

vi.mock('../../composables/useToast.ts', () => ({
    toast: mockToast,
}));

vi.mock('../../lib/utils.ts', () => ({
    confirmAction: mockConfirmAction,
}));

function noMergeInProgressState(): MergeConflictState {
    return {
        isMerging: false,
        targetBranch: undefined,
        incomingBranch: undefined,
        conflictedFiles: [],
        mergedFiles: [],
        canCommit: false,
    };
}

function mergeInProgressState(): MergeConflictState {
    return {
        isMerging: true,
        targetBranch: 'main',
        incomingBranch: 'feature',
        conflictedFiles: [{ path: 'story.txt', conflictCount: 1 }],
        mergedFiles: [],
        canCommit: false,
    };
}

describe('useMergeHelper inline conflict editor', () => {
    beforeEach(() => {
        mockCoreState.selectedRepoId = 1;
        mockTasks.getMergeConflictFileDetails.run.mockResolvedValue({
            path: 'story.txt',
            base: 'base\n',
            current: 'ours\n',
            incoming: 'theirs\n',
            result: 'resolved\n',
            conflictCount: 1,
        });
    });

    it('stays open when a background refresh reports no merge in progress', async () => {
        const merge = _useMergeHelper();

        await merge.openInlineMergeEditor('story.txt');
        merge._syncMergeConflictModal(noMergeInProgressState());

        expect(merge.isMergeConflictModalOpen).toBe(true);
        expect(merge.activeMergeConflictEditor?.path).toBe('story.txt');
    });

    it('closes when the selected repository changes', async () => {
        const merge = _useMergeHelper();

        await merge.openInlineMergeEditor('story.txt');
        mockCoreState.selectedRepoId = 2;
        merge._syncMergeConflictModal(noMergeInProgressState());

        expect(merge.isMergeConflictModalOpen).toBe(false);
        expect(merge.activeMergeConflictEditor).toBeUndefined();
    });

    it('closes when the editor is closed explicitly', async () => {
        const merge = _useMergeHelper();

        await merge.openInlineMergeEditor('story.txt');
        merge.closeInlineMergeEditor();

        expect(merge.isMergeConflictModalOpen).toBe(false);
        expect(merge.activeMergeConflictEditor).toBeUndefined();
    });

    it('still opens the merge session modal while a merge is in progress', async () => {
        const merge = _useMergeHelper();

        merge._syncMergeConflictModal(mergeInProgressState());

        expect(merge.isMergeConflictModalOpen).toBe(true);
        expect(merge.mergeConflictState?.isMerging).toBe(true);
    });

    it('replaces the inline editor with the merge session when a merge starts', async () => {
        const merge = _useMergeHelper();

        await merge.openInlineMergeEditor('story.txt');
        merge._syncMergeConflictModal(mergeInProgressState());

        expect(merge.isMergeConflictModalOpen).toBe(true);
        expect(merge.activeMergeConflictEditor).toBeUndefined();
    });
});
