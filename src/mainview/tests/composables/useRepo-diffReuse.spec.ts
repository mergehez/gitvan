import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitDetail, FileChangeEntry, FileDiffData, Repo, RepoChangesData } from '../../../shared/types';

const { getChangesRun, getFileDiffRun, getCommitDetailRun, getCommitFileDiffRun } = vi.hoisted(() => ({
    getChangesRun: vi.fn(),
    getFileDiffRun: vi.fn(),
    getCommitDetailRun: vi.fn(),
    getCommitFileDiffRun: vi.fn(),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: {
            diffIgnoredChars: '',
            diffIgnoredCharsEnabled: false,
            showWhitespaceChanges: false,
            activeView: 'changes',
        },
    }),
}));

vi.mock('../../composables/useAuth', () => ({
    useAuth: () => ({ accounts: [] }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        isBusy: false,
        isOperationRunning: vi.fn(() => false),
        getChanges: { run: getChangesRun },
        getFileDiff: { run: getFileDiffRun },
        getCommitDetail: { run: getCommitDetailRun },
        getCommitFileDiff: { run: getCommitFileDiffRun },
    },
}));

vi.mock('../../composables/initializeStates', () => ({
    applyMutation: vi.fn(),
}));

import { useRepo } from '../../composables/useRepo';

let nextRepoId = 1;

function createRepo(): Repo {
    const id = nextRepoId++;

    return {
        id,
        name: `ReuseRepo${id}`,
        path: `/tmp/reuse-repo-${id}`,
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
            changedFiles: 1,
            stagedFiles: 0,
            unstagedFiles: 1,
            isDirty: true,
            error: undefined,
            lastScannedAt: undefined,
        },
    };
}

function createChange(path: string, contentKey: string): FileChangeEntry {
    return {
        path,
        previousPath: undefined,
        stagedStatus: 'clean',
        unstagedStatus: 'modified',
        contentKey,
        displayStatus: 'Modified',
    };
}

function createChanges(entries: FileChangeEntry[]): RepoChangesData {
    return {
        staged: [],
        unstaged: entries,
        stagedStats: { addedLines: 0, removedLines: 0, hasChanges: false },
        unstagedStats: { addedLines: 1, removedLines: 1, hasChanges: true },
    };
}

function createDiff(path: string): FileDiffData {
    return {
        path,
        entry: {
            label: 'Unstaged',
            kind: 'unstaged',
            patch: '@@',
            original: 'before\n',
            modified: 'after\n',
            stats: { oldSizeBytes: 7, newSizeBytes: 6, addedLines: 1, removedLines: 1 },
        },
    };
}

