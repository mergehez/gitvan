import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    AppBootstrapApi,
    BranchesData,
    CloneableRepo,
    CloneRepoDefaults,
    CommitDetail,
    CommitFormState,
    CommittedFileData,
    CommittedTreeData,
    EditorSettings,
    FileDiffData,
    FileDiffRequestKind,
    HistoryData,
    MergeConflictFileDetails,
    MergeConflictState,
    NavigationView,
    OAuthDevicePollResult,
    OAuthDeviceStartResult,
    OAuthProviderSettings,
    RemoteOperation,
    Repo,
    RepoChangesData,
} from '../../shared/gitClient.js';
import { deleteAccountSecret, readAccountSecret, storeAccountSecret } from './auth.js';
import type { RepoRow } from './database.js';
import { useDb } from './database.js';
import { git, GitCommandError } from './git.js';
import type { OAuthCompletedDeviceResult } from './oauth.js';
import { pollOAuthDeviceSession, startOAuthDeviceSession, verifyProviderAccessToken } from './oauth.js';

type HostControls = {
    updateWindowTitle?: (title: string) => void;
    pickDirectory?: () => Promise<string | undefined>;
    openExternalUrl?: (url: string) => Promise<void>;
    getDefaultCloneParentDirectory?: () => string;
};

const db = useDb();

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..', '..');
const sandboxResetScripts = [
    {
        scriptPath: join(projectRoot, 'sandbox', 'merge-conflict-lab', 'reset-conflict-repo.sh'),
        repoPath: join(projectRoot, 'sandbox', 'merge-conflict-lab', 'repo'),
    },
    {
        scriptPath: join(projectRoot, 'sandbox', 'pull-conflict-lab', 'reset-pull-conflict-repo.sh'),
        repoPath: join(projectRoot, 'sandbox', 'pull-conflict-lab', 'repo'),
    },
] as const;

type RepoRemoteAuth = {
    kind: 'https-token';
    username: string;
    password: string;
    host: string | undefined;
};

type OAuthSecretRecord = {
    kind: 'oauth';
    provider: 'github' | 'gitlab';
    accessToken: string;
    refreshToken: string | undefined;
    expiresAt: string | undefined;
};

type GithubRepoApiRecord = {
    id?: number;
    name?: string;
    full_name?: string;
    private?: boolean;
    clone_url?: string;
    default_branch?: string | undefined;
    updated_at?: string | undefined;
    description?: string | undefined;
    owner?:
        | {
              login?: string;
          }
        | undefined;
};

const defaultOAuthProviderSettings: OAuthProviderSettings = {
    githubClientId: '',
    gitlabClientId: '',
    gitlabHost: 'gitlab.com',
};

const defaultEditorSettings: EditorSettings = {
    editors: [],
    defaultEditorPath: undefined,
    diffFontSize: 12,
    diffViewMode: 'full-file',
    showWhitespaceChanges: false,
    activeView: 'changes',
    showBranches: false,
};

function normalizeOAuthProviderSettings(value: unknown): OAuthProviderSettings {
    if (!value || typeof value !== 'object') {
        return defaultOAuthProviderSettings;
    }

    const raw = value as Partial<OAuthProviderSettings>;

    return {
        githubClientId: raw.githubClientId?.trim() || '',
        gitlabClientId: raw.gitlabClientId?.trim() || '',
        gitlabHost: raw.gitlabHost?.trim() || defaultOAuthProviderSettings.gitlabHost,
    };
}

function normalizeEditorSettings(value: unknown): EditorSettings {
    if (!value || typeof value !== 'object') {
        return defaultEditorSettings;
    }

    const raw = value as {
        editors?: Array<{ path?: string; label?: string }>;
        defaultEditorPath?: string | undefined;
        diffFontSize?: number;
        diffViewMode?: EditorSettings['diffViewMode'];
        showWhitespaceChanges?: boolean;
        activeView?: NavigationView;
        lastEditorPath?: string | undefined;
        showBranches?: boolean;
    };

    const editors = (raw.editors ?? [])
        .filter((editor): editor is { path: string; label?: string } => typeof editor?.path === 'string' && editor.path.length > 0)
        .map((editor) => ({
            path: editor.path,
            label: editor.label?.trim() || editor.path.split('/').pop() || editor.path,
        }))
        .filter((editor, index, collection) => collection.findIndex((candidate) => candidate.path === editor.path) === index);

    const legacyLastEditorPath = typeof raw.lastEditorPath === 'string' && raw.lastEditorPath.length > 0 ? raw.lastEditorPath : undefined;

    if (legacyLastEditorPath && !editors.some((editor) => editor.path === legacyLastEditorPath)) {
        editors.push({
            path: legacyLastEditorPath,
            label: legacyLastEditorPath.split('/').pop() || legacyLastEditorPath,
        });
    }

    const requestedDefaultPath = typeof raw.defaultEditorPath === 'string' && raw.defaultEditorPath.length > 0 ? raw.defaultEditorPath : legacyLastEditorPath;
    const defaultEditorPath = requestedDefaultPath && editors.some((editor) => editor.path === requestedDefaultPath) ? requestedDefaultPath : undefined;

    return {
        editors,
        defaultEditorPath,
        diffFontSize: ((): number => {
            const value: unknown = raw.diffFontSize;
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return defaultEditorSettings.diffFontSize;
            }

            return Math.min(24, Math.max(10, Math.round(value)));
        })(),
        diffViewMode: raw.diffViewMode === 'changes' ? 'changes' : 'full-file',
        showWhitespaceChanges: raw.showWhitespaceChanges === true,
        activeView: raw.activeView === 'history' || raw.activeView === 'explorer' ? raw.activeView : 'changes',
        showBranches: raw.showBranches === true,
    };
}

