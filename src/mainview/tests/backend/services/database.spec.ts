import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { useDb } from '../../../../backend/services/database.js';
import { appConfig } from '../../../../electronUtils/helpers.js';
import { useDatabase } from '../../../../electronUtils/useDatabase.js';

// The database client is a module singleton that refuses to configure twice, so every test in this
// file shares one throwaway database and starts from cleared tables.
const userDataDir = mkdtempSync(join(tmpdir(), 'gitvan-database-'));
const database = useDb();
database.configureDatabase(userDataDir);

function clearTables() {
    const client = useDatabase();

    client.exec('DELETE FROM repositories; DELETE FROM groups; DELETE FROM settings;');
    // The System Git account is seeded by configureDatabase and is what upsertRepo assigns by default.
    client.exec("DELETE FROM accounts WHERE provider <> 'system';");
}

beforeEach(() => {
    clearTables();
});

afterAll(() => {
    useDatabase().close();
    rmSync(userDataDir, { recursive: true, force: true });
});

function addGroup(name: string) {
    return database.createGroup(name);
}

function addRepo(name: string, groupId?: number) {
    return database.upsertRepo(`/tmp/gitvan-spec/${name}`, name, groupId);
}

describe('schema', () => {
    it('creates the full repository schema on a brand-new database', () => {
        // This query selects `group_id`, so it is what used to fail on a fresh install.
        expect(Array.isArray(database.listRepos())).toBe(true);

        const client = useDatabase().createRuntimeDatabaseClient(join(userDataDir, appConfig.dbFileName), { readOnly: true });

        try {
            const columnNames = client
                .prepare('PRAGMA table_info(repositories)')
                .all<{ name: string }>()
                .map((column) => column.name);

            expect(columnNames).toEqual(expect.arrayContaining(['id', 'name', 'path', 'sequence', 'group_id', 'account_id', 'terminal_path', 'created_at', 'last_opened_at']));
        } finally {
            client.close();
        }
    });

    it('adds a column that a database created before it is missing', () => {
        const client = useDatabase();

        client.exec('CREATE TABLE IF NOT EXISTS legacy_repositories (id INTEGER PRIMARY KEY, name TEXT)');
        client.ensureColumn('legacy_repositories', 'group_id', 'INTEGER');

        const columns = client
            .prepare('PRAGMA table_info(legacy_repositories)')
            .all<{ name: string }>()
            .map((column) => column.name);
        client.exec('DROP TABLE legacy_repositories');

        expect(columns).toContain('group_id');
    });
});

describe('repositories', () => {
    it('inserts a repository and returns the id it stored it under', () => {
        const repoId = addRepo('alpha');

        expect(database.repoExists(repoId)).toBe(true);
        expect(database.getRepo(repoId)).toMatchObject({ name: 'alpha', path: '/tmp/gitvan-spec/alpha' });
    });

    it('updates the existing row instead of duplicating a path', () => {
        const repoId = addRepo('alpha');
        const groupId = addGroup('Work');

        const sameId = database.upsertRepo('/tmp/gitvan-spec/alpha', 'renamed-alpha', groupId);

        expect(sameId).toBe(repoId);
        expect(database.listRepos()).toHaveLength(1);
        expect(database.getRepo(repoId)).toMatchObject({ name: 'renamed-alpha', group_id: groupId });
    });

    it('joins the group name and account label into the repository list', () => {
        const groupId = addGroup('Work');
        const repoId = addRepo('alpha', groupId);
        const accountId = database.createAccount('Work token', 'github', 'https-token', 'octocat', 'github.com', false);

        database.assignRepoAccount(repoId, accountId);

        expect(database.listRepos()[0]).toMatchObject({ group_id: groupId, group_name: 'Work', account_id: accountId, account_label: 'Work token' });
    });

    it('lists repositories in their stored order and reorders them', () => {
        const first = addRepo('alpha');
        addRepo('beta');
        const third = addRepo('gamma');

        expect(database.listRepos().map((repo) => repo.name)).toEqual(['alpha', 'beta', 'gamma']);

        database.moveRepo(third, 'up');
        expect(database.listRepos().map((repo) => repo.name)).toEqual(['alpha', 'gamma', 'beta']);

        database.reorderRepo(first, 2);
        expect(database.listRepos().map((repo) => repo.name)).toEqual(['gamma', 'beta', 'alpha']);
    });

    it('renames a repository and assigns its terminal', () => {
        const repoId = addRepo('alpha');

        database.updateRepoName(repoId, 'beta');
        database.assignRepoTerminal(repoId, '/bin/zsh');

        expect(database.getRepo(repoId)).toMatchObject({ name: 'beta', terminal_path: '/bin/zsh' });
    });

    it('removes a repository', () => {
        const repoId = addRepo('alpha');

        database.removeRepo(repoId);

        expect(database.repoExists(repoId)).toBe(false);
        expect(database.listRepos()).toEqual([]);
    });
});

