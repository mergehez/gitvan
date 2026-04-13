import { randomUUID } from 'node:crypto';
import type { OAuthDeviceStartResult, OAuthProvider, OAuthProviderSettings } from '../../shared/gitClient.js';

type OAuthSecretRecord = {
    kind: 'oauth';
    provider: OAuthProvider;
    accessToken: string;
    refreshToken: string | undefined;
    expiresAt: string | undefined;
};

type OAuthCompletedAccount = {
    provider: OAuthProvider;
    label: string;
    setAsDefault: boolean;
    username: string;
    host: string;
    secret: OAuthSecretRecord;
};

export type OAuthCompletedDeviceResult = {
    status: 'completed';
    account: OAuthCompletedAccount;
};

type OAuthProviderPollPending = {
    error: string;
    error_description?: string;
};

type OAuthProviderPollCompleted = {
    account: OAuthCompletedAccount;
};

type OAuthDeviceSession = {
    id: string;
    provider: OAuthProvider;
    label: string;
    setAsDefault: boolean;
    clientId: string;
    host: string;
    deviceCode: string;
    intervalSeconds: number;
    expiresAt: number;
};

type JsonValue = Record<string, unknown>;

const oauthSessions = new Map<string, OAuthDeviceSession>();

function ensureOk(response: Response, message: string) {
    if (response.ok) {
        return;
    }

    throw new Error(`${message} (${response.status})`);
}

function normalizeHost(host: string) {
    const trimmed = host.trim();
    if (!trimmed) {
        throw new Error('A host is required.');
    }

    const withScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    return url.host.toLowerCase();
}

function baseUrlForHost(host: string) {
    return `https://${normalizeHost(host)}`;
}

async function parseJson(response: Response) {
    const body = await response.text();

    if (!body) {
        return {} as JsonValue;
    }

    return JSON.parse(body) as JsonValue;
}

async function fetchGithubUser(accessToken: string) {
    const response = await fetch('https://api.github.com/user', {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    ensureOk(response, 'GitHub token verification failed.');
    const data = await parseJson(response);
    const login = typeof data.login === 'string' ? data.login : undefined;
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : login;

    if (!login) {
        throw new Error('GitHub did not return the authenticated username.');
    }

    return {
        username: login,
        labelSuggestion: name || login,
        host: 'github.com',
    };
}

async function fetchGitlabUser(accessToken: string, host: string) {
    const response = await fetch(`${baseUrlForHost(host)}/api/v4/user`, {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
    });
    ensureOk(response, 'GitLab token verification failed.');
    const data = await parseJson(response);
    const username = typeof data.username === 'string' ? data.username : undefined;
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : username;

    if (!username) {
        throw new Error('GitLab did not return the authenticated username.');
    }

    return {
        username,
        labelSuggestion: name || username,
        host: normalizeHost(host),
    };
}

async function fetchBitbucketUser(accessToken: string) {
    const response = await fetch('https://api.bitbucket.org/2.0/user', {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
    });
    ensureOk(response, 'Bitbucket token verification failed.');
    const data = await parseJson(response);
    const displayName = typeof data.display_name === 'string' && data.display_name.trim() ? data.display_name.trim() : 'Bitbucket';

    return {
        username: undefined,
        labelSuggestion: displayName,
        host: 'bitbucket.org',
    };
}

export async function verifyProviderAccessToken(params: { provider: string; username: string | undefined; host: string | undefined; accessToken: string }) {
    switch (params.provider) {
        case 'github':
            return await fetchGithubUser(params.accessToken);
        case 'gitlab':
            return await fetchGitlabUser(params.accessToken, params.host || 'gitlab.com');
        case 'bitbucket':
            return await fetchBitbucketUser(params.accessToken);
        default:
            return {
                username: params.username,
                labelSuggestion: params.username || 'Custom account',
                host: params.host ? normalizeHost(params.host) : undefined,
            };
    }
}

async function startGithubDeviceFlow(clientId: string) {
    const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: clientId,
            scope: 'repo read:user',
        }),
    });
    ensureOk(response, 'GitHub device sign-in could not be started.');
    const data = await parseJson(response);

    return {
        deviceCode: String(data.device_code?.toString() || ''),
        userCode: String(data.user_code?.toString() || ''),
        verificationUri: String(data.verification_uri?.toString() || 'https://github.com/login/device'),
        verificationUriComplete: undefined,
        intervalSeconds: Number(data.interval || 5),
        expiresInSeconds: Number(data.expires_in || 900),
        host: 'github.com',
    };
}

async function startGitlabDeviceFlow(clientId: string, host: string) {
    const response = await fetch(`${baseUrlForHost(host)}/oauth/authorize_device`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: clientId,
            scope: 'read_user read_repository write_repository',
        }),
    });
    ensureOk(response, 'GitLab device sign-in could not be started.');
    const data = await parseJson(response);

    return {
        deviceCode: String(data.device_code?.toString() || ''),
        userCode: String(data.user_code?.toString() || ''),
        verificationUri: String(data.verification_uri?.toString() || `${baseUrlForHost(host)}/oauth/device`),
        verificationUriComplete: typeof data.verification_uri_complete === 'string' ? data.verification_uri_complete : undefined,
        intervalSeconds: Number(data.interval || 5),
        expiresInSeconds: Number(data.expires_in || 300),
        host: normalizeHost(host),
    };
}

