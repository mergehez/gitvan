import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../../../shared/types';

const { confirmActionMock, discardFileRun, discardRepoFilesRun } = vi.hoisted(() => ({
    confirmActionMock: vi.fn(async () => true),
    discardFileRun: vi.fn(async () => ({})),
    discardRepoFilesRun: vi.fn(async () => ({})),
}));

vi.mock('../../lib/utils.ts', () => ({
    confirmAction: confirmActionMock,
}));

vi.mock('../../composables/initializeStates', () => ({
    applyMutation: vi.fn(async () => {}),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: {
            diffIgnoredChars: '',
            diffIgnoredCharsEnabled: true,
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

vi.mock('../../composables/useToast', () => ({
    toast: {
        showSuccessToast: vi.fn(),
        showErrorToast: vi.fn(),
    },
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        isBusy: false,
        isOperationRunning: vi.fn(() => false),
        discardFile: { run: discardFileRun },
        discardRepoFiles: { run: discardRepoFilesRun },
        getChanges: {
            run: vi.fn(async () => ({ staged: [], unstaged: [], stagedStats: { addedLines: 0, removedLines: 0 }, unstagedStats: { addedLines: 0, removedLines: 0 } })),
        },
        getFileDiff: { run: vi.fn() },
    },
}));

import { useRepo } from '../../composables/useRepo';
import { confirmDiscards } from '../../composables/useUiPreferences';

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

describe('discard confirmation', () => {
    beforeEach(() => {
        localStorage.clear();
        confirmDiscards.value = true;
        confirmActionMock.mockReset();
        confirmActionMock.mockResolvedValue(true);
        discardFileRun.mockReset();
        discardFileRun.mockResolvedValue({});
        discardRepoFilesRun.mockReset();
        discardRepoFilesRun.mockResolvedValue({});
    });

    it('asks before discarding a file', async () => {
        confirmActionMock.mockResolvedValue(false);
        const repo = useRepo(createRepo(1, 'TestRepo'));

        await repo.discardFile('a.txt');

        expect(confirmActionMock).toHaveBeenCalledTimes(1);
        expect(discardFileRun).not.toHaveBeenCalled();
    });

    it('discards without asking once the confirmation toggle is off', async () => {
        confirmDiscards.value = false;
        const repo = useRepo(createRepo(1, 'TestRepo'));

        await repo.discardFile('a.txt');

        expect(confirmActionMock).not.toHaveBeenCalled();
        expect(discardFileRun).toHaveBeenCalledWith({ repoId: 1, path: 'a.txt' }, 'a.txt');
    });

    it('discards multiple files without asking as well', async () => {
        confirmDiscards.value = false;
        const repo = useRepo(createRepo(1, 'TestRepo'));

        await repo.discardFiles(['a.txt', 'b.txt']);

        expect(confirmActionMock).not.toHaveBeenCalled();
        expect(discardRepoFilesRun).toHaveBeenCalledWith({ repoId: 1, paths: ['a.txt', 'b.txt'] });
    });
});
