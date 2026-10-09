import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it } from 'vitest';
import { useDb } from '../../../../backend/services/database.js';
import { appConfig } from '../../../../electronUtils/helpers.js';
import { useDatabase } from '../../../../electronUtils/useDatabase.js';

// The database client is a module singleton that refuses to configure twice, so this file
// configures one throwaway directory and asserts the schema it produced.
const userDataDir = mkdtempSync(join(tmpdir(), 'gitvan-database-'));

afterEach(() => {
    useDatabase().close();
    rmSync(userDataDir, { recursive: true, force: true });
});

it('creates the full repository schema on a brand-new database', () => {
    const database = useDb();
    database.configureDatabase(userDataDir);

    // This query selects `group_id`, so it is what used to fail on a fresh install.
    expect(database.listRepos()).toEqual([]);

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
