import { existsSync } from 'fs';
import { join } from 'path';
import { appConfig } from '../../electronUtils/helpers.js';
import { resolveAppDataDir, useDatabase, type DatabaseClient } from '../../electronUtils/useDatabase.js';
import type { AccountSummary, GroupSummary } from '../../shared/types.js';

type SettingsRow = {
    key: string;
    value: string;
};
export type RepoRow = {
    id: number;
    name: string;
    path: string;
    sequence: number | bigint;
    group_id: number | undefined;
    group_name: string | undefined;
    account_id: number | undefined;
    account_label: string | undefined;
    terminal_path: string | undefined;
    created_at: string;
    last_opened_at: string | undefined;
};

type GroupRow = {
    id: number;
    name: string;
    sequence: number | bigint;
    created_at: string;
    repository_count: number | bigint;
};

type AccountRow = {
    id: number;
    label: string;
    provider: string;
    auth_kind: string;
    username: string | undefined;
    host: string | undefined;
    sequence: number | bigint;
    is_default: number;
    created_at: string;
};

type AccountAuthRow = {
    id: number;
    label: string;
    provider: string;
    auth_kind: string;
    username: string | undefined;
    host: string | undefined;
    is_default: number;
    created_at: string;
};

type ColumnDefinitions<T extends Record<string, any>, TComputed extends string> = Record<Exclude<keyof T, TComputed>, string>;
function useTable<Table extends Record<string, any>, TComputed extends string = ''>(
    tableName: string,
    columns: ColumnDefinitions<Table, TComputed>,
    foreignKeys?: Record<string, string>
) {
    type RealColumn = Exclude<keyof Table, TComputed>;
    // const columns = columnDefs as { name: string; createDefinition: string }[];

    function createTableSql() {
        // `columns` is a generic mapped type, so `Object.entries` widens the values to `unknown`.
        const columnDefs = (Object.entries(columns) as Array<[string, string]>).map(([name, createDefinition]) => `${name} ${createDefinition}`).join(',\n    ');
        const foreignKeyDefs = foreignKeys
            ? Object.entries(foreignKeys)
                  .map(([col, ref]) => `FOREIGN KEY (${col}) REFERENCES ${ref}`)
                  .join(',\n    ')
            : '';
        const allDefs = [columnDefs, foreignKeyDefs].filter(Boolean).join(',\n    ');
        return `CREATE TABLE IF NOT EXISTS ${tableName} (\n    ${allDefs}\n);`;
    }

    function select(db: DatabaseClient, columns: (keyof Table)[] | '*', whereClause?: string, orderBy?: string, limit?: number) {
        let sql = `SELECT ${columns === '*' ? '*' : (columns as string[]).join(', ')} FROM ${tableName}`;
        if (whereClause) {
            sql += ` WHERE ${whereClause}`;
        }
        if (orderBy) {
            sql += ` ORDER BY ${orderBy}`;
        }
        if (limit !== undefined) {
            sql += ` LIMIT ${limit}`;
        }
        return db.prepare(sql).all() as Table[];
    }

    function getCount(db: DatabaseClient, whereClause?: string) {
        let sql = `SELECT COUNT(*) AS count FROM ${tableName}`;
        if (whereClause) {
            sql += ` WHERE ${whereClause}`;
        }
        const row = db.prepare(sql).get<{ count: number }>();
        return row ? row.count : 0;
    }
    // db.prepare('INSERT INTO accounts(label, provider, auth_kind, username, host, is_default) VALUES(?, ?, ?, ?, ?, ?)').run(
    //     'System Git',
    //     'system',
    //     'system-git',
    //     null,
    //     null,
    //     1
    // );
    type InsertUpdateData = Partial<{
        [K in RealColumn]: Table[K] | null;
    }>;
    function insert(db: DatabaseClient, data: InsertUpdateData) {
        const keys = Object.keys(data);
        const vals = Object.values(data).map((v) => (v === undefined ? null : v)) as any[];
        return db.prepare(`INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...vals);
    }
    return {
        createTableSql,
        select,
        getCount,
        insert,
    };
}

const settingsTable = useTable<SettingsRow>('settings', {
    key: 'TEXT PRIMARY KEY',
    value: 'TEXT NOT NULL',
});

const repoTable = useTable<RepoRow, 'group_name' | 'account_label'>(
    'repositories',
    {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        name: 'TEXT NOT NULL',
        path: 'TEXT NOT NULL UNIQUE',
        sequence: 'INTEGER NOT NULL DEFAULT 0',
        group_id: 'INTEGER',
        account_id: 'INTEGER',
        terminal_path: 'TEXT',
        created_at: 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
        last_opened_at: 'TEXT',
    },
    {
        group_id: 'groups(id)',
        account_id: 'accounts(id)',
    }
);
console.log(repoTable.createTableSql());

const accountTable = useTable<AccountRow>('accounts', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    label: 'TEXT NOT NULL',
    provider: 'TEXT NOT NULL',
    auth_kind: 'TEXT NOT NULL',
    username: 'TEXT',
    host: 'TEXT',
    sequence: 'INTEGER NOT NULL DEFAULT 0',
    is_default: 'INTEGER NOT NULL DEFAULT 0',
    created_at: 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
});

const groupsTable = useTable<GroupRow, 'repository_count'>('groups', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL UNIQUE COLLATE NOCASE',
    sequence: 'INTEGER NOT NULL DEFAULT 0',
    created_at: 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
});

const db = useDatabase();

export function useDb() {
    return {
        configureDatabase(userDataDir?: string) {
            db.configureDatabase(userDataDir ?? resolveAppDataDir(), () => {
                db.exec(`
                    PRAGMA journal_mode = WAL;
                    ${settingsTable.createTableSql()}
                    ${accountTable.createTableSql()}
                    ${groupsTable.createTableSql()}
                    ${repoTable.createTableSql()}
                `);

                const accountCount = accountTable.getCount(db);

                if (accountCount === 0) {
                    accountTable.insert(db, {
                        label: 'System Git',
                        provider: 'system',
                        auth_kind: 'system-git',
                        username: null,
                        host: null,
                        is_default: 1,
                    });
                }

                db.normalizeSequence('accounts', 'is_default DESC, ');
                db.normalizeSequence('groups');
                db.normalizeSequence('repositories');
            });
        },
        getStoredRepoCount(userDataDir: string) {
            const databasePath = join(userDataDir, appConfig.dbFileName);

            if (!existsSync(databasePath)) {
                return undefined;
            }

            let tempDatabase: DatabaseClient | undefined = undefined;

            try {
                tempDatabase = db.createRuntimeDatabaseClient(databasePath, { readOnly: true });

                const hasRepositoriesTable = tempDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repositories'").get() as
                    | { name: string }
                    | undefined;

                if (!hasRepositoriesTable) {
                    return undefined;
                }

                const row = tempDatabase.prepare('SELECT COUNT(*) AS count FROM repositories').get() as { count: number };
                return row.count;
            } catch {
                return undefined;
            } finally {
                tempDatabase?.close();
            }
        },
        listRepos() {
            return db
                .prepare(`
                    SELECT
                        repositories.id,
                        repositories.name,
                        repositories.path,
                        repositories.sequence,
                        repositories.group_id,
                        groups.name AS group_name,
                        repositories.account_id,
                        accounts.label AS account_label,
                        repositories.terminal_path,
                        repositories.created_at,
                        repositories.last_opened_at
                    FROM repositories
                    LEFT JOIN groups ON groups.id = repositories.group_id
                    LEFT JOIN accounts ON accounts.id = repositories.account_id
                    ORDER BY repositories.sequence ASC, repositories.created_at ASC, repositories.id ASC
                `)
                .all<RepoRow>();
        },
        listGroups() {
            return db
                .prepare(`
                    SELECT
                        groups.id,
                        groups.name,
                        groups.sequence,
                        groups.created_at,
                        COUNT(repositories.id) AS repository_count
                    FROM groups
                    LEFT JOIN repositories ON repositories.group_id = groups.id
                    GROUP BY groups.id, groups.name, groups.sequence, groups.created_at
                    ORDER BY groups.sequence ASC, groups.created_at ASC, groups.id ASC
                `)
                .all<GroupRow>()
                .map((group) => {
                    const summary: GroupSummary = {
                        id: group.id,
                        name: group.name,
                        sequence: db.toNumber(group.sequence),
                        repoCount: db.toNumber(group.repository_count),
                        createdAt: group.created_at,
                    };

                    return summary;
                }) as GroupSummary[];
        },
        listAccounts() {
            return accountTable.select(db, '*', undefined, 'sequence ASC, created_at ASC, id ASC').map((account) => {
                const summary: AccountSummary = {
                    id: account.id,
                    label: account.label,
                    provider: account.provider,
                    authKind: account.auth_kind,
                    username: account.username,
                    host: account.host,
                    hasSecret: account.auth_kind === 'https-token' || account.auth_kind === 'oauth',
                    isDefault: account.is_default === 1,
                    createdAt: account.created_at,
                };

                return summary;
            });
        },
        upsertRepo(path: string, name: string, groupId?: number) {
            const existing = db.prepare('SELECT id FROM repositories WHERE path = ?').get<{ id: number }>(path);
            const defaultAccount = db.prepare('SELECT id FROM accounts WHERE is_default = 1 ORDER BY id ASC LIMIT 1').get<{ id: number } | undefined>();
            const touchRepo = db.prepare('UPDATE repositories SET name = ?, last_opened_at = CURRENT_TIMESTAMP, group_id = ? WHERE path = ?');

            if (existing) {
                touchRepo.run(name, path, groupId ?? null);
                return existing.id;
            }

            if (defaultAccount) {
                const result = db
                    .prepare('INSERT INTO repositories(name, path, account_id, sequence, group_id) VALUES(?, ?, ?, ?, ?)')
                    .run(name, path, defaultAccount.id, db.getNextSequence('repositories'), groupId ?? null);
                touchRepo.run(name, path, groupId ?? null);

                return db.toNumber(result.lastInsertRowid);
            }

            const result = db
                .prepare('INSERT INTO repositories(name, path, sequence, group_id) VALUES(?, ?, ?, ?)')
                .run(name, path, db.getNextSequence('repositories'), groupId ?? null);
            touchRepo.run(name, path, groupId ?? null);
            return db.toNumber(result.lastInsertRowid);
        },
        setSelectedRepoId(id: number | undefined) {
            db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('selectedRepoId', JSON.stringify(id));
        },
        getSelectedRepoId() {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>('selectedRepoId');

            if (!row) {
                return undefined;
            }

            return JSON.parse(row.value) as number | undefined;
        },
        getSetting<T>(key: string, fallbackValue: T) {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(key);

            if (!row) {
                return fallbackValue;
            }

            return JSON.parse(row.value) as T;
        },
        setSetting<T>(key: string, value: T) {
            db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
        },
        repoExists(id: number) {
            return Boolean(db.prepare('SELECT id FROM repositories WHERE id = ?').get<{ id: number }>(id));
        },
        getRepo(id: number) {
            return db.prepare('SELECT * FROM repositories WHERE id = ?').get<RepoRow>(id);
        },
        groupExists(groupId: number) {
            return Boolean(db.prepare('SELECT id FROM groups WHERE id = ?').get<{ id: number }>(groupId));
        },
        getGroupByName(name: string) {
            return db.prepare('SELECT * FROM groups WHERE name = ?').get<GroupRow>(name);
        },
        createGroup(name: string) {
            const normalizedName = name.trim();

            if (!normalizedName) {
                throw new Error('Group name is required.');
            }

            const result = db.prepare('INSERT INTO groups(name, sequence) VALUES(?, ?)').run(normalizedName, db.getNextSequence('groups'));
            return db.toNumber(result.lastInsertRowid);
        },
        deleteGroup(id: number) {
            db.prepare('DELETE FROM repositories WHERE group_id = ?').run(id);
            db.prepare('UPDATE repositories SET group_id = NULL WHERE group_id = ?').run(id);
            db.prepare('DELETE FROM groups WHERE id = ?').run(id);
        },
        updateGroupName(id: number, name: string) {
            const normalizedName = name.trim();

            if (!normalizedName) {
                throw new Error('Group name is required.');
            }

            db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(normalizedName, id);
        },
        moveGroup(id: number, direction: 'up' | 'down') {
            db.moveSequence('group', 'groups', id, direction);
        },
        moveRepo(id: number, direction: 'up' | 'down') {
            db.moveSequence('repository', 'repositories', id, direction);
        },
        reorderRepo(id: number, toIndex: number) {
            db.reorderSequence('repository', 'repositories', id, toIndex);
        },
        accountExists(id: number) {
            return Boolean(db.prepare('SELECT id FROM accounts WHERE id = ?').get(id));
        },
        createAccount(label: string, provider: string, authKind: string, username: string | undefined, host: string | undefined, setAsDefault: boolean) {
            const normalizedLabel = label.trim();

            if (!normalizedLabel) {
                throw new Error('Account label is required.');
            }

            if (setAsDefault) {
                db.prepare('UPDATE accounts SET is_default = 0').run();
            }

            const result = db
                .prepare('INSERT INTO accounts(label, provider, auth_kind, username, host, sequence, is_default) VALUES(?, ?, ?, ?, ?, ?, ?)')
                .run(normalizedLabel, provider, authKind, username ?? null, host ?? null, db.getNextSequence('accounts'), setAsDefault ? 1 : 0);

            return db.toNumber(result.lastInsertRowid);
        },
        updateAccount(id: number, label: string, username: string | undefined, host: string | undefined, setAsDefault: boolean) {
            const normalizedLabel = label.trim();

            if (!normalizedLabel) {
                throw new Error('Account label is required.');
            }

            if (setAsDefault) {
                db.prepare('UPDATE accounts SET is_default = 0').run();
            }

            db.prepare('UPDATE accounts SET label = ?, username = ?, host = ?, is_default = ? WHERE id = ?').run(
                normalizedLabel,
                username ?? null,
                host ?? null,
                setAsDefault ? 1 : 0,
                id
            );
        },
        reorderAccount(id: number, toIndex: number) {
            db.reorderSequence('account', 'accounts', id, toIndex);
        },
        getAccountAuthById(id: number) {
            return db.prepare('SELECT id, label, provider, auth_kind, username, host, is_default, created_at FROM accounts WHERE id = ?').get<AccountAuthRow>(id);
        },
        assignRepoAccount(id: number, accountId: number | undefined) {
            db.prepare('UPDATE repositories SET account_id = ? WHERE id = ?').run(accountId ?? null, id);
        },
        assignRepoTerminal(id: number, terminalPath: string | undefined) {
            db.prepare('UPDATE repositories SET terminal_path = ? WHERE id = ?').run(terminalPath ?? null, id);
        },
        updateRepoName(id: number, name: string) {
            const normalizedName = name.trim();

            if (!normalizedName) {
                throw new Error('Repository name is required.');
            }

            db.prepare('UPDATE repositories SET name = ? WHERE id = ?').run(normalizedName, id);
        },
        updateRepoGroup(id: number, groupId: number | undefined) {
            db.prepare('UPDATE repositories SET group_id = ? WHERE id = ?').run(groupId ?? null, id);
        },
        removeRepo(id: number) {
            db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
        },
        removeAccount(id: number) {
            db.prepare('UPDATE repositories SET account_id = NULL WHERE account_id = ?').run(id);
            db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
        },
    };
}
