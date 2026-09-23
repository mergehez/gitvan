import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import type { MergeConflictFileDetails, MergeConflictState } from '../../../shared/types';
import AppMergeConflictModal from '../../components/AppMergeConflictModal.vue';

type MergeStateMock = {
    mergeConflictState: MergeConflictState | undefined;
    activeMergeConflictEditor: MergeConflictFileDetails | undefined;
    isMergeConflictModalOpen: boolean;
    resolvedMergeConflictPaths: Set<string>;
    openInlineMergeEditor: ReturnType<typeof vi.fn>;
    closeInlineMergeEditor: ReturnType<typeof vi.fn>;
    abortMerge: ReturnType<typeof vi.fn>;
    commitMerge: ReturnType<typeof vi.fn>;
    markMergeConflictResolved: ReturnType<typeof vi.fn>;
    resolveMergeConflictFile: ReturnType<typeof vi.fn>;
    saveMergeConflictResolution: ReturnType<typeof vi.fn>;
    loadMergeConflictState: ReturnType<typeof vi.fn>;
    openMergeConflictModal: ReturnType<typeof vi.fn>;
    _syncMergeConflictModal: ReturnType<typeof vi.fn>;
};

const { mockMergeState, mockRepos } = vi.hoisted(() => {
    const mergeState: MergeStateMock = {
        mergeConflictState: undefined,
        activeMergeConflictEditor: undefined,
        isMergeConflictModalOpen: false,
        resolvedMergeConflictPaths: new Set<string>(),
        openInlineMergeEditor: vi.fn(),
        closeInlineMergeEditor: vi.fn(),
        abortMerge: vi.fn(),
        commitMerge: vi.fn(),
        markMergeConflictResolved: vi.fn(),
        resolveMergeConflictFile: vi.fn(),
        saveMergeConflictResolution: vi.fn(),
        loadMergeConflictState: vi.fn(),
        openMergeConflictModal: vi.fn(),
        _syncMergeConflictModal: vi.fn(),
    };

    return {
        mockMergeState: mergeState,
        mockRepos: {
            getSelectedRepo: () => ({ openFileInEditor: vi.fn() }),
        },
    };
});

vi.mock('../../composables/useMerge.ts', () => ({
    useMergeHelper: () => mockMergeState,
}));

vi.mock('../../composables/useRepos.ts', () => ({
    useRepos: () => mockRepos,
}));

vi.mock('../../composables/useTasks.ts', () => ({
    tasks: {
        isOperationRunning: () => false,
        markMergeConflictResolved: { isRunning: () => false },
    },
}));

vi.mock('../../directives/useOverlaysState.ts', () => ({
    useOverlaysState: () => ({ claimZIndex: () => 40, releaseZIndex: vi.fn() }),
}));

const iconButtonStub = defineComponent({
    name: 'IconButton',
    props: {
        icon: { type: String, required: false },
    },
    emits: ['click'],
    template: '<button type="button" data-testid="header-close" @click="$emit(\'click\')"><slot /></button>',
});

function mountModal() {
    return mount(AppMergeConflictModal, {
        global: {
            directives: {
                tooltip: {},
                loading: {},
            },
            stubs: {
                Button: defineComponent({ name: 'Button', emits: ['click'], template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' }),
                ConflictMonacoEditor: defineComponent({ name: 'ConflictMonacoEditor', template: '<div />' }),
                IconButton: iconButtonStub,
            },
        },
    });
}

describe('AppMergeConflictModal close button', () => {
    beforeEach(() => {
        mockMergeState.activeMergeConflictEditor = undefined;
        mockMergeState.mergeConflictState = undefined;
        mockMergeState.isMergeConflictModalOpen = true;
        mockMergeState.closeInlineMergeEditor.mockClear();
        mockMergeState.abortMerge.mockClear();
    });

    it('closes the inline editor instead of aborting the merge', () => {
        mockMergeState.activeMergeConflictEditor = { path: 'story.txt', base: '', current: '', incoming: '', result: '', conflictCount: 1 };
        const wrapper = mountModal();

        wrapper.get('[data-testid="header-close"]').trigger('click');

        expect(mockMergeState.closeInlineMergeEditor).toHaveBeenCalledTimes(1);
        expect(mockMergeState.abortMerge).not.toHaveBeenCalled();
    });

    it('aborts the merge while a merge session is in progress', () => {
        mockMergeState.mergeConflictState = reactive({
            isMerging: true,
            targetBranch: 'main',
            incomingBranch: 'feature',
            conflictedFiles: [{ path: 'story.txt', conflictCount: 1 }],
            mergedFiles: [],
            canCommit: false,
        });
        const wrapper = mountModal();

        wrapper.get('[data-testid="header-close"]').trigger('click');

        expect(mockMergeState.abortMerge).toHaveBeenCalledTimes(1);
        expect(mockMergeState.closeInlineMergeEditor).not.toHaveBeenCalled();
    });
});
