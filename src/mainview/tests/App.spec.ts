import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive } from 'vue';
import type { EditorSettings, NativeCommand, NavigationView, Repo, SettingsPanel } from '../../shared/gitClient';
import App from '../App.vue';
import { useRepo, type RepositoryState } from '../composables/useRepo';
import { useRepos } from '../composables/useRepos';
import { useSettings } from '../composables/useSettings';
import { tasks } from '../composables/useTasks';

type SettingsState = ReturnType<typeof useSettings>;
type ReposState = ReturnType<typeof useRepos>;
type TasksState = typeof tasks;
type AbortMergeTaskState = TasksState['abortMerge'];
type AppSettingsMock = Pick<SettingsState, 'state' | 'setActiveView' | 'openSettingsWindow' | 'isSettingsModalOpen' | 'selectedSettingsPanel'>;
type AppReposMock = Pick<ReposState, 'repos' | 'repoGroups' | 'selectedRepoId' | 'getSelectedRepo' | 'selectRepo'>;

let mockSettings: AppSettingsMock;
let mockRepos: AppReposMock;
let nativeCommandListener: ((command: NativeCommand) => void) | undefined;

vi.mock('../composables/useSettings', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

vi.mock('../composables/useRepos', () => ({
    useRepos: () => mockRepos as unknown as ReposState,
}));

vi.mock('../composables/initializeStates', () => ({
    initializeStates: () => undefined,
}));

vi.mock('../composables/useTasks', () => ({
    tasks: {
        isBusy: false,
        isOperationRunning: vi.fn(() => false),
        isAnyLongRunningOperation: vi.fn(() => false),
        getLongRunningOperation: null,
        abortMerge: {
            run: vi.fn(async () => ({ repos: [], groups: [], accounts: [], selectedRepoId: undefined })),
            isRunning: vi.fn(() => false),
            errorMessage: undefined,
            clearError: vi.fn(() => undefined),
        } as unknown as AbortMergeTaskState,
    } as unknown as TasksState,
}));

function createRepository(id: number, name: string): Repo {
    return {
        id,
        name,
        path: `/tmp/${name.toLowerCase()}`,
        sequence: id,
        groupId: 1,
        groupName: 'Work',
        accountId: undefined,
        accountLabel: undefined,
        terminalPath: undefined,
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

function createMockSettings(activeView: NavigationView = 'changes') {
    return reactive({
        state: reactive({
            editors: [],
            defaultEditorPath: undefined,
            terminals: [],
            defaultTerminalPath: undefined,
            diffFontSize: 12,
            diffViewMode: 'full-file',
            showWhitespaceChanges: false,
            activeView,
            showBranches: false,
        } satisfies EditorSettings),
        async setActiveView(nextView: NavigationView) {
            this.state.activeView = nextView;
        },
        isSettingsModalOpen: false,
        selectedSettingsPanel: 'editors' as SettingsPanel,
        async openSettingsWindow(panel?: SettingsPanel) {
            this.selectedSettingsPanel = panel ?? 'editors';
            this.isSettingsModalOpen = true;
        },
    } satisfies AppSettingsMock);
}

function createMockRepos() {
    const repos: RepositoryState[] = [useRepo(createRepository(1, 'Alpha')), useRepo(createRepository(2, 'Beta'))];

    return reactive({
        _selectedRepoId: 1 as number | undefined,
        repos,
        repoGroups: [{ id: 1, name: 'Work', sequence: 1, repoCount: 2, createdAt: '2026-03-27T00:00:00.000Z' }],
        get selectedRepoId() {
            return this._selectedRepoId;
        },
        getSelectedRepo() {
            return this.repos.find((repo) => repo.id === this.selectedRepoId);
        },
        async selectRepo(repoId: number) {
            this._selectedRepoId = repoId;
        },
    } satisfies AppReposMock & { _selectedRepoId: number | undefined });
}

const stubComponent = (name: string, text?: string) =>
    defineComponent({
        name,
        template: `<div data-testid="${name}">${text ?? name}</div>`,
    });

const splitterStub = defineComponent({
    name: 'EtSplitter',
    template: `
        <div data-testid="EtSplitter">
            <div data-testid="EtSplitter-left"><slot name="left" /></div>
            <div data-testid="EtSplitter-right"><slot name="right" /></div>
        </div>
    `,
});

const sidebarRepositoriesStub = defineComponent({
    name: 'SidebarRepositories',
    setup() {
        return {
            repos: computed(() => mockRepos.repos),
            selectRepo(repoId: number) {
                mockRepos.selectRepo(repoId);
            },
        };
    },
    template: `
        <div data-testid="SidebarRepositories">
            <button
                v-for="repo in repos"
                :key="repo.id"
                type="button"
                :data-testid="'select-repository-' + repo.id"
                @click="selectRepo(repo.id)">
                {{ repo.name }}
            </button>
        </div>
    `,
});

const gitClientHeaderStub = defineComponent({
    name: 'GitClientHeader',
    setup() {
        return {
            repoName: computed(() => mockRepos.getSelectedRepo()?.name ?? 'No repository selected'),
            activeView: computed(() => mockSettings.state.activeView),
            async setActiveView(nextView: NavigationView) {
                await mockSettings.setActiveView(nextView);
            },
        };
    },
    template: `
        <div data-testid="GitClientHeader">
            <p data-testid="selected-repository-name">{{ repoName }}</p>
            <button type="button" data-testid="switch-view-changes" @click="setActiveView('changes')">Changes</button>
            <button type="button" data-testid="switch-view-explorer" @click="setActiveView('explorer')">Explorer</button>
            <button type="button" data-testid="switch-view-history" @click="setActiveView('history')">History</button>
            <p data-testid="active-view-name">{{ activeView }}</p>
        </div>
    `,
});

const changesViewStub = defineComponent({
    name: 'RepChangesView',
    setup() {
        return {
            repoName: computed(() => mockRepos.getSelectedRepo()?.name ?? 'No repository selected'),
        };
    },
    template: `<div data-testid="RepChangesView">Changes View: {{ repoName }}</div>`,
});

const historyViewStub = defineComponent({
    name: 'RepHistoryView',
    setup() {
        return {
            repoName: computed(() => mockRepos.getSelectedRepo()?.name ?? 'No repository selected'),
        };
    },
    template: `<div data-testid="RepHistoryView">History View: {{ repoName }}</div>`,
});

const explorerViewStub = defineComponent({
    name: 'RepExplorerView',
    setup() {
        return {
            repoName: computed(() => mockRepos.getSelectedRepo()?.name ?? 'No repository selected'),
        };
    },
    template: `<div data-testid="RepExplorerView">Explorer View: {{ repoName }}</div>`,
});

const branchesViewStub = defineComponent({
    name: 'RepBranchesView',
    setup() {
        return {
            repoName: computed(() => mockRepos.getSelectedRepo()?.name ?? 'No repository selected'),
        };
    },
    template: `<div data-testid="RepBranchesView">Branches View: {{ repoName }}</div>`,
});

function mountApp() {
    return mount(App, {
        global: {
            stubs: {
                AppCloneRepositoryModal: stubComponent('AppCloneRepositoryModal'),
                AppCreateRepositoryModal: stubComponent('AppCreateRepositoryModal'),
                AppErrorBanner: stubComponent('AppErrorBanner'),
                AppIntegratedTerminalModal: stubComponent('AppIntegratedTerminalModal'),
                AppMergeConflictModal: stubComponent('AppMergeConflictModal'),
                AppPullBlockedByLocalChangesModal: stubComponent('AppPullBlockedByLocalChangesModal'),
                AppSuccessToast: stubComponent('AppSuccessToast'),
                EtSplitter: splitterStub,
                GitClientHeader: gitClientHeaderStub,
                Settings: stubComponent('Settings'),
                SidebarRepositories: sidebarRepositoriesStub,
                RepChangesView: changesViewStub,
                RepExplorerView: explorerViewStub,
                RepHistoryView: historyViewStub,
                RepBranchesView: branchesViewStub,
            },
        },
    });
}

describe('App', () => {
    beforeEach(() => {
        nativeCommandListener = undefined;
        window.gitClient = {
            invoke: vi.fn(),
            onIntegratedTerminalEvent: vi.fn(() => () => {}),
            onNativeCommand: vi.fn((listener: (command: NativeCommand) => void) => {
                nativeCommandListener = listener;
                return () => {
                    if (nativeCommandListener === listener) {
                        nativeCommandListener = undefined;
                    }
                };
            }),
        };
        mockSettings = createMockSettings();
        mockRepos = createMockRepos();
    });

    it('renders the shared shell', () => {
        const wrapper = mountApp();

        expect(wrapper.get('[data-testid="AppMergeConflictModal"]')).toBeTruthy();
        expect(wrapper.get('[data-testid="AppCloneRepositoryModal"]')).toBeTruthy();
        expect(wrapper.get('[data-testid="AppCreateRepositoryModal"]')).toBeTruthy();
        expect(wrapper.get('[data-testid="AppIntegratedTerminalModal"]')).toBeTruthy();
        expect(wrapper.get('[data-testid="AppSuccessToast"]')).toBeTruthy();
        expect(wrapper.get('[data-testid="AppPullBlockedByLocalChangesModal"]')).toBeTruthy();
        expect(wrapper.get('[data-testid="Settings"]')).toBeTruthy();
        expect(wrapper.get('[data-testid="SidebarRepositories"]')).toBeTruthy();
        expect(wrapper.get('[data-testid="GitClientHeader"]')).toBeTruthy();
    });

    it('renders the changes view by default', () => {
        const wrapper = mountApp();

        expect(wrapper.get('[data-testid="RepChangesView"]').text()).toContain('Changes View');
        expect(wrapper.find('[data-testid="RepExplorerView"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="RepHistoryView"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="RepBranchesView"]').exists()).toBe(false);
    });

    it('updates the right panel when changing repositories', async () => {
        const wrapper = mountApp();

        expect(wrapper.get('[data-testid="selected-repository-name"]').text()).toBe('Alpha');
        expect(wrapper.get('[data-testid="RepChangesView"]').text()).toContain('Alpha');

        await wrapper.get('[data-testid="select-repository-2"]').trigger('click');

        expect(wrapper.get('[data-testid="selected-repository-name"]').text()).toBe('Beta');
        expect(wrapper.get('[data-testid="RepChangesView"]').text()).toContain('Beta');
    });

    it('switches between changes, explorer, and history in the right panel', async () => {
        const wrapper = mountApp();

        expect(wrapper.get('[data-testid="RepChangesView"]').text()).toContain('Alpha');

        await wrapper.get('[data-testid="switch-view-explorer"]').trigger('click');
        expect(wrapper.find('[data-testid="RepChangesView"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="RepExplorerView"]').text()).toContain('Alpha');

        await wrapper.get('[data-testid="switch-view-history"]').trigger('click');
        expect(wrapper.find('[data-testid="RepExplorerView"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="RepHistoryView"]').text()).toContain('Alpha');

        await wrapper.get('[data-testid="switch-view-changes"]').trigger('click');
        expect(wrapper.find('[data-testid="RepHistoryView"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="RepBranchesView"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="RepChangesView"]').text()).toContain('Alpha');
    });

    it('renders the history view when activeView is history', () => {
        mockSettings = createMockSettings('history');

        const wrapper = mountApp();

        expect(wrapper.find('[data-testid="RepChangesView"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="RepExplorerView"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="RepHistoryView"]').text()).toContain('History View');
        expect(wrapper.find('[data-testid="RepBranchesView"]').exists()).toBe(false);
    });

    it('opens the settings window when triggered from the native menu', async () => {
        mountApp();

        nativeCommandListener?.({ kind: 'open-settings', panel: 'accounts' });

        expect(mockSettings.isSettingsModalOpen).toBe(true);
        expect(mockSettings.selectedSettingsPanel).toBe('accounts');
    });
});