async function pollGithubDeviceFlow(session: OAuthDeviceSession): Promise<OAuthProviderPollPending | OAuthProviderPollCompleted> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: session.clientId,
            device_code: session.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
    });
    ensureOk(response, 'GitHub device sign-in could not be completed.');
    const data = await parseJson(response);

    if (typeof data.error === 'string') {
        return {
            error: data.error,
            error_description: typeof data.error_description === 'string' ? data.error_description : undefined,
        };
    }

    const accessToken = typeof data.access_token === 'string' ? data.access_token : undefined;
    if (!accessToken) {
        throw new Error('GitHub did not return an access token.');
    }

    const user = await fetchGithubUser(accessToken);

    return {
        account: {
            provider: 'github',
            label: session.label || user.labelSuggestion,
            setAsDefault: session.setAsDefault,
            username: user.username,
            host: user.host,
            secret: {
                kind: 'oauth',
                provider: 'github',
                accessToken,
                refreshToken: undefined,
                expiresAt: undefined,
            },
        } satisfies OAuthCompletedAccount,
    };
}

async function pollGitlabDeviceFlow(session: OAuthDeviceSession): Promise<OAuthProviderPollPending | OAuthProviderPollCompleted> {
    const response = await fetch(`${baseUrlForHost(session.host)}/oauth/token`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: session.clientId,
            device_code: session.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
    });
    ensureOk(response, 'GitLab device sign-in could not be completed.');
    const data = await parseJson(response);

    if (typeof data.error === 'string') {
        return {
            error: data.error,
            error_description: typeof data.error_description === 'string' ? data.error_description : undefined,
        };
    }

    const accessToken = typeof data.access_token === 'string' ? data.access_token : undefined;
    if (!accessToken) {
        throw new Error('GitLab did not return an access token.');
    }

    const user = await fetchGitlabUser(accessToken, session.host);
    const createdAt = typeof data.created_at === 'number' ? data.created_at : Math.floor(Date.now() / 1000);
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;
    const expiresAt = expiresIn ? new Date((createdAt + expiresIn) * 1000).toISOString() : undefined;

    return {
        account: {
            provider: 'gitlab',
            label: session.label || user.labelSuggestion,
            setAsDefault: session.setAsDefault,
            username: user.username,
            host: user.host,
            secret: {
                kind: 'oauth',
                provider: 'gitlab',
                accessToken,
                refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
                expiresAt,
            },
        } satisfies OAuthCompletedAccount,
    };
}

export async function startOAuthDeviceSession(
    settings: OAuthProviderSettings,
    params: { provider: OAuthProvider; label: string; setAsDefault: boolean }
): Promise<OAuthDeviceStartResult> {
    const provider = params.provider;
    const sessionId = randomUUID();
    const label = params.label.trim();

    if (provider === 'github' && !settings.githubClientId.trim()) {
        throw new Error('Configure a GitHub OAuth client ID before starting GitHub sign-in.');
    }

    if (provider === 'gitlab' && (!settings.gitlabClientId.trim() || !settings.gitlabHost.trim())) {
        throw new Error('Configure the GitLab host and OAuth client ID before starting GitLab sign-in.');
    }

    const flow =
        provider === 'github'
            ? await startGithubDeviceFlow(settings.githubClientId.trim())
            : await startGitlabDeviceFlow(settings.gitlabClientId.trim(), settings.gitlabHost.trim());

    if (!flow.deviceCode || !flow.userCode) {
        throw new Error(`${provider === 'github' ? 'GitHub' : 'GitLab'} did not return a valid device authorization response.`);
    }

    oauthSessions.set(sessionId, {
        id: sessionId,
        provider,
        label,
        setAsDefault: params.setAsDefault,
        clientId: provider === 'github' ? settings.githubClientId.trim() : settings.gitlabClientId.trim(),
        host: flow.host,
        deviceCode: flow.deviceCode,
        intervalSeconds: flow.intervalSeconds,
        expiresAt: Date.now() + flow.expiresInSeconds * 1000,
    });

    return {
        sessionId,
        provider,
        verificationUri: flow.verificationUri,
        verificationUriComplete: flow.verificationUriComplete,
        userCode: flow.userCode,
        intervalSeconds: flow.intervalSeconds,
        expiresAt: new Date(Date.now() + flow.expiresInSeconds * 1000).toISOString(),
    };
}

export async function pollOAuthDeviceSession(sessionId: string): Promise<{ status: 'pending' } | OAuthCompletedDeviceResult> {
    const session = oauthSessions.get(sessionId);
    if (!session) {
        throw new Error('The OAuth sign-in session could not be found.');
    }

    if (Date.now() >= session.expiresAt) {
        oauthSessions.delete(sessionId);
        throw new Error('The OAuth sign-in session expired. Start the sign-in flow again.');
    }

    const response = session.provider === 'github' ? await pollGithubDeviceFlow(session) : await pollGitlabDeviceFlow(session);

    if ('error' in response) {
        if (response.error === 'authorization_pending') {
            return { status: 'pending' } as const;
        }

        if (response.error === 'slow_down') {
            session.intervalSeconds += 5;
            oauthSessions.set(sessionId, session);
            return { status: 'pending' } as const;
        }

        if (response.error === 'expired_token') {
            oauthSessions.delete(sessionId);
            throw new Error('The OAuth sign-in session expired. Start the sign-in flow again.');
        }

        if (response.error === 'access_denied') {
            oauthSessions.delete(sessionId);
            throw new Error('The OAuth sign-in was canceled.');
        }

        throw new Error(String(response.error_description || response.error));
    }

    oauthSessions.delete(sessionId);
    return {
        status: 'completed',
        account: response.account,
    };
}