describe('useRepo reuses an unchanged changes diff', () => {
    beforeEach(() => {
        getChangesRun.mockReset();
        getFileDiffRun.mockReset();
        getCommitDetailRun.mockReset();
        getCommitFileDiffRun.mockReset();
        getFileDiffRun.mockImplementation(async (params: { path: string }) => createDiff(params.path));
    });

    it('reuses the diff when a reload selects the same file with the same content key', async () => {
        const repo = useRepo(createRepo());
        getChangesRun.mockResolvedValue(createChanges([createChange('a.txt', '1:2|3')]));

        await repo.loadChanges();
        const firstDiff = repo.curDiff;
        await repo.loadChanges();

        expect(getFileDiffRun).toHaveBeenCalledTimes(1);
        expect(repo.curDiff).toBe(firstDiff);
    });

    it('refetches when the selected content changed', async () => {
        const repo = useRepo(createRepo());
        getChangesRun.mockResolvedValueOnce(createChanges([createChange('a.txt', '1:2|3')]));

        await repo.loadChanges();
        getChangesRun.mockResolvedValueOnce(createChanges([createChange('a.txt', '1:2|4')]));

        await repo.loadChanges();

        expect(getFileDiffRun).toHaveBeenCalledTimes(2);
    });

    it('refetches when the selection moves to another file', async () => {
        const repo = useRepo(createRepo());
        getChangesRun.mockResolvedValueOnce(createChanges([createChange('a.txt', '1:2|3')]));

        await repo.loadChanges();
        getChangesRun.mockResolvedValueOnce(createChanges([createChange('b.txt', '4:5|6')]));

        await repo.loadChanges();

        expect(getFileDiffRun).toHaveBeenCalledTimes(2);
        expect(repo.currChangePath).toBe('b.txt');
    });

    it('keeps the newer selection when an earlier diff resolves last', async () => {
        const repo = useRepo(createRepo());

        let resolveFirst: ((diff: FileDiffData) => void) | undefined;
        getFileDiffRun.mockImplementationOnce(
            async () =>
                await new Promise<FileDiffData>((resolve) => {
                    resolveFirst = resolve;
                })
        );
        getFileDiffRun.mockImplementation(async (params: { path: string }) => createDiff(params.path));

        const first = repo.selectChange({ kind: 'unstaged', path: 'a.txt' });
        const second = repo.selectChange({ kind: 'unstaged', path: 'b.txt' });
        await second;

        // The auto-selection's slow response lands after the user's click and must be dropped.
        resolveFirst!(createDiff('a.txt'));
        await first;

        expect(repo.currChangePath).toBe('b.txt');
        expect(repo.curDiff?.path).toBe('b.txt');
    });

    it('does not reopen the diff for a selection cleared while its diff was loading', async () => {
        const repo = useRepo(createRepo());

        let resolveDiff: ((diff: FileDiffData) => void) | undefined;
        getFileDiffRun.mockImplementationOnce(
            async () =>
                await new Promise<FileDiffData>((resolve) => {
                    resolveDiff = resolve;
                })
        );

        const selection = repo.selectChange({ kind: 'unstaged', path: 'a.txt' });
        repo.clearViewState();
        resolveDiff!(createDiff('a.txt'));
        await selection;

        expect(repo.curDiff).toBeUndefined();
    });

    it('reuses the commit detail and its file diff for the same commit selection', async () => {
        const repo = useRepo(createRepo());
        getCommitDetailRun.mockResolvedValue({
            sha: 'abc',
            shortSha: 'abc',
            summary: 'Commit abc',
            authorName: 'Gitvan',
            authorEmail: 'g@example.com',
            authoredAt: '2026-01-01T00:00:00.000Z',
            refs: [],
            tags: [],
            isUnpushed: false,
            body: '',
            files: [{ path: 'a.txt', previousPath: undefined, status: 'modified' }],
        } satisfies CommitDetail);
        getCommitFileDiffRun.mockImplementation(async (params: { path: string }) => createDiff(params.path));

        await repo.selectCommit('abc');
        await repo.selectCommit('abc');

        expect(getCommitDetailRun).toHaveBeenCalledTimes(1);
        expect(getCommitFileDiffRun).toHaveBeenCalledTimes(1);
    });

    it('refetches the commit detail when another commit is selected', async () => {
        const repo = useRepo(createRepo());
        const detail = (sha: string) =>
            ({
                sha,
                shortSha: sha,
                summary: `Commit ${sha}`,
                authorName: 'Gitvan',
                authorEmail: 'g@example.com',
                authoredAt: '2026-01-01T00:00:00.000Z',
                refs: [],
                tags: [],
                isUnpushed: false,
                body: '',
                files: [{ path: 'a.txt', previousPath: undefined, status: 'modified' }],
            }) satisfies CommitDetail;

        getCommitDetailRun.mockImplementation(async (params: { commitSha: string }) => detail(params.commitSha));
        getCommitFileDiffRun.mockImplementation(async (params: { path: string }) => createDiff(params.path));

        await repo.selectCommit('abc');
        await repo.selectCommit('def');

        expect(getCommitDetailRun).toHaveBeenCalledTimes(2);
        expect(getCommitFileDiffRun).toHaveBeenCalledTimes(2);
    });
});
