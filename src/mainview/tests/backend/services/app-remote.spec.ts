import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The git facade is a Proxy of per-method fakes so a handler test only has to configure the
 * calls it expects; predicate helpers default to `false` so an unconfigured error path is
 * never taken by accident.
 */
const gitMocks = vi.hoisted(() => {
    const mocks = new Map<string, ReturnType<typeof vi.fn>>();

    function mockFor(name: string) {
        const existing = mocks.get(name);
        if (existing) {
            return existing;
        }

        const created = vi.fn();
        mocks.set(name, created);

        return created;
    }

    return {
        git: new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
            get: (_target, property) => (typeof property === 'string' ? mockFor(property) : undefined),
        }),
        mockFor,
        resetAll() {
            for (const [name, mock] of mocks) {
                mock.mockReset();

                if (name.startsWith('is')) {
                    mock.mockReturnValue(false);
                }
            }
        },
    };
});

const authMocks = vi.hoisted(() => ({ readAccountSecret: vi.fn() }));

vi.mock('../../../../backend/services/git.js', async (importOriginal) => {
    // Only the real error class is kept; every other method is a per-call fake.
    const actual = (await importOriginal()) as { GitCommandError: unknown };

    return { GitCommandError: actual.GitCommandError, git: gitMocks.git };
});

vi.mock('../../../../backend/services/auth.js', () => ({
    storeAccountSecret: vi.fn(),
    readAccountSecret: authMocks.readAccountSecret,
    deleteAccountSecret: vi.fn(),
}));

import { app } from '../../../../backend/services/app.js';
import { useDb } from '../../../../backend/services/database.js';
import { GitCommandError } from '../../../../backend/services/git/git-common.js';
import { useDatabase } from '../../../../electronUtils/useDatabase.js';

// The database client is a module singleton that refuses to configure twice.
const userDataDir = mkdtempSync(join(tmpdir(), 'gitvan-app-remote-'));
const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-app-remote-repo-'));
let repoId: number;

beforeAll(() => {
    useDb().configureDatabase(userDataDir);
    repoId = useDb().upsertRepo(repoPath, 'remote');
});

afterAll(() => {
    useDatabase().close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
});

function cleanStatus() {
    return {
        branch: 'main',
        ahead: 0,
        behind: 0,
        hasRemote: true,
        hasUpstream: true,
        publishableCommits: 0,
        changedFiles: 0,
        stagedFiles: 0,
        unstagedFiles: 0,
        isDirty: false,
        error: undefined,
        lastScannedAt: new Date(0).toISOString(),
    };
}

function remoteNotFound() {
    // The wording git prints for a private remote the token cannot see.
    return new GitCommandError('fatal', ['git', 'remote'], "remote: Repository 'https://example.invalid/acme/private.git' not found");
}

beforeEach(() => {
    gitMocks.resetAll();
    gitMocks.mockFor('getRepoSidebarStatus').mockResolvedValue(cleanStatus());
    authMocks.readAccountSecret.mockReset().mockResolvedValue('ghp_secret');
    useDb().assignRepoAccount(repoId, undefined);
});

describe('app getChanges', () => {
    it('reads changes with the stored ignore settings', async () => {
        app.updateEditorSettings({ settings: { ...app.getEditorSettings(), diffIgnoredChars: ',;', showWhitespaceChanges: true } });
        const changes = {
            staged: [],
            unstaged: [],
            stagedStats: { addedLines: 0, removedLines: 0, hasChanges: false },
            unstagedStats: { addedLines: 0, removedLines: 0, hasChanges: false },
        };
        gitMocks.mockFor('getRepoChanges').mockResolvedValue(changes);

        await expect(app.getChanges({ repoId })).resolves.toBe(changes);
        expect(gitMocks.mockFor('getRepoChanges')).toHaveBeenCalledWith(repoPath, { ignoredChars: ',;', showWhitespaceChanges: true });
    });
});

