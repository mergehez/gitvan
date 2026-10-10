import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../../../backend/services/app.js';
import { useDb } from '../../../../backend/services/database.js';
import { useDatabase } from '../../../../electronUtils/useDatabase.js';
import { repositoryNotFoundMessage } from '../../../../shared/repositoryErrors.js';

// The database client is a module singleton that refuses to configure twice.
const userDataDir = mkdtempSync(join(tmpdir(), 'gitvan-app-'));

beforeAll(() => {
    useDb().configureDatabase(userDataDir);
});

afterAll(() => {
    useDatabase().close();
    rmSync(userDataDir, { recursive: true, force: true });
});

const unknownRepoId = 987_654;

/**
 * Every repository-scoped handler used to dereference a missing row (`.path` on `undefined`) and
 * report a TypeError. A repository removed while a request is in flight has to surface as the
 * message the renderer recognises instead.
 */
const repoScopedCalls: Array<[string, (repoId: number) => Promise<unknown>]> = [
    ['getChanges', (repoId) => app.getChanges({ repoId })],
    ['getFileDiff', (repoId) => app.getFileDiff({ repoId, path: 'a.txt', kind: 'unstaged' })],
    ['getStashes', (repoId) => app.getStashes({ repoId })],
    ['getMergeConflictState', (repoId) => app.getMergeConflictState({ repoId })],
    ['getTags', (repoId) => app.getTags({ repoId })],
    ['getBranches', (repoId) => app.getBranches({ repoId })],
    ['getHistory', (repoId) => app.getHistory({ repoId, limit: 10, skip: 0 })],
    ['getCommittedTree', (repoId) => app.getCommittedTree({ repoId, commitSha: 'HEAD' })],
    ['stageFile', (repoId) => app.stageFile({ repoId, path: 'a.txt' })],
    ['commitRepo', (repoId) => app.commitRepo({ repoId, summary: 'message', description: '', amend: false })],
    ['discardAllChanges', (repoId) => app.discardAllChanges({ repoId })],
    ['checkoutBranch', (repoId) => app.checkoutBranch({ repoId, branchName: 'main' })],
    ['deleteTag', (repoId) => app.deleteTag({ repoId, tagName: 'v1.0.0' })],
    ['abortMerge', (repoId) => app.abortMerge({ repoId })],
    ['stashRepo', (repoId) => app.stashRepo({ repoId })],
    ['publishBranch', (repoId) => app.publishBranch({ repoId })],
];

describe('app handlers for a repository that no longer exists', () => {
    it.each(repoScopedCalls)('%s reports the repository as missing instead of throwing a TypeError', async (_name, call) => {
        await expect(call(unknownRepoId)).rejects.toThrow(repositoryNotFoundMessage);
    });

    it('does not leak a TypeError for a missing repository', async () => {
        const error = await app.getChanges({ repoId: unknownRepoId }).then(
            () => undefined,
            (thrown: unknown) => thrown as Error
        );

        expect(error?.message).toBe(repositoryNotFoundMessage);
        expect(error?.message).not.toMatch(/reading 'path'/);
    });
});

describe('app bootstrap', () => {
    it('reports no repositories and no selection for a fresh database', async () => {
        await expect(app.getBootstrap()).resolves.toMatchObject({ repos: [], groups: [], selectedRepoId: undefined });
    });
});

