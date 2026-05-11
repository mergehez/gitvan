import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, resolveDev2ApiBase } from '../../lib/gitClientDev2';

describe('gitClientDev2', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('builds a direct backend url from the current hostname by default', () => {
        expect(resolveDev2ApiBase()).toBe(`http://${window.location.hostname}:5174/api`);
    });

    it('uses the configured backend base when provided', () => {
        vi.stubEnv('VITE_DEV2_API_BASE', 'http://127.0.0.1:9999/api/');

        expect(resolveDev2ApiBase()).toBe('http://127.0.0.1:9999/api');
    });

    it('fails timed out requests instead of hanging forever', async () => {
        vi.useFakeTimers();

        globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            return new Promise((_, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(init.signal?.reason ?? new Error('aborted'));
                });
            });
        }) as unknown as typeof fetch;

        const requestExpectation = expect(invoke('getBootstrap')).rejects.toThrow('Backend request "getBootstrap" timed out after 75000ms.');

        await vi.advanceTimersByTimeAsync(75_000);

        await requestExpectation;
    });
});
