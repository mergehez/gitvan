import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppBootstrapApi, EditorSettings, Repo } from '../../../shared/gitClient';
import type { ContextMenuEntry, ContextMenuItem } from '../../components/contextMenuTypes';
import { _useRepositories } from '../../composables/useRepos';

const { testEditor, mockRequest, mockTasks, mockApplyMutation, mockSettings, mockCoreState, mockContextMenu } = vi.hoisted(() => {
    const testEditor = 'Visual Studio Code.app';

    return {
        testEditor,
        mockRequest: {
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
        mockContextMenu: {
            openAtEvent: vi.fn(),
            openAtPosition: vi.fn(),
            openAtViewportCenter: vi.fn(),
            closeMenu: vi.fn(),
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

vi.mock('../../composables/useContextMenu.ts', () => ({
    useContextMenu: () => mockContextMenu,
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

function isMenuItem(entry: ContextMenuEntry | undefined): entry is ContextMenuItem {
    return Boolean(entry && 'id' in entry);
}

describe('useRepos repo context menu', () => {
    beforeEach(() => {
        mockCoreState.repos = [createRepo()];
        mockCoreState.selectedRepoId = 1;
        mockTasks.openFileInEditor.run.mockClear();
        mockContextMenu.openAtViewportCenter.mockClear();
    });

    it('builds repo context-menu entries with configured editors', async () => {
        const repos = _useRepositories();

        await repos.openRepoContextMenu(1);

        expect(mockContextMenu.openAtViewportCenter).toHaveBeenCalledTimes(1);

        const items = mockContextMenu.openAtViewportCenter.mock.calls[0]?.[0] as ContextMenuEntry[];
        const openWithEntry = items.find((item) => 'id' in item && item.id === 'repo-open-with:1');

        expect(openWithEntry && 'children' in openWithEntry ? openWithEntry.children : undefined).toEqual(
            expect.arrayContaining([expect.objectContaining({ label: testEditor.replace('.app', '') })]),
        );
    });

    it('opens the repository root through the picker for open-with', async () => {
        const repos = _useRepositories();

        await repos.openRepoContextMenu(1);

        const items = mockContextMenu.openAtViewportCenter.mock.calls[0]?.[0] as ContextMenuEntry[];
        const openWithEntry = items.find((item) => 'id' in item && item.id === 'repo-open-with:1');
        const pickProgramEntry = isMenuItem(openWithEntry)
            ? openWithEntry.children?.find((item: ContextMenuEntry) => isMenuItem(item) && item.id === 'repo-open-with-picker:1')
            : undefined;

        expect(isMenuItem(pickProgramEntry) ? pickProgramEntry.action : undefined).toBeTruthy();
        if (!isMenuItem(pickProgramEntry) || !pickProgramEntry.action) {
            throw new Error('Expected repo-open-with-picker:1 menu item to be present.');
        }

        await pickProgramEntry.action();

        expect(mockTasks.openFileInEditor.run).toHaveBeenCalledWith({ repoId: 1, path: '', mode: 'pick' }, 'repo:1:pick-editor');
    });

    it('opens the repository root in a selected configured editor', async () => {
        const repos = _useRepositories();

        await repos.openRepoContextMenu(1);

        const items = mockContextMenu.openAtViewportCenter.mock.calls[0]?.[0] as ContextMenuEntry[];
        const openWithEntry = items.find((item) => 'id' in item && item.id === 'repo-open-with:1');
        const editorEntry = isMenuItem(openWithEntry)
            ? openWithEntry.children?.find((item: ContextMenuEntry) => isMenuItem(item) && item.id === `repo-open-with-editor:1:/Applications/${testEditor}`)
            : undefined;

        expect(isMenuItem(editorEntry) ? editorEntry.action : undefined).toBeTruthy();
        if (!isMenuItem(editorEntry) || !editorEntry.action) {
            throw new Error(`Expected repo-open-with-editor entry for ${testEditor} to be present.`);
        }

        await editorEntry.action();

        expect(mockTasks.openFileInEditor.run).toHaveBeenCalledWith(
            { repoId: 1, path: '', editorPath: `/Applications/${testEditor}` },
            `repo:1:editor:/Applications/${testEditor}`,
        );
    });
});
