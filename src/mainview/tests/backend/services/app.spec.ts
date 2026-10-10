import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../../../backend/services/app.js';
import { useDb } from '../../../../backend/services/database.js';
import { useDatabase } from '../../../../electronUtils/useDatabase.js';
import { repositoryNotFoundMessage } from '../../../../shared/repositoryErrors.js';
import type { EditorSettings } from '../../../../shared/types.js';

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

describe('app selection and bootstrap', () => {
    let firstPath: string;
    let secondPath: string;
    let firstId: number;
    let secondId: number;

    beforeAll(() => {
        firstPath = createTrackedRepo('gitvan-app-select-first-');
        secondPath = createTrackedRepo('gitvan-app-select-second-');
        firstId = useDb().upsertRepo(firstPath, 'select-first');
        secondId = useDb().upsertRepo(secondPath, 'select-second');
    });

    afterAll(() => {
        useDb().removeRepo(firstId);
        useDb().removeRepo(secondId);
        rmSync(firstPath, { recursive: true, force: true });
        rmSync(secondPath, { recursive: true, force: true });
    });

    it('selects the first repository when none is stored', async () => {
        useDb().setSelectedRepoId(undefined);

        const bootstrap = await app.getBootstrap();

        expect(bootstrap.repos.map((repo) => repo.id)).toEqual([firstId, secondId]);
        expect(bootstrap.selectedRepoId).toBe(firstId);
        expect(bootstrap.sandboxLabsAvailable).toBe(true);
    });

    it('keeps a stored selection and repairs one that points at a removed repository', async () => {
        useDb().setSelectedRepoId(secondId);
        expect((await app.getBootstrap()).selectedRepoId).toBe(secondId);

        useDb().setSelectedRepoId(unknownRepoId);

        const repaired = await app.getBootstrap();
        expect(repaired.selectedRepoId).toBe(firstId);
        expect(useDb().getSelectedRepoId()).toBe(firstId);
    });

    it('selects a repository and rejects an unknown one', async () => {
        await app.selectRepo({ repoId: secondId });

        expect(useDb().getSelectedRepoId()).toBe(secondId);
        await expect(app.selectRepo({ repoId: unknownRepoId })).rejects.toThrow('The selected repository could not be found.');
    });

    it('moves the selection to the first repository when the selected one is removed', async () => {
        const extraPath = createTrackedRepo('gitvan-app-select-extra-');
        const extraId = useDb().upsertRepo(extraPath, 'select-extra');

        try {
            await app.selectRepo({ repoId: extraId });
            await app.removeRepo({ repoId: extraId });

            expect(useDb().repoExists(extraId)).toBe(false);
            expect(useDb().getSelectedRepoId()).toBe(firstId);
        } finally {
            rmSync(extraPath, { recursive: true, force: true });
        }
    });

    it('refreshes a repository list that a new repository joined', async () => {
        const addedPath = createTrackedRepo('gitvan-app-select-refresh-');

        try {
            await app.addTrackedRepoFromPath({ path: addedPath });

            const refreshed = await app.refreshRepos();
            expect(refreshed.repos.some((repo) => repo.name === basename(addedPath))).toBe(true);
        } finally {
            const added = useDb()
                .listRepos()
                .find((repo) => repo.name === basename(addedPath));
            if (added) {
                useDb().removeRepo(added.id);
            }
            rmSync(addedPath, { recursive: true, force: true });
        }
    });
});

