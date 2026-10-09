import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitDetail, Repo, TagSummary } from '../../../shared/types';

const {
    confirmActionMock,
    getTagsRun,
    getCommitDetailRun,
    getCommitFileDiffRun,
    createTagRun,
    renameTagRun,
    deleteTagRun,
    pushTagRun,
    pushAllTagsRun,
    deleteRemoteTagRun,
    settingsState,
} = vi.hoisted(() => ({
    confirmActionMock: vi.fn(async () => true),
    getTagsRun: vi.fn(),
    getCommitDetailRun: vi.fn(),
    getCommitFileDiffRun: vi.fn(),
    createTagRun: vi.fn(async () => ({})),
    renameTagRun: vi.fn(async () => ({})),
    deleteTagRun: vi.fn(async () => ({})),
    pushTagRun: vi.fn(async () => ({})),
    pushAllTagsRun: vi.fn(async () => ({})),
    deleteRemoteTagRun: vi.fn(async () => ({})),
    settingsState: { activeView: 'tags' } as { activeView: string },
}));

vi.mock('../../lib/utils.ts', () => ({
    confirmAction: confirmActionMock,
}));

vi.mock('../../composables/initializeStates', () => ({
    applyMutation: vi.fn(async () => {}),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: settingsState,
        openRepoPathInEditor: vi.fn(),
        setActiveView: vi.fn(),
    }),
}));

vi.mock('../../composables/useAuth', () => ({
    useAuth: () => ({ accounts: [] }),
}));

vi.mock('../../composables/useToast', () => ({
    toast: { showSuccessToast: vi.fn(), showErrorToast: vi.fn() },
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        isBusy: false,
        isOperationRunning: vi.fn(() => false),
        getTags: { run: getTagsRun },
        getCommitDetail: { run: getCommitDetailRun },
        getCommitFileDiff: { run: getCommitFileDiffRun },
        createTag: { run: createTagRun },
        renameTag: { run: renameTagRun },
        deleteTag: { run: deleteTagRun },
        pushTag: { run: pushTagRun },
        pushAllTags: { run: pushAllTagsRun },
        deleteRemoteTag: { run: deleteRemoteTagRun },
    },
}));

import { useRepo } from '../../composables/useRepo';

let nextRepoId = 1;

function createRepo(): Repo {
    const id = nextRepoId++;
    const name = `TagsRepo${id}`;

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
        addedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
        status: {
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
            lastScannedAt: undefined,
        },
    };
}

