import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollOAuthDeviceSession, startOAuthDeviceSession, verifyProviderAccessToken } from '../../../../backend/services/oauth.js';
import type { OAuthProviderSettings } from '../../../../shared/types.js';

type QueuedResponse = { body: unknown; status?: number };

let queuedResponses: QueuedResponse[] = [];
let fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
let sessionCounter = 0;

const githubSettings: OAuthProviderSettings = { githubClientId: 'github-client', gitlabClientId: '', gitlabHost: '' };
const startParams = { provider: 'github' as const, label: 'Work', setAsDefault: true };

const deviceFlowBody = {
    device_code: 'device-code',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    interval: 5,
    expires_in: 900,
};

function queue(body: unknown, status = 200) {
    queuedResponses.push({ body, status });
}

function startSession(settings: OAuthProviderSettings = githubSettings, params = startParams) {
    queue(deviceFlowBody);
    return startOAuthDeviceSession(settings, params);
}

beforeEach(() => {
    queuedResponses = [];
    fetchCalls = [];
    sessionCounter = 0;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.stubGlobal('crypto', { randomUUID: () => `session-${++sessionCounter}` });
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: unknown, init?: RequestInit) => {
            fetchCalls.push({ url: String(url), init });

            const next = queuedResponses.shift();
            if (!next) {
                throw new Error(`No queued response for ${String(url)}`);
            }

            const status = next.status ?? 200;
            return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(next.body) } as unknown as Response;
        })
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('startOAuthDeviceSession', () => {
    it('starts a GitHub device flow and returns the code the user has to enter', async () => {
        const result = await startSession();

        expect(result).toMatchObject({
            sessionId: 'session-1',
            provider: 'github',
            userCode: 'ABCD-1234',
            verificationUri: 'https://github.com/login/device',
            intervalSeconds: 5,
            expiresAt: new Date('2026-01-01T00:15:00.000Z').toISOString(),
        });

        expect(fetchCalls.map((call) => call.url)).toEqual(['https://github.com/login/device/code']);
        expect(String(fetchCalls[0]!.init?.body)).toContain('client_id=github-client');
    });

    it('starts a GitLab device flow against the configured host', async () => {
        queue({ device_code: 'dc', user_code: 'WXYZ-9876', verification_uri: 'https://gitlab.example.com/oauth/device', interval: 10, expires_in: 300 });

        const result = await startOAuthDeviceSession(
            { githubClientId: '', gitlabClientId: 'gitlab-client', gitlabHost: 'gitlab.example.com' },
            { provider: 'gitlab', label: '', setAsDefault: false }
        );

        expect(result.sessionId).toBe('session-1');
        expect(result.intervalSeconds).toBe(10);
        expect(fetchCalls[0]!.url).toBe('https://gitlab.example.com/oauth/authorize_device');
        expect(String(fetchCalls[0]!.init?.body)).toContain('client_id=gitlab-client');
    });

    it('refuses to start a GitHub flow without a client id', async () => {
        await expect(startOAuthDeviceSession({ githubClientId: '   ', gitlabClientId: '', gitlabHost: '' }, startParams)).rejects.toThrow(/Configure a GitHub OAuth client ID/);
        expect(fetchCalls).toHaveLength(0);
    });

    it('refuses to start a GitLab flow without a host', async () => {
        await expect(startOAuthDeviceSession({ githubClientId: '', gitlabClientId: 'client', gitlabHost: '' }, { ...startParams, provider: 'gitlab' })).rejects.toThrow(
            /Configure the GitLab host/
        );
        expect(fetchCalls).toHaveLength(0);
    });
});

