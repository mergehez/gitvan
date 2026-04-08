import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountSummary, CloneableRepo } from '../../../shared/gitClient';
import { useAuth } from '../../composables/useAuth';
import { useRepos } from '../../composables/useRepos';
import { useSettings } from '../../composables/useSettings';
import { tasks } from '../../composables/useTasks';
import AppCloneRepositoryModal from '../../components/AppCloneRepositoryModal.vue';

type ReposState = ReturnType<typeof useRepos>;
type AuthState = ReturnType<typeof useAuth>;
type SettingsState = ReturnType<typeof useSettings>;
type TasksState = typeof tasks;
type CloneListTaskState = TasksState['listCloneableRepos'];
type CloneModalReposMock = Pick<ReposState, 'repoGroups' | 'isCloneRepoModalOpen' | 'getCloneRepoDefaults' | 'pickCloneRepoDirectory' | 'cloneTrackedRepo'>;
type CloneModalAuthMock = Pick<AuthState, 'accounts'>;
type CloneModalSettingsMock = Pick<SettingsState, 'openSettingsWindow'>;

let mockRepos: CloneModalReposMock;
let mockAuth: CloneModalAuthMock;

const listCloneableRepos = vi.fn<(params: { accountId: number }) => Promise<CloneableRepo[]>>();

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => mockRepos as unknown as ReposState,
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () =>
        ({
            openSettingsWindow: vi.fn(() => Promise.resolve()),
        }) satisfies CloneModalSettingsMock as unknown as SettingsState,
}));

vi.mock('../../composables/useAuth', () => ({
    useAuth: () => mockAuth as unknown as AuthState,
}));

vi.mock('../../composables/useTasks', () => {
    return {
        tasks: {
            isOperationRunning: vi.fn(() => false),
            listCloneableRepos: {
                run: (params: { accountId: number }) => listCloneableRepos({ accountId: params.accountId }),
                isRunning: () => false,
                errorMessage: undefined,
                clearError: vi.fn(),
            } satisfies CloneListTaskState,
        } as Partial<TasksState>,
    };
});

function createAccount(id: number, label: string, provider: string, authKind: string, username: string | undefined, host: string | undefined, isDefault = false): AccountSummary {
    return {
        id,
        label,
        provider,
        authKind,
        username,
        host,
        hasSecret: authKind !== 'system-git',
        isDefault,
        createdAt: '2026-03-28T00:00:00.000Z',
    };
}

function createMockAuth() {
    return reactive({
        accounts: [
            createAccount(1, 'GitHub Main', 'github', 'oauth', 'octocat', 'github.com', true),
            createAccount(2, 'Enterprise', 'custom', 'https-token', 'enterprise-user', 'git.example.com'),
            createAccount(3, 'System Git', 'system', 'system-git', undefined, undefined),
        ],
    } satisfies CloneModalAuthMock);
}

function createMockRepos() {
    return reactive({
        repoGroups: [
            {
                id: 10,
                name: 'Client Work',
                sequence: 1,
                repoCount: 0,
                createdAt: '2026-03-28T00:00:00.000Z',
            },
        ],
        isCloneRepoModalOpen: true,
        getCloneRepoDefaults: vi.fn(() => Promise.resolve({ parentDirectory: '/tmp/gitvan-clones' })),
        pickCloneRepoDirectory: vi.fn(() => Promise.resolve(undefined)),
        cloneTrackedRepo: vi.fn(() => Promise.resolve()),
    } satisfies CloneModalReposMock);
}

function mountCloneModal() {
    return mount(AppCloneRepositoryModal, {
        global: {
            directives: {
                tooltip: {},
            },
            stubs: {
                Transition: false,
            },
        },
    });
}

describe('AppCloneRepositoryModal', () => {
    beforeEach(() => {
        mockRepos = createMockRepos();
        mockAuth = createMockAuth();
        listCloneableRepos.mockReset();
        listCloneableRepos.mockImplementation(async ({ accountId }) => {
            if (accountId === 1) {
                return [
                    {
                        id: 'octo-repo',
                        name: 'repo-one',
                        fullName: 'octocat/repo-one',
                        ownerLogin: 'octocat',
                        description: 'Main account repository',
                        isPrivate: false,
                        cloneUrl: 'https://github.com/octocat/repo-one.git',
                        defaultBranch: 'main',
                        updatedAt: '2026-03-28T00:00:00.000Z',
                    },
                ];
            }

            return [
                {
                    id: 'enterprise-repo',
                    name: 'secure-repo',
                    fullName: 'platform/secure-repo',
                    ownerLogin: 'platform',
                    description: 'Enterprise repository',
                    isPrivate: true,
                    cloneUrl: 'https://git.example.com/platform/secure-repo.git',
                    defaultBranch: 'main',
                    updatedAt: '2026-03-28T00:00:00.000Z',
                },
            ];
        });
    });

    it('loads repositories for the default GitHub account on open', async () => {
        const wrapper = mountCloneModal();

        await flushPromises();

        expect(mockRepos.getCloneRepoDefaults).toHaveBeenCalledTimes(1);
        expect(listCloneableRepos).toHaveBeenCalledWith({ accountId: 1 });
        expect(wrapper.text()).toContain('GitHub Main');
        expect(wrapper.text()).toContain('octocat/repo-one');
    });

    it('switches to enterprise accounts when the enterprise tab is selected', async () => {
        const wrapper = mountCloneModal();

        await flushPromises();
        wrapper.get('button').findAll('button');

        const enterpriseTab = wrapper.findAll('button').find((entry) => entry.text() === 'GitHub Enterprise');
        await enterpriseTab!.trigger('click');
        await flushPromises();

        expect(listCloneableRepos).toHaveBeenLastCalledWith({ accountId: 2 });
        expect(wrapper.text()).toContain('Enterprise');
        expect(wrapper.text()).toContain('platform/secure-repo');
    });
});
