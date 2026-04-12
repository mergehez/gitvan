import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import type { EditorSettings, Repo } from '../../../shared/gitClient';
import ContextMenu from '../../components/ContextMenu.vue';
import SidebarRepositories from '../../components/SidebarRepositories.vue';
import { useAuth } from '../../composables/useAuth';
import { useContextMenu } from '../../composables/useContextMenu';
import { useRepo, type RepositoryState } from '../../composables/useRepo';
import { useRepos } from '../../composables/useRepos';
import { useSettings } from '../../composables/useSettings';
import { tasks } from '../../composables/useTasks';

type AuthState = ReturnType<typeof useAuth>;
type SettingsState = ReturnType<typeof useSettings>;
type ReposState = ReturnType<typeof useRepos>;
type TasksState = typeof tasks;
type RepositorySidebarAuthMock = Pick<AuthState, 'accounts' | 'assignAccountToRepo'>;
type RepositorySidebarSettingsMock = Pick<SettingsState, 'openSettingsWindow' | 'state'>;
type RepositorySidebarReposMock = Pick<
    ReposState,
    | 'repos'
    | 'repoGroups'
    | 'selectedRepoId'
    | 'isCreateRepoModalOpen'
    | 'isCloneRepoModalOpen'
    | 'canFetch'
    | 'canPull'
    | 'canPush'
    | 'createRepoGroup'
    | 'deleteRepoGroup'
    | 'copyRepoPath'
    | 'openRepoInTerminal'
    | 'pickRepo'
    | 'publishRepoBranch'
    | 'refreshRepositories'
    | 'removeRepo'
    | 'revealRepoInFinder'
    | 'renameRepo'
    | 'resetSandboxRepos'
    | 'runRepoRemoteOperation'
    | 'selectRepo'
    | 'updateRepoGroup'
>;

let mockAuth: RepositorySidebarAuthMock;
let mockSettings: RepositorySidebarSettingsMock;
let mockRepos: RepositorySidebarReposMock;

const settingsState = {
    editors: [{ path: '/Applications/Visual Studio Code.app', label: 'Visual Studio Code' }],
    defaultEditorPath: '/Applications/Visual Studio Code.app',
    diffFontSize: 12,
    diffViewMode: 'full-file',
    showWhitespaceChanges: false,
    activeView: 'changes',
    showBranches: false,
} satisfies EditorSettings;

vi.mock('../../composables/useAuth.ts', () => ({
    useAuth: () => mockAuth as unknown as AuthState,
}));