describe('app runRemoteOperation', () => {
    it('reports a completed operation with the refreshed bootstrap', async () => {
        gitMocks.mockFor('runRepoRemoteOperation').mockResolvedValue(undefined);

        const result = await app.runRemoteOperation({ repoId, operation: 'fetch' });

        expect(result).toMatchObject({ status: 'completed', stashed: false });
        expect(gitMocks.mockFor('runRepoRemoteOperation')).toHaveBeenCalledWith(repoPath, 'fetch', undefined);
        expect(result.bootstrap.repos.map((repo) => repo.id)).toContain(repoId);
    });

    it('turns a pull merge conflict into the conflicted result with the unmerged files', async () => {
        gitMocks.mockFor('runRepoRemoteOperation').mockRejectedValue(new Error('conflict'));
        gitMocks.mockFor('isPullMergeConflictError').mockReturnValue(true);
        gitMocks.mockFor('listUnmergedRepoFiles').mockResolvedValue(['a.txt', 'b.txt']);

        await expect(app.runRemoteOperation({ repoId, operation: 'pull' })).resolves.toMatchObject({
            status: 'conflicted',
            stashed: false,
            conflictingFiles: ['a.txt', 'b.txt'],
        });
    });

    it('turns a blocked pull into the blocked result with the files it names', async () => {
        gitMocks.mockFor('runRepoRemoteOperation').mockRejectedValue(new Error('blocked'));
        gitMocks.mockFor('isPullBlockedByLocalChangesError').mockReturnValue(true);
        gitMocks.mockFor('getPullBlockedByLocalChangesFiles').mockReturnValue(['local.txt']);

        await expect(app.runRemoteOperation({ repoId, operation: 'pull' })).resolves.toMatchObject({
            status: 'blocked-by-local-changes',
            stashed: false,
            conflictingFiles: ['local.txt'],
        });
    });

    it('rethrows a failure that is not a handled pull outcome', async () => {
        gitMocks.mockFor('runRepoRemoteOperation').mockRejectedValue(new Error('network down'));

        await expect(app.runRemoteOperation({ repoId, operation: 'fetch' })).rejects.toThrow('network down');
    });

    it('turns a rejected push into the non-fast-forward result instead of an error', async () => {
        gitMocks.mockFor('runRepoRemoteOperation').mockRejectedValue(new Error('rejected'));
        gitMocks.mockFor('isPushRejectedByRemoteError').mockReturnValue(true);

        await expect(app.runRemoteOperation({ repoId, operation: 'push' })).resolves.toMatchObject({
            status: 'rejected-non-fast-forward',
            stashed: false,
        });
    });

    it('still throws the original push failure when the rejection is not recognised', async () => {
        gitMocks.mockFor('runRepoRemoteOperation').mockRejectedValue(new Error('push rejected for another reason'));
        gitMocks.mockFor('isPushRejectedByRemoteError').mockReturnValue(false);

        await expect(app.runRemoteOperation({ repoId, operation: 'push' })).rejects.toThrow('push rejected for another reason');
    });

    it('explains a remote the assigned account cannot see', async () => {
        const accountId = useDb().createAccount('Limited', 'github', 'https-token', 'octocat', 'github.com', false);
        useDb().assignRepoAccount(repoId, accountId);
        gitMocks.mockFor('runRepoRemoteOperation').mockRejectedValue(remoteNotFound());

        try {
            await expect(app.runRemoteOperation({ repoId, operation: 'fetch' })).rejects.toThrow(/does not have access to this remote repository/);
        } finally {
            useDb().removeAccount(accountId);
        }
    });
});

