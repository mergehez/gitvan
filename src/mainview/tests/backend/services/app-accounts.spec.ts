import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    storeAccountSecret: vi.fn(),
    readAccountSecret: vi.fn(),
    deleteAccountSecret: vi.fn(),
    verifyProviderAccessToken: vi.fn(),
    startOAuthDeviceSession: vi.fn(),
    pollOAuthDeviceSession: vi.fn(),
}));

vi.mock('../../../../backend/services/auth.js', () => ({
    storeAccountSecret: mocks.storeAccountSecret,
    readAccountSecret: mocks.readAccountSecret,
    deleteAccountSecret: mocks.deleteAccountSecret,
}));

vi.mock('../../../../backend/services/oauth.js', () => ({
    verifyProviderAccessToken: mocks.verifyProviderAccessToken,
    startOAuthDeviceSession: mocks.startOAuthDeviceSession,
    pollOAuthDeviceSession: mocks.pollOAuthDeviceSession,
}));

import { app } from '../../../../backend/services/app.js';
import { useDb } from '../../../../backend/services/database.js';
import { useDatabase } from '../../../../electronUtils/useDatabase.js';

// The database client is a module singleton that refuses to configure twice.
const userDataDir = mkdtempSync(join(tmpdir(), 'gitvan-app-accounts-'));

beforeAll(() => {
    useDb().configureDatabase(userDataDir);
});

afterAll(() => {
    useDatabase().close();
    rmSync(userDataDir, { recursive: true, force: true });
});

beforeEach(() => {
    mocks.storeAccountSecret.mockReset().mockResolvedValue(undefined);
    mocks.readAccountSecret.mockReset().mockResolvedValue('ghp_stored');
    mocks.deleteAccountSecret.mockReset().mockResolvedValue(undefined);
    mocks.verifyProviderAccessToken.mockReset().mockResolvedValue({ username: 'octocat', host: 'github.com' });
    mocks.startOAuthDeviceSession.mockReset();
    mocks.pollOAuthDeviceSession.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function createGithubAccount(label: string) {
    return useDb().createAccount(label, 'github', 'https-token', 'octocat', 'github.com', false);
}

function removeAccount(label: string) {
    const account = useDb()
        .listAccounts()
        .find((entry) => entry.label === label);
    if (account) {
        useDb().removeAccount(account.id);
    }
}

function jsonResponse(body: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as unknown as Response;
}

describe('app createAccount', () => {
    it('verifies an HTTPS token, stores the secret and keeps the verified username', async () => {
        const result = await app.createAccount({
            label: ' GitHub Work ',
            provider: ' Github ',
            authKind: ' HTTPS-Token ',
            username: undefined,
            host: undefined,
            accessToken: '  ghp_token  ',
            setAsDefault: true,
        });

        const account = result.accounts.find((entry) => entry.label === 'GitHub Work')!;

        expect(account).toMatchObject({ provider: 'github', authKind: 'https-token', username: 'octocat', host: 'github.com', isDefault: true });
        expect(mocks.verifyProviderAccessToken).toHaveBeenCalledWith({ provider: 'github', username: undefined, host: 'github.com', accessToken: 'ghp_token' });
        expect(mocks.storeAccountSecret).toHaveBeenCalledWith(account.id, 'GitHub Work', 'ghp_token');

        useDb().removeAccount(account.id);
    });

    it('requires a token before it asks the provider anything', async () => {
        await expect(
            app.createAccount({ label: 'No token', provider: 'github', authKind: 'https-token', username: undefined, host: undefined, accessToken: '   ', setAsDefault: false })
        ).rejects.toThrow('An access token is required for HTTPS token authentication.');

        expect(mocks.verifyProviderAccessToken).not.toHaveBeenCalled();
    });

    it('requires a host and a username for a custom account and skips provider verification', async () => {
        const base = { label: 'Custom', provider: 'custom', authKind: 'https-token', accessToken: 'token', setAsDefault: false };

        await expect(app.createAccount({ ...base, username: 'dev', host: undefined })).rejects.toThrow('A host is required for custom HTTPS accounts.');
        await expect(app.createAccount({ ...base, username: undefined, host: '  ' })).rejects.toThrow('A host is required for custom HTTPS accounts.');
        await expect(app.createAccount({ ...base, username: '  ', host: 'git.example.com' })).rejects.toThrow('A username is required for custom HTTPS accounts.');

        const result = await app.createAccount({ ...base, username: ' dev ', host: '  Git.Example.com ' });
        const account = result.accounts.find((entry) => entry.label === 'Custom')!;

        expect(account).toMatchObject({ provider: 'custom', username: 'dev', host: 'git.example.com' });
        expect(mocks.verifyProviderAccessToken).not.toHaveBeenCalled();

        useDb().removeAccount(account.id);
    });

    it('refuses a token the provider cannot map to a username', async () => {
        mocks.verifyProviderAccessToken.mockResolvedValue({ username: undefined, host: 'github.com' });

        await expect(
            app.createAccount({ label: 'Nameless', provider: 'github', authKind: 'https-token', username: undefined, host: undefined, accessToken: 'token', setAsDefault: false })
        ).rejects.toThrow('The provider did not return a usable username for this token.');
    });

    it('rolls the account back when its secret cannot be stored', async () => {
        mocks.storeAccountSecret.mockRejectedValueOnce(new Error('keychain refused'));

        await expect(
            app.createAccount({ label: 'Rollback', provider: 'github', authKind: 'https-token', username: undefined, host: undefined, accessToken: 'token', setAsDefault: false })
        ).rejects.toThrow('keychain refused');

        expect(
            useDb()
                .listAccounts()
                .some((account) => account.label === 'Rollback')
        ).toBe(false);
        expect(mocks.deleteAccountSecret).toHaveBeenCalled();
    });
});

describe('app updateAccount', () => {
    it('replaces the secret only when a new token is given', async () => {
        const created = await app.createAccount({
            label: 'Update Me',
            provider: 'github',
            authKind: 'https-token',
            username: undefined,
            host: undefined,
            accessToken: 'first',
            setAsDefault: false,
        });
        const accountId = created.accounts.find((account) => account.label === 'Update Me')!.id;
        mocks.storeAccountSecret.mockClear();

        const withToken = await app.updateAccount({ accountId, label: 'Update Me', username: undefined, host: '   ', accessToken: ' second ', setAsDefault: false });

        expect(withToken.accounts.find((account) => account.id === accountId)).toMatchObject({ username: 'octocat', host: 'github.com' });
        expect(mocks.storeAccountSecret).toHaveBeenCalledWith(accountId, 'Update Me', 'second');

        mocks.storeAccountSecret.mockClear();
        await app.updateAccount({ accountId, label: 'Update Me again', username: undefined, host: undefined, accessToken: undefined, setAsDefault: false });

        expect(mocks.readAccountSecret).toHaveBeenCalledWith(accountId);
        expect(mocks.verifyProviderAccessToken).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: 'ghp_stored' }));
        expect(mocks.storeAccountSecret).not.toHaveBeenCalled();

        useDb().removeAccount(accountId);
    });

    it('refuses a blank label and an account that is not there', async () => {
        const accountId = createGithubAccount('Label Check');

        await expect(app.updateAccount({ accountId, label: '   ', username: undefined, host: undefined, accessToken: undefined, setAsDefault: false })).rejects.toThrow(
            'Account label is required.'
        );
        await expect(app.updateAccount({ accountId: 987_654, label: 'x', username: undefined, host: undefined, accessToken: undefined, setAsDefault: false })).rejects.toThrow(
            'The selected account could not be found.'
        );

        useDb().removeAccount(accountId);
    });
});