describe('pollOAuthDeviceSession', () => {
    it('reports pending until the provider hands over a token', async () => {
        const session = await startSession();

        queue({ error: 'authorization_pending' });
        await expect(pollOAuthDeviceSession(session.sessionId)).resolves.toEqual({ status: 'pending' });

        vi.advanceTimersByTime(session.intervalSeconds * 1000);
        queue({ access_token: 'gh-token' });
        queue({ login: 'octocat', name: 'The Octocat' });

        const completed = await pollOAuthDeviceSession(session.sessionId);

        expect(completed).toEqual({
            status: 'completed',
            account: {
                provider: 'github',
                label: 'Work',
                setAsDefault: true,
                username: 'octocat',
                host: 'github.com',
                secret: {
                    kind: 'oauth',
                    provider: 'github',
                    accessToken: 'gh-token',
                    refreshToken: undefined,
                    expiresAt: undefined,
                },
            },
        });
    });

    it('answers a poll that arrives before the interval locally', async () => {
        const session = await startSession();

        queue({ error: 'authorization_pending' });
        await pollOAuthDeviceSession(session.sessionId);
        expect(fetchCalls).toHaveLength(2);

        // Too soon: the provider is not called again.
        await expect(pollOAuthDeviceSession(session.sessionId)).resolves.toEqual({ status: 'pending' });
        expect(fetchCalls).toHaveLength(2);

        vi.advanceTimersByTime(4999);
        await pollOAuthDeviceSession(session.sessionId);
        expect(fetchCalls).toHaveLength(2);

        vi.advanceTimersByTime(1);
        queue({ error: 'authorization_pending' });
        await pollOAuthDeviceSession(session.sessionId);
        expect(fetchCalls).toHaveLength(3);
    });

    it('waits out the longer interval after a slow_down', async () => {
        const session = await startSession();

        queue({ error: 'slow_down' });
        await pollOAuthDeviceSession(session.sessionId);
        expect(fetchCalls).toHaveLength(2);

        // The old five second cadence is no longer enough.
        vi.advanceTimersByTime(5000);
        await pollOAuthDeviceSession(session.sessionId);
        expect(fetchCalls).toHaveLength(2);

        vi.advanceTimersByTime(5000);
        queue({ error: 'authorization_pending' });
        await pollOAuthDeviceSession(session.sessionId);
        expect(fetchCalls).toHaveLength(3);
    });

    it('rejects a session that is no longer known', async () => {
        await expect(pollOAuthDeviceSession('missing')).rejects.toThrow(/could not be found/);
    });

    it('expires a session whose device code ran out', async () => {
        queue({ ...deviceFlowBody, expires_in: 1 });
        const session = await startOAuthDeviceSession(githubSettings, startParams);

        vi.advanceTimersByTime(1000);

        await expect(pollOAuthDeviceSession(session.sessionId)).rejects.toThrow(/expired/);
        // The expired session is gone, so the next poll no longer finds it.
        await expect(pollOAuthDeviceSession(session.sessionId)).rejects.toThrow(/could not be found/);
    });

    it('drops an abandoned session when the next one starts', async () => {
        queue({ ...deviceFlowBody, expires_in: 1 });
        const abandoned = await startOAuthDeviceSession(githubSettings, startParams);

        vi.advanceTimersByTime(2000);

        const fresh = await startSession();
        expect(fresh.sessionId).toBe('session-2');

        // The sweep removed it, so it is unknown rather than merely expired.
        await expect(pollOAuthDeviceSession(abandoned.sessionId)).rejects.toThrow(/could not be found/);
    });

    it('reports a denied sign-in and forgets the session', async () => {
        const session = await startSession();

        queue({ error: 'access_denied', error_description: 'The user denied the request' });
        await expect(pollOAuthDeviceSession(session.sessionId)).rejects.toThrow(/canceled/);

        await expect(pollOAuthDeviceSession(session.sessionId)).rejects.toThrow(/could not be found/);
    });

    it('forgets a session the provider says has expired', async () => {
        const session = await startSession();

        queue({ error: 'expired_token' });
        await expect(pollOAuthDeviceSession(session.sessionId)).rejects.toThrow(/expired/);

        await expect(pollOAuthDeviceSession(session.sessionId)).rejects.toThrow(/could not be found/);
    });

    it('throws the provider description for an unexpected device error', async () => {
        const session = await startSession();

        queue({ error: 'incorrect_device_code', error_description: 'That code is wrong' });
        await expect(pollOAuthDeviceSession(session.sessionId)).rejects.toThrow('That code is wrong');
    });
});

describe('verifyProviderAccessToken', () => {
    it('verifies a GitHub token against the user endpoint', async () => {
        queue({ login: 'octocat', name: 'The Octocat' });

        await expect(verifyProviderAccessToken({ provider: 'github', username: undefined, host: undefined, accessToken: 'gh-token' })).resolves.toEqual({
            username: 'octocat',
            labelSuggestion: 'The Octocat',
            host: 'github.com',
        });
        expect(fetchCalls[0]!.url).toBe('https://api.github.com/user');
        expect((fetchCalls[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer gh-token');
    });

    it('falls back to the login when GitHub returns no name', async () => {
        queue({ login: 'octocat' });

        await expect(verifyProviderAccessToken({ provider: 'github', username: undefined, host: undefined, accessToken: 'gh-token' })).resolves.toMatchObject({
            username: 'octocat',
            labelSuggestion: 'octocat',
        });
    });

    it('reports a rejected token', async () => {
        queue({ message: 'Bad credentials' }, 401);

        await expect(verifyProviderAccessToken({ provider: 'github', username: undefined, host: undefined, accessToken: 'bad' })).rejects.toThrow(/verification failed\. \(401\)/);
    });

    it('passes a custom provider through with a normalized host', async () => {
        await expect(verifyProviderAccessToken({ provider: 'custom', username: 'me', host: 'Git.Example.com', accessToken: 'token' })).resolves.toEqual({
            username: 'me',
            labelSuggestion: 'me',
            host: 'git.example.com',
        });
        expect(fetchCalls).toHaveLength(0);
    });
});