describe('app repository groups and ordering', () => {
    const repoPaths: string[] = [];
    let groupAId: number;
    let groupBId: number;
    let repoAId: number;
    let repoBId: number;

    function addRepo(name: string) {
        const repoPath = createTrackedRepo(`gitvan-app-${name}-`);
        repoPaths.push(repoPath);

        return useDb().upsertRepo(repoPath, name);
    }

    beforeAll(async () => {
        const createdA = await app.createRepoGroup({ name: 'App Group A' });
        groupAId = createdA.groups.find((group) => group.name === 'App Group A')!.id;

        const createdB = await app.createRepoGroup({ name: 'App Group B' });
        groupBId = createdB.groups.find((group) => group.name === 'App Group B')!.id;

        repoAId = addRepo('order-a');
        repoBId = addRepo('order-b');
    });

    afterAll(() => {
        useDb().removeRepo(repoAId);
        useDb().removeRepo(repoBId);
        for (const groupId of [groupAId, groupBId]) {
            if (useDb().groupExists(groupId)) {
                useDb().deleteGroup(groupId);
            }
        }
        for (const repoPath of repoPaths) {
            rmSync(repoPath, { recursive: true, force: true });
        }
    });

    function orderedRepoIds() {
        return useDb()
            .listRepos()
            .filter((repo) => repo.id === repoAId || repo.id === repoBId)
            .map((repo) => repo.id);
    }

    function orderedGroupIds() {
        return useDb()
            .listGroups()
            .filter((group) => group.id === groupAId || group.id === groupBId)
            .map((group) => group.id);
    }

    it('validates a new group name and rejects a duplicate', async () => {
        await expect(app.createRepoGroup({ name: '   ' })).rejects.toThrow('Group name is required.');
        await expect(app.createRepoGroup({ name: 'app group a' })).rejects.toThrow('A group with that name already exists.');
    });

    it('renames a group and refuses the name of another group', async () => {
        await app.renameRepoGroup({ groupId: groupBId, name: 'App Group B renamed' });
        expect(
            useDb()
                .listGroups()
                .find((group) => group.id === groupBId)?.name
        ).toBe('App Group B renamed');

        await expect(app.renameRepoGroup({ groupId: groupBId, name: 'App Group A' })).rejects.toThrow('A group with that name already exists.');
        await expect(app.renameRepoGroup({ groupId: unknownRepoId, name: 'Anything' })).rejects.toThrow('The selected group could not be found.');
        await expect(app.renameRepoGroup({ groupId: groupBId, name: '   ' })).rejects.toThrow('Group name is required.');

        await app.renameRepoGroup({ groupId: groupBId, name: 'App Group B' });
    });

    it('moves and reorders repositories', async () => {
        expect(orderedRepoIds()).toEqual([repoAId, repoBId]);

        await app.moveRepo({ repoId: repoBId, direction: 'up' });
        expect(orderedRepoIds()).toEqual([repoBId, repoAId]);

        await app.moveRepo({ repoId: repoBId, direction: 'up' });
        expect(orderedRepoIds()).toEqual([repoBId, repoAId]);

        await app.reorderRepo({ repoId: repoAId, toIndex: 0 });
        expect(orderedRepoIds()).toEqual([repoAId, repoBId]);

        await expect(app.moveRepo({ repoId: unknownRepoId, direction: 'up' })).rejects.toThrow('The selected repository could not be found.');
        await expect(app.reorderRepo({ repoId: unknownRepoId, toIndex: 0 })).rejects.toThrow('The selected repository could not be found.');
    });

    it('moves a group up and down', async () => {
        expect(orderedGroupIds()).toEqual([groupAId, groupBId]);

        await app.moveRepoGroup({ groupId: groupBId, direction: 'up' });
        expect(orderedGroupIds()).toEqual([groupBId, groupAId]);

        await app.moveRepoGroup({ groupId: groupAId, direction: 'up' });
        expect(orderedGroupIds()).toEqual([groupAId, groupBId]);

        await expect(app.moveRepoGroup({ groupId: unknownRepoId, direction: 'up' })).rejects.toThrow('The selected group could not be found.');
    });

    it('assigns repositories to a group in a batch and ungroups them when it is deleted', async () => {
        await app.updateRepoGroups({
            updates: [
                { repoId: repoAId, groupId: groupBId },
                { repoId: repoBId, groupId: groupBId },
            ],
        });

        expect(useDb().getRepo(repoAId)?.group_id).toBe(groupBId);
        expect(useDb().getRepo(repoBId)?.group_id).toBe(groupBId);

        await app.updateRepoGroup({ repoId: repoAId, groupId: groupAId });
        expect(useDb().getRepo(repoAId)?.group_id).toBe(groupAId);

        await app.updateRepoGroup({ repoId: repoAId, groupId: undefined });
        expect(useDb().getRepo(repoAId)?.group_id).toBeNull();

        await app.deleteTrackedRepoGroup({ groupId: groupBId });

        expect(useDb().groupExists(groupBId)).toBe(false);
        expect(useDb().getRepo(repoBId)?.group_id).toBeNull();

        await expect(app.updateRepoGroups({ updates: [{ repoId: unknownRepoId, groupId: undefined }] })).rejects.toThrow('One of the selected repositories could not be found.');
        await expect(app.updateRepoGroups({ updates: [{ repoId: repoAId, groupId: unknownRepoId }] })).rejects.toThrow('One of the selected groups could not be found.');
        await expect(app.updateRepoGroup({ repoId: repoAId, groupId: unknownRepoId })).rejects.toThrow('The selected group could not be found.');
        await expect(app.updateRepoGroup({ repoId: unknownRepoId, groupId: undefined })).rejects.toThrow('The selected repository could not be found.');
        await expect(app.deleteTrackedRepoGroup({ groupId: unknownRepoId })).rejects.toThrow('The selected group could not be found.');
    });

    it('renames a repository and refuses a blank name', async () => {
        await app.renameRepo({ repoId: repoAId, name: '  order-a renamed  ' });
        expect(useDb().getRepo(repoAId)?.name).toBe('order-a renamed');

        await expect(app.renameRepo({ repoId: repoAId, name: '   ' })).rejects.toThrow('Repository name is required.');
        await expect(app.renameRepo({ repoId: unknownRepoId, name: 'anything' })).rejects.toThrow('The selected repository could not be found.');
    });

    it('adds a tracked repository from a path with its target group', async () => {
        const repoPath = createTrackedRepo('gitvan-app-add-path-');

        try {
            const result = await app.addTrackedRepoFromPath({ path: `  ${repoPath}  `, targetGroupId: groupAId });
            const added = result.repos.find((repo) => repo.path.endsWith(basename(repoPath)));

            expect(added).toBeDefined();
            expect(added?.groupId).toBe(groupAId);
            expect(result.selectedRepoId).toBe(added?.id);
        } finally {
            const added = useDb()
                .listRepos()
                .find((repo) => repo.path.endsWith(basename(repoPath)));
            if (added) {
                useDb().removeRepo(added.id);
            }
            rmSync(repoPath, { recursive: true, force: true });
        }
    });

    it('ignores a blank path and rejects a directory that is not a repository', async () => {
        const before = (await app.getBootstrap()).repos.length;
        await app.addTrackedRepoFromPath({ path: '   ' });
        expect((await app.getBootstrap()).repos.length).toBe(before);

        const notARepo = mkdtempSync(join(tmpdir(), 'gitvan-app-not-a-repo-'));
        try {
            await expect(app.addTrackedRepoFromPath({ path: notARepo })).rejects.toThrow();
        } finally {
            rmSync(notARepo, { recursive: true, force: true });
        }
    });
});

