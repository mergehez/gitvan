import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../../../shared/gitClient';

// Mock useSettings before importing the module under test
vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: {
            diffIgnoredChars: '',
            showWhitespaceChanges: false,
            activeView: 'changes',
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
        getChanges: {
            run: vi.fn(async () => ({
                staged: [
                    {
                        path: 'staged-file.txt',
                        stagedStatus: 'modified',
                        unstagedStatus: 'clean',
                    },
                ],
                unstaged: [
                    {
                        path: 'unstaged-file.txt',
                        stagedStatus: 'clean',
                        unstagedStatus: 'modified',
                    },
                ],
                stagedStats: { addedLines: 1, removedLines: 0 },
                unstagedStats: { addedLines: 0, removedLines: 1 },
            })),
        },
        getFileDiff: {
            run: vi.fn(async () => ({
                path: 'file.txt',
                entry: {
                    label: 'Staged',
                    kind: 'staged',
                    patch: '',
                    original: '',
                    modified: '',
                    stats: { oldSizeBytes: 0, newSizeBytes: 0, addedLines: 0, removedLines: 0 },
                },
            })),
        },
    },
}));

import { useRepo } from '../../composables/useRepo';

function createRepo(id: number, name: string): Repo {
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

describe('file locking', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('starts with no locked files', () => {
        const repo = useRepo(createRepo(1, 'TestRepo'));
        expect(repo.isFileLocked('some-file.txt')).toBe(false);
    });

    it('lockFile adds a file to the locked set', () => {
        const repo = useRepo(createRepo(1, 'TestRepo'));
        repo.lockFile('notes.txt');
        expect(repo.isFileLocked('notes.txt')).toBe(true);
    });

    it('unlockFile removes a file from the locked set', () => {
        const repo = useRepo(createRepo(1, 'TestRepo'));
        repo.lockFile('notes.txt');
        expect(repo.isFileLocked('notes.txt')).toBe(true);

        repo.unlockFile('notes.txt');
        expect(repo.isFileLocked('notes.txt')).toBe(false);
    });

    it('persists locked files to localStorage', () => {
        const repo = useRepo(createRepo(42, 'PersistRepo'));
        repo.lockFile('secret.txt');
        repo.lockFile('draft.txt');

        const stored = JSON.parse(localStorage.getItem('gitvan-locked-files-42')!);
        expect(stored).toEqual(expect.arrayContaining(['secret.txt', 'draft.txt']));
        expect(stored).toHaveLength(2);
    });

    it('restores locked files from localStorage on initialization', () => {
        // Pre-populate localStorage
        localStorage.setItem('gitvan-locked-files-7', JSON.stringify(['pre-locked.txt']));

        const repo = useRepo(createRepo(7, 'RestoreRepo'));
        expect(repo.isFileLocked('pre-locked.txt')).toBe(true);
    });

    it('removes a file from localStorage after unlock', () => {
        const repo = useRepo(createRepo(3, 'UnlockRepo'));
        repo.lockFile('temp.txt');
        expect(JSON.parse(localStorage.getItem('gitvan-locked-files-3')!)).toContain('temp.txt');

        repo.unlockFile('temp.txt');
        const stored = JSON.parse(localStorage.getItem('gitvan-locked-files-3')!);
        expect(stored).not.toContain('temp.txt');
    });

    it('handles invalid localStorage data gracefully', () => {
        localStorage.setItem('gitvan-locked-files-5', 'not valid json');

        // Should not throw
        const repo = useRepo(createRepo(5, 'BadDataRepo'));
        expect(repo.isFileLocked('anything')).toBe(false);
    });

    it('cleans up locked files that no longer exist in the changes list', async () => {
        const repo = useRepo(createRepo(9, 'CleanupRepo'));

        // Lock a file that exists in the changes list
        repo.lockFile('staged-file.txt');
        // Lock a file that does NOT exist in the changes list (should be removed)
        repo.lockFile('stale-removed-file.txt');

        expect(repo.isFileLocked('stale-removed-file.txt')).toBe(true);

        await repo.loadChanges();

        // The stale file should have been removed
        expect(repo.isFileLocked('stale-removed-file.txt')).toBe(false);
        // The valid file should still be locked
        expect(repo.isFileLocked('staged-file.txt')).toBe(true);
    });

    it('keeps locked files that still exist after loadChanges', async () => {
        const repo = useRepo(createRepo(10, 'KeepLockedRepo'));

        repo.lockFile('staged-file.txt');
        repo.lockFile('unstaged-file.txt');

        await repo.loadChanges();

        expect(repo.isFileLocked('staged-file.txt')).toBe(true);
        expect(repo.isFileLocked('unstaged-file.txt')).toBe(true);
    });

    it('isFileLocked returns false for an unlocked file in a second repo', () => {
        // Different repos have independent locked-files sets
        const repoA = useRepo(createRepo(11, 'RepoA'));
        const repoB = useRepo(createRepo(12, 'RepoB'));

        repoA.lockFile('secret.txt');
        expect(repoA.isFileLocked('secret.txt')).toBe(true);
        expect(repoB.isFileLocked('secret.txt')).toBe(false);
    });

    it('locking multiple files and unlocking one keeps the others', () => {
        const repo = useRepo(createRepo(13, 'MultiLock'));

        repo.lockFile('a.txt');
        repo.lockFile('b.txt');
        repo.lockFile('c.txt');

        repo.unlockFile('b.txt');

        expect(repo.isFileLocked('a.txt')).toBe(true);
        expect(repo.isFileLocked('b.txt')).toBe(false);
        expect(repo.isFileLocked('c.txt')).toBe(true);

        const stored = JSON.parse(localStorage.getItem('gitvan-locked-files-13')!);
        expect(stored).toEqual(expect.arrayContaining(['a.txt', 'c.txt']));
        expect(stored).toHaveLength(2);
    });
});
