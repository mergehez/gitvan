import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitSummary, FileChangeEntry, Repo } from '../../../shared/types';

const { confirmActionMock, applyMutationMock, toasts, runs } = vi.hoisted(() => {
    const runs = new Map<string, ReturnType<typeof vi.fn>>();

    return {
        confirmActionMock: vi.fn(async () => true),
        applyMutationMock: vi.fn(async () => {}),
        toasts: { success: vi.fn(), error: vi.fn() },
        runs,
    };
});

function runFor(taskName: string) {
    if (!runs.has(taskName)) {
        runs.set(taskName, vi.fn(async () => ({})).mockName(`tasks.${taskName}.run`));
    }

    return runs.get(taskName)!;
}

vi.mock('../../lib/utils.ts', () => ({
    confirmAction: confirmActionMock,
}));

vi.mock('../../composables/initializeStates', () => ({
    applyMutation: applyMutationMock,
}));

vi.mock('../../composables/useToast', () => ({
    toast: {
        showSuccessToast: toasts.success,
        showErrorToast: toasts.error,
    },
}));

vi.mock('../../composables/useAuth', () => ({
    useAuth: () => ({
        accounts: [],
    }),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: {
            diffIgnoredChars: '',
            diffIgnoredCharsEnabled: true,
            showWhitespaceChanges: false,
            activeView: 'changes',
        },
        openRepoPathInEditor: runFor('openRepoPathInEditor'),
        setActiveView: vi.fn(),
    }),
}));

/**
 * Any task the composable reaches for resolves to an empty mutation, so a spec only has to assert
 * on the ones it cares about instead of listing all eighty.
 */
vi.mock('../../composables/useTasks', () => ({
    tasks: new Proxy(
        { isBusy: false, isOperationRunning: vi.fn(() => false) },
        {
            get(target, property: string) {
                if (property in target) {
                    return target[property as keyof typeof target];
                }

                return { run: runFor(property) };
            },
        }
    ),
}));

import { useRepo } from '../../composables/useRepo';
import { confirmDiscards } from '../../composables/useUiPreferences';

let nextRepoId = 1;