describe('app listCloneableRepos', () => {
    it('lists and normalizes the account repositories, skipping the unusable records', async () => {
        const accountId = createGithubAccount('Discovery');
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
            jsonResponse([
                {
                    id: 2,
                    name: 'beta',
                    full_name: 'acme/beta',
                    clone_url: 'https://github.com/acme/beta.git',
                    private: true,
                    owner: { login: 'acme' },
                    default_branch: 'main',
                    updated_at: '2026-01-01T00:00:00Z',
                    description: '  Beta repo  ',
                },
                { id: 1, name: 'alpha', full_name: 'acme/alpha', clone_url: 'https://github.com/acme/alpha.git', owner: { login: 'acme' } },
                { name: '', full_name: 'acme/broken', clone_url: 'https://github.com/acme/broken.git' },
                { name: 'no-clone', full_name: 'acme/no-clone', clone_url: '' },
            ])
        );
        vi.stubGlobal('fetch', fetchMock);

        try {
            const repos = await app.listCloneableRepos({ accountId });

            expect(repos.map((repo) => repo.fullName)).toEqual(['acme/alpha', 'acme/beta']);
            expect(repos[1]).toMatchObject({ name: 'beta', ownerLogin: 'acme', isPrivate: true, defaultBranch: 'main', description: 'Beta repo' });
            expect(repos[0]).toMatchObject({ isPrivate: false, description: undefined, defaultBranch: undefined });
            expect(repos[0]?.id).toBe('1');

            const [url, init] = fetchMock.mock.calls[0]!;
            expect(url).toContain('https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member');
            expect(init?.headers).toMatchObject({ Authorization: 'Bearer ghp_stored' });
        } finally {
            useDb().removeAccount(accountId);
        }
    });

    it('asks a custom host through its API path', async () => {
        const accountId = useDb().createAccount('Custom Host', 'custom', 'https-token', 'dev', 'git.example.com', false);
        const fetchMock = vi.fn(async (_url: string) => jsonResponse([]));
        vi.stubGlobal('fetch', fetchMock);

        try {
            await expect(app.listCloneableRepos({ accountId })).resolves.toEqual([]);
            expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://git.example.com/api/v3/user/repos');
        } finally {
            useDb().removeAccount(accountId);
        }
    });

    it('refuses discovery for a system account and for a provider other than GitHub', async () => {
        const systemId = useDb()
            .listAccounts()
            .find((account) => account.authKind === 'system-git')!.id;
        await expect(app.listCloneableRepos({ accountId: systemId })).rejects.toThrow('Repository discovery requires a saved GitHub account with a token or OAuth sign-in.');

        const gitlabId = useDb().createAccount('GitLab', 'gitlab', 'https-token', 'worker', 'gitlab.com', false);
        try {
            await expect(app.listCloneableRepos({ accountId: gitlabId })).rejects.toThrow('Repository discovery is currently available for GitHub accounts only.');
        } finally {
            useDb().removeAccount(gitlabId);
        }

        await expect(app.listCloneableRepos({ accountId: 987_654 })).rejects.toThrow('The selected account could not be found.');
    });

    it('reports a repository list the provider refuses', async () => {
        const accountId = createGithubAccount('Discovery Fail');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ message: 'Bad credentials' }, 401))
        );

        try {
            await expect(app.listCloneableRepos({ accountId })).rejects.toThrow('The repository list could not be loaded (401).');
        } finally {
            useDb().removeAccount(accountId);
        }
    });
});

