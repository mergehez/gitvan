import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defineComponent, reactive } from 'vue';
import AppPushRejectedModal from '../../components/AppPushRejectedModal.vue';

type Repo = {
    id: number;
    name: string;
    status: { branch: string; behind: number; ahead: number };
};

type ReposState = {
    repos: Repo[];
    pushRejectedRepoId: number | undefined;
    isPushRejectedModalOpen: boolean;
    closePushRejectedModal: () => void;
    runRepoRemoteOperation: (repoId: number, operation: string) => Promise<void>;
};

let mockRepos: ReposState;

vi.mock('../../composables/useRepos.ts', () => ({
    useRepos: () => mockRepos,
}));

const centeredModalStub = defineComponent({
    name: 'CenteredModal',
    props: {
        open: { type: Boolean, required: true },
        title: { type: String, required: false },
    },
    template: '<section v-if="open"><slot /></section>',
});

function createRepo(behind: number): Repo {
    return { id: 1, name: 'EezyAPI', status: { branch: 'v1', behind, ahead: 2 } };
}

function mountModal() {
    return mount(AppPushRejectedModal, {
        global: {
            stubs: {
                CenteredModal: centeredModalStub,
            },
        },
    });
}

describe('AppPushRejectedModal', () => {
    let closePushRejectedModal: Mock<() => void>;
    let runRepoRemoteOperation: Mock<(repoId: number, operation: string) => Promise<void>>;

    beforeEach(() => {
        closePushRejectedModal = vi.fn<() => void>();
        runRepoRemoteOperation = vi.fn<(repoId: number, operation: string) => Promise<void>>(async () => undefined);
        mockRepos = reactive({
            repos: [createRepo(1)],
            pushRejectedRepoId: 1,
            isPushRejectedModalOpen: true,
            closePushRejectedModal,
            runRepoRemoteOperation,
        });
    });

    it('names the repository and how far behind its branch is', () => {
        const wrapper = mountModal();

        expect(wrapper.text()).toContain('EezyAPI');
        expect(wrapper.text()).toContain('v1');
        expect(wrapper.text()).toContain('1 commit behind');
        expect(wrapper.text()).toContain('Pull');
    });

    it('still explains the rejection when the fetch found no behind count', () => {
        mockRepos.repos = [createRepo(0)];

        const wrapper = mountModal();

        expect(wrapper.text()).toContain('behind its remote counterpart');
        expect(wrapper.get('button:last-of-type').text()).toContain('Pull');
    });

    it('pulls the announced repository and closes itself', async () => {
        const wrapper = mountModal();

        const pullButton = wrapper.findAll('button').find((button) => button.text().includes('Pull'));
        await pullButton?.trigger('click');

        expect(closePushRejectedModal).toHaveBeenCalledTimes(1);
        expect(runRepoRemoteOperation).toHaveBeenCalledWith(1, 'pull');
    });

    it('closes without touching the remote', async () => {
        const wrapper = mountModal();

        const closeButton = wrapper.findAll('button').find((button) => button.text().includes('Close'));
        await closeButton?.trigger('click');

        expect(closePushRejectedModal).toHaveBeenCalledTimes(1);
        expect(runRepoRemoteOperation).not.toHaveBeenCalled();
    });
});