function createRepo(): Repo {
    const id = nextRepoId++;
    const name = `FlowRepo${id}`;

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

function change(path: string, stagedStatus: FileChangeEntry['stagedStatus'] = 'modified'): FileChangeEntry {
    return {
        path,
        previousPath: undefined,
        stagedStatus,
        unstagedStatus: 'clean',
        displayStatus: stagedStatus,
    };
}

function commit(sha: string): CommitSummary {
    return {
        sha,
        shortSha: sha.slice(0, 7),
        summary: `Commit ${sha}`,
        authorName: 'Gitvan Test',
        authorEmail: 'gitvan@example.com',
        authoredAt: '2026-07-25T00:00:00.000Z',
        refs: [],
        tags: [],
        isUnpushed: false,
    };
}

function changes(staged: FileChangeEntry[]) {
    return {
        staged,
        unstaged: [],
        stagedStats: { addedLines: 1, removedLines: 0 },
        unstagedStats: { addedLines: 0, removedLines: 0 },
    };
}

beforeEach(() => {
    localStorage.clear();
    confirmDiscards.value = false;
    confirmActionMock.mockReset();
    confirmActionMock.mockResolvedValue(true);
    applyMutationMock.mockReset();
    applyMutationMock.mockResolvedValue(undefined);
    toasts.success.mockReset();
    toasts.error.mockReset();

    for (const run of runs.values()) {
        run.mockReset();
        run.mockResolvedValue({});
    }

    // Commit selection reads the detail's file list, so it needs the shape it expects.
    runFor('getCommitDetail').mockResolvedValue({ sha: 'aaa', summary: 'Commit', files: [] });
});

describe('useRepo commit form', () => {
    it('suggests a summary from the single staged change', () => {
        const repo = useRepo(createRepo());
        repo.changes = changes([change('src/values.ts', 'added')]) as never;

        expect(repo.suggestedCommitSummary()).toBe('Add values.ts');
    });

    it('suggests nothing while amending or with more than one staged file', () => {
        const repo = useRepo(createRepo());
        repo.changes = changes([change('a.txt'), change('b.txt')]) as never;

        expect(repo.suggestedCommitSummary()).toBe('');

        repo.changes = changes([change('a.txt')]) as never;
        repo.commitForm.amend = true;

        expect(repo.suggestedCommitSummary()).toBe('');
    });

    it('needs a summary and either staged work or an amend', () => {
        const repo = useRepo(createRepo());
        repo.changes = changes([]) as never;

        expect(repo.canCommit()).toBeFalsy();

        repo.commitForm.summary = 'Ship it';
        // A summary alone is not enough while there is nothing to commit.
        expect(repo.canCommit()).toBeFalsy();

        repo.changes = changes([change('a.txt')]) as never;
        expect(repo.canCommit()).toBeTruthy();

        // An amend has no staged work of its own, so the form alone allows it.
        repo.changes = changes([]) as never;
        repo.commitForm.amend = true;

        expect(repo.canCommit()).toBeTruthy();
    });

    it('falls back to the suggested summary when the form is empty', () => {
        const repo = useRepo(createRepo());
        repo.changes = changes([change('src/values.ts', 'deleted')]) as never;
        repo.commitForm.description = 'Body only';

        expect(repo.resolvedCommitSummary()).toBe('Remove values.ts');
    });

    it('commits the form, applies the mutation and clears it', async () => {
        const repo = useRepo(createRepo());
        repo.commitForm.summary = '  Commit from the form  ';
        repo.commitForm.description = 'Details';
        runFor('commitRepo').mockResolvedValue({ repos: [] });

        await repo.commitRepository();

        expect(runFor('commitRepo')).toHaveBeenCalledWith({ repoId: repo.id, summary: 'Commit from the form', description: 'Details', amend: false });
        expect(applyMutationMock).toHaveBeenCalledWith({ repos: [] });
        expect(repo.commitForm).toMatchObject({ summary: '', description: '', amend: false });
        expect(toasts.success).toHaveBeenCalledWith('Commit created.');
    });

    it('reports an amended commit as such', async () => {
        const repo = useRepo(createRepo());
        repo.commitForm.summary = 'Rework';
        repo.commitForm.amend = true;

        await repo.commitRepository();

        expect(runFor('commitRepo')).toHaveBeenCalledWith(expect.objectContaining({ amend: true }));
        expect(toasts.success).toHaveBeenCalledWith('Commit amended.');
    });

    it('drops the amend state when it is cancelled', () => {
        const repo = useRepo(createRepo());
        repo.commitForm.amend = true;
        repo.commitForm.summary = 'Draft';

        repo.cancelAmendCommit();

        expect(repo.commitForm).toMatchObject({ amend: false, summary: '', description: '' });
    });
});

describe('useRepo file operations', () => {
    it('stages one file and stages a deduplicated batch through the bulk command', async () => {
        const repo = useRepo(createRepo());

        await repo.stageFile('a.txt');
        expect(runFor('stageFile')).toHaveBeenCalledWith({ repoId: repo.id, path: 'a.txt' }, 'a.txt');
        expect(toasts.success).toHaveBeenCalledWith('File staged.');

        await repo.stageFiles(['a.txt', 'b.txt', 'a.txt']);
        expect(runFor('stageRepoFiles')).toHaveBeenCalledWith({ repoId: repo.id, paths: ['a.txt', 'b.txt'] });
        expect(toasts.success).toHaveBeenCalledWith('2 files staged.');
    });

    it('routes a single-path batch through the single-file command', async () => {
        const repo = useRepo(createRepo());

        await repo.stageFiles(['only.txt']);

        expect(runFor('stageFile')).toHaveBeenCalledWith({ repoId: repo.id, path: 'only.txt' }, 'only.txt');
        expect(runFor('stageRepoFiles')).not.toHaveBeenCalled();
    });

    it('does nothing for an empty path list', async () => {
        const repo = useRepo(createRepo());

        await repo.stageFiles([]);
        await repo.unstageFiles([]);

        expect(runFor('stageFile')).not.toHaveBeenCalled();
        expect(runFor('unstageFile')).not.toHaveBeenCalled();
    });

    it('unstages one file and a batch', async () => {
        const repo = useRepo(createRepo());

        await repo.unstageFile('a.txt');
        await repo.unstageFiles(['a.txt', 'b.txt']);

        expect(runFor('unstageFile')).toHaveBeenCalledWith({ repoId: repo.id, path: 'a.txt' }, 'a.txt');
        expect(runFor('unstageRepoFiles')).toHaveBeenCalledWith({ repoId: repo.id, paths: ['a.txt', 'b.txt'] });
    });

    it('applies a partial patch under a mode-scoped operation key', async () => {
        const repo = useRepo(createRepo());
        runFor('applyPatch').mockResolvedValue({ repos: [] });

        await repo.applyPatch('@@ -1 +1 @@', 'stage', 'hunk');

        expect(runFor('applyPatch')).toHaveBeenCalledWith({ repoId: repo.id, patch: '@@ -1 +1 @@', mode: 'stage' }, 'stage:hunk');
        expect(toasts.success).toHaveBeenCalledWith('Change staged.');
    });

    it('discards without asking while the confirmation toggle is off', async () => {
        const repo = useRepo(createRepo());

        await repo.discardFile('a.txt');

        expect(confirmActionMock).not.toHaveBeenCalled();
        expect(runFor('discardFile')).toHaveBeenCalledWith({ repoId: repo.id, path: 'a.txt' }, 'a.txt');
        expect(toasts.success).toHaveBeenCalledWith('File discarded.');
    });

    it('asks before discarding a batch once the toggle is on', async () => {
        confirmDiscards.value = true;
        confirmActionMock.mockResolvedValue(false);
        const repo = useRepo(createRepo());

        await repo.discardFiles(['a.txt', 'b.txt']);

        expect(confirmActionMock).toHaveBeenCalledTimes(1);
        expect(runFor('discardRepoFiles')).not.toHaveBeenCalled();

        confirmActionMock.mockResolvedValue(true);
        await repo.discardFiles(['a.txt', 'b.txt']);

        expect(runFor('discardRepoFiles')).toHaveBeenCalledWith({ repoId: repo.id, paths: ['a.txt', 'b.txt'] });
    });

    it('deletes staged and untracked files behind a confirmation', async () => {
        const repo = useRepo(createRepo());

        await repo.deleteFile('gone.txt', 'staged');
        await repo.deleteFiles(['gone.txt', 'also-gone.txt'], 'staged');
        await repo.deleteFiles(['loose.txt'], 'unstaged');

        expect(confirmActionMock).toHaveBeenCalledTimes(3);
        expect(runFor('deleteStagedRepoFile')).toHaveBeenCalledWith({ repoId: repo.id, path: 'gone.txt' }, 'gone.txt');
        expect(runFor('deleteStagedRepoFiles')).toHaveBeenCalledWith({ repoId: repo.id, paths: ['gone.txt', 'also-gone.txt'] });
        // An untracked file is only in the working tree, so the discard tasks remove it.
        expect(runFor('discardFile')).toHaveBeenCalledWith({ repoId: repo.id, path: 'loose.txt' }, 'loose.txt');

        confirmActionMock.mockResolvedValue(false);
        await repo.deleteFile('kept.txt', 'staged');

        expect(runFor('deleteStagedRepoFile')).toHaveBeenCalledTimes(1);
    });

    it('reverts deletions with their kind and ignores a path', async () => {
        const repo = useRepo(createRepo());

        await repo.revertDeletion('gone.txt', 'staged');
        await repo.revertDeletions(['gone.txt', 'other.txt'], 'unstaged');
        await repo.ignorePath('build/', 'directory');

        expect(runFor('restoreRepoFile')).toHaveBeenCalledWith({ repoId: repo.id, path: 'gone.txt', kind: 'staged' }, 'staged:gone.txt');
        expect(runFor('restoreRepoFiles')).toHaveBeenCalledWith({ repoId: repo.id, paths: ['gone.txt', 'other.txt'], kind: 'unstaged' });
        expect(runFor('ignoreRepoPath')).toHaveBeenCalledWith({ repoId: repo.id, path: 'build/', mode: 'directory' }, 'directory:build/');
    });

    it('opens and reveals a file through the host', async () => {
        const repo = useRepo(createRepo());
        const absolutePath = `${repo.path}/a.txt`;

        await repo.openFileInEditor('a.txt');
        await repo.openFileWithDefaultProgram('a.txt');
        await repo.revealFileInFinder('a.txt');

        expect(runFor('openRepoPathInEditor')).toHaveBeenCalledWith({ repoId: repo.id, path: 'a.txt' }, 'a.txt');
        expect(runFor('openPathWithDefaultProgram')).toHaveBeenCalledWith({ path: absolutePath }, 'a.txt');
        expect(runFor('revealPathInFileManager')).toHaveBeenCalledWith({ path: absolutePath, mode: 'reveal-item' }, 'a.txt');
    });
});

describe('useRepo branches and tags', () => {
    it('creates and checks out branches', async () => {
        const repo = useRepo(createRepo());

        await repo.createBranch('feature');
        await repo.checkoutBranch('feature');

        expect(runFor('createBranch')).toHaveBeenCalledWith({ repoId: repo.id, branchName: 'feature' }, 'feature');
        expect(runFor('checkoutBranch')).toHaveBeenCalledWith({ repoId: repo.id, branchName: 'feature' }, 'feature');
    });

    it('creates a tag with a message and keeps the tags view on it', async () => {
        const repo = useRepo(createRepo());
        repo.selectedTagName = 'old';

        await repo.createTag('abc123', '  v1.0.0  ', '  Release  ');
        await repo.createTag('abc123', 'v1.0.1');

        expect(runFor('createTag')).toHaveBeenNthCalledWith(1, { repoId: repo.id, commitSha: 'abc123', tagName: 'v1.0.0', message: 'Release' }, 'abc123:v1.0.0');
        expect(runFor('createTag')).toHaveBeenNthCalledWith(2, { repoId: repo.id, commitSha: 'abc123', tagName: 'v1.0.1', message: undefined }, 'abc123:v1.0.1');
        expect(toasts.success).toHaveBeenCalledWith('Annotated tag "v1.0.0" created.');
        expect(toasts.success).toHaveBeenCalledWith('Tag "v1.0.1" created.');
    });

    it('ignores a blank tag name', async () => {
        const repo = useRepo(createRepo());

        await repo.createTag('abc123', '   ');

        expect(runFor('createTag')).not.toHaveBeenCalled();
    });

    it('renames, pushes and deletes tags', async () => {
        const repo = useRepo(createRepo());
        // The selected name only follows the rename while the tags view owns the list.
        repo.selectedTagName = 'v1';

        await repo.renameTag('v1', 'v2');
        await repo.pushTag('v2');
        await repo.pushAllTags();
        await repo.deleteTag('v2');
        await repo.deleteRemoteTag('v2');

        expect(runFor('renameTag')).toHaveBeenCalledWith({ repoId: repo.id, tagName: 'v1', nextTagName: 'v2' }, 'v1:v2');
        expect(repo.selectedTagName).toBe('v1');
        expect(runFor('pushTag')).toHaveBeenCalledWith({ repoId: repo.id, tagName: 'v2' }, 'v2');
        expect(runFor('pushAllTags')).toHaveBeenCalledWith({ repoId: repo.id });
        expect(runFor('deleteTag')).toHaveBeenCalledWith({ repoId: repo.id, tagName: 'v2' }, 'v2');
        expect(runFor('deleteRemoteTag')).toHaveBeenCalledWith({ repoId: repo.id, tagName: 'v2' }, 'v2');
    });

    it('loads and selects tags', async () => {
        const repo = useRepo(createRepo());
        runFor('getTags').mockResolvedValue({ tags: [{ name: 'v1', commitSha: 'aaa' }] });
        runFor('getCommitDetail').mockResolvedValue({ sha: 'aaa', files: [] });

        await repo.loadTags();
        await repo.selectTag('v1');

        expect(runFor('getTags')).toHaveBeenCalledWith({ repoId: repo.id });
        expect(repo.tags).toEqual({ tags: [{ name: 'v1', commitSha: 'aaa' }] });
        expect(repo.selectedTag()).toEqual({ name: 'v1', commitSha: 'aaa' });
        expect(repo.currCommitSha).toBe('aaa');
    });
});

describe('useRepo stashes', () => {
    it('loads the stash list without selecting one on its own', async () => {
        const repo = useRepo(createRepo());
        runFor('getStashes').mockResolvedValue([{ ref: 'stash@{0}', message: 'On main: work', createdAtRelative: '1 minute ago' }]);

        await repo.loadRepositoryStashes();

        expect(runFor('getStashes')).toHaveBeenCalledWith({ repoId: repo.id });
        expect(repo.stashes).toHaveLength(1);
        expect(runFor('getStashDetail')).not.toHaveBeenCalled();
    });

    it('refreshes the selected stash and drops it when it is gone', async () => {
        const repo = useRepo(createRepo());
        repo.currStashRef = 'stash@{0}';
        runFor('getStashes').mockResolvedValue([]);

        await repo.loadRepositoryStashes();

        expect(repo.currStashRef).toBeUndefined();
    });

    it('selects a stash and its first file', async () => {
        const repo = useRepo(createRepo());
        runFor('getStashDetail').mockResolvedValue({
            ref: 'stash@{0}',
            message: 'On main: work',
            files: [{ path: 'a.txt', previousPath: undefined, status: 'modified', hadConflict: false }],
        });
        runFor('getStashFileDiff').mockResolvedValue({ path: 'a.txt', entry: { label: 'stash@{0}' } });

        await repo.selectRepositoryStash('stash@{0}');

        expect(repo.currStashFilePath).toBe('a.txt');
        expect(runFor('getStashFileDiff')).toHaveBeenCalledWith({ repoId: repo.id, stashRef: 'stash@{0}', path: 'a.txt', previousPath: undefined });
    });

    it('restores a stash and reports the conflict that keeps it', async () => {
        const repo = useRepo(createRepo());
        runFor('restoreStash').mockResolvedValue({ bootstrap: { repos: [] }, status: 'conflicted', kept: true, conflictingFiles: ['a.txt'] });

        await repo.restoreRepositoryStash('stash@{0}');

        expect(applyMutationMock).toHaveBeenCalledWith({ repos: [] });
        expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('conflicts in 1 file'));
    });

    it('reports a clean restore and a discarded stash', async () => {
        const repo = useRepo(createRepo());
        runFor('restoreStash').mockResolvedValue({ bootstrap: { repos: [] }, status: 'completed', kept: false, conflictingFiles: [] });
        confirmActionMock.mockResolvedValue(true);

        await repo.restoreRepositoryStash('stash@{0}');
        await repo.discardRepositoryStash('stash@{0}');

        expect(toasts.success).toHaveBeenCalledWith('Stash restored.');
        expect(runFor('discardStash')).toHaveBeenCalledWith({ repoId: repo.id, stashRef: 'stash@{0}' }, 'stash@{0}');
        expect(toasts.success).toHaveBeenCalledWith('Stash discarded.');
    });

    it('does not discard a stash the user cancelled', async () => {
        const repo = useRepo(createRepo());
        confirmActionMock.mockResolvedValue(false);

        await repo.discardRepositoryStash('stash@{0}');

        expect(runFor('discardStash')).not.toHaveBeenCalled();
    });
});

