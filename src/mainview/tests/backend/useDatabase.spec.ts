import { describe, expect, it } from 'vitest';
import { useDatabase } from '../../../electronUtils/useDatabase.js';

const { createRuntimeDatabaseClient } = useDatabase();

describe('createRuntimeDatabaseClient statement cache', () => {
    it('reuses the compiled statement for the same SQL', () => {
        const client = createRuntimeDatabaseClient(':memory:');

        try {
            client.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');

            const insert = client.prepare('INSERT INTO items(name) VALUES (?)');
            const sameInsert = client.prepare('INSERT INTO items(name) VALUES (?)');

            expect(sameInsert).toBe(insert);
        } finally {
            client.close();
        }
    });

    it('runs and reads rows through a reused statement', () => {
        const client = createRuntimeDatabaseClient(':memory:');

        try {
            client.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');

            const insert = client.prepare('INSERT INTO items(name) VALUES (?)');
            insert.run('alpha');
            insert.run('beta');

            const select = client.prepare('SELECT name FROM items ORDER BY name');
            expect(client.prepare('SELECT name FROM items ORDER BY name')).toBe(select);
            expect(select.all<{ name: string }>()).toEqual([{ name: 'alpha' }, { name: 'beta' }]);
            expect(select.get<{ name: string }>()).toEqual({ name: 'alpha' });
        } finally {
            client.close();
        }
    });

    it('recompiles a statement after the schema changed underneath it', () => {
        const client = createRuntimeDatabaseClient(':memory:');

        try {
            client.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
            const before = client.prepare('SELECT name FROM items');

            client.exec('ALTER TABLE items ADD COLUMN extra TEXT');
            const after = client.prepare('SELECT name FROM items');

            expect(after).not.toBe(before);

            client.prepare('INSERT INTO items(name, extra) VALUES (?, ?)').run('alpha', 'x');
            expect(after.all<{ name: string }>()).toEqual([{ name: 'alpha' }]);
        } finally {
            client.close();
        }
    });
});

describe('createRuntimeDatabaseClient transactions', () => {
    function createItemsClient() {
        const client = createRuntimeDatabaseClient(':memory:');
        client.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');

        return client;
    }

    it('commits every write in the callback', () => {
        const client = createItemsClient();

        try {
            const insert = client.prepare('INSERT INTO items(name) VALUES (?)');
            client.transaction(() => {
                insert.run('alpha');
                insert.run('beta');
            });

            expect(client.prepare('SELECT COUNT(*) AS count FROM items').get<{ count: number }>()).toEqual({ count: 2 });
        } finally {
            client.close();
        }
    });

    it('rolls back every write when the callback throws', () => {
        const client = createItemsClient();

        try {
            const insert = client.prepare('INSERT INTO items(name) VALUES (?)');

            expect(() =>
                client.transaction(() => {
                    insert.run('alpha');
                    throw new Error('boom');
                })
            ).toThrow('boom');

            expect(client.prepare('SELECT COUNT(*) AS count FROM items').get<{ count: number }>()).toEqual({ count: 0 });
        } finally {
            client.close();
        }
    });
});