let hostControls: HostControls = {};

async function runProcess(command: string, args: string[], cwd: string) {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });

        let stderr = '';

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if ((code ?? 1) !== 0) {
                reject(new Error(stderr.trim() || `${command} exited with code ${code ?? -1}.`));
                return;
            }

            resolve();
        });
    });
}

export function configureAppHost(nextHostControls: HostControls) {
    hostControls = nextHostControls;
}

async function resolveVerifiedManualAccount(params: {
    provider: string;
    authKind: string;
    username: string | undefined;
    host: string | undefined;
    accessToken: string | undefined;
}) {
    if (params.authKind !== 'https-token') {
        return {
            username: undefined,
            host: undefined,
            accessToken: undefined,
        };
    }

    function defaultHostForProvider(provider: string) {
        switch (provider) {
            case 'github':
                return 'github.com';
            case 'gitlab':
                return 'gitlab.com';
            case 'bitbucket':
                return 'bitbucket.org';
            default:
                return undefined;
        }
    }

    const normalizedToken = params.accessToken?.trim() || undefined;
    const normalizedHost = (params.host?.trim() || defaultHostForProvider(params.provider) || undefined)?.toLowerCase() ?? undefined;

    if (!normalizedToken) {
        throw new Error('An access token is required for HTTPS token authentication.');
    }

    if (params.provider === 'custom') {
        if (!normalizedHost) {
            throw new Error('A host is required for custom HTTPS accounts.');
        }

        if (!params.username?.trim()) {
            throw new Error('A username is required for custom HTTPS accounts.');
        }

        return {
            username: params.username.trim(),
            host: normalizedHost,
            accessToken: normalizedToken,
        };
    }

    const verified = await verifyProviderAccessToken({
        provider: params.provider,
        username: params.username?.trim() || undefined,
        host: normalizedHost,
        accessToken: normalizedToken,
    });

    const resolvedUsername = params.username?.trim() || verified.username;
    if (!resolvedUsername) {
        throw new Error('The provider did not return a usable username for this token.');
    }

    return {
        username: resolvedUsername,
        host: verified.host,
        accessToken: normalizedToken,
    };
}

function setStoredCloneParentDirectory(parentDirectory: string) {
    const normalizedParentDirectory = parentDirectory.trim();
    if (!normalizedParentDirectory) {
        return;
    }

    db.setSetting('cloneParentDirectory', normalizedParentDirectory);
}

async function resolveAccountRemoteAuth(accountId: number): Promise<RepoRemoteAuth | undefined> {
    const account = db.getAccountAuthById(accountId);
    if (!account) {
        throw new Error('The selected account could not be found.');
    }

    if (account.auth_kind !== 'https-token') {
        if (account.auth_kind !== 'oauth') {
            return undefined;
        }

        const storedSecret = await readAccountSecret(account.id);
        const parsed = JSON.parse(storedSecret) as Partial<OAuthSecretRecord>;

        if (parsed.kind !== 'oauth' || (parsed.provider !== 'github' && parsed.provider !== 'gitlab') || typeof parsed.accessToken !== 'string') {
            throw new Error('The stored OAuth secret is invalid.');
        }

        const secret = {
            kind: 'oauth',
            provider: parsed.provider,
            accessToken: parsed.accessToken,
            refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined,
            expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : undefined,
        };

        if (secret.expiresAt && new Date(secret.expiresAt).getTime() <= Date.now()) {
            throw new Error('The assigned OAuth account has expired. Sign in again to continue.');
        }

        return {
            kind: 'https-token',
            username: secret.provider === 'gitlab' ? 'oauth2' : (account.username ?? 'git'),
            password: secret.accessToken,
            host: account.host,
        };
    }

    if (!account.username) {
        throw new Error('The assigned account is missing a username.');
    }

    const accessToken = await readAccountSecret(account.id);
    if (!accessToken) {
        throw new Error('The assigned account is missing its stored access token.');
    }

    return {
        kind: 'https-token',
        username: account.username,
        password: accessToken,
        host: account.host,
    };
}

async function resolveRepoRemoteAuth(repoId: number): Promise<RepoRemoteAuth | undefined> {
    const r = db.getRepo(repoId)!;

    return r.account_id ? await resolveAccountRemoteAuth(r.account_id) : undefined;
}