describe('useRepo history loaders', () => {
    it('loads a page of history and selects its newest commit', async () => {
        const repo = useRepo(createRepo());
        runFor('getHistory').mockResolvedValue({ commits: [commit('aaa'), commit('bbb')], hasMore: true });
        runFor('getCommitDetail').mockResolvedValue({ sha: 'aaa', files: [] });

        await repo.loadHistory();

        expect(runFor('getHistory')).toHaveBeenCalledWith({ repoId: repo.id, limit: undefined });
        expect(repo.currCommitSha).toBe('aaa');
    });

    it('appends the next history page and stops at the end', async () => {
        const repo = useRepo(createRepo());
        repo.history = { commits: [commit('aaa')], hasMore: true };
        runFor('getHistory').mockResolvedValue({ commits: [commit('bbb')], hasMore: false });

        expect(await repo.loadMoreHistory()).toBe(true);
        expect(repo.history?.commits.map((commit) => commit.sha)).toEqual(['aaa', 'bbb']);
        expect(await repo.loadMoreHistory()).toBe(false);
    });

    it('re-requests the pages already loaded when history refreshes', async () => {
        const repo = useRepo(createRepo());
        repo.history = { commits: [commit('aaa'), commit('bbb')], hasMore: true };
        runFor('getHistory').mockResolvedValue({ commits: [commit('aaa'), commit('bbb')], hasMore: true });
        runFor('getCommitDetail').mockResolvedValue({ sha: 'aaa', files: [] });

        await repo.loadHistory();

        expect(runFor('getHistory')).toHaveBeenCalledWith({ repoId: repo.id, limit: 2 });
    });

    it('loads a file history page for the pinned path', async () => {
        const repo = useRepo(createRepo());
        repo.fileHistoryPath = 'src/a.ts';
        runFor('getHistory').mockResolvedValue({ commits: [commit('ccc')], hasMore: false });

        await repo.loadFileHistory();

        expect(runFor('getHistory')).toHaveBeenCalledWith({ repoId: repo.id, path: 'src/a.ts', followRenames: undefined });
        expect(repo.fileHistoryResults?.commits.map((commit) => commit.sha)).toEqual(['ccc']);
    });

    it('does not load a file history without a pinned path', async () => {
        const repo = useRepo(createRepo());

        await repo.loadFileHistory();

        expect(runFor('getHistory')).not.toHaveBeenCalled();
    });

    it('loads and selects the committed tree of a snapshot', async () => {
        const repo = useRepo(createRepo());
        runFor('getHistory').mockResolvedValue({ commits: [commit('aaa')], hasMore: false });
        runFor('getCommittedTree').mockResolvedValue({ commitSha: 'aaa', files: [{ path: 'README.md', sizeBytes: 12 }] });
        runFor('getCommittedFile').mockResolvedValue({ path: 'README.md', content: 'hello', sizeBytes: 5 });

        await repo.loadCommittedTree();

        expect(repo.explorerCommitSha).toBe('aaa');
        expect(repo.committedTree?.files.map((file) => file.path)).toEqual(['README.md']);
        expect(repo.currCommittedFilePath).toBe('README.md');
    });
});
