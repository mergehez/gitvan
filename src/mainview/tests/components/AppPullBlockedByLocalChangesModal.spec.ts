import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import AppPullBlockedByLocalChangesModal from '../../components/AppPullBlockedByLocalChangesModal.vue';

type ReposState = {
    repos: Array<{ id: number; name: string }>;
    pullBlockedRepoId: number | undefined;
    pullBlockedConflictingFiles: string[];
    isPullBlockedByLocalChangesModalOpen: boolean;
    closePullBlockedByLocalChangesModal: () => void;
    retryPullAfterStash: () => Promise<void>;
};

let mockRepos: ReposState;

vi.mock('../../composables/useRepos.ts', () => ({
    useRepos: () => mockRepos,
}));

vi.mock('../../composables/useTasks.ts', () => ({
    tasks: {
        retryPullAfterStash: {
            isRunning: () => false,
        },
    },
}));

const centeredModalStub = defineComponent({
    name: 'CenteredModal',
    props: {
        open: { type: Boolean, required: true },
        title: { type: String, required: false },
    },
    template: '<section v-if="open"><slot /></section>',
});

function mountModal() {
    return mount(AppPullBlockedByLocalChangesModal, {
        global: {
            directives: {
                loading: {},
            },
            stubs: {
                CenteredModal: centeredModalStub,
            },
        },
    });
}

function conflictingPaths(count: number) {
    return Array.from({ length: count }, (_, index) => `Portal/Services/Service${index + 1}.cs`);
}

describe('AppPullBlockedByLocalChangesModal', () => {
    beforeEach(() => {
        mockRepos = reactive({
            repos: [{ id: 1, name: 'Portal' }],
            pullBlockedRepoId: 1,
            pullBlockedConflictingFiles: conflictingPaths(3),
            isPullBlockedByLocalChangesModalOpen: true,
            closePullBlockedByLocalChangesModal: () => undefined,
            retryPullAfterStash: async () => undefined,
        });
    });

    it('lists every conflicting file instead of collapsing the tail', () => {
        const paths = conflictingPaths(9);
        mockRepos.pullBlockedConflictingFiles = paths;

        const wrapper = mountModal();

        for (const path of paths) {
            expect(wrapper.text()).toContain(path);
        }

        expect(wrapper.text()).not.toContain('more files');
    });

    it('keeps listing all files just past the previous collapse threshold', () => {
        const paths = conflictingPaths(5);
        mockRepos.pullBlockedConflictingFiles = paths;

        const wrapper = mountModal();

        expect(wrapper.text()).toContain(paths[4]);
        expect(wrapper.text()).not.toContain('more files');
    });
});