describe('app remote auth resolution', () => {
    it('reports an account that is missing its username or its stored secret', async () => {
        const accountId = useDb().createAccount('No username', 'github', 'https-token', undefined, 'github.com', false);
        useDb().assignRepoAccount(repoId, accountId);

        try {
            await expect(app.runRemoteOperation({ repoId, operation: 'fetch' })).rejects.toThrow('The assigned account is missing a username.');

            useDb().updateAccount(accountId, 'No username', 'octocat', 'github.com', false);
            authMocks.readAccountSecret.mockResolvedValue('');

            await expect(app.runRemoteOperation({ repoId, operation: 'fetch' })).rejects.toThrow('The assigned account is missing its stored access token.');
        } finally {
            useDb().removeAccount(accountId);
        }
    });

    it('uses an OAuth secret and refuses one that is expired or malformed', async () => {
        const accountId = useDb().createAccount('OAuth', 'github', 'oauth', 'octocat', 'github.com', false);
        useDb().assignRepoAccount(repoId, accountId);
        gitMocks.mockFor('runRepoRemoteOperation').mockResolvedValue(undefined);

        try {
            authMocks.readAccountSecret.mockResolvedValue(JSON.stringify({ kind: 'oauth', provider: 'github', accessToken: 'oauth-token' }));
            await expect(app.runRemoteOperation({ repoId, operation: 'fetch' })).resolves.toMatchObject({ status: 'completed' });
            expect(gitMocks.mockFor('runRepoRemoteOperation')).toHaveBeenCalledWith(repoPath, 'fetch', {
                kind: 'https-token',
                username: 'octocat',
                password: 'oauth-token',
                host: 'github.com',
            });

            authMocks.readAccountSecret.mockResolvedValue(JSON.stringify({ kind: 'oauth', provider: 'gitlab', accessToken: 'oauth-token' }));
            await app.runRemoteOperation({ repoId, operation: 'fetch' });
            expect(gitMocks.mockFor('runRepoRemoteOperation')).toHaveBeenLastCalledWith(repoPath, 'fetch', {
                kind: 'https-token',
                username: 'oauth2',
                password: 'oauth-token',
                host: 'github.com',
            });

            authMocks.readAccountSecret.mockResolvedValue(JSON.stringify({ kind: 'oauth', provider: 'github', accessToken: 'oauth-token', expiresAt: '2000-01-01T00:00:00.000Z' }));
            await expect(app.runRemoteOperation({ repoId, operation: 'fetch' })).rejects.toThrow('The assigned OAuth account has expired. Sign in again to continue.');

            authMocks.readAccountSecret.mockResolvedValue(JSON.stringify({ kind: 'other' }));
            await expect(app.runRemoteOperation({ repoId, operation: 'fetch' })).rejects.toThrow('The stored OAuth secret is invalid.');
        } finally {
            useDb().removeAccount(accountId);
        }
    });
});

describe('app stash and merge recovery', () => {
    it('stashes through the resolved account auth', async () => {
        gitMocks.mockFor('stashRepoChanges').mockResolvedValue(undefined);

        await expect(app.stashRepo({ repoId })).resolves.toMatchObject({ repos: expect.any(Array) });
        expect(gitMocks.mockFor('stashRepoChanges')).toHaveBeenCalledWith(repoPath, undefined);
    });

    it('completes a retry pull that was stashed first', async () => {
        gitMocks.mockFor('stashRepoChanges').mockResolvedValue(undefined);
        gitMocks.mockFor('runRepoRemoteOperation').mockResolvedValue(undefined);

        await expect(app.retryPullAfterStash({ repoId })).resolves.toMatchObject({ status: 'completed', stashed: true });
        expect(gitMocks.mockFor('stashRepoChanges')).toHaveBeenCalledWith(repoPath, undefined);
        expect(gitMocks.mockFor('runRepoRemoteOperation')).toHaveBeenCalledWith(repoPath, 'pull', undefined);
    });

    it('keeps the stash when the retry pull conflicts', async () => {
        gitMocks.mockFor('stashRepoChanges').mockResolvedValue(undefined);
        gitMocks.mockFor('runRepoRemoteOperation').mockRejectedValue(new Error('conflict'));
        gitMocks.mockFor('isPullMergeConflictError').mockReturnValue(true);
        gitMocks.mockFor('listUnmergedRepoFiles').mockResolvedValue(['story.txt']);

        await expect(app.retryPullAfterStash({ repoId })).resolves.toMatchObject({ status: 'conflicted', stashed: true, conflictingFiles: ['story.txt'] });
    });

    it('rethrows a retry pull that fails for another reason', async () => {
        gitMocks.mockFor('stashRepoChanges').mockResolvedValue(undefined);
        gitMocks.mockFor('runRepoRemoteOperation').mockRejectedValue(new Error('offline'));

        await expect(app.retryPullAfterStash({ repoId })).rejects.toThrow('offline');
    });

    it('reports a restored stash and keeps it when the restore conflicts', async () => {
        gitMocks.mockFor('restoreRepoStash').mockResolvedValue(undefined);

        await expect(app.restoreStash({ repoId, stashRef: 'stash@{0}' })).resolves.toMatchObject({ status: 'completed', kept: false, conflictingFiles: [] });
        expect(gitMocks.mockFor('restoreRepoStash')).toHaveBeenCalledWith(repoPath, 'stash@{0}');

        gitMocks.mockFor('restoreRepoStash').mockRejectedValue(new Error('conflict'));
        gitMocks.mockFor('isStashRestoreConflictError').mockReturnValue(true);
        gitMocks.mockFor('listUnmergedRepoFiles').mockResolvedValue(['a.txt']);

        await expect(app.restoreStash({ repoId, stashRef: 'stash@{0}' })).resolves.toMatchObject({ status: 'conflicted', kept: true, conflictingFiles: ['a.txt'] });

        gitMocks.mockFor('restoreRepoStash').mockRejectedValue(new Error('unrelated'));
        gitMocks.mockFor('isStashRestoreConflictError').mockReturnValue(false);

        await expect(app.restoreStash({ repoId, stashRef: 'stash@{0}' })).rejects.toThrow('unrelated');
    });

    it('discards a stash through the git service', async () => {
        gitMocks.mockFor('discardRepoStash').mockResolvedValue(undefined);

        await expect(app.discardStash({ repoId, stashRef: 'stash@{0}' })).resolves.toBeDefined();
        expect(gitMocks.mockFor('discardRepoStash')).toHaveBeenCalledWith(repoPath, 'stash@{0}');
    });
});

