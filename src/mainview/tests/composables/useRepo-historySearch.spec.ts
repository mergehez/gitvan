import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitSummary, HistoryData, Repo } from '../../../shared/types';

const { getHistoryRun } = vi.hoisted(() => ({
    getHistoryRun: vi.fn(),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: {
            diffIgnoredChars: '',
            diffIgnoredCharsEnabled: true,
            showWhitespaceChanges: false,
            activeView: 'history',
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
    },
}));

import { useRepo } from '../../composables/useRepo';

let nextRepoId = 1;

function createRepo(): Repo {
    const id = nextRepoId++;
    const name = `SearchRepo${id}`;

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

function createCommit(sha: string): CommitSummary {
    return {
        sha,
        shortSha: sha,
        summary: `Commit ${sha}`,
        authorName: 'Gitvan Test',
        authorEmail: 'gitvan@example.com',
        authoredAt: '2026-07-25T00:00:00.000Z',
        refs: [],
        tags: [],
        isUnpushed: false,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

describe('useRepo history search', () => {
    beforeEach(() => {
        getHistoryRun.mockReset();
    });

    it('trims the query and stores the results', async () => {
        getHistoryRun.mockResolvedValueOnce({ commits: [createCommit('aaa')], hasMore: true });

        const repo = useRepo(createRepo());
        await repo.searchHistory('  aaa  ');

        expect(getHistoryRun).toHaveBeenCalledWith({ repoId: repo.id, search: 'aaa' });
        expect(repo.historySearchQuery).toBe('aaa');
        expect(repo.historySearchResults?.commits.map((commit) => commit.sha)).toEqual(['aaa']);
        expect(repo.isSearchingHistory).toBe(false);
    });

    it('discards a slow response when a newer query has started', async () => {
        const firstSearch = deferred<HistoryData>();
        const secondSearch = deferred<HistoryData>();
        getHistoryRun.mockReturnValueOnce(firstSearch.promise).mockReturnValueOnce(secondSearch.promise);

        const repo = useRepo(createRepo());
        const firstCall = repo.searchHistory('aa');
        const secondCall = repo.searchHistory('aab');

        secondSearch.resolve({ commits: [createCommit('bbb')], hasMore: false });
        await secondCall;

        firstSearch.resolve({ commits: [createCommit('aaa')], hasMore: false });
        await firstCall;

        expect(repo.historySearchQuery).toBe('aab');
        expect(repo.historySearchResults?.commits.map((commit) => commit.sha)).toEqual(['bbb']);
        expect(repo.isSearchingHistory).toBe(false);
    });

    it('does not leave the loading flag stuck when a refresh supersedes an in-flight search', async () => {
        const search = deferred<HistoryData>();
        const refresh = deferred<HistoryData>();
        getHistoryRun.mockReturnValueOnce(search.promise).mockReturnValueOnce(refresh.promise);

        const repo = useRepo(createRepo());
        const searchCall = repo.searchHistory('abc');
        expect(repo.isSearchingHistory).toBe(true);

        const refreshCall = repo.refreshHistorySearch();
        refresh.resolve({ commits: [createCommit('ccc')], hasMore: false });
        await refreshCall;

        expect(repo.isSearchingHistory).toBe(false);
        expect(repo.historySearchResults?.commits.map((commit) => commit.sha)).toEqual(['ccc']);

        search.resolve({ commits: [], hasMore: false });
        await searchCall;

        expect(repo.historySearchResults?.commits.map((commit) => commit.sha)).toEqual(['ccc']);
    });

    it('appends and deduplicates the next page of matches', async () => {
        getHistoryRun
            .mockResolvedValueOnce({ commits: [createCommit('aaa')], hasMore: true })
            .mockResolvedValueOnce({ commits: [createCommit('aaa'), createCommit('bbb')], hasMore: false });

        const repo = useRepo(createRepo());
        await repo.searchHistory('abc');

        const appended = await repo.loadMoreHistorySearch();

        expect(appended).toBe(true);
        expect(getHistoryRun).toHaveBeenLastCalledWith({ repoId: repo.id, search: 'abc', skip: 1 });
        expect(repo.historySearchResults?.commits.map((commit) => commit.sha)).toEqual(['aaa', 'bbb']);
        expect(repo.historySearchResults?.hasMore).toBe(false);
    });

    it('clears the search state', async () => {
        getHistoryRun.mockResolvedValueOnce({ commits: [createCommit('aaa')], hasMore: true });

        const repo = useRepo(createRepo());
        await repo.searchHistory('abc');

        repo.clearHistorySearch();

        expect(repo.historySearchQuery).toBe('');
        expect(repo.historySearchResults).toBeUndefined();
        expect(repo.isSearchingHistory).toBe(false);
    });
});
