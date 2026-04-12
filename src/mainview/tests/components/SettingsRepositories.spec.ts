import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive } from 'vue';
import type { Repo } from '../../../shared/gitClient';
import SettingsRepositories from '../../components/SettingsRepositories.vue';
import { useRepo, type RepositoryState } from '../../composables/useRepo';
import { useRepos } from '../../composables/useRepos';
import { tasks } from '../../composables/useTasks';

type ReposState = ReturnType<typeof useRepos>;
type TasksState = typeof tasks;
type SettingsRepositoriesReposMock = Pick<
    ReposState,
    'repos' | 'repoGroups' | 'createRepoGroup' | 'deleteRepoGroup' | 'reorderRepo' | 'moveRepoGroup' | 'renameRepoGroup' | 'updateRepoGroups'
>;

let mockRepos: SettingsRepositoriesReposMock;

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => mockRepos as unknown as ReposState,
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: { isBusy: false } as unknown as TasksState,
}));

function createRepository(id: number, name: string, groupName: string | undefined): Repo {
    return {
        id,
        name,
        path: `/tmp/${name.toLowerCase()}`,
        sequence: id,
        groupId: groupName === 'Work' ? 1 : groupName === 'Personal' ? 2 : undefined,
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

function createMockRepos() {
    const repos: RepositoryState[] = [
        useRepo(createRepository(1, 'Alpha', 'Work')),
        useRepo(createRepository(2, 'Beta', undefined)),
        useRepo(createRepository(3, 'Gamma', 'Personal')),
    ];

    return reactive({
        repos,
        repoGroups: [
            { id: 1, name: 'Work', sequence: 1, repoCount: 1, createdAt: '2026-03-27T00:00:00.000Z' },
            { id: 2, name: 'Personal', sequence: 2, repoCount: 1, createdAt: '2026-03-27T00:00:00.000Z' },
        ],
        createRepoGroup: vi.fn(() => Promise.resolve({ id: 3, name: 'Platform', sequence: 3, repoCount: 0, createdAt: '2026-03-27T00:00:00.000Z' })),
        deleteRepoGroup: vi.fn(() => Promise.resolve()),
        reorderRepo: vi.fn(() => Promise.resolve()),
        moveRepoGroup: vi.fn(() => Promise.resolve()),
        renameRepoGroup: vi.fn(() => Promise.resolve({ id: 1, name: 'Workspace', sequence: 1, repoCount: 1, createdAt: '2026-03-27T00:00:00.000Z' })),
        updateRepoGroups: vi.fn(() => Promise.resolve()),
    } satisfies SettingsRepositoriesReposMock);
}

const buttonStub = defineComponent({
    name: 'Button',
    emits: ['click'],
    template: '<button :disabled="$attrs.disabled" @click="$emit(\'click\', $event)"><slot /></button>',
});

const iconButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    template: '<button :aria-label="$attrs[\'aria-label\']" :disabled="$attrs.disabled" @click="$emit(\'click\', $event)"><slot /></button>',
});

const draggableListStub = defineComponent({
    name: 'DraggableList',
    props: {
        items: {
            type: Array,
            required: true,
        },
        onSelect: {
            type: Function,
            required: true,
        },
        onReorder: {
            type: Function,
            required: true,
        },
    },
    template: `
        <div>
            <div v-for="(entry, index) in items" :key="entry.id">
                <button
                    type="button"
                    @click="onSelect(entry)">
                    {{ entry.title }}
                </button>
                <button
                    type="button"
                    :aria-label="'Reorder ' + entry.title + ' down'"
                    @click="onReorder({ item: entry, fromIndex: index, toIndex: index + 1 })">
                    reorder
                </button>
                <slot name="item-rightIcon" :item="entry"></slot>
            </div>
        </div>
    `,
});

function mountSettingsRepositories() {
    return mount(SettingsRepositories, {
        global: {
            stubs: {
                Button: buttonStub,
                DraggableList: draggableListStub,
                IconButton: iconButtonStub,
                Icon: true,
                Alert: true,
            },
        },
    });
}

describe('SettingsRepositories', () => {
    beforeEach(() => {
        mockRepos = createMockRepos();
    });

    it('creates a group record before repositories are assigned', async () => {
        const wrapper = mountSettingsRepositories();

        await wrapper.get('input[placeholder="Frontend apps"]').setValue('Platform');
        const createButton = wrapper.findAll('button').find((candidate) => candidate.text() === 'Create group');

        expect(createButton).toBeTruthy();
        await createButton!.trigger('click');

        expect(mockRepos.createRepoGroup).toHaveBeenCalledWith('Platform');
    });

    it('updates repository membership using the selected group id', async () => {
        const wrapper = mountSettingsRepositories();

        await wrapper.get('button[aria-label="Open group Work"]').trigger('click');

        const repoButton = wrapper.findAll('button').find((candidate) => candidate.text() === 'Beta');
        expect(repoButton).toBeTruthy();
        await repoButton!.trigger('click');

        const saveButton = wrapper.findAll('button').find((candidate) => candidate.text() === 'Save changes');
        expect(saveButton).toBeTruthy();
        await saveButton!.trigger('click');

        expect(mockRepos.updateRepoGroups).toHaveBeenCalledWith([{ repoId: 2, groupId: 1 }], 'Group Work updated.');
    });

    it('renames an existing group', async () => {
        const wrapper = mountSettingsRepositories();

        await wrapper.get('button[aria-label="Open group Work"]').trigger('click');

        await wrapper.get('input[placeholder="Frontend apps"]').setValue('Workspace');

        const saveButton = wrapper.findAll('button').find((candidate) => candidate.text() === 'Save changes');
        expect(saveButton).toBeTruthy();
        await saveButton!.trigger('click');

        expect(mockRepos.renameRepoGroup).toHaveBeenCalledWith(1, 'Workspace');
    });

    it('moves a group down from the settings list', async () => {
        const wrapper = mountSettingsRepositories();

        await wrapper.get('button[aria-label="Move Work down"]').trigger('click');

        expect(mockRepos.moveRepoGroup).toHaveBeenCalledWith(1, 'down');
    });

    it('deletes the active group from the detail panel', async () => {
        const wrapper = mountSettingsRepositories();

        await wrapper.get('button[aria-label="Open group Work"]').trigger('click');

        const deleteButton = wrapper.findAll('button').find((candidate) => candidate.text() === 'Delete');
        expect(deleteButton).toBeTruthy();
        await deleteButton!.trigger('click');

        expect(mockRepos.deleteRepoGroup).toHaveBeenCalledWith(1);
    });

    it('reorders a repository from the repositories list with one backend call', async () => {
        const wrapper = mountSettingsRepositories();

        await wrapper.get('button[aria-label="Reorder Alpha down"]').trigger('click');

        expect(mockRepos.reorderRepo).toHaveBeenCalledWith(1, 1);
    });

    it('preserves an unsaved group name while repositories refresh in the background', async () => {
        const wrapper = mountSettingsRepositories();

        const input = wrapper.get('input[placeholder="Frontend apps"]');
        await input.setValue('Platform Draft');

        mockRepos.repos = [...mockRepos.repos];
        await nextTick();

        expect((wrapper.get('input[placeholder="Frontend apps"]').element as HTMLInputElement).value).toBe('Platform Draft');
    });
});