describe('app remote tag and branch publishing', () => {
    it('pushes a tag, every tag, a branch and a remote branch through the auth', async () => {
        for (const method of ['pushRepoTag', 'pushRepoAllTags', 'deleteRemoteRepoTag', 'publishRepoBranch', 'createRemoteRepoBranch']) {
            gitMocks.mockFor(method).mockResolvedValue(undefined);
        }

        await app.pushTag({ repoId, tagName: 'v1.0.0' });
        await app.pushAllTags({ repoId });
        await app.deleteRemoteTag({ repoId, tagName: 'v1.0.0' });
        await app.publishBranch({ repoId });
        await app.createRemoteBranch({ repoId, branchName: 'feature' });

        expect(gitMocks.mockFor('pushRepoTag')).toHaveBeenCalledWith(repoPath, 'v1.0.0', undefined);
        expect(gitMocks.mockFor('pushRepoAllTags')).toHaveBeenCalledWith(repoPath, undefined);
        expect(gitMocks.mockFor('deleteRemoteRepoTag')).toHaveBeenCalledWith(repoPath, 'v1.0.0', undefined);
        expect(gitMocks.mockFor('publishRepoBranch')).toHaveBeenCalledWith(repoPath, undefined);
        expect(gitMocks.mockFor('createRemoteRepoBranch')).toHaveBeenCalledWith(repoPath, 'feature', undefined);
    });

    it('translates the remote-not-found failure for every publishing operation', async () => {
        const accountId = useDb().createAccount('Publisher', 'github', 'https-token', 'octocat', 'github.com', false);
        useDb().assignRepoAccount(repoId, accountId);

        try {
            gitMocks.mockFor('pushRepoTag').mockRejectedValue(remoteNotFound());
            await expect(app.pushTag({ repoId, tagName: 'v1.0.0' })).rejects.toThrow(/does not have access to this remote repository/);

            gitMocks.mockFor('pushRepoAllTags').mockRejectedValue(remoteNotFound());
            await expect(app.pushAllTags({ repoId })).rejects.toThrow(/does not have access to this remote repository/);

            gitMocks.mockFor('deleteRemoteRepoTag').mockRejectedValue(remoteNotFound());
            await expect(app.deleteRemoteTag({ repoId, tagName: 'v1.0.0' })).rejects.toThrow(/does not have access to this remote repository/);

            gitMocks.mockFor('publishRepoBranch').mockRejectedValue(remoteNotFound());
            await expect(app.publishBranch({ repoId })).rejects.toThrow(/does not have access to this remote repository/);

            gitMocks.mockFor('createRemoteRepoBranch').mockRejectedValue(remoteNotFound());
            await expect(app.createRemoteBranch({ repoId, branchName: 'feature' })).rejects.toThrow(/does not have access to this remote repository/);
        } finally {
            useDb().removeAccount(accountId);
        }
    });
});