describe('app.resolveRepoFilePath', () => {
    let repoPath: string;
    let repoId: number;

    // Kept last in the file so the bootstrap test above still sees an empty database.
    beforeAll(() => {
        repoPath = mkdtempSync(join(tmpdir(), 'gitvan-app-paths-'));
        repoId = useDb().upsertRepo(repoPath, 'paths');
    });

    afterAll(() => {
        useDb().removeRepo(repoId);
        rmSync(repoPath, { recursive: true, force: true });
    });

    it('resolves a repository-relative path', () => {
        expect(app.resolveRepoFilePath({ repoId, path: 'src/app.ts' })).toBe(join(repoPath, 'src', 'app.ts'));
    });

    it('resolves the repository root for an empty path', () => {
        expect(app.resolveRepoFilePath({ repoId, path: '' })).toBe(repoPath);
    });

    it('normalizes a path that stays inside the repository', () => {
        expect(app.resolveRepoFilePath({ repoId, path: 'nested/../inside.txt' })).toBe(join(repoPath, 'inside.txt'));
    });

    it('rejects a path that escapes the repository', () => {
        expect(() => app.resolveRepoFilePath({ repoId, path: '../outside.txt' })).toThrow(/outside the repository/);
        expect(() => app.resolveRepoFilePath({ repoId, path: '../../etc/passwd' })).toThrow(/outside the repository/);
        expect(() => app.resolveRepoFilePath({ repoId, path: 'nested/../../escape.txt' })).toThrow(/outside the repository/);
        expect(() => app.resolveRepoFilePath({ repoId, path: '/etc/passwd' })).toThrow(/outside the repository/);
    });

    it('rejects a sibling directory that shares the repository prefix', () => {
        expect(() => app.resolveRepoFilePath({ repoId, path: `../${basename(repoPath)}-evil/secret` })).toThrow(/outside the repository/);
    });
});

function gitSetup(cwd: string, args: string[]) {
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createTrackedRepo(prefix: string) {
    const repoPath = mkdtempSync(join(tmpdir(), prefix));

    gitSetup(repoPath, ['init']);
    gitSetup(repoPath, ['config', 'user.name', 'Gitvan Test']);
    gitSetup(repoPath, ['config', 'user.email', 'gitvan@example.com']);
    writeFileSync(join(repoPath, 'tracked.txt'), 'one\n', 'utf8');
    gitSetup(repoPath, ['add', 'tracked.txt']);
    gitSetup(repoPath, ['commit', '-m', 'Initial commit']);

    return repoPath;
}

describe('app mutation results', () => {
    let repoPath: string;
    let repoId: number;

    // Kept after the bootstrap test so the empty-database expectation above still holds.
    beforeAll(() => {
        repoPath = createTrackedRepo('gitvan-app-mutation-');
        repoId = useDb().upsertRepo(repoPath, 'mutation');
    });

    afterAll(() => {
        useDb().removeRepo(repoId);
        rmSync(repoPath, { recursive: true, force: true });
    });

    it('ships rows without statuses and patches only the repository the mutation touched', async () => {
        // Prime the status cache the way startup does.
        const bootstrap = await app.getBootstrap();
        expect(bootstrap.repos.find((repo) => repo.id === repoId)?.status).toBeDefined();

        writeFileSync(join(repoPath, 'tracked.txt'), 'one\ntwo\n', 'utf8');

        const result = await app.stageFile({ repoId, path: 'tracked.txt' });

        expect(result.repos.find((repo) => repo.id === repoId)).not.toHaveProperty('status');
        expect(result.statuses.map((patch) => patch.id)).toEqual([repoId]);
        expect(result.statuses[0]?.status.stagedFiles).toBe(1);
    });

    it('patches nothing when the mutation touched no repository', async () => {
        const result = await app.createRepoGroup({ name: 'Mutation Group' });

        expect(result.statuses).toEqual([]);
        expect(result.groups.some((group) => group.name === 'Mutation Group')).toBe(true);

        useDb().deleteGroup(result.groups.find((group) => group.name === 'Mutation Group')!.id);
    });

    it('patches a repository the renderer has never seen', async () => {
        const otherPath = createTrackedRepo('gitvan-app-mutation-other-');
        const otherId = useDb().upsertRepo(otherPath, 'mutation-other');

        try {
            // A rename runs no git command, so the only patch is the uncached repository.
            const result = await app.renameRepo({ repoId: otherId, name: 'mutation-other-renamed' });

            expect(result.statuses.map((patch) => patch.id)).toEqual([otherId]);
            expect(result.repos.find((repo) => repo.id === otherId)?.name).toBe('mutation-other-renamed');
        } finally {
            useDb().removeRepo(otherId);
            rmSync(otherPath, { recursive: true, force: true });
        }
    });
});
