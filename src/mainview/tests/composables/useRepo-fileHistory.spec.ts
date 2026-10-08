import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitDetail, CommitSummary, HistoryData, Repo } from '../../../shared/types';

const { getHistoryRun, getCommitDetailRun, getCommitFileDiffRun } = vi.hoisted(() => ({
    getHistoryRun: vi.fn(),
    getCommitDetailRun: vi.fn(),
    getCommitFileDiffRun: vi.fn(),
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
        getHistory: { run: getHistoryRun },
        getCommitDetail: { run: getCommitDetailRun },
        getCommitFileDiff: { run: getCommitFileDiffRun },
    },
}));

import { useRepo } from '../../composables/useRepo';

let nextRepoId = 1;

function createRepo(): Repo {
    const id = nextRepoId++;
    const name = `FileHistoryRepo${id}`;

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

function createCommitSummary(sha: string): CommitSummary {
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

function createCommitDetail(sha: string, files: Array<{ path: string; previousPath?: string }>): CommitDetail {
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
        body: '',
        files: files.map((file) => ({ path: file.path, previousPath: file.previousPath, status: 'modified' })),
        patch: '',
    };
}

function mockCommitDetail(sha: string, files: Array<{ path: string; previousPath?: string }>) {
    getCommitDetailRun.mockResolvedValue(createCommitDetail(sha, files));
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

describe('useRepo file history', () => {
    beforeEach(() => {
        getHistoryRun.mockReset();
        getCommitDetailRun.mockReset();
        getCommitFileDiffRun.mockReset();
        getCommitFileDiffRun.mockResolvedValue({ path: 'src/app.ts', entry: { label: 'a', kind: 'staged', patch: '', original: '', modified: '', stats: {} } });
    });

    it('loads the pinned path and selects that file inside the first matching commit', async () => {
        getHistoryRun.mockResolvedValueOnce({ commits: [createCommitSummary('aaa')], hasMore: false });
        mockCommitDetail('aaa', [{ path: 'src/other.ts' }, { path: 'src/app.ts' }]);

        const repo = useRepo(createRepo());
        repo.beginFileHistory('src/app.ts');
        await repo.loadFileHistory();

        expect(getHistoryRun).toHaveBeenCalledWith({ repoId: repo.id, path: 'src/app.ts', followRenames: undefined });
        expect(repo.fileHistoryResults?.commits.map((commit) => commit.sha)).toEqual(['aaa']);
        expect(repo.fileHistoryPath).toBe('src/app.ts');
        expect(repo.currCommitSha).toBe('aaa');
        expect(repo.currCommitFilePath).toBe('src/app.ts');
        expect(getCommitFileDiffRun).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/app.ts' }));
    });

    it('starts without following renames', async () => {
        getHistoryRun.mockResolvedValueOnce({ commits: [], hasMore: false });

        const repo = useRepo(createRepo());
        repo.beginFileHistory('src/app.ts');
        await repo.loadFileHistory();

        expect(repo.fileHistoryFollowRenames).toBe(false);
        expect(getHistoryRun).toHaveBeenCalledWith({ repoId: repo.id, path: 'src/app.ts', followRenames: undefined });
    });

    it('reloads the file history with renames once they are included', async () => {
        getHistoryRun
            .mockResolvedValueOnce({ commits: [createCommitSummary('aaa')], hasMore: false })
            .mockResolvedValueOnce({ commits: [createCommitSummary('aaa'), createCommitSummary('bbb')], hasMore: false });
        mockCommitDetail('aaa', [{ path: 'src/app.ts' }]);

        const repo = useRepo(createRepo());
        repo.beginFileHistory('src/app.ts');
        await repo.loadFileHistory();

        await repo.includeFileHistoryRenames();

        expect(repo.fileHistoryFollowRenames).toBe(true);
        expect(repo.isIncludingFileHistoryRenames).toBe(false);
        expect(getHistoryRun).toHaveBeenLastCalledWith({ repoId: repo.id, path: 'src/app.ts', followRenames: true });
        expect(repo.fileHistoryResults?.commits.map((commit) => commit.sha)).toEqual(['aaa', 'bbb']);
    });

    it('keeps renames out when the file history is not pinned', async () => {
        const repo = useRepo(createRepo());

        await repo.includeFileHistoryRenames();

        expect(repo.fileHistoryFollowRenames).toBe(false);
        expect(getHistoryRun).not.toHaveBeenCalled();
    });

    it('appends the next page of file commits', async () => {
        getHistoryRun
            .mockResolvedValueOnce({ commits: [createCommitSummary('aaa')], hasMore: true })
            .mockResolvedValueOnce({ commits: [createCommitSummary('aaa'), createCommitSummary('bbb')], hasMore: false });
        mockCommitDetail('aaa', [{ path: 'src/app.ts' }]);

        const repo = useRepo(createRepo());
        repo.beginFileHistory('src/app.ts');
        await repo.loadFileHistory();

        const appended = await repo.loadMoreFileHistory();

        expect(appended).toBe(true);
        expect(getHistoryRun).toHaveBeenLastCalledWith({ repoId: repo.id, path: 'src/app.ts', followRenames: undefined, skip: 1 });
        expect(repo.fileHistoryResults?.commits.map((commit) => commit.sha)).toEqual(['aaa', 'bbb']);
        expect(repo.fileHistoryResults?.hasMore).toBe(false);
    });

    it('clears the pinned path and its results', async () => {
        getHistoryRun.mockResolvedValueOnce({ commits: [createCommitSummary('aaa')], hasMore: true });
        mockCommitDetail('aaa', [{ path: 'src/app.ts' }]);

        const repo = useRepo(createRepo());
        repo.beginFileHistory('src/app.ts');
        await repo.loadFileHistory();

        repo.closeFileHistory();

        expect(repo.fileHistoryPath).toBeUndefined();
        expect(repo.fileHistoryFollowRenames).toBe(false);
        expect(repo.fileHistoryResults).toBeUndefined();
        expect(repo.isLoadingFileHistory).toBe(false);
    });

    it('does not leave the loading flag stuck when a refresh supersedes an in-flight load', async () => {
        const load = deferred<HistoryData>();
        const refresh = deferred<HistoryData>();
        getHistoryRun.mockReturnValueOnce(load.promise).mockReturnValueOnce(refresh.promise);
        mockCommitDetail('ccc', [{ path: 'src/app.ts' }]);

        const repo = useRepo(createRepo());
        repo.beginFileHistory('src/app.ts');
        const loadCall = repo.loadFileHistory();
        expect(repo.isLoadingFileHistory).toBe(true);

        const refreshCall = repo.refreshFileHistory();
        refresh.resolve({ commits: [createCommitSummary('ccc')], hasMore: false });
        await refreshCall;

        expect(repo.isLoadingFileHistory).toBe(false);

        load.resolve({ commits: [], hasMore: false });
        await loadCall;

        expect(repo.fileHistoryResults?.commits.map((commit) => commit.sha)).toEqual(['ccc']);
    });
});
