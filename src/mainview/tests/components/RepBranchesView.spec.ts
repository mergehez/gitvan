import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import type { BranchesData, Repo } from '../../../shared/gitClient';
import RepBranchesView from '../../components/RepBranchesView.vue';
import type { useRepos } from '../../composables/useRepos';
import type { tasks as tasksType } from '../../composables/useTasks';

type ReposState = ReturnType<typeof useRepos>;
type TasksState = typeof tasksType;
type BranchesViewRepoMock = Repo & {
    branches: BranchesData;
    newBranchName: string;
    newRemoteBranchName: string;
    createBranch: ReturnType<typeof vi.fn>;
    createRemoteBranch: ReturnType<typeof vi.fn>;
    checkoutBranch: ReturnType<typeof vi.fn>;
};

let selectedRepo: BranchesViewRepoMock;
let mockTasks: Pick<TasksState, 'isBusy'>;

vi.mock('../../composables/useRepos', () => ({
    useRepos: () =>
        ({
            getSelectedRepo: () => selectedRepo,
        }) as unknown as ReposState,
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: new Proxy(
        {},
        {
            get(_target, propertyKey) {
                return mockTasks[propertyKey as keyof typeof mockTasks];
            },
        },
    ),
}));

const fileTreeStub = defineComponent({
    name: 'FileTree',
    props: {
        item: {
            type: Object,
            required: true,
        },
    },
    template: `
        <section>
            <header><slot name="header-actions" /></header>
            <div>{{ item.title }}</div>
        </section>
    `,
});

const buttonStub = defineComponent({
    name: 'Button',
    emits: ['click'],
    props: {
        disabled: {
            type: Boolean,
            default: false,
        },
    },
    template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const iconButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    props: {
        disabled: {
            type: Boolean,
            default: false,
        },
    },
    template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

function createRepo(): BranchesViewRepoMock {
    return reactive({
        id: 1,
        name: 'Alpha',
        path: '/tmp/alpha',
        sequence: 1,
        groupId: undefined,
        groupName: undefined,
        accountId: undefined,
        accountLabel: undefined,
        terminalPath: undefined,
        addedAt: '2026-04-01T00:00:00.000Z',
        lastOpenedAt: undefined,
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
        branches: {
            currentBranch: 'main',
            local: [],
            remote: [],
        },
        newBranchName: '',
        newRemoteBranchName: 'release/1.0',
        createBranch: vi.fn(),
        createRemoteBranch: vi.fn(),
        checkoutBranch: vi.fn(),
    }) as BranchesViewRepoMock;
}

function mountView() {
    return mount(RepBranchesView, {
        global: {
            stubs: {
                FileTree: fileTreeStub,
                Button: buttonStub,
                IconButton: iconButtonStub,
            },
            directives: {
                tooltip: {},
            },
        },
    });
}

describe('RepBranchesView', () => {
    beforeEach(() => {
        selectedRepo = createRepo();
        mockTasks = reactive({
            isBusy: false,
        });
    });

    it('creates a remote branch from the remote branches header action', async () => {
        const wrapper = mountView();

        const inputs = wrapper.findAll('input');
        expect(inputs).toHaveLength(2);
        await inputs[1]!.setValue('release/1.0');

        const buttons = wrapper.findAll('button');
        expect(buttons).toHaveLength(2);
        await buttons[1]!.trigger('click');

        expect(selectedRepo.createRemoteBranch).toHaveBeenCalledTimes(1);
    });
});
