import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
