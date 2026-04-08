import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppBootstrapApi, EditorSettings, Repo, RepoContextMenuAction } from '../../../shared/gitClient';
import { _useRepositories } from '../../composables/useRepos';

const { testEditor, mockRequest, mockTasks, mockApplyMutation, mockSettings, mockCoreState } = vi.hoisted(() => {
    const testEditor = 'Visual Studio Code.app';

    return {
        testEditor,
        mockRequest: {
            showRepoContextMenu: vi.fn(),
            getCloneRepoDefaults: vi.fn(),
            pickCloneRepoDirectory: vi.fn(),
        },
        mockTasks: {
            isBusy: false,
            openFileInEditor: {
                run: vi.fn(async () => undefined),
            },
            runRemoteOperation: {
                run: vi.fn(),
            },
            retryPullAfterStash: {
                run: vi.fn(),
            },
            publishBranch: {
                run: vi.fn(),
            },
        } as any,
        mockApplyMutation: vi.fn(async (_bootstrap: AppBootstrapApi) => undefined),
        mockSettings: {
            state: {
                editors: [{ path: `/Applications/${testEditor}`, label: testEditor.replace('.app', '') }],
                defaultEditorPath: `/Applications/${testEditor}`,
                diffFontSize: 12,
                diffViewMode: 'full-file',
                showWhitespaceChanges: false,
                activeView: 'changes',
                showBranches: false,
            } satisfies EditorSettings,
        },
        mockCoreState: {
            stateCounter: 0,
            repos: [] as Repo[],
            repoGroups: [],
            selectedRepoId: undefined as number | undefined,
            applyBootstrap: vi.fn(),
        },
    };
});

vi.mock('../../lib/gitClient.ts', () => ({
    gitClientRpc: {
        request: mockRequest,
    },
}));

vi.mock('../../composables/useTasks.ts', () => ({
    tasks: mockTasks,
}));

vi.mock('../../composables/coreState.ts', () => ({
    _coreState: mockCoreState,
}));

vi.mock('../../composables/initializeStates.ts', () => ({
    applyMutation: mockApplyMutation,
}));

vi.mock('../../lib/utils.ts', () => ({
    confirmAction: vi.fn(async () => true),
}));

vi.mock('../../composables/useRepo.ts', () => ({
    useRepo: (repo: Repo) => repo,
}));

vi.mock('../../composables/useToast.ts', () => ({
    toast: {
        showSuccessToast: vi.fn(),
    },
}));

vi.mock('../../lib/loadingIndicatorState.ts', () => ({
    isButtonBusyStateSilenced: { value: false },
    runWithButtonBusyStateSilenced: async (callback: () => Promise<unknown>) => await callback(),
}));

vi.mock('../../composables/useSettings.ts', () => ({
    useSettings: () => mockSettings,
}));

function createRepo(): Repo {
    return {
        id: 1,
        name: 'Alpha',
        path: '/tmp/alpha',
        sequence: 1,
        groupId: 1,
        groupName: 'Work',
        accountId: undefined,
        accountLabel: undefined,
        addedAt: '2026-03-27T00:00:00.000Z',
        lastOpenedAt: '2026-03-27T00:00:00.000Z',
        status: {
            branch: 'main',
            ahead: 0,
            behind: 0,
            hasRemote: true,
            hasUpstream: true,
            publishableCommits: 0,
            changedFiles: 0,
            stagedFiles: 0,
            unstagedFiles: 0,
            isDirty: false,
            error: undefined,
            lastScannedAt: undefined,
        },
    };
}

describe('useRepos repo context menu', () => {
    beforeEach(() => {
        mockCoreState.repos = [createRepo()];
        mockCoreState.selectedRepoId = 1;
        mockRequest.showRepoContextMenu.mockReset();
        mockTasks.openFileInEditor.run.mockClear();
    });

    it('passes the default editor label into the repo context menu', async () => {
        mockRequest.showRepoContextMenu.mockResolvedValue(undefined);
        const repos = _useRepositories();

        await repos.openRepoContextMenu(1);

        expect(mockRequest.showRepoContextMenu).toHaveBeenCalledWith(
            expect.objectContaining({
                openWithEditors: [{ path: `/Applications/${testEditor}`, label: testEditor.replace('.app', '') }],
            }),
        );
    });

    it('opens the repository root through the picker for open-with', async () => {
        const action: RepoContextMenuAction = 'open-with';
        mockRequest.showRepoContextMenu.mockResolvedValue(action);
        const repos = _useRepositories();

        await repos.openRepoContextMenu(1);

        expect(mockTasks.openFileInEditor.run).toHaveBeenCalledWith({ repoId: 1, path: '', mode: 'pick' }, 'repo:1:pick-editor');
    });

    it('opens the repository root in a selected configured editor', async () => {
        mockRequest.showRepoContextMenu.mockResolvedValue({
            kind: 'open-with-editor',
            editorPath: `/Applications/${testEditor}`,
        });
        const repos = _useRepositories();

        await repos.openRepoContextMenu(1);

        expect(mockTasks.openFileInEditor.run).toHaveBeenCalledWith(
            { repoId: 1, path: '', editorPath: `/Applications/${testEditor}` },
            `repo:1:editor:/Applications/${testEditor}`,
        );
    });
});
