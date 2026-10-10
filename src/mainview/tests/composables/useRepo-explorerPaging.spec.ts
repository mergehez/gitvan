import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitSummary, CommittedTreeData, HistoryData, Repo } from '../../../shared/types';

const { getHistoryRun, getCommittedTreeRun, getCommittedFileRun } = vi.hoisted(() => ({
    getHistoryRun: vi.fn(),
    getCommittedTreeRun: vi.fn(),
    getCommittedFileRun: vi.fn(),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: {
            diffIgnoredChars: '',
            diffIgnoredCharsEnabled: true,
            showWhitespaceChanges: false,
            activeView: 'explorer',
        },
        openRepoPathInEditor: vi.fn(),
        setActiveView: vi.fn(),
    }),
}));

vi.mock('../../composables/useAuth', () => ({
    useAuth: () => ({
        accounts: [],
    }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        isBusy: false,
        isOperationRunning: vi.fn(() => false),
        getHistory: {
            run: getHistoryRun,
        },
        getCommittedTree: {
            run: getCommittedTreeRun,
        },
        getCommittedFile: {
            run: getCommittedFileRun,
        },
    },
}));

import { useRepo } from '../../composables/useRepo';

let nextRepoId = 1;

function createRepo(): Repo {
    const id = nextRepoId++;
    const name = `ExplorerRepo${id}`;

    return {
        id,
        name,
        path: `/tmp/${name.toLowerCase()}`,
        sequence: id,
        groupId: 1,
        groupName: 'Test',
        accountId: undefined,
        accountLabel: undefined,
        terminalPath: undefined,
        addedAt: '2026-07-25T00:00:00.000Z',
        lastOpenedAt: '2026-07-25T00:00:00.000Z',
        status: {
            branch: 'main',
            ahead: 0,
            behind: 0,
            hasRemote: false,
            hasUpstream: false,
            publishableCommits: 0,
            changedFiles: 0,
            stagedFiles: 0,
            unstagedFiles: 0,
            isDirty: false,
            error: undefined,
            lastScannedAt: undefined,
        },
    };
}

function createCommit(index: number): CommitSummary {
    const sha = `sha-${String(index).padStart(3, '0')}`;

    return {
        sha,
        shortSha: sha,
        summary: `Commit ${index}`,
        authorName: 'Gitvan Test',
        authorEmail: 'gitvan@example.com',
        authoredAt: '2026-07-25T00:00:00.000Z',
        refs: [],
        tags: [],
        isUnpushed: false,
    };
}

function createTree(): CommittedTreeData {
    return {
        commitSha: 'head',
        files: [{ path: 'README.md', sizeBytes: 1 }],
    };
}

/** Serves the newest-first commit list the way the backend does: skip, then `limit` (60 default). */
function serveHistory(total: number, requests: Array<{ skip?: number; limit?: number }> = []) {
    const commits = Array.from({ length: total }, (_, index) => createCommit(index));

    getHistoryRun.mockImplementation(async (request: { skip?: number; limit?: number }) => {
        requests.push(request);

        const skip = request.skip ?? 0;
        const limit = request.limit ?? 60;

        return {
            commits: commits.slice(skip, skip + limit),
            hasMore: skip + limit < commits.length,
        } satisfies HistoryData;
    });
}

describe('useRepo explorer snapshots', () => {
    beforeEach(() => {
        getHistoryRun.mockReset();
        getCommittedTreeRun.mockReset();
        getCommittedFileRun.mockReset();
        getCommittedTreeRun.mockResolvedValue(createTree());
        getCommittedFileRun.mockResolvedValue({ path: 'README.md', content: 'text', sizeBytes: 1 });
    });

    it('keeps the Explorer commit list out of the History view list', async () => {
        serveHistory(130);

        const repo = useRepo(createRepo());
        await repo.loadCommittedTree();

        expect(getHistoryRun).toHaveBeenCalledWith({ repoId: repo.id, limit: undefined });
        expect(repo.explorerHistory?.commits).toHaveLength(60);
        expect(repo.history).toBeUndefined();
        expect(repo.explorerCommitSha).toBe('sha-000');
    });

    it('appends an older page without dropping the selected snapshot', async () => {
        const requests: Array<{ skip?: number; limit?: number }> = [];
        serveHistory(130, requests);

        const repo = useRepo(createRepo());
        await repo.loadCommittedTree();
        await repo.selectExplorerCommit('sha-059');

        expect(await repo.loadMoreExplorerCommits()).toBe(true);
        expect(requests).toEqual([{ repoId: repo.id, limit: undefined }, { repoId: repo.id, skip: 60 }]);
        expect(repo.explorerHistory?.commits).toHaveLength(120);
        expect(repo.explorerHistory?.hasMore).toBe(true);
        expect(repo.explorerCommitSha).toBe('sha-059');
        expect(repo.isLoadingMoreExplorerHistory).toBe(false);
    });

    it('stops paging once every commit is loaded', async () => {
        serveHistory(130);

        const repo = useRepo(createRepo());
        await repo.loadCommittedTree();
        await repo.loadMoreExplorerCommits();
        await repo.loadMoreExplorerCommits();

        expect(repo.explorerHistory?.commits).toHaveLength(130);
        expect(repo.explorerHistory?.hasMore).toBe(false);
        expect(await repo.loadMoreExplorerCommits()).toBe(false);
        expect(getHistoryRun).toHaveBeenCalledTimes(3);
    });

    it('re-requests the older pages a refresh would otherwise drop', async () => {
        const requests: Array<{ skip?: number; limit?: number }> = [];
        serveHistory(75, requests);

        const repo = useRepo(createRepo());
        await repo.loadCommittedTree();
        await repo.loadMoreExplorerCommits();
        await repo.selectExplorerCommit('sha-061');

        // A foreground refresh reloads the Explorer data.
        await repo.loadCommittedTree();

        // The refresh asks for the whole loaded window, not just the newest page.
        expect(requests[2]).toEqual({ repoId: repo.id, limit: 75 });
        expect(repo.explorerHistory?.commits).toHaveLength(75);
        expect(repo.explorerCommitSha).toBe('sha-061');
    });

    it('falls back to the newest snapshot when the selected commit is gone', async () => {
        serveHistory(5);

        const repo = useRepo(createRepo());
        await repo.loadCommittedTree();
        await repo.selectExplorerCommit('sha-004');
        serveHistory(4);
        await repo.loadCommittedTree();

        expect(repo.explorerCommitSha).toBe('sha-000');
    });

    it('clears the Explorer list with the rest of the view state', async () => {
        serveHistory(5);

        const repo = useRepo(createRepo());
        await repo.loadCommittedTree();
        repo.clearViewState();

        expect(repo.explorerHistory).toBeUndefined();
        expect(repo.explorerCommitSha).toBeUndefined();
    });
});