describe('groups', () => {
    it('creates a group and finds it by name regardless of case', () => {
        const groupId = addGroup('  Work  ');

        expect(database.getGroupByName('work')).toMatchObject({ id: groupId, name: 'Work' });
        expect(database.listGroups()).toEqual([expect.objectContaining({ id: groupId, repoCount: 0 })]);
    });

    it('refuses an empty group name', () => {
        expect(() => database.createGroup('   ')).toThrow('Group name is required.');
    });

    it('counts the repositories in each group', () => {
        const groupId = addGroup('Work');
        addRepo('alpha', groupId);
        addRepo('beta', groupId);
        addRepo('gamma');

        expect(database.listGroups()).toEqual([expect.objectContaining({ name: 'Work', repoCount: 2 })]);
    });

    it('keeps the repositories when their group is deleted', () => {
        const groupId = addGroup('Work');
        const repoId = addRepo('alpha', groupId);

        database.deleteGroup(groupId);

        expect(database.groupExists(groupId)).toBe(false);
        expect(database.repoExists(repoId)).toBe(true);
        expect(database.getRepo(repoId)?.group_id).toBeNull();
    });

    it('moves a group up and down', () => {
        const first = addGroup('Alpha');
        addGroup('Beta');
        const third = addGroup('Gamma');

        database.moveGroup(third, 'up');
        expect(database.listGroups().map((group) => group.name)).toEqual(['Alpha', 'Gamma', 'Beta']);

        database.moveGroup(first, 'down');
        expect(database.listGroups().map((group) => group.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
    });
});

describe('settings', () => {
    it('round-trips arbitrary values and falls back when a key is unset', () => {
        expect(database.getSetting('missing', 'fallback')).toBe('fallback');

        database.setSetting('editorSettings', { diffFontSize: 14 });
        database.setSetting('editorSettings', { diffFontSize: 16 });

        expect(database.getSetting('editorSettings', {})).toEqual({ diffFontSize: 16 });
    });

    it('round-trips the selected repository, including clearing it', () => {
        const repoId = addRepo('alpha');

        expect(database.getSelectedRepoId()).toBeUndefined();

        database.setSelectedRepoId(repoId);
        expect(database.getSelectedRepoId()).toBe(repoId);

        database.setSelectedRepoId(undefined);
        expect(database.getSelectedRepoId()).toBeUndefined();
    });
});

describe('accounts', () => {
    it('creates, updates and reorders accounts', () => {
        const first = database.createAccount('Personal', 'github', 'https-token', 'octocat', 'github.com', false);
        const second = database.createAccount('Work', 'gitlab', 'https-token', 'worker', 'gitlab.com', false);

        expect(database.accountExists(first)).toBe(true);
        // "System Git" is seeded when the database is created and always sorts first.
        expect(database.listAccounts().map((account) => account.label)).toEqual(['System Git', 'Personal', 'Work']);

        database.updateAccount(second, 'Work renamed', 'worker2', 'gitlab.example.com', true);
        expect(database.listAccounts().find((account) => account.id === second)).toMatchObject({
            label: 'Work renamed',
            username: 'worker2',
            host: 'gitlab.example.com',
            isDefault: true,
        });

        database.reorderAccount(second, 0);
        expect(database.listAccounts().map((account) => account.label)).toEqual(['Work renamed', 'System Git', 'Personal']);
    });

    it('removes an account', () => {
        const accountId = database.createAccount('Personal', 'github', 'https-token', 'octocat', 'github.com', false);

        database.removeAccount(accountId);

        expect(database.accountExists(accountId)).toBe(false);
    });
});