describe('app OAuth device flow', () => {
    const completedResult = {
        status: 'completed' as const,
        account: {
            provider: 'github' as const,
            label: 'Polled',
            setAsDefault: false,
            username: 'octocat',
            host: 'github.com',
            secret: { kind: 'oauth', provider: 'github' as const, accessToken: 'oauth-token', refreshToken: undefined, expiresAt: undefined },
        },
    };

    it('starts a device flow with the stored provider settings', async () => {
        app.updateOAuthProviderSettings({ settings: { githubClientId: 'client', gitlabClientId: '', gitlabHost: 'gitlab.com' } });
        mocks.startOAuthDeviceSession.mockResolvedValue({ sessionId: 'session-1' });

        const result = await app.startOAuthDeviceFlow({ provider: 'github', label: 'Work', setAsDefault: true });

        expect(result).toMatchObject({ sessionId: 'session-1' });
        expect(mocks.startOAuthDeviceSession).toHaveBeenCalledWith(
            { githubClientId: 'client', gitlabClientId: '', gitlabHost: 'gitlab.com' },
            { provider: 'github', label: 'Work', setAsDefault: true }
        );
    });

    it('answers a pending poll without creating an account', async () => {
        mocks.pollOAuthDeviceSession.mockResolvedValue({ status: 'pending' });

        await expect(app.pollOAuthDeviceFlow({ sessionId: 'session-1' })).resolves.toEqual({ status: 'pending' });
        expect(mocks.storeAccountSecret).not.toHaveBeenCalled();
    });

    it('creates the account and stores its secret when the flow completes', async () => {
        mocks.pollOAuthDeviceSession.mockResolvedValue(completedResult);

        const result = await app.pollOAuthDeviceFlow({ sessionId: 'session-1' });

        expect(result.status).toBe('completed');
        const account = useDb()
            .listAccounts()
            .find((entry) => entry.label === 'Polled')!;
        expect(account).toMatchObject({ provider: 'github', authKind: 'oauth', username: 'octocat' });
        expect(mocks.storeAccountSecret).toHaveBeenCalledWith(account.id, 'Polled', JSON.stringify(completedResult.account.secret));

        useDb().removeAccount(account.id);
    });

    it('rolls the polled account back when its secret cannot be stored', async () => {
        mocks.pollOAuthDeviceSession.mockResolvedValue({ ...completedResult, account: { ...completedResult.account, label: 'Polled Rollback' } });
        mocks.storeAccountSecret.mockRejectedValueOnce(new Error('keychain refused'));

        await expect(app.pollOAuthDeviceFlow({ sessionId: 'session-1' })).rejects.toThrow('keychain refused');

        expect(
            useDb()
                .listAccounts()
                .some((account) => account.label === 'Polled Rollback')
        ).toBe(false);
        expect(mocks.deleteAccountSecret).toHaveBeenCalled();
    });
});

describe('app account cleanup', () => {
    it('leaves no spec account behind', () => {
        for (const label of ['GitHub Work', 'Custom', 'Update Me', 'Discovery', 'Custom Host', 'GitLab', 'Discovery Fail', 'Polled', 'Polled Rollback', 'Label Check']) {
            removeAccount(label);
        }

        expect(
            useDb()
                .listAccounts()
                .map((account) => account.label)
        ).toEqual(['System Git']);
    });
});
