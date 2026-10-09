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