describe('app create and clone', () => {
    const cleanups: Array<() => void> = [];

    afterAll(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function removeRepoByName(name: string) {
        const repo = useDb()
            .listRepos()
            .find((entry) => entry.name === name);
        if (repo) {
            useDb().removeRepo(repo.id);
        }
    }

    it('creates a local repository, selects it and remembers the parent directory', async () => {
        const parent = mkdtempSync(join(tmpdir(), 'gitvan-app-create-'));
        cleanups.push(() => rmSync(parent, { recursive: true, force: true }));

        const result = await app.createTrackedLocalRepo({ name: 'created-local', parentDirectory: ` ${parent} ` });
        const created = result.repos.find((repo) => repo.name === 'created-local');

        expect(created).toBeDefined();
        expect(existsSync(join(parent, 'created-local', '.git'))).toBe(true);
        expect(result.selectedRepoId).toBe(created?.id);
        expect(app.getCloneRepoDefaults().parentDirectory).toBe(parent);

        removeRepoByName('created-local');
    });

    it('validates the repository name, the parent directory and the group', async () => {
        const parent = mkdtempSync(join(tmpdir(), 'gitvan-app-create-invalid-'));
        cleanups.push(() => rmSync(parent, { recursive: true, force: true }));

        await expect(app.createTrackedLocalRepo({ name: '   ', parentDirectory: parent })).rejects.toThrow('A repository name is required.');
        await expect(app.createTrackedLocalRepo({ name: 'repo', parentDirectory: '   ' })).rejects.toThrow('A local path is required.');
        await expect(app.createTrackedLocalRepo({ name: 'repo', parentDirectory: parent, groupId: unknownRepoId })).rejects.toThrow('The selected group could not be found.');
    });

    it('clones a repository from a local path and names it after the source', async () => {
        const source = createTrackedRepo('gitvan-app-clone-source-');
        const parent = mkdtempSync(join(tmpdir(), 'gitvan-app-clone-'));
        cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
        cleanups.push(() => rmSync(source, { recursive: true, force: true }));

        const result = await app.cloneTrackedRepo({ accountId: undefined, cloneUrl: source, parentDirectory: parent });
        const cloned = result.repos.find((repo) => repo.name === basename(source));

        expect(cloned).toBeDefined();
        expect(existsSync(join(parent, basename(source), '.git'))).toBe(true);
        expect(result.selectedRepoId).toBe(cloned?.id);

        removeRepoByName(basename(source));
    });

    it('validates the clone url, the parent directory and the group', async () => {
        const parent = mkdtempSync(join(tmpdir(), 'gitvan-app-clone-invalid-'));
        cleanups.push(() => rmSync(parent, { recursive: true, force: true }));

        await expect(app.cloneTrackedRepo({ accountId: undefined, cloneUrl: '   ', parentDirectory: parent })).rejects.toThrow('A repository URL is required.');
        await expect(app.cloneTrackedRepo({ accountId: undefined, cloneUrl: 'https://example.invalid/repo.git', parentDirectory: '   ' })).rejects.toThrow(
            'A local path is required.'
        );
        await expect(app.cloneTrackedRepo({ accountId: undefined, cloneUrl: ':', parentDirectory: parent })).rejects.toThrow(
            'The repository URL does not include a valid repository name.'
        );
        await expect(app.cloneTrackedRepo({ accountId: undefined, cloneUrl: 'https://example.invalid/repo.git', parentDirectory: parent, groupId: unknownRepoId })).rejects.toThrow(
            'The selected group could not be found.'
        );
    });
});

describe('app settings', () => {
    it('normalizes the editor settings it writes and reads back', () => {
        const updated = app.updateEditorSettings({
            settings: {
                ...app.getEditorSettings(),
                editors: [
                    { path: '/Applications/Code.app', label: '   ' },
                    { path: '/Applications/Code.app', label: 'Duplicate' },
                    { path: '/usr/bin/vim', label: 'Vim' },
                ],
                defaultEditorPath: '/Applications/Code.app',
                diffFontSize: 99,
                diffIgnoredChars: ' , ;  ,\n|',
                diffViewMode: 'changes',
                activeView: 'tags',
                showBranches: true,
                showWhitespaceChanges: true,
            } as EditorSettings,
        });

        expect(updated.editors).toEqual([
            { path: '/Applications/Code.app', label: 'Code.app' },
            { path: '/usr/bin/vim', label: 'Vim' },
        ]);
        expect(updated.defaultEditorPath).toBe('/Applications/Code.app');
        expect(updated.diffFontSize).toBe(24);
        expect(updated.diffIgnoredChars).toBe(',;|');
        expect(updated.diffViewMode).toBe('changes');
        expect(updated.activeView).toBe('tags');
        expect(updated.showBranches).toBe(true);
        expect(updated.showWhitespaceChanges).toBe(true);
        expect(updated.diffIgnoredCharsEnabled).toBe(true);
        expect(updated.terminals.length).toBeGreaterThan(0);
        expect(updated.defaultTerminalPath).toBe(updated.terminals[0]?.path);

        expect(app.getEditorSettings().editors).toEqual(updated.editors);
    });

    it('falls back to the defaults for a font size and a view it cannot use', () => {
        const updated = app.updateEditorSettings({
            settings: {
                ...app.getEditorSettings(),
                diffFontSize: Number.NaN,
                diffViewMode: 'side-by-side' as EditorSettings['diffViewMode'],
                activeView: 'unknown' as EditorSettings['activeView'],
                diffIgnoredCharsEnabled: false,
            },
        });

        expect(updated.diffFontSize).toBe(12);
        expect(updated.diffViewMode).toBe('full-file');
        expect(updated.activeView).toBe('changes');
        expect(updated.diffIgnoredCharsEnabled).toBe(false);
    });

    it('drops a default editor that is not in the list and keeps a legacy one', () => {
        const legacySettings = {
            ...app.getEditorSettings(),
            editors: [{ path: '/usr/bin/vim' }],
            defaultEditorPath: '/missing/editor',
            lastEditorPath: '/usr/bin/nano',
        };

        const updated = app.updateEditorSettings({ settings: legacySettings as unknown as EditorSettings });

        expect(updated.editors.some((editor) => editor.path === '/usr/bin/nano')).toBe(true);
        expect(updated.defaultEditorPath).toBeUndefined();
    });

    it('normalizes the OAuth provider settings', () => {
        const updated = app.updateOAuthProviderSettings({ settings: { githubClientId: ' gh ', gitlabClientId: '', gitlabHost: '  ' } });

        expect(updated).toEqual({ githubClientId: 'gh', gitlabClientId: '', gitlabHost: 'gitlab.com' });
        expect(app.getOAuthProviderSettings()).toEqual(updated);
    });

    it('reports the stored clone parent directory and falls back to an empty one', () => {
        useDb().setSetting('cloneParentDirectory', '/tmp/gitvan-spec-parent');
        expect(app.getCloneRepoDefaults()).toEqual({ parentDirectory: '/tmp/gitvan-spec-parent' });

        useDb().setSetting('cloneParentDirectory', '   ');
        expect(app.getCloneRepoDefaults()).toEqual({ parentDirectory: '' });
    });
});

describe('app accounts and assignment', () => {
    let repoPath: string;
    let repoId: number;
    let terminalPath: string;

    function createSystemAccount(label: string) {
        return app.createAccount({
            label,
            provider: 'system',
            authKind: 'system-git',
            username: undefined,
            host: undefined,
            accessToken: undefined,
            setAsDefault: false,
        });
    }

    beforeAll(() => {
        repoPath = createTrackedRepo('gitvan-app-accounts-');
        repoId = useDb().upsertRepo(repoPath, 'accounts');
        terminalPath = app.updateEditorSettings({ settings: { ...app.getEditorSettings(), terminals: [{ path: '/bin/zsh', label: 'zsh', locked: true }] } }).terminals[0]!.path;
    });

    afterAll(() => {
        useDb().removeRepo(repoId);
        rmSync(repoPath, { recursive: true, force: true });
    });

    it('creates a normalized system account and rejects the value mistakes', async () => {
        const created = await createSystemAccount('  Spec System  ');
        const account = created.accounts.find((entry) => entry.label === 'Spec System');

        expect(account).toMatchObject({ provider: 'system', authKind: 'system-git', isDefault: false });
        useDb().removeAccount(account!.id);

        await expect(
            app.createAccount({ label: 'x', provider: 'unsupported', authKind: 'system-git', username: undefined, host: undefined, accessToken: undefined, setAsDefault: false })
        ).rejects.toThrow('Unsupported account provider.');
        await expect(
            app.createAccount({ label: 'x', provider: 'github', authKind: 'bogus', username: undefined, host: undefined, accessToken: undefined, setAsDefault: false })
        ).rejects.toThrow('Unsupported authentication method.');
        await expect(
            app.createAccount({ label: '   ', provider: 'github', authKind: 'https-token', username: undefined, host: undefined, accessToken: 'token', setAsDefault: false })
        ).rejects.toThrow('Account label is required.');
        await expect(
            app.createAccount({ label: 'x', provider: 'github', authKind: 'oauth', username: undefined, host: undefined, accessToken: undefined, setAsDefault: false })
        ).rejects.toThrow('OAuth accounts must be created through the sign-in flow.');
    });

    it('renames an account, marks it default and reorders it to the top', async () => {
        const first = await createSystemAccount('Spec One');
        const firstId = first.accounts.find((account) => account.label === 'Spec One')!.id;
        const second = await createSystemAccount('Spec Two');
        const secondId = second.accounts.find((account) => account.label === 'Spec Two')!.id;

        try {
            const updated = await app.updateAccount({
                accountId: secondId,
                label: ' Spec Two renamed ',
                username: undefined,
                host: undefined,
                accessToken: undefined,
                setAsDefault: true,
            });
            expect(updated.accounts.find((account) => account.id === secondId)).toMatchObject({ label: 'Spec Two renamed', isDefault: true });

            await app.reorderAccount({ accountId: secondId, toIndex: 0 });

            const ids = useDb()
                .listAccounts()
                .map((account) => account.id);
            expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId));

            await expect(
                app.updateAccount({ accountId: unknownRepoId, label: 'x', username: undefined, host: undefined, accessToken: undefined, setAsDefault: false })
            ).rejects.toThrow('The selected account could not be found.');
            await expect(app.reorderAccount({ accountId: unknownRepoId, toIndex: 0 })).rejects.toThrow('The selected account could not be found.');
        } finally {
            useDb().removeAccount(firstId);
            useDb().removeAccount(secondId);
        }
    });

    it('assigns an account and a terminal to a repository and clears them', async () => {
        const created = await createSystemAccount('Spec Assign');
        const accountId = created.accounts.find((account) => account.label === 'Spec Assign')!.id;

        await app.assignRepoAccount({ repoId, accountId });
        await app.assignRepoTerminal({ repoId, terminalPath });
        expect(useDb().getRepo(repoId)).toMatchObject({ account_id: accountId, terminal_path: terminalPath });

        await app.assignRepoAccount({ repoId, accountId: undefined });
        await app.assignRepoTerminal({ repoId, terminalPath: undefined });
        expect(useDb().getRepo(repoId)).toMatchObject({ account_id: null, terminal_path: null });

        useDb().removeAccount(accountId);
    });

    it('refuses an unknown account, repository or terminal', async () => {
        await expect(app.assignRepoAccount({ repoId, accountId: unknownRepoId })).rejects.toThrow('The selected account could not be found.');
        await expect(app.assignRepoAccount({ repoId: unknownRepoId, accountId: undefined })).rejects.toThrow(repositoryNotFoundMessage);
        await expect(app.assignRepoTerminal({ repoId, terminalPath: '/definitely/missing' })).rejects.toThrow('The selected terminal could not be found.');
        await expect(app.assignRepoTerminal({ repoId: unknownRepoId, terminalPath: undefined })).rejects.toThrow(repositoryNotFoundMessage);
    });
});
