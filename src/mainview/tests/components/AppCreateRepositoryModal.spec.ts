import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import AppCreateRepositoryModal from '../../components/AppCreateRepositoryModal.vue';
import type { useRepos } from '../../composables/useRepos';
import type { tasks } from '../../composables/useTasks';

type ReposState = ReturnType<typeof useRepos>;
type TasksState = typeof tasks;
type CreateModalReposMock = Pick<ReposState, 'repoGroups' | 'isCreateRepoModalOpen' | 'getCloneRepoDefaults' | 'pickCloneRepoDirectory' | 'createTrackedLocalRepo'>;

let mockRepos: CreateModalReposMock;

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => mockRepos as unknown as ReposState,
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        isOperationRunning: vi.fn(() => false),
    } as unknown as TasksState,
}));

function createMockRepos() {
    return reactive({
        repoGroups: [
            { id: 10, name: 'Client Work', sequence: 1, repoCount: 0, createdAt: '2026-03-28T00:00:00.000Z' },
            { id: 11, name: 'Personal', sequence: 2, repoCount: 0, createdAt: '2026-03-28T00:00:00.000Z' },
        ],
        isCreateRepoModalOpen: true,
        getCloneRepoDefaults: vi.fn(() => Promise.resolve({ parentDirectory: '/tmp/gitvan-repos' })),
        pickCloneRepoDirectory: vi.fn(() => Promise.resolve(undefined as string | undefined)),
        createTrackedLocalRepo: vi.fn(() => Promise.resolve()),
    } satisfies CreateModalReposMock);
}

function mountCreateModal() {
    return mount(AppCreateRepositoryModal, {
        global: {
            directives: {
                loading: {},
                tooltip: {},
            },
            stubs: {
                Transition: false,
            },
        },
    });
}

describe('AppCreateRepositoryModal', () => {
    beforeEach(() => {
        mockRepos = createMockRepos();
    });

    it('loads the default local path and the repository groups when it opens', async () => {
        const wrapper = mountCreateModal();

        await flushPromises();

        expect(mockRepos.getCloneRepoDefaults).toHaveBeenCalledTimes(1);
        expect((wrapper.get('#create-repository-directory').element as HTMLInputElement).value).toBe('/tmp/gitvan-repos');

        const groupOptions = wrapper.findAll('#create-group-select option');
        expect(groupOptions.map((option) => option.text())).toEqual(['No group', 'Client Work', 'Personal']);
    });

    it('gates the Create Repository button until a name and a local path are present', async () => {
        mockRepos.getCloneRepoDefaults = vi.fn(() => Promise.resolve({ parentDirectory: '' }));

        const wrapper = mountCreateModal();
        await flushPromises();

        const createButton = wrapper.findAll('button').find((button) => button.text() === 'Create Repository')!;
        expect(createButton.attributes('disabled')).toBeDefined();

        await wrapper.get('#create-repository-name').setValue('my-new-repository');
        expect(createButton.attributes('disabled')).toBeDefined();

        await wrapper.get('#create-repository-directory').setValue('/tmp/repos');
        expect(createButton.attributes('disabled')).toBeUndefined();
    });

    it('previews the destination path once both fields are filled', async () => {
        const wrapper = mountCreateModal();
        await flushPromises();

        expect(wrapper.text()).not.toContain('Repository will be created at');

        await wrapper.get('#create-repository-name').setValue('demo-app');
        await wrapper.get('#create-repository-directory').setValue('/tmp/repos/');

        expect(wrapper.text()).toContain('Repository will be created at');
        expect(wrapper.text()).toContain('/tmp/repos/demo-app');
    });

    it('creates the repository with the typed name, path and selected group', async () => {
        const wrapper = mountCreateModal();
        await flushPromises();

        await wrapper.get('#create-repository-name').setValue('my-new-repository');
        await wrapper.get('#create-repository-directory').setValue('/tmp/repos');
        await wrapper.get('#create-group-select').setValue('11');
        await flushPromises();

        const createButton = wrapper.findAll('button').find((button) => button.text() === 'Create Repository')!;
        await createButton.trigger('click');
        await flushPromises();

        expect(mockRepos.createTrackedLocalRepo).toHaveBeenCalledWith({
            name: 'my-new-repository',
            parentDirectory: '/tmp/repos',
            groupId: 11,
        });
    });

    it('does not create anything while the form is incomplete', async () => {
        mockRepos.getCloneRepoDefaults = vi.fn(() => Promise.resolve({ parentDirectory: '' }));

        const wrapper = mountCreateModal();
        await flushPromises();

        await wrapper.get('#create-repository-name').setValue('my-new-repository');

        const createButton = wrapper.findAll('button').find((button) => button.text() === 'Create Repository')!;
        await createButton.trigger('click');
        await flushPromises();

        expect(mockRepos.createTrackedLocalRepo).not.toHaveBeenCalled();
    });

    it('fills the local path from the native directory picker', async () => {
        mockRepos.pickCloneRepoDirectory = vi.fn((defaultPath?: string) => Promise.resolve(`/tmp/picked/${defaultPath?.split('/').pop() ?? 'none'}`));

        const wrapper = mountCreateModal();
        await flushPromises();

        const chooseButton = wrapper.findAll('button').find((button) => button.text() === 'Choose...')!;
        await chooseButton.trigger('click');
        await flushPromises();

        expect(mockRepos.pickCloneRepoDirectory).toHaveBeenCalledWith('/tmp/gitvan-repos');
        expect((wrapper.get('#create-repository-directory').element as HTMLInputElement).value).toBe('/tmp/picked/gitvan-repos');
    });

    it('keeps the local path when the directory picker is dismissed', async () => {
        const wrapper = mountCreateModal();
        await flushPromises();

        const chooseButton = wrapper.findAll('button').find((button) => button.text() === 'Choose...')!;
        await chooseButton.trigger('click');
        await flushPromises();

        expect(mockRepos.pickCloneRepoDirectory).toHaveBeenCalledWith('/tmp/gitvan-repos');
        expect((wrapper.get('#create-repository-directory').element as HTMLInputElement).value).toBe('/tmp/gitvan-repos');
    });

    it('closes the modal from the Cancel button', async () => {
        const wrapper = mountCreateModal();
        await flushPromises();

        const cancelButton = wrapper.findAll('button').find((button) => button.text() === 'Cancel')!;
        await cancelButton.trigger('click');

        expect(mockRepos.isCreateRepoModalOpen).toBe(false);
    });

    it('clears the form and reloads the defaults the next time it opens', async () => {
        mockRepos.isCreateRepoModalOpen = false;

        const wrapper = mountCreateModal();
        await flushPromises();

        expect(wrapper.find('#create-repository-name').exists()).toBe(false);

        mockRepos.isCreateRepoModalOpen = true;
        await nextTick();
        await flushPromises();

        expect(mockRepos.getCloneRepoDefaults).toHaveBeenCalledTimes(1);
        expect((wrapper.get('#create-repository-directory').element as HTMLInputElement).value).toBe('/tmp/gitvan-repos');

        await wrapper.get('#create-repository-name').setValue('leftover');

        mockRepos.isCreateRepoModalOpen = false;
        await nextTick();
        mockRepos.isCreateRepoModalOpen = true;
        await nextTick();
        await flushPromises();

        expect(mockRepos.getCloneRepoDefaults).toHaveBeenCalledTimes(2);
        expect((wrapper.get('#create-repository-name').element as HTMLInputElement).value).toBe('');
    });
});
