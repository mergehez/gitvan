import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';
import type { AccountSummary, GroupSummary } from '../../shared/gitClient.js';

export const DATABASE_FILE_NAME = 'gitvan.sqlite';

export type RepoRow = {
    id: number;
    name: string;
    path: string;
    sequence: number | bigint;
    group_id: number | undefined;
    group_name: string | undefined;
    account_id: number | undefined;
    account_label: string | undefined;
    added_at: string;
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

function createDbClient(userDataDir: string) {
    mkdirSync(userDataDir, { recursive: true });

    console.log(`Using database path: ${join(userDataDir, DATABASE_FILE_NAME)}`);
    const db = new DatabaseSync(join(userDataDir, DATABASE_FILE_NAME), {
        enableForeignKeyConstraints: true,
        timeout: 5000,
    });

    return {
        exec: (sql: string) => db.exec(sql),
        prepare: (sql: string) => {
            const statement = db.prepare(sql);
            return {
                run: (...params: SQLInputValue[]) => statement.run(...params),
                get: <T = Record<string, SQLOutputValue>>(...params: SQLInputValue[]) => statement.get(...params) as T | undefined,
                all: <T = Record<string, SQLOutputValue>>(...params: SQLInputValue[]) => statement.all(...params) as T[],
            };
        },
    };
}

let db = undefined as unknown as ReturnType<typeof createDbClient>;

export function useDb() {
    function ensureColumn(tableName: string, columnName: string, definition: string) {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();

        if (columns.some((column) => column.name === columnName)) {
            return;
        }

        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }

    function toNumber(value: number | bigint) {
        return typeof value === 'bigint' ? Number(value) : value;
    }

    function normalizeGroupSequences() {
        const rows = db.prepare('SELECT id FROM groups ORDER BY sequence ASC, created_at ASC, id ASC').all<{ id: number }>();
        const updateSequence = db.prepare('UPDATE groups SET sequence = ? WHERE id = ?');

        rows.forEach((row, index) => {
            updateSequence.run(index + 1, row.id);
        });
    }

    function normalizeRepoSequences() {
        const rows = db.prepare('SELECT id FROM repositories ORDER BY sequence ASC, added_at ASC, id ASC').all<{ id: number }>();
        const updateSequence = db.prepare('UPDATE repositories SET sequence = ? WHERE id = ?');

        rows.forEach((row, index) => {
            updateSequence.run(index + 1, row.id);
        });
    }

    function normalizeAccountSequences() {
        const rows = db.prepare('SELECT id FROM accounts ORDER BY sequence ASC, is_default DESC, created_at ASC, id ASC').all<{ id: number }>();
        const updateSequence = db.prepare('UPDATE accounts SET sequence = ? WHERE id = ?');

        rows.forEach((row, index) => {
            updateSequence.run(index + 1, row.id);
        });
    }

    function getNextSequence(tableName: 'accounts' | 'groups' | 'repositories') {
        const row = db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM ${tableName}`).get<{ sequence: number }>();
        return toNumber(row!.sequence) + 1;
    }

    function moveSequence(tableName: 'accounts' | 'groups' | 'repositories', id: number, direction: 'up' | 'down') {
        const orderColumn = tableName === 'groups' ? 'created_at' : tableName === 'repositories' ? 'added_at' : 'created_at';
        const rows = db.prepare(`SELECT id FROM ${tableName} ORDER BY sequence ASC, ${orderColumn} ASC, id ASC`).all<{ id: number }>();
        const currentIndex = rows.findIndex((row) => row.id === id);

        if (currentIndex === -1) {
            throw new Error(`The selected ${tableName === 'groups' ? 'group' : tableName === 'repositories' ? 'repository' : 'account'} could not be found.`);
        }

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= rows.length) {
            return;
        }

        const orderedIds = rows.map((row) => row.id);
        const [movedId] = orderedIds.splice(currentIndex, 1);
        orderedIds.splice(targetIndex, 0, movedId!);

        applySequenceOrder(tableName, orderedIds);
    }

    function applySequenceOrder(tableName: 'accounts' | 'groups' | 'repositories', orderedIds: number[]) {
        const updateSequence =
            tableName === 'groups'
                ? db.prepare('UPDATE groups SET sequence = ? WHERE id = ?')
                : tableName === 'repositories'
                  ? db.prepare('UPDATE repositories SET sequence = ? WHERE id = ?')
                  : db.prepare('UPDATE accounts SET sequence = ? WHERE id = ?');

        orderedIds.forEach((entryId, index) => {
            updateSequence.run(index + 1, entryId);
        });
    }

    function reorderSequence(tableName: 'accounts' | 'groups' | 'repositories', id: number, toIndex: number) {
        const orderColumn = tableName === 'groups' ? 'created_at' : tableName === 'repositories' ? 'added_at' : 'created_at';
        const rows = db.prepare(`SELECT id FROM ${tableName} ORDER BY sequence ASC, ${orderColumn} ASC, id ASC`).all<{ id: number }>();
        const currentIndex = rows.findIndex((row) => row.id === id);

        if (currentIndex === -1) {
            throw new Error(`The selected ${tableName === 'groups' ? 'group' : tableName === 'repositories' ? 'repository' : 'account'} could not be found.`);
        }

        const clampedIndex = Math.max(0, Math.min(toIndex, rows.length - 1));
        if (currentIndex === clampedIndex) {
            return;
        }

        const orderedIds = rows.map((row) => row.id);
        const [movedId] = orderedIds.splice(currentIndex, 1);
        orderedIds.splice(clampedIndex, 0, movedId!);

        applySequenceOrder(tableName, orderedIds);
    }

    return {
        configureDatabase(userDataDir: string) {
            if (db) {
                return;
            }

            db = createDbClient(userDataDir);
            db.exec(`
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    label TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    auth_kind TEXT NOT NULL,
                    username TEXT,
                    host TEXT,
                    sequence INTEGER NOT NULL DEFAULT 0,
                    is_default INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    sequence INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS repositories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    sequence INTEGER NOT NULL DEFAULT 0,
                    account_id INTEGER,
                    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_opened_at TEXT,
                    FOREIGN KEY (account_id) REFERENCES accounts(id)
                );
            `);

            ensureColumn('accounts', 'username', 'TEXT');
            ensureColumn('accounts', 'host', 'TEXT');
            ensureColumn('accounts', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
            ensureColumn('groups', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
            ensureColumn('repositories', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
            ensureColumn('repositories', 'group_id', 'INTEGER REFERENCES groups(id)');

            const accountCount = db.prepare('SELECT COUNT(*) AS count FROM accounts').get<{ count: number } | undefined>();

            if ((accountCount?.count ?? 0) === 0) {
                db.prepare('INSERT INTO accounts(label, provider, auth_kind, username, host, is_default) VALUES(?, ?, ?, ?, ?, ?)').run(
                    'System Git',
                    'system',
                    'system-git',
                    null,
                    null,
                    1,
                );
            }

            normalizeAccountSequences();
            normalizeGroupSequences();
            normalizeRepoSequences();
        },
        getStoredRepoCount(userDataDir: string) {
            const databasePath = join(userDataDir, DATABASE_FILE_NAME);

            if (!existsSync(databasePath)) {
                return undefined;
            }

            let tempDatabase: DatabaseSync | undefined = undefined;

            try {
                tempDatabase = new DatabaseSync(databasePath, { readOnly: true });

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
                        repositories.added_at,
                        repositories.last_opened_at
                    FROM repositories
                    LEFT JOIN groups ON groups.id = repositories.group_id
                    LEFT JOIN accounts ON accounts.id = repositories.account_id
                    ORDER BY repositories.sequence ASC, repositories.added_at ASC, repositories.id ASC
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
                        sequence: toNumber(group.sequence),
                        repoCount: toNumber(group.repository_count),
                        createdAt: group.created_at,
                    };

                    return summary;
                }) as GroupSummary[];
        },
        listAccounts() {
            return db
                .prepare('SELECT id, label, provider, auth_kind, username, host, is_default, created_at FROM accounts ORDER BY sequence ASC, created_at ASC, id ASC')
                .all<AccountRow>()
                .map((account) => {
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
                }) as AccountSummary[];
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
                    .run(name, path, defaultAccount.id, getNextSequence('repositories'), groupId ?? null);
                touchRepo.run(name, path, groupId ?? null);

                return toNumber(result.lastInsertRowid);
            }

            const result = db
                .prepare('INSERT INTO repositories(name, path, sequence, group_id) VALUES(?, ?, ?, ?)')
                .run(name, path, getNextSequence('repositories'), groupId ?? null);
            touchRepo.run(name, path, groupId ?? null);
            return toNumber(result.lastInsertRowid);
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

            const result = db.prepare('INSERT INTO groups(name, sequence) VALUES(?, ?)').run(normalizedName, getNextSequence('groups'));
            return toNumber(result.lastInsertRowid);
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
            moveSequence('groups', id, direction);
        },
        moveRepo(id: number, direction: 'up' | 'down') {
            moveSequence('repositories', id, direction);
        },
        reorderRepo(id: number, toIndex: number) {
            reorderSequence('repositories', id, toIndex);
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
                .run(normalizedLabel, provider, authKind, username ?? null, host ?? null, getNextSequence('accounts'), setAsDefault ? 1 : 0);

            return toNumber(result.lastInsertRowid);
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
                id,
            );
        },
        reorderAccount(id: number, toIndex: number) {
            reorderSequence('accounts', id, toIndex);
        },
        getAccountAuthById(id: number) {
            return db.prepare('SELECT id, label, provider, auth_kind, username, host, is_default, created_at FROM accounts WHERE id = ?').get<AccountAuthRow>(id);
        },
        assignRepoAccount(id: number, accountId: number | undefined) {
            db.prepare('UPDATE repositories SET account_id = ? WHERE id = ?').run(accountId ?? null, id);
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
