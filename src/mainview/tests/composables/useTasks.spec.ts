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

import { tasks } from '../../composables/useTasks';

type RunnableTask = {
    run: (params: unknown, identifier?: string) => Promise<unknown>;
};

const commitRepo = tasks.commitRepo as unknown as RunnableTask;
const runRemoteOperation = tasks.runRemoteOperation as unknown as RunnableTask;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

describe('useTasks', () => {
    beforeEach(() => {
        requestHandlers.clear();
        tasks.dismissError();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('tracks an operation while it runs and clears it afterwards', async () => {
        const pending = deferred<void>();
        requestHandlers.set('commitRepo', () => pending.promise);

        const running = commitRepo.run({ repoId: 1 });

        expect(tasks.isBusy).toBe(true);
        expect(tasks.isAnyOperationRunning()).toBe(true);
        expect(tasks.isOperationRunning('commitRepo')).toBe(true);
        expect(tasks.getRunningOperation()).toBe('commitRepo');

        pending.resolve();
        await running;

        expect(tasks.isBusy).toBe(false);
        expect(tasks.isAnyOperationRunning()).toBe(false);
        expect(tasks.isOperationRunning('commitRepo')).toBe(false);
        expect(tasks.getRunningOperation()).toBe(null);
    });

    it('keys operations by identifier without marking the bare method as running', async () => {
        const pending = deferred<void>();
        requestHandlers.set('runRemoteOperation', () => pending.promise);

        const running = runRemoteOperation.run({ repoId: 7, operation: 'fetch' }, 'fetch-7');

        expect(tasks.isOperationRunning('runRemoteOperation:fetch-7')).toBe(true);
        expect(tasks.isOperationRunning('runRemoteOperation:fetch-8')).toBe(false);
        expect(tasks.isOperationRunning('runRemoteOperation')).toBe(false);
        expect(tasks.getRunningOperation()).toBe('runRemoteOperation:fetch-7');

        pending.resolve();
        await running;

        expect(tasks.isOperationRunning('runRemoteOperation:fetch-7')).toBe(false);
    });

    it('captures the message of a rejected operation and clears it on demand', async () => {
        requestHandlers.set('commitRepo', async () => {
            throw new Error('commit failed');
        });

        await expect(commitRepo.run({ repoId: 1 })).rejects.toThrow('commit failed');

        expect(tasks.errorMessage).toBe('commit failed');
        expect(tasks.isBusy).toBe(false);

        tasks.dismissError();

        expect(tasks.errorMessage).toBeUndefined();
    });

    it('clears the previous error when the same operation runs again', async () => {
        requestHandlers.set('commitRepo', async () => {
            throw new Error('first failure');
        });
        await expect(commitRepo.run({ repoId: 1 })).rejects.toThrow('first failure');
        expect(tasks.errorMessage).toBe('first failure');

        requestHandlers.set('commitRepo', async () => undefined);
        await commitRepo.run({ repoId: 1 });

        expect(tasks.errorMessage).toBeUndefined();
    });

    it('marks an operation as long running only after the threshold', async () => {
        vi.useFakeTimers();
        const pending = deferred<void>();
        requestHandlers.set('commitRepo', () => pending.promise);

        const running = commitRepo.run({ repoId: 1 });

        expect(tasks.isAnyLongRunningOperation()).toBe(false);
        expect(tasks.getLongRunningOperation).toBe(null);

        await vi.advanceTimersByTimeAsync(500);

        expect(tasks.isAnyLongRunningOperation()).toBe(true);
        expect(tasks.getLongRunningOperation).toBe('commitRepo');

        pending.resolve();
        await running;

        expect(tasks.isAnyLongRunningOperation()).toBe(false);
    });

    it('drops the pending long-running timer when the operation finishes first', async () => {
        vi.useFakeTimers();
        const pending = deferred<void>();
        requestHandlers.set('commitRepo', () => pending.promise);

        const running = commitRepo.run({ repoId: 1 });

        pending.resolve();
        await running;

        expect(vi.getTimerCount()).toBe(0);
        expect(tasks.isAnyLongRunningOperation()).toBe(false);
    });
});
