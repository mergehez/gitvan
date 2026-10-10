import { afterEach, describe, expect, it, vi } from 'vitest';

// The module reads the ports from `process.env` at import time, so each case resets the registry
// and asks for a fresh copy after setting the environment it wants to test.
function freshImport() {
    vi.resetModules();

    return import('../../../../electronUtils/helpers.js');
}

function jsonResponse(payload: unknown) {
    return { ok: true, json: () => Promise.resolve(payload) };
}

describe('appConfig', () => {
    afterEach(() => {
        delete process.env.GITVAN_VUE_PORT;
        delete process.env.GITVAN_API_PORT;
    });

    it('derives the backend urls from the packaged ports by default', async () => {
        const { appConfig } = await freshImport();

        expect(appConfig).toMatchObject({
            appName: 'Gitvan',
            projectName: 'gitvan',
            vuePort: 5177,
            apiPort: 5176,
            vueBaseUrl: 'http://127.0.0.1:5177',
            apiBaseUrl: 'http://127.0.0.1:5176',
        });
    });

    it('honours valid port overrides', async () => {
        process.env.GITVAN_VUE_PORT = '5277';
        process.env.GITVAN_API_PORT = '5276';

        const { appConfig } = await freshImport();

        expect(appConfig).toMatchObject({ vuePort: 5277, apiPort: 5276, apiBaseUrl: 'http://127.0.0.1:5276' });
    });

    it.each(['', 'not-a-number', '0', '-1', '70000'])('keeps the packaged port for the invalid override %j', async (override) => {
        process.env.GITVAN_VUE_PORT = override;

        const { appConfig } = await freshImport();

        expect(appConfig.vuePort).toBe(5177);
    });
});

describe('callApiPost', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts the JSON params to the backend url with a request timeout', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ done: true }));
        vi.stubGlobal('fetch', fetchSpy);
        const { appConfig, apiRequestTimeoutMs, callApiPost } = await freshImport();

        await expect(callApiPost('stageFile', { repoId: 3 })).resolves.toEqual({ done: true });

        expect(apiRequestTimeoutMs).toBe(12 * 60_000);
        expect(fetchSpy).toHaveBeenCalledWith(`${appConfig.apiBaseUrl}/api/stageFile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoId: 3 }),
            signal: expect.any(AbortSignal),
        });
    });

    it('sends no body when the method was called without params', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(null));
        vi.stubGlobal('fetch', fetchSpy);
        const { callApiPost } = await freshImport();

        await callApiPost('loadRepos');

        expect(fetchSpy.mock.calls[0][1].body).toBeUndefined();
    });

    it('sends an explicit undefined-compatible body only for real params', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(null));
        vi.stubGlobal('fetch', fetchSpy);
        const { callApiPost } = await freshImport();

        await callApiPost('loadRepos', false);

        expect(fetchSpy.mock.calls[0][1].body).toBe('false');
    });

    it('throws an error carrying the status and the response text for a failed request', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('backend exploded') }));
        const { callApiPost } = await freshImport();

        await expect(callApiPost('loadRepos')).rejects.toThrow('Backend error (500): backend exploded');
    });

    it('lets a network failure surface as-is', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
        const { callApiPost } = await freshImport();

        await expect(callApiPost('loadRepos')).rejects.toThrow('connect ECONNREFUSED');
    });
});
