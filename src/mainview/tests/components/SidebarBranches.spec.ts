import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarBranches from '../../components/SidebarBranches.vue';

const fileTreeStub = defineComponent({
    name: 'FileTree',
    props: {
        item: {
            type: Object,
            required: true,
        },
    },
    template: '<section><div>{{ item.title }}</div><slot name="header-actions" :item="item" /></section>',
});

const iconButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

const centeredInputModalStub = defineComponent({
    name: 'CenteredInputModal',
    template: '<div />',
});

type SidebarRepoMock = {
    id: number;
    status: {
        lastScannedAt: string | undefined;
    };
    branches: {
        currentBranch: string | undefined;
        local: Array<{
            name: string;
            refName: string;
            kind: 'local';
            isCurrent: boolean;
            upstream: string | undefined;
            ahead: number;
            behind: number;
            commit: string | undefined;
            subject: string | undefined;
        }>;
        remote: Array<{
            name: string;
            refName: string;
            kind: 'remote';
            isCurrent: boolean;
            upstream: string | undefined;
            ahead: number;
            behind: number;
            commit: string | undefined;
            subject: string | undefined;
        }>;
    };
    loadBranches: ReturnType<typeof vi.fn>;
    checkoutBranch: ReturnType<typeof vi.fn>;
    createBranch: ReturnType<typeof vi.fn>;
    createRemoteBranch: ReturnType<typeof vi.fn>;
};

let selectedRepo: SidebarRepoMock;

vi.mock('../../composables/useRepos.ts', () => ({
    useRepos: () => ({
        getSelectedRepo: () => selectedRepo,
    }),
}));

vi.mock('../../composables/useTasks.ts', () => ({
    tasks: {
        isBusy: false,
        isOperationRunning: () => false,
    },
}));

function mountView() {
    return mount(SidebarBranches, {
        global: {
            stubs: {
                FileTree: fileTreeStub,
                IconButton: iconButtonStub,
                CenteredInputModal: centeredInputModalStub,
            },
        },
    });
}

describe('SidebarBranches', () => {
    beforeEach(() => {
        selectedRepo = reactive({
            id: 1,
            status: {
                lastScannedAt: '2026-04-06T09:00:00.000Z',
            },
            branches: {
                currentBranch: 'main',
                local: [],
                remote: [],
            },
            loadBranches: vi.fn(async () => undefined),
            checkoutBranch: vi.fn(async () => undefined),
            createBranch: vi.fn(async () => undefined),
            createRemoteBranch: vi.fn(async () => undefined),
        }) as SidebarRepoMock;
    });

    it('loads branches on open and when the repository scan changes', async () => {
        mountView();

        await flushPromises();
        expect(selectedRepo.loadBranches).toHaveBeenCalledTimes(1);

        selectedRepo.loadBranches.mockClear();
        selectedRepo.status.lastScannedAt = '2026-04-06T09:01:00.000Z';

        await flushPromises();
        expect(selectedRepo.loadBranches).toHaveBeenCalledTimes(1);
    });
});
