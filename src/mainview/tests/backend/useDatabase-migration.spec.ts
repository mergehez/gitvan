import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { useDb } from '../../../backend/services/database.js';
import { appConfig } from '../../../electronUtils/helpers.js';
import { useDatabase } from '../../../electronUtils/useDatabase.js';

// The legacy fixture is written before `configureDatabase` runs, because the client it returns
// is a module singleton that can only be pointed at one directory per test file.
const userDataDir = mkdtempSync(join(tmpdir(), 'gitvan-legacy-database-'));
const databasePath = join(userDataDir, appConfig.dbFileName);

const legacyClient = useDatabase().createRuntimeDatabaseClient(databasePath);
legacyClient.exec(`
    CREATE TABLE repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL DEFAULT 0,
        account_id INTEGER,
        terminal_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_opened_at TEXT
    );
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    INSERT INTO repositories(name, path, sequence) VALUES ('legacy', '/tmp/gitvan-legacy', 7);
    INSERT INTO settings(key, value) VALUES ('selectedRepoId', '1');
`);
legacyClient.close();

const database = useDb();
database.configureDatabase(userDataDir);

afterAll(() => {
    useDatabase().close();
    rmSync(userDataDir, { recursive: true, force: true });
});

describe('useDb legacy database migration', () => {
    it('adds the column a pre-groups database is missing and keeps its rows', () => {
        const columns = useDatabase()
            .prepare('PRAGMA table_info(repositories)')
            .all<{ name: string }>()
            .map((column) => column.name);

        expect(columns).toContain('group_id');
        expect(database.listRepos()).toEqual([expect.objectContaining({ id: 1, name: 'legacy', path: '/tmp/gitvan-legacy', group_id: null })]);
    });

    it('normalizes the migrated sequence and creates the tables it did not have', () => {
        expect(database.listRepos()[0]?.sequence).toBe(1);

        const tables = useDatabase()
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .all<{ name: string }>()
            .map((table) => table.name);

        expect(tables).toEqual(expect.arrayContaining(['accounts', 'groups', 'repositories', 'settings']));
    });

    it('keeps a stored setting and seeds the system account once', () => {
        expect(database.getSelectedRepoId()).toBe(1);
        expect(database.listAccounts().map((account) => account.label)).toEqual(['System Git']);
    });
});