function createTag(name: string, commitSha: string): TagSummary {
    return {
        name,
        commitSha,
        shortSha: commitSha.slice(0, 7),
        commitSummary: `Commit for ${name}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        isAnnotated: false,
        isTargetUnpushed: false,
    };
}

function createCommitDetail(sha: string): CommitDetail {
    return {
        sha,
        shortSha: sha.slice(0, 7),
        summary: `Commit ${sha}`,
        authorName: 'Gitvan Test',
        authorEmail: 'gitvan@example.com',
        authoredAt: '2026-01-01T00:00:00.000Z',
        refs: [],
        tags: [],
        isUnpushed: false,
        body: '',
        files: [],
        patch: '',
    };
}

describe('useRepo tags', () => {
    beforeEach(() => {
        confirmActionMock.mockReset();
        confirmActionMock.mockResolvedValue(true);
        getTagsRun.mockReset();
        getCommitDetailRun.mockReset();
        getCommitDetailRun.mockImplementation(async (ps: { commitSha: string }) => createCommitDetail(ps.commitSha));
        getCommitFileDiffRun.mockReset();
        createTagRun.mockClear();
        renameTagRun.mockClear();
        deleteTagRun.mockClear();
        pushTagRun.mockClear();
        pushAllTagsRun.mockClear();
        deleteRemoteTagRun.mockClear();
        settingsState.activeView = 'tags';
    });

    it('loads tags and inspects the newest one', async () => {
        const repo = useRepo(createRepo());
        getTagsRun.mockResolvedValue({ tags: [createTag('v2.0.0', 'bbb'), createTag('v1.0.0', 'aaa')] });

        await repo.loadTags();

        expect(getTagsRun).toHaveBeenCalledWith({ repoId: repo.id });
        expect(repo.tags?.tags.map((tag) => tag.name)).toEqual(['v2.0.0', 'v1.0.0']);
        expect(repo.selectedTagName).toBe('v2.0.0');
        expect(repo.currCommitSha).toBe('bbb');
    });

    it('keeps the selected tag across reloads when it still exists', async () => {
        const repo = useRepo(createRepo());
        getTagsRun.mockResolvedValue({ tags: [createTag('v2.0.0', 'bbb'), createTag('v1.0.0', 'aaa')] });
        await repo.loadTags();

        await repo.selectTag('v1.0.0');
        await repo.loadTags();

        expect(repo.selectedTagName).toBe('v1.0.0');
        expect(repo.currCommitSha).toBe('aaa');
    });

    it('falls back to the first tag when the selected one disappears', async () => {
        const repo = useRepo(createRepo());
        getTagsRun.mockResolvedValueOnce({ tags: [createTag('v2.0.0', 'bbb'), createTag('v1.0.0', 'aaa')] });
        await repo.loadTags();
        await repo.selectTag('v1.0.0');

        getTagsRun.mockResolvedValueOnce({ tags: [createTag('v2.0.0', 'bbb')] });
        await repo.loadTags();

        expect(repo.selectedTagName).toBe('v2.0.0');
    });

    it('clears the inspected commit when the repository has no tags', async () => {
        const repo = useRepo(createRepo());
        repo.currCommitSha = 'stale';
        getTagsRun.mockResolvedValue({ tags: [] });

        await repo.loadTags();

        expect(repo.selectedTagName).toBeUndefined();
        expect(repo.currCommitSha).toBeUndefined();
        expect(repo.currCommit).toBeUndefined();
    });

    it('creates a tag and keeps it selected', async () => {
        const repo = useRepo(createRepo());

        await repo.createTag('HEAD', 'v3.0.0', 'Release notes');

        expect(createTagRun).toHaveBeenCalledWith({ repoId: repo.id, commitSha: 'HEAD', tagName: 'v3.0.0', message: 'Release notes' }, 'HEAD:v3.0.0');
        expect(repo.selectedTagName).toBe('v3.0.0');
    });

    it('drops a blank message so the tag stays lightweight', async () => {
        const repo = useRepo(createRepo());

        await repo.createTag('HEAD', 'v3.0.0', '   ');

        expect(createTagRun).toHaveBeenCalledWith({ repoId: repo.id, commitSha: 'HEAD', tagName: 'v3.0.0', message: undefined }, 'HEAD:v3.0.0');
    });

    it('follows a rename with the selection', async () => {
        const repo = useRepo(createRepo());
        getTagsRun.mockResolvedValue({ tags: [createTag('v1.0.0', 'aaa')] });
        await repo.loadTags();

        await repo.renameTag('v1.0.0', 'v1.0.1');

        expect(renameTagRun).toHaveBeenCalledWith({ repoId: repo.id, tagName: 'v1.0.0', nextTagName: 'v1.0.1' }, 'v1.0.0:v1.0.1');
        expect(repo.selectedTagName).toBe('v1.0.1');
    });

    it('asks before deleting a local tag', async () => {
        const repo = useRepo(createRepo());

        confirmActionMock.mockResolvedValueOnce(false);
        await repo.deleteTag('v1.0.0');
        expect(deleteTagRun).not.toHaveBeenCalled();

        await repo.deleteTag('v1.0.0');
        expect(deleteTagRun).toHaveBeenCalledWith({ repoId: repo.id, tagName: 'v1.0.0' }, 'v1.0.0');
    });

    it('pushes a single tag and every tag', async () => {
        const repo = useRepo(createRepo());

        await repo.pushTag('v1.0.0');
        await repo.pushAllTags();

        expect(pushTagRun).toHaveBeenCalledWith({ repoId: repo.id, tagName: 'v1.0.0' }, 'v1.0.0');
        expect(pushAllTagsRun).toHaveBeenCalledWith({ repoId: repo.id });
    });

    it('asks before deleting a tag on the remote', async () => {
        const repo = useRepo(createRepo());

        confirmActionMock.mockResolvedValueOnce(false);
        await repo.deleteRemoteTag('v1.0.0');
        expect(deleteRemoteTagRun).not.toHaveBeenCalled();

        await repo.deleteRemoteTag('v1.0.0');
        expect(deleteRemoteTagRun).toHaveBeenCalledWith({ repoId: repo.id, tagName: 'v1.0.0' }, 'v1.0.0');
    });
});
