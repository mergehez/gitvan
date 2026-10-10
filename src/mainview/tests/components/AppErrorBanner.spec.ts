import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestHandlers } = vi.hoisted(() => ({ requestHandlers: new Map<string, (...args: unknown[]) => unknown>() }));

vi.mock('../../appClient.ts', () => ({
    appClientRpc: {
        request: new Proxy(
            {},
            {
                get:
                    (_target, method: string) =>
                    (...args: unknown[]) => {
                        const handler = requestHandlers.get(method);
                        if (!handler) {
                            throw new Error(`No request handler was registered for ${method}.`);
                        }

                        return handler(...args);
                    },
            }
        ),
    },
}));

import AppErrorBanner from '../../components/AppErrorBanner.vue';
import { tasks } from '../../composables/useTasks';

type RunnableTask = {
    run: (params: unknown, identifier?: string) => Promise<unknown>;
};

const commitRepo = tasks.commitRepo as unknown as RunnableTask;
const runRemoteOperation = tasks.runRemoteOperation as unknown as RunnableTask;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });

    return { promise, resolve };
}

async function failCommit(message: string) {
    requestHandlers.set('commitRepo', async () => {
        throw new Error(message);
    });

    await expect(commitRepo.run({ repoId: 1 })).rejects.toThrow(message);
}

beforeEach(() => {
    requestHandlers.clear();
    tasks.dismissError();
});

afterEach(() => {
    tasks.dismissError();
});

describe('AppErrorBanner', () => {
    it('renders nothing while no operation has failed', () => {
        const wrapper = mount(AppErrorBanner);

        expect(wrapper.find('#app-error-banner').exists()).toBe(false);
    });

    it('shows the failed message and clears it when dismissed', async () => {
        await failCommit('commit failed');

        const wrapper = mount(AppErrorBanner);

        expect(wrapper.get('#app-error-banner').text()).toContain('commit failed');

        await wrapper.get('button').trigger('click');

        expect(tasks.errorMessage).toBeUndefined();
        expect(wrapper.find('#app-error-banner').exists()).toBe(false);
    });

    it('disables the dismiss button while another operation runs', async () => {
        await failCommit('commit failed');

        const pending = deferred<void>();
        requestHandlers.set('runRemoteOperation', () => pending.promise);
        const running = runRemoteOperation.run({ repoId: 2, operation: 'fetch' }, 'fetch-2');

        const wrapper = mount(AppErrorBanner);
        expect(wrapper.get('button').attributes('disabled')).toBeDefined();

        pending.resolve();
        await running;
    });
});