vi.mock('../../composables/useSettings.ts', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

vi.mock('../../composables/useRepos.ts', () => ({
    useRepos: () => mockRepos as unknown as ReposState,
}));

vi.mock('../../composables/useTasks.ts', () => ({
    tasks: {
        isBusy: false,
        isOperationRunning: vi.fn(() => false),
        isAnyLongRunningOperation: vi.fn(() => false),
        getLongRunningOperation: null,
        renameRepo: {
            isRunning: vi.fn(() => false),
        },
    } as unknown as TasksState,
}));

function createRepository(id: number, name: string, groupName: string | undefined): Repo {
    return {
        id,
        name,
        path: `/tmp/${name.toLowerCase()}`,
        sequence: id,
        groupId: groupName ? 1 : undefined,
        groupName,
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

function createMockSettings() {
    return {
        openSettingsWindow: vi.fn(() => Promise.resolve()),
        state: settingsState,
    } satisfies RepositorySidebarSettingsMock;
}

function createMockAuth() {
    return reactive({
        accounts: [],
        assignAccountToRepo: vi.fn(() => Promise.resolve()),
    } satisfies RepositorySidebarAuthMock);
}

function createMockRepos() {
    return reactive({
        repos: [useRepo(createRepository(1, 'Alpha', 'Work')), useRepo(createRepository(2, 'Beta', 'Work'))] as RepositoryState[],
        repoGroups: [{ id: 1, name: 'Work', sequence: 1, repoCount: 2, createdAt: '2026-03-27T00:00:00.000Z' }],
        selectedRepoId: 1,
        isCreateRepoModalOpen: false,
        isCloneRepoModalOpen: false,
        canFetch: vi.fn(() => true),
        canPull: vi.fn(() => false),
        canPush: vi.fn(() => false),
        createRepoGroup: vi.fn(),
        copyRepoPath: vi.fn(() => Promise.resolve()),
        deleteRepoGroup: vi.fn(),
        openRepoInTerminal: vi.fn(() => Promise.resolve()),
        pickRepo: vi.fn(),
        publishRepoBranch: vi.fn(),
        refreshRepositories: vi.fn(),
        removeRepo: vi.fn(() => Promise.resolve()),
        revealRepoInFinder: vi.fn(() => Promise.resolve()),
        renameRepo: vi.fn(async function (this: RepositorySidebarReposMock, repoId: number, name: string) {
            const repo = this.repos.find((entry) => entry.id === repoId);
            if (repo) {
                repo.name = name.trim();
            }

            return repo;
        }),
        resetSandboxRepos: vi.fn(),
        runRepoRemoteOperation: vi.fn(),
        selectRepo: vi.fn(),
        updateRepoGroup: vi.fn(() => Promise.resolve()),
    } satisfies RepositorySidebarReposMock);
}

const buttonStub = defineComponent({
    name: 'Button',
    emits: ['click'],
    template: '<button :disabled="$attrs.disabled" @click="$emit(\'click\')"><slot /></button>',
});

const iconButtonStub = defineComponent({
    name: 'IconButton',
    props: {
        icon: {
            type: String,
            required: false,
        },
        disabled: {
            type: Boolean,
            default: false,
        },
    },
    emits: ['click'],
    computed: {
        testId(): string {
            if (this.icon?.includes('cog-outline')) {
                return 'settings-button';
            }

            if (this.icon?.includes('mdi--plus')) {
                return 'add-repository-button';
            }

            if (this.icon?.includes('folder-plus-outline')) {
                return 'add-group-button';
            }

            if (this.icon?.includes('ic--refresh')) {
                return 'refresh-button';
            }

            return 'icon-button';
        },
    },
    template: '<button type="button" :data-testid="testId" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const fileTreeStub = defineComponent({
    name: 'FileTree',
    props: {
        item: {
            type: Object,
            required: true,
        },
        onContextMenu: {
            type: Function,
            required: false,
        },
    },
    template: `
        <section>
            <h4>{{ item.title }}</h4>
            <button
                v-for="entry in item.children"
                :key="entry.id"
                type="button"
                :data-testid="'repo-item-' + entry.id"
                @contextmenu.prevent="onContextMenu && onContextMenu(entry, $event)">
                {{ entry.title }}
            </button>
        </section>
    `,
});

const centeredInputModalStub = defineComponent({
    name: 'CenteredInputModal',
    props: {
        open: {
            type: Boolean,
            required: true,
        },
        title: {
            type: String,
            required: true,
        },
        value: {
            type: String,
            required: false,
        },
        submitLabel: {
            type: String,
            required: false,
        },
        canSubmit: {
            type: Boolean,
            required: false,
        },
        submit: {
            type: Function,
            required: false,
        },
    },
    emits: ['update:open', 'update:value'],
    template: `
        <section v-if="open" data-testid="rename-modal">
            <h3>{{ title }}</h3>
            <input id="rename-repository-name" :value="value" @input="$emit('update:value', $event.target.value)" />
            <button type="button" :disabled="!canSubmit" @click="submit && submit()">{{ submitLabel ?? 'Submit' }}</button>
        </section>
    `,
});

const sidebarHost = defineComponent({
    name: 'RepositorySidebarHost',
    components: {
        ContextMenu,
        SidebarRepositories,
    },
    setup() {
        const contextMenu = useContextMenu();
        return {
            contextMenu,
        };
    },
    template: `
        <div>
            <SidebarRepositories />
            <ContextMenu
                :open="contextMenu.open"
                :items="contextMenu.items"
                :x="contextMenu.x"
                :y="contextMenu.y"
                @close="contextMenu.closeMenu" />
        </div>
    `,
});

function mountSidebar() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    return mount(sidebarHost, {
        attachTo: container,
        global: {
            stubs: {
                Button: buttonStub,
                CenteredInputModal: centeredInputModalStub,
                FileTree: fileTreeStub,
                IconButton: iconButtonStub,
            },
            directives: {
                tooltip: {},
                loading: {},
            },
        },
    });
}

function getTeleportedMenuButtons() {
    return Array.from(document.body.querySelectorAll('button')).filter((entry) => {
        const text = entry.textContent ?? '';
        return text.includes('Clone Repository') || text.includes('Create New Repository') || text.includes('Add Existing Repository');
    });
}

describe('RepositorySidebar', () => {
    beforeEach(() => {
        useContextMenu().closeMenu();
        mockAuth = createMockAuth();
        mockSettings = createMockSettings();
        mockRepos = createMockRepos();
    });

    it('opens the settings window with the repositories panel selected', async () => {
        const wrapper = mountSidebar();

        await wrapper.get('[data-testid="settings-button"]').trigger('click');

        expect(mockSettings.openSettingsWindow).toHaveBeenCalledWith('repositories');

        wrapper.unmount();
    });

    it('routes add menu actions to create and clone handlers', async () => {
        const wrapper = mountSidebar();

        await wrapper.get('[data-testid="add-repository-button"]').trigger('click');

        const menuButtons = getTeleportedMenuButtons();

        menuButtons[0]!.click();
        expect(mockRepos.isCloneRepoModalOpen).toBe(true);

        mockRepos.isCloneRepoModalOpen = false;
        await wrapper.get('[data-testid="add-repository-button"]').trigger('click');
        const reopenedMenuButtons = getTeleportedMenuButtons();

        reopenedMenuButtons[1]!.click();
        expect(mockRepos.isCreateRepoModalOpen).toBe(true);

        mockRepos.isCreateRepoModalOpen = false;
        await wrapper.get('[data-testid="add-repository-button"]').trigger('click');
        const finalMenuButtons = getTeleportedMenuButtons();

        finalMenuButtons[2]!.click();
        expect(mockRepos.pickRepo).toHaveBeenCalledWith(undefined);

        wrapper.unmount();
    });

    it('opens the rename modal from the repository context menu and submits the new name', async () => {
        const wrapper = mountSidebar();

        await wrapper.get('[data-testid="repo-item-1"]').trigger('contextmenu');

        expect(mockRepos.selectRepo).not.toHaveBeenCalled();

        const renameMenuButton = Array.from(document.body.querySelectorAll('button')).find((entry) => entry.textContent?.trim() === 'Rename...');

        expect(renameMenuButton).toBeTruthy();
        renameMenuButton!.click();
        await wrapper.vm.$nextTick();

        expect(wrapper.get('[data-testid="rename-modal"]').text()).toContain('Rename Repository');

        const renameInput = wrapper.get('#rename-repository-name');
        expect((renameInput.element as HTMLInputElement).value).toBe('Alpha');

        await renameInput.setValue('Alpha Prime');
        const renameButton = wrapper.findAll('button').find((entry) => entry.text().trim() === 'Rename');

        expect(renameButton).toBeTruthy();
        await renameButton!.trigger('click');

        expect(mockRepos.renameRepo).toHaveBeenCalledWith(1, 'Alpha Prime');

        wrapper.unmount();
    });

    it('does not select a repository when opening its context menu', async () => {
        const wrapper = mountSidebar();

        await wrapper.get('[data-testid="repo-item-2"]').trigger('contextmenu');

        expect(mockRepos.selectRepo).not.toHaveBeenCalled();

        wrapper.unmount();
    });

    it('renders repositories without a group', () => {
        mockRepos.repos = [useRepo(createRepository(7, 'Solo', undefined))] as RepositoryState[];
        (mockRepos as unknown as { repoGroups: RepositorySidebarReposMock['repoGroups']; selectedRepoId: number | undefined }).repoGroups = [];
        (mockRepos as unknown as { selectedRepoId: number | undefined }).selectedRepoId = 7;

        const wrapper = mountSidebar();

        expect(wrapper.text()).toContain('Repositories');
        expect(wrapper.get('[data-testid="repo-item-7"]').text()).toContain('Solo');

        wrapper.unmount();
    });
});