describe('app repo-scoped handlers delegate to the git service', () => {
    const cases: Array<{ method: string; call: () => Promise<unknown>; args: unknown[]; passthrough?: boolean }> = [
        { method: 'getRepoStashes', call: () => app.getStashes({ repoId }), args: [repoPath], passthrough: true },
        { method: 'getRepoStashDetail', call: () => app.getStashDetail({ repoId, stashRef: 'stash@{0}' }), args: [repoPath, 'stash@{0}'], passthrough: true },
        {
            method: 'getRepoStashFileDiff',
            call: () => app.getStashFileDiff({ repoId, stashRef: 'stash@{0}', path: 'a.txt' }),
            args: [repoPath, 'stash@{0}', 'a.txt', undefined],
            passthrough: true,
        },
        { method: 'getRepoMergeConflictState', call: () => app.getMergeConflictState({ repoId }), args: [repoPath], passthrough: true },
        { method: 'getRepoMergeConflictFileDetails', call: () => app.getMergeConflictFileDetails({ repoId, path: 'a.txt' }), args: [repoPath, 'a.txt'], passthrough: true },
        { method: 'getFileDiff', call: () => app.getFileDiff({ repoId, path: 'a.txt', kind: 'unstaged' }), args: [repoPath, 'a.txt', 'unstaged'], passthrough: true },
        { method: 'getRepoTags', call: () => app.getTags({ repoId }), args: [repoPath], passthrough: true },
        { method: 'getRepoBranches', call: () => app.getBranches({ repoId }), args: [repoPath], passthrough: true },
        { method: 'getRepoCommitMessage', call: () => app.getCommitMessage({ repoId, commitSha: 'sha' }), args: [repoPath, 'sha'], passthrough: true },
        { method: 'getCommittedTree', call: () => app.getCommittedTree({ repoId, commitSha: 'HEAD' }), args: [repoPath, 'HEAD'], passthrough: true },
        { method: 'getCommittedFile', call: () => app.getCommittedFile({ repoId, path: 'a.txt' }), args: [repoPath, 'a.txt', undefined], passthrough: true },
        { method: 'getCommitDetail', call: () => app.getCommitDetail({ repoId, commitSha: 'sha' }), args: [repoPath, 'sha'], passthrough: true },
        {
            method: 'getCommitFileDiff',
            call: () => app.getCommitFileDiff({ repoId, commitSha: 'sha', path: 'a.txt' }),
            args: [repoPath, 'sha', 'a.txt', undefined],
            passthrough: true,
        },
        {
            method: 'getRepoHistory',
            call: () => app.getHistory({ repoId, limit: 20, skip: 5, search: 'fix', path: 'a.txt', followRenames: true }),
            args: [repoPath, { limit: 20, skip: 5, search: 'fix', path: 'a.txt', followRenames: true }],
            passthrough: true,
        },
        { method: 'stageRepoFile', call: () => app.stageFile({ repoId, path: 'a.txt' }), args: [repoPath, 'a.txt'] },
        { method: 'stageRepoFiles', call: () => app.stageRepoFiles({ repoId, paths: ['a.txt'] }), args: [repoPath, ['a.txt']] },
        { method: 'stageAllRepoFiles', call: () => app.stageAllFiles({ repoId }), args: [repoPath] },
        { method: 'unstageRepoFile', call: () => app.unstageFile({ repoId, path: 'a.txt' }), args: [repoPath, 'a.txt'] },
        { method: 'unstageRepoFiles', call: () => app.unstageRepoFiles({ repoId, paths: ['a.txt'] }), args: [repoPath, ['a.txt']] },
        { method: 'unstageAllRepoFiles', call: () => app.unstageAllFiles({ repoId }), args: [repoPath] },
        { method: 'discardRepoFile', call: () => app.discardFile({ repoId, path: 'a.txt' }), args: [repoPath, 'a.txt'] },
        { method: 'discardRepoFiles', call: () => app.discardRepoFiles({ repoId, paths: ['a.txt'] }), args: [repoPath, ['a.txt']] },
        { method: 'discardAllRepoChanges', call: () => app.discardAllChanges({ repoId }), args: [repoPath] },
        { method: 'applyPatch', call: () => app.applyPatch({ repoId, patch: 'patch', mode: 'stage' }), args: [repoPath, 'patch', 'stage'] },
        { method: 'restoreRepoFile', call: () => app.restoreRepoFile({ repoId, path: 'a.txt', kind: 'staged' }), args: [repoPath, 'a.txt', 'staged'] },
        { method: 'restoreRepoFiles', call: () => app.restoreRepoFiles({ repoId, paths: ['a.txt'], kind: 'unstaged' }), args: [repoPath, ['a.txt'], 'unstaged'] },
        { method: 'deleteStagedRepoFile', call: () => app.deleteStagedRepoFile({ repoId, path: 'a.txt' }), args: [repoPath, 'a.txt'] },
        { method: 'deleteStagedRepoFiles', call: () => app.deleteStagedRepoFiles({ repoId, paths: ['a.txt'] }), args: [repoPath, ['a.txt']] },
        { method: 'ignoreRepoPath', call: () => app.ignoreRepoPath({ repoId, path: 'a.txt', mode: 'file' }), args: [repoPath, 'a.txt', 'file'] },
        { method: 'resolveRepoMergeConflict', call: () => app.resolveMergeConflictFile({ repoId, path: 'a.txt', resolution: 'ours' }), args: [repoPath, 'a.txt', 'ours'] },
        { method: 'markRepoConflictResolved', call: () => app.markMergeConflictResolved({ repoId, path: 'a.txt' }), args: [repoPath, 'a.txt'] },
        {
            method: 'saveRepoMergeConflictResolution',
            call: () => app.saveMergeConflictResolution({ repoId, path: 'a.txt', resolvedContent: 'resolved' }),
            args: [repoPath, 'a.txt', 'resolved'],
        },
        { method: 'abortRepoMerge', call: () => app.abortMerge({ repoId }), args: [repoPath] },
        { method: 'commitRepoMerge', call: () => app.commitMerge({ repoId }), args: [repoPath] },
        {
            method: 'commitRepoChanges',
            call: () => app.commitRepo({ repoId, summary: 'summary', description: 'description', amend: false }),
            args: [repoPath, 'summary', 'description', false],
        },
        {
            method: 'rewordRepoCommit',
            call: () => app.rewordCommit({ repoId, commitSha: 'sha', summary: 'summary', description: 'description' }),
            args: [repoPath, 'sha', 'summary', 'description'],
        },
        { method: 'undoLastRepoCommit', call: () => app.undoLastCommit({ repoId }), args: [repoPath] },
        { method: 'createRepoTag', call: () => app.createTag({ repoId, commitSha: 'sha', tagName: 'v1', message: 'message' }), args: [repoPath, 'sha', 'v1', 'message'] },
        { method: 'renameRepoTag', call: () => app.renameTag({ repoId, tagName: 'v1', nextTagName: 'v2' }), args: [repoPath, 'v1', 'v2'] },
        { method: 'deleteRepoTag', call: () => app.deleteTag({ repoId, tagName: 'v1' }), args: [repoPath, 'v1'] },
        { method: 'checkoutRepoBranch', call: () => app.checkoutBranch({ repoId, branchName: 'main' }), args: [repoPath, 'main'] },
        { method: 'createRepoBranch', call: () => app.createBranch({ repoId, branchName: 'feature' }), args: [repoPath, 'feature'] },
    ];

    it.each(cases)('$method', async ({ method, call, args, passthrough }) => {
        const mock = gitMocks.mockFor(method);
        const sentinel = { method };
        mock.mockResolvedValue(sentinel);

        const result = await call();

        expect(mock).toHaveBeenCalledWith(...args);

        if (passthrough) {
            expect(result).toBe(sentinel);
        } else {
            expect(result).toMatchObject({ repos: expect.any(Array) });
        }
    });
});