function rethrowRemoteAuthError(error: unknown, auth: RepoRemoteAuth | undefined): never {
    if (auth && error instanceof GitCommandError && /repository .* not found/i.test(error.stderr)) {
        throw new Error(
            'The assigned account authenticated successfully, but it does not have access to this remote repository. Check that the token is authorized for the repo or organization, or assign a different account.',
        );
    }

    throw error;
}

async function buildBootstrap(): Promise<AppBootstrapApi> {
    const repoRows = db.listRepos();
    const repos: AppBootstrapApi['repos'] = await Promise.all(
        repoRows.map(async (row: ReturnType<typeof db.listRepos>[number]) => {
            const status = await git.getRepoSidebarStatus(row.path);

            const r: Repo = {
                id: row.id,
                name: row.name,
                path: row.path,
                sequence: typeof row.sequence === 'bigint' ? Number(row.sequence) : row.sequence,
                groupId: row.group_id,
                groupName: row.group_name,
                accountId: row.account_id,
                accountLabel: row.account_label,
                addedAt: row.added_at,
                lastOpenedAt: row.last_opened_at,
                status,
            };

            return r;
        }),
    );

    let selectedRepoId = db.getSelectedRepoId();

    if (selectedRepoId === undefined && repos.length > 0) {
        selectedRepoId = repos[0]?.id ?? undefined;
        db.setSelectedRepoId(selectedRepoId);
    }

    if (selectedRepoId !== undefined && !repos.some((repo) => repo.id === selectedRepoId)) {
        selectedRepoId = repos[0]?.id ?? undefined;
        db.setSelectedRepoId(selectedRepoId);
    }

    const bootstrap: AppBootstrapApi = {
        repos,
        groups: db.listGroups(),
        accounts: db.listAccounts(),
        selectedRepoId,
    };

    const r = bootstrap.repos.find((t) => t.id === bootstrap.selectedRepoId);
    hostControls.updateWindowTitle?.(r ? `${r.name} - ${r.status.branch ?? 'No branch'} - Gitvan` : 'Gitvan');

    return bootstrap;
}
export const app = {
    getBootstrap: async () => {
        return buildBootstrap();
    },
    getEditorSettings: (): EditorSettings => {
        return normalizeEditorSettings(db.getSetting<unknown>('editorSettings', defaultEditorSettings));
    },
    updateEditorSettings: (ps: { settings: EditorSettings }): EditorSettings => {
        const nextSettings = normalizeEditorSettings(ps.settings);

        db.setSetting('editorSettings', nextSettings);
        return nextSettings;
    },
    getOAuthProviderSettings: (): OAuthProviderSettings => {
        return normalizeOAuthProviderSettings(db.getSetting<unknown>('oauthProviderSettings', defaultOAuthProviderSettings));
    },
    updateOAuthProviderSettings: (ps: { settings: OAuthProviderSettings }): OAuthProviderSettings => {
        const nextSettings = normalizeOAuthProviderSettings(ps.settings);
        db.setSetting('oauthProviderSettings', nextSettings);
        return nextSettings;
    },
    getCloneRepoDefaults: (): CloneRepoDefaults => {
        const fallback = hostControls.getDefaultCloneParentDirectory?.() ?? '';
        const value = db.getSetting<unknown>('cloneParentDirectory', fallback);
        return {
            parentDirectory: typeof value === 'string' && value.trim() ? value.trim() : fallback,
        };
    },
    pickCloneRepoDirectory: async () => {
        const selectedPath = await hostControls.pickDirectory?.();

        if (!selectedPath) {
            return undefined;
        }

        setStoredCloneParentDirectory(selectedPath);
        return selectedPath;
    },
    listCloneableRepos: async (ps: { accountId: number }): Promise<CloneableRepo[]> => {
        const account = db.getAccountAuthById(ps.accountId);
        if (!account) {
            throw new Error('The selected account could not be found.');
        }

        if (account.auth_kind === 'system-git') {
            throw new Error('Repository discovery requires a saved GitHub account with a token or OAuth sign-in.');
        }

        if (account.provider !== 'github' && account.provider !== 'custom') {
            throw new Error('Repository discovery is currently available for GitHub accounts only.');
        }

        const auth = await resolveAccountRemoteAuth(ps.accountId);
        if (!auth) {
            throw new Error('The selected account cannot be used to browse repositories.');
        }

        const repos: CloneableRepo[] = [];
        const baseUrl = (() => {
            const normalizedHost = account.host?.trim().toLowerCase() || 'github.com';
            return normalizedHost === 'github.com' ? 'https://api.github.com' : `https://${normalizedHost}/api/v3`;
        })();

        for (let page = 1; page <= 10; page++) {
            const response = await fetch(`${baseUrl}/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name&per_page=100&page=${page}`, {
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${auth.password}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            });
            if (!response.ok) {
                throw new Error(`The repository list could not be loaded (${response.status}).`);
            }
            const data = (await response.json()) as GithubRepoApiRecord[];
            const pageItems = Array.isArray(data) ? data : [];

            repos.push(
                ...pageItems
                    .map((record): CloneableRepo | undefined => {
                        const name = record.name?.trim() ?? '';
                        const fullName = record.full_name?.trim() ?? '';
                        const cloneUrl = record.clone_url?.trim() ?? '';
                        const ownerLogin = record.owner?.login?.trim() ?? fullName.split('/')[0] ?? '';

                        if (!name || !fullName || !cloneUrl || !ownerLogin) {
                            return undefined;
                        }

                        return {
                            id: String(record.id ?? fullName),
                            name,
                            fullName,
                            ownerLogin,
                            description: typeof record.description === 'string' && record.description.trim() ? record.description.trim() : undefined,
                            isPrivate: record.private === true,
                            cloneUrl,
                            defaultBranch: typeof record.default_branch === 'string' && record.default_branch.trim() ? record.default_branch.trim() : undefined,
                            updatedAt: typeof record.updated_at === 'string' && record.updated_at.trim() ? record.updated_at.trim() : undefined,
                        };
                    })
                    .filter((entry): entry is CloneableRepo => entry !== undefined),
            );

            if (pageItems.length < 100) {
                break;
            }
        }

        return repos.sort((left, right) => left.fullName.localeCompare(right.fullName));
    },
    pickRepo: async (ps: { targetGroupId?: number }) => {
        const selectedPath = await hostControls.pickDirectory?.();

        if (!selectedPath) {
            return buildBootstrap();
        }

        const repo = await git.resolveGitRepo(selectedPath);
        const repoId = db.upsertRepo(repo.path, repo.name);
        if (ps.targetGroupId !== undefined) {
            db.updateRepoGroup(repoId, ps.targetGroupId);
        }
        db.setSelectedRepoId(repoId);

        return buildBootstrap();
    },
    cloneTrackedRepo: async (ps: { accountId: number | undefined; cloneUrl: string; parentDirectory: string; repoName?: string | undefined; groupId?: number | undefined }) => {
        function extractRepoNameFromCloneUrl(remoteUrl: string) {
            const normalizedRemoteUrl = remoteUrl.trim().replace(/\/+$/, '');
            if (!normalizedRemoteUrl) {
                throw new Error('A repository URL is required.');
            }

            const withoutGitSuffix = normalizedRemoteUrl.replace(/\.git$/i, '');
            const segments = withoutGitSuffix.split(/[/:]/).filter(Boolean);
            const name = segments[segments.length - 1]?.trim() ?? '';

            if (!name) {
                throw new Error('The repository URL does not include a valid repository name.');
            }

            return name;
        }

        const normalizedCloneUrl = ps.cloneUrl.trim();
        const normalizedParentDirectory = ps.parentDirectory.trim();
        const resolvedRepoName = ps.repoName?.trim() || extractRepoNameFromCloneUrl(normalizedCloneUrl);

        if (!normalizedParentDirectory) {
            throw new Error('A local path is required.');
        }

        if (ps.groupId !== undefined && !db.groupExists(ps.groupId)) {
            throw new Error('The selected group could not be found.');
        }

        const auth = ps.accountId === undefined ? undefined : await resolveAccountRemoteAuth(ps.accountId);
        const destinationPath = join(normalizedParentDirectory, resolvedRepoName);

        try {
            await git.cloneGitRepo(normalizedCloneUrl, destinationPath, auth);
        } catch (error) {
            rethrowRemoteAuthError(error, auth);
        }

        setStoredCloneParentDirectory(normalizedParentDirectory);

        const repo = await git.resolveGitRepo(destinationPath);
        const repoId = db.upsertRepo(repo.path, repo.name, ps.groupId ?? undefined);

        if (ps.accountId !== undefined) {
            db.assignRepoAccount(repoId, ps.accountId);
        }

        db.setSelectedRepoId(repoId);
        return buildBootstrap();
    },
    createTrackedLocalRepo: async (ps: { name: string; parentDirectory: string; groupId?: number | undefined }) => {
        const normalizedName = ps.name.trim();
        const normalizedParentDirectory = ps.parentDirectory.trim();

        if (!normalizedName) {
            throw new Error('A repository name is required.');
        }

        if (!normalizedParentDirectory) {
            throw new Error('A local path is required.');
        }

        if (ps.groupId !== undefined && !db.groupExists(ps.groupId)) {
            throw new Error('The selected group could not be found.');
        }

        const destinationPath = join(normalizedParentDirectory, normalizedName);

        await git.initializeGitRepo(destinationPath);

        setStoredCloneParentDirectory(normalizedParentDirectory);

        const repo = await git.resolveGitRepo(destinationPath);
        const repoId = db.upsertRepo(repo.path, repo.name, ps.groupId ?? undefined);
        db.setSelectedRepoId(repoId);

        return buildBootstrap();
    },
    selectRepo: async (ps: { repoId: number }) => {
        if (!db.repoExists(ps.repoId)) {
            throw new Error('The selected repository could not be found.');
        }

        db.setSelectedRepoId(ps.repoId);
        return buildBootstrap();
    },
    refreshRepos: async () => {
        return buildBootstrap();
    },
    resetSandboxRepos: async () => {
        for (const sandbox of sandboxResetScripts) {
            await runProcess('zsh', [sandbox.scriptPath], projectRoot);
            const repo = await git.resolveGitRepo(sandbox.repoPath);
            db.upsertRepo(repo.path, repo.name);
        }

        return buildBootstrap();
    },
    removeTrackedRepo: async (ps: { repoId: number }) => {
        db.removeRepo(ps.repoId);

        if (db.getSelectedRepoId() === ps.repoId) {
            db.setSelectedRepoId(undefined);
        }

        return buildBootstrap();
    },
    createTrackedRepoGroup: async (ps: { name: string }) => {
        const normalizedName = ((groupName: string): string => groupName.trim())(ps.name);

        if (!normalizedName) {
            throw new Error('Group name is required.');
        }

        if (db.getGroupByName(normalizedName)) {
            throw new Error('A group with that name already exists.');
        }

        db.createGroup(normalizedName);
        return buildBootstrap();
    },
    deleteTrackedRepoGroup: async (ps: { groupId: number }) => {
        if (!db.groupExists(ps.groupId)) {
            throw new Error('The selected group could not be found.');
        }

        const repos = db.listRepos().filter((repo: RepoRow) => repo.group_id === ps.groupId);
        for (const repo of repos) {
            db.updateRepoGroup(repo.id, undefined);
        }

        db.moveGroup(ps.groupId, 'down');
        db.moveGroup(ps.groupId, 'down');
        db.deleteGroup(ps.groupId);
        return buildBootstrap();
    },
    renameTrackedRepoGroup: async (ps: { groupId: number; name: string }) => {
        const normalizedName = ((groupName: string): string => groupName.trim())(ps.name);

        if (!normalizedName) {
            throw new Error('Group name is required.');
        }

        if (!db.groupExists(ps.groupId)) {
            throw new Error('The selected group could not be found.');
        }

        const existingGroup = db.getGroupByName(normalizedName);
        if (existingGroup && existingGroup.id !== ps.groupId) {
            throw new Error('A group with that name already exists.');
        }

        db.updateGroupName(ps.groupId, normalizedName);
        return buildBootstrap();
    },
    renameTrackedRepo: async (ps: { repoId: number; name: string }) => {
        const normalizedName = ps.name.trim();

        if (!normalizedName) {
            throw new Error('Repository name is required.');
        }

        if (!db.repoExists(ps.repoId)) {
            throw new Error('The selected repository could not be found.');
        }

        db.updateRepoName(ps.repoId, normalizedName);
        return buildBootstrap();
    },
    updateTrackedRepoGroup: async (ps: { repoId: number; groupId: number | undefined }) => {
        if (!db.repoExists(ps.repoId)) {
            throw new Error('The selected repository could not be found.');
        }

        if (ps.groupId !== undefined && !db.groupExists(ps.groupId)) {
            throw new Error('The selected group could not be found.');
        }

        db.updateRepoGroup(ps.repoId, ps.groupId);
        return buildBootstrap();
    },
    updateTrackedRepoGroups: async (ps: { updates: Array<{ repoId: number; groupId: number | undefined }> }) => {
        for (const update of ps.updates) {
            if (!db.repoExists(update.repoId)) {
                throw new Error('One of the selected repositories could not be found.');
            }

            if (update.groupId !== undefined && !db.groupExists(update.groupId)) {
                throw new Error('One of the selected groups could not be found.');
            }

            db.updateRepoGroup(update.repoId, update.groupId);
        }

        return buildBootstrap();
    },
    moveTrackedRepo: async (ps: { repoId: number; direction: 'up' | 'down' }) => {
        if (!db.repoExists(ps.repoId)) {
            throw new Error('The selected repository could not be found.');
        }

        db.moveRepo(ps.repoId, ps.direction);
        return buildBootstrap();
    },
    reorderTrackedRepo: async (ps: { repoId: number; toIndex: number }) => {
        if (!db.repoExists(ps.repoId)) {
            throw new Error('The selected repository could not be found.');
        }

        db.reorderRepo(ps.repoId, ps.toIndex);
        return buildBootstrap();
    },
    moveTrackedRepoGroup: async (ps: { groupId: number; direction: 'up' | 'down' }) => {
        if (!db.groupExists(ps.groupId)) {
            throw new Error('The selected group could not be found.');
        }

        db.moveGroup(ps.groupId, ps.direction);
        return buildBootstrap();
    },
    createAccountRecord: async (ps: {
        label: string;
        provider: string;
        authKind: string;
        username: string | undefined;
        host: string | undefined;
        accessToken: string | undefined;
        setAsDefault: boolean;
    }) => {
        ps.provider = ps.provider.trim().toLowerCase();
        const normalizedProvider = ps.provider.trim().toLowerCase();
        if (!['github', 'gitlab', 'bitbucket', 'custom', 'system'].includes(normalizedProvider)) throw new Error('Unsupported account provider.');

        const normalizedAuthKind = ps.authKind.trim().toLowerCase();
        if (!['system-git', 'https-token', 'oauth'].includes(normalizedAuthKind)) throw new Error('Unsupported authentication method.');

        const normalizedLabel = ps.label.trim();

        if (!normalizedLabel) {
            throw new Error('Account label is required.');
        }

        if (normalizedAuthKind === 'oauth') {
            throw new Error('OAuth accounts must be created through the sign-in flow.');
        }

        const verifiedAccount = await resolveVerifiedManualAccount({
            provider: normalizedProvider,
            authKind: normalizedAuthKind,
            username: ps.username,
            host: ps.host,
            accessToken: ps.accessToken,
        });

        const accountId = db.createAccount(normalizedLabel, normalizedProvider, normalizedAuthKind, verifiedAccount.username, verifiedAccount.host, ps.setAsDefault);

        if (normalizedAuthKind === 'https-token') {
            try {
                await storeAccountSecret(accountId, normalizedLabel, verifiedAccount.accessToken!);
            } catch (error) {
                db.removeAccount(accountId);
                await deleteAccountSecret(accountId);
                throw error;
            }
        }

        return buildBootstrap();
    },
    updateAccountRecord: async (ps: {
        accountId: number;
        label: string;
        username: string | undefined;
        host: string | undefined;
        accessToken: string | undefined;
        setAsDefault: boolean;
    }) => {
        const account = db.getAccountAuthById(ps.accountId);
        if (!account) {
            throw new Error('The selected account could not be found.');
        }

        const normalizedLabel = ps.label.trim();
        if (!normalizedLabel) {
            throw new Error('Account label is required.');
        }

        let nextUsername = account.username;
        let nextHost = account.host;

        if (account.auth_kind === 'https-token') {
            const verifiedAccount = await resolveVerifiedManualAccount({
                provider: account.provider,
                authKind: account.auth_kind,
                username: ps.username,
                host: ps.host,
                accessToken: ps.accessToken?.trim() ? ps.accessToken : await readAccountSecret(ps.accountId),
            });

            nextUsername = verifiedAccount.username;
            nextHost = verifiedAccount.host;

            if (ps.accessToken?.trim()) {
                await storeAccountSecret(ps.accountId, normalizedLabel, verifiedAccount.accessToken!);
            }
        }

        db.updateAccount(ps.accountId, normalizedLabel, nextUsername, nextHost, ps.setAsDefault);
        return buildBootstrap();
    },
    deleteAccountRecord: async (ps: { accountId: number }) => {
        if (!db.accountExists(ps.accountId)) {
            throw new Error('The selected account could not be found.');
        }

        db.removeAccount(ps.accountId);
        await deleteAccountSecret(ps.accountId);
        return buildBootstrap();
    },
    reorderAccountRecord: async (ps: { accountId: number; toIndex: number }) => {
        if (!db.accountExists(ps.accountId)) {
            throw new Error('The selected account could not be found.');
        }

        db.reorderAccount(ps.accountId, ps.toIndex);
        return buildBootstrap();
    },
    startOAuthAccountDeviceFlow: async (ps: { provider: 'github' | 'gitlab'; label: string; setAsDefault: boolean }): Promise<OAuthDeviceStartResult> => {
        const settings = app.getOAuthProviderSettings();
        const result = await startOAuthDeviceSession(settings, {
            provider: ps.provider,
            label: ps.label,
            setAsDefault: ps.setAsDefault,
        });

        await hostControls.openExternalUrl?.(result.verificationUriComplete ?? result.verificationUri);
        return result;
    },
    pollOAuthAccountDeviceFlow: async (ps: { sessionId: string }): Promise<OAuthDevicePollResult> => {
        const result = await pollOAuthDeviceSession(ps.sessionId);

        if (result.status === 'pending') {
            return result;
        }

        const completedResult = result as OAuthCompletedDeviceResult;

        const accountId = db.createAccount(
            completedResult.account.label,
            completedResult.account.provider,
            'oauth',
            completedResult.account.username,
            completedResult.account.host,
            completedResult.account.setAsDefault,
        );

        try {
            await storeAccountSecret(accountId, completedResult.account.label, JSON.stringify(completedResult.account.secret));
        } catch (error) {
            db.removeAccount(accountId);
            await deleteAccountSecret(accountId);
            throw error;
        }

        return {
            status: 'completed',
            bootstrap: await buildBootstrap(),
        };
    },
    assignAccountToRepo: async (ps: { repoId: number; accountId: number | undefined }) => {
        db.getRepo(ps.repoId)!;

        if (ps.accountId !== undefined && !db.accountExists(ps.accountId)) {
            throw new Error('The selected account could not be found.');
        }

        db.assignRepoAccount(ps.repoId, ps.accountId);
        return buildBootstrap();
    },
    getChanges: async (ps: { repoId: number }): Promise<RepoChangesData> => {
        return git.getRepoChanges(db.getRepo(ps.repoId)!.path);
    },
    getStashes: async (ps: { repoId: number }) => {
        return git.getRepoStashes(db.getRepo(ps.repoId)!.path);
    },
    getStashDetail: async (ps: { repoId: number; stashRef: string }) => {
        return git.getRepoStashDetail(db.getRepo(ps.repoId)!.path, ps.stashRef);
    },
    getStashFileDiff: async (ps: { repoId: number; stashRef: string; path: string; previousPath?: string }) => {
        return git.getRepoStashFileDiff(db.getRepo(ps.repoId)!.path, ps.stashRef, ps.path, ps.previousPath);
    },
    getMergeConflictState: async (ps: { repoId: number }): Promise<MergeConflictState> => {
        return git.getRepoMergeConflictState(db.getRepo(ps.repoId)!.path);
    },
    getMergeConflictFileDetails: async (ps: { repoId: number; path: string }): Promise<MergeConflictFileDetails> => {
        return git.getRepoMergeConflictFileDetails(db.getRepo(ps.repoId)!.path, ps.path);
    },
    getDiff: async (ps: { repoId: number; path: string; kind: FileDiffRequestKind }): Promise<FileDiffData> => {
        return git.getFileDiff(db.getRepo(ps.repoId)!.path, ps.path, ps.kind);
    },
    resolveRepoFilePath: (ps: { repoId: number; path: string }) => {
        return join(db.getRepo(ps.repoId)!.path, ps.path);
    },
    stageFile: async (ps: { repoId: number; path: string }) => {
        await git.stageRepoFile(db.getRepo(ps.repoId)!.path, ps.path);
        return buildBootstrap();
    },
    stageFileHunks: async (ps: { repoId: number; path: string; hunkIds: string[] }) => {
        await git.stageRepoFileHunks(db.getRepo(ps.repoId)!.path, ps.path, ps.hunkIds);
        return buildBootstrap();
    },
    stageRepoFiles: async (ps: { repoId: number; paths: string[] }) => {
        await git.stageRepoFiles(db.getRepo(ps.repoId)!.path, ps.paths);
        return buildBootstrap();
    },
    stageAllFiles: async (ps: { repoId: number }) => {
        await git.stageAllRepoFiles(db.getRepo(ps.repoId)!.path);
        return buildBootstrap();
    },
    unstageFile: async (ps: { repoId: number; path: string }) => {
        await git.unstageRepoFile(db.getRepo(ps.repoId)!.path, ps.path);
        return buildBootstrap();
    },
    unstageFileHunks: async (ps: { repoId: number; path: string; hunkIds: string[] }) => {
        await git.unstageRepoFileHunks(db.getRepo(ps.repoId)!.path, ps.path, ps.hunkIds);
        return buildBootstrap();
    },
    unstageRepoFiles: async (ps: { repoId: number; paths: string[] }) => {
        await git.unstageRepoFiles(db.getRepo(ps.repoId)!.path, ps.paths);
        return buildBootstrap();
    },
    discardFile: async (ps: { repoId: number; path: string }) => {
        await git.discardRepoFile(db.getRepo(ps.repoId)!.path, ps.path);
        return buildBootstrap();
    },
    discardFileHunks: async (ps: { repoId: number; path: string; hunkIds: string[] }) => {
        await git.discardRepoFileHunks(db.getRepo(ps.repoId)!.path, ps.path, ps.hunkIds);
        return buildBootstrap();
    },
    discardRepoFiles: async (ps: { repoId: number; paths: string[] }) => {
        await git.discardRepoFiles(db.getRepo(ps.repoId)!.path, ps.paths);
        return buildBootstrap();
    },
    unstageAllFiles: async (ps: { repoId: number }) => {
        await git.unstageAllRepoFiles(db.getRepo(ps.repoId)!.path);
        return buildBootstrap();
    },
    discardAllChanges: async (ps: { repoId: number }) => {
        await git.discardAllRepoChanges(db.getRepo(ps.repoId)!.path);
        return buildBootstrap();
    },
    restoreRepoFile: async (ps: { repoId: number; path: string; kind: 'staged' | 'unstaged' }) => {
        await git.restoreRepoFile(db.getRepo(ps.repoId)!.path, ps.path, ps.kind);
        return buildBootstrap();
    },
    restoreRepoFiles: async (ps: { repoId: number; paths: string[]; kind: 'staged' | 'unstaged' }) => {
        await git.restoreRepoFiles(db.getRepo(ps.repoId)!.path, ps.paths, ps.kind);
        return buildBootstrap();
    },
    deleteStagedRepoFile: async (ps: { repoId: number; path: string }) => {
        await git.deleteStagedRepoFile(db.getRepo(ps.repoId)!.path, ps.path);
        return buildBootstrap();
    },
    deleteStagedRepoFiles: async (ps: { repoId: number; paths: string[] }) => {
        await git.deleteStagedRepoFiles(db.getRepo(ps.repoId)!.path, ps.paths);
        return buildBootstrap();
    },
    ignoreRepoPath: async (ps: { repoId: number; path: string; mode: 'file' | 'directory' | 'pattern' }) => {
        await git.ignoreRepoPath(db.getRepo(ps.repoId)!.path, ps.path, ps.mode);
        return buildBootstrap();
    },
    resolveMergeConflictFile: async (ps: { repoId: number; path: string; resolution: 'ours' | 'theirs' }) => {
        await git.resolveRepoMergeConflict(db.getRepo(ps.repoId)!.path, ps.path, ps.resolution);
        return buildBootstrap();
    },
    markMergeConflictResolved: async (ps: { repoId: number; path: string }) => {
        await git.markRepoConflictResolved(db.getRepo(ps.repoId)!.path, ps.path);
        return buildBootstrap();
    },
    saveMergeConflictResolution: async (ps: { repoId: number; path: string; resolvedContent: string }) => {
        await git.saveRepoMergeConflictResolution(db.getRepo(ps.repoId)!.path, ps.path, ps.resolvedContent);
        return buildBootstrap();
    },
    abortMerge: async (ps: { repoId: number }) => {
        await git.abortRepoMerge(db.getRepo(ps.repoId)!.path);
        return buildBootstrap();
    },
    commitMerge: async (ps: { repoId: number }) => {
        await git.commitRepoMerge(db.getRepo(ps.repoId)!.path);
        return buildBootstrap();
    },
    commitRepo: async (ps: { repoId: number; summary: string; description: string; amend: CommitFormState['amend'] }) => {
        await git.commitRepoChanges(db.getRepo(ps.repoId)!.path, ps.summary, ps.description, ps.amend);
        return buildBootstrap();
    },
    undoLastCommit: async (ps: { repoId: number }) => {
        await git.undoLastRepoCommit(db.getRepo(ps.repoId)!.path);
        return buildBootstrap();
    },
    getHistory: async (ps: { repoId: number }): Promise<HistoryData> => {
        return git.getRepoHistory(db.getRepo(ps.repoId)!.path);
    },
    getCommittedTree: async (ps: { repoId: number; commitSha?: string }): Promise<CommittedTreeData> => {
        return git.getCommittedTree(db.getRepo(ps.repoId)!.path, ps.commitSha);
    },
    getCommittedFile: async (ps: { repoId: number; path: string; commitSha?: string }): Promise<CommittedFileData> => {
        return git.getCommittedFile(db.getRepo(ps.repoId)!.path, ps.path, ps.commitSha);
    },
    getCommit: async (ps: { repoId: number; commitSha: string }): Promise<CommitDetail> => {
        return git.getCommitDetail(db.getRepo(ps.repoId)!.path, ps.commitSha);
    },
    getCommitDiff: async (ps: { repoId: number; commitSha: string; path: string; previousPath?: string }): Promise<FileDiffData> => {
        return git.getCommitFileDiff(db.getRepo(ps.repoId)!.path, ps.commitSha, ps.path, ps.previousPath);
    },
    getBranches: async (ps: { repoId: number }): Promise<BranchesData> => {
        return git.getRepoBranches(db.getRepo(ps.repoId)!.path);
    },
    checkoutBranch: async (ps: { repoId: number; branchName: string }) => {
        await git.checkoutRepoBranch(db.getRepo(ps.repoId)!.path, ps.branchName);
        return buildBootstrap();
    },
    createBranch: async (ps: { repoId: number; branchName: string }) => {
        await git.createRepoBranch(db.getRepo(ps.repoId)!.path, ps.branchName);
        return buildBootstrap();
    },
    createRemoteBranch: async (ps: { repoId: number; branchName: string }) => {
        const auth = await resolveRepoRemoteAuth(ps.repoId);

        try {
            await git.createRemoteRepoBranch(db.getRepo(ps.repoId)!.path, ps.branchName, auth);
        } catch (error) {
            rethrowRemoteAuthError(error, auth);
        }

        return buildBootstrap();
    },
    runRemoteOperation: async (ps: { repoId: number; operation: RemoteOperation }) => {
        const auth = await resolveRepoRemoteAuth(ps.repoId);

        try {
            await git.runRepoRemoteOperation(db.getRepo(ps.repoId)!.path, ps.operation, auth);
        } catch (error) {
            rethrowRemoteAuthError(error, auth);
        }

        return buildBootstrap();
    },
    stashRepo: async (ps: { repoId: number }) => {
        const auth = await resolveRepoRemoteAuth(ps.repoId);

        try {
            await git.stashRepoChanges(db.getRepo(ps.repoId)!.path, auth);
        } catch (error) {
            rethrowRemoteAuthError(error, auth);
        }

        return buildBootstrap();
    },
    restoreStash: async (ps: { repoId: number; stashRef: string }) => {
        try {
            await git.restoreRepoStash(db.getRepo(ps.repoId)!.path, ps.stashRef);
            return {
                bootstrap: await buildBootstrap(),
                status: 'completed' as const,
                kept: false,
            };
        } catch (error) {
            if (git.isStashRestoreConflictError(error)) {
                return {
                    bootstrap: await buildBootstrap(),
                    status: 'conflicted' as const,
                    kept: true,
                };
            }

            throw error;
        }
    },
    discardStash: async (ps: { repoId: number; stashRef: string }) => {
        await git.discardRepoStash(db.getRepo(ps.repoId)!.path, ps.stashRef);
        return buildBootstrap();
    },
    publishBranch: async (ps: { repoId: number }) => {
        const auth = await resolveRepoRemoteAuth(ps.repoId);

        try {
            await git.publishRepoBranch(db.getRepo(ps.repoId)!.path, auth);
        } catch (error) {
            rethrowRemoteAuthError(error, auth);
        }

        return buildBootstrap();
    },
};
