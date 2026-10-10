import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { useDatabase } from '../../../electronUtils/useDatabase.js';

// The database client is a module singleton that refuses to configure twice, so this file owns
// one throwaway database and starts every test from empty tables.
const userDataDir = mkdtempSync(join(tmpdir(), 'gitvan-sequences-'));
const database = useDatabase();

database.configureDatabase(userDataDir, (client) => {
    client.exec(`
        CREATE TABLE items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sequence INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            sequence INTEGER NOT NULL DEFAULT 0,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
});

interface ItemRow {
    id: number;
    name: string;
    sequence: number;
}

function addItem(name: string, sequence: number) {
    return database.toNumber(database.prepare('INSERT INTO items(name, sequence) VALUES(?, ?)').run(name, sequence).lastInsertRowid);
}

function items() {
    return database.prepare('SELECT id, name, sequence FROM items ORDER BY sequence ASC, created_at ASC, id ASC').all<ItemRow>();
}

function itemNames() {
    return items().map((item) => item.name);
}

function itemSequences() {
    return items().map((item) => item.sequence);
}

function addAccount(label: string, sequence: number, isDefault = false) {
    return database.toNumber(database.prepare('INSERT INTO accounts(label, sequence, is_default) VALUES(?, ?, ?)').run(label, sequence, isDefault ? 1 : 0).lastInsertRowid);
}

beforeEach(() => {
    database.exec('DELETE FROM items; DELETE FROM accounts;');
});

afterAll(() => {
    database.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

describe('useDatabase sequence normalization', () => {
    it('rewrites gaps and ties into a one-based consecutive order', () => {
        addItem('alpha', 5);
        addItem('beta', 5);
        addItem('gamma', 1);

        database.normalizeSequence('items');

        expect(items().map((item) => [item.name, item.sequence])).toEqual([
            ['gamma', 1],
            ['alpha', 2],
            ['beta', 3],
        ]);
    });

    it('breaks a tie with the additional order the caller asks for', () => {
        addAccount('work', 3, false);
        addAccount('system', 3, true);

        database.normalizeSequence('accounts', 'is_default DESC, ');

        expect(database.prepare('SELECT label, sequence FROM accounts ORDER BY sequence ASC').all()).toEqual([
            { label: 'system', sequence: 1 },
            { label: 'work', sequence: 2 },
        ]);
    });

    it('continues after the highest sequence and starts at one for an empty table', () => {
        expect(database.getNextSequence('items')).toBe(1);

        addItem('alpha', 4);

        expect(database.getNextSequence('items')).toBe(5);
    });
});

describe('useDatabase moveSequence', () => {
    it('moves an item up and down and rewrites the order without gaps', () => {
        const alpha = addItem('alpha', 1);
        const beta = addItem('beta', 2);
        const gamma = addItem('gamma', 3);

        database.moveSequence('item', 'items', gamma, 'up');
        expect(itemNames()).toEqual(['alpha', 'gamma', 'beta']);
        expect(itemSequences()).toEqual([1, 2, 3]);

        database.moveSequence('item', 'items', beta, 'up');
        expect(itemNames()).toEqual(['alpha', 'beta', 'gamma']);

        database.moveSequence('item', 'items', alpha, 'down');
        expect(itemNames()).toEqual(['beta', 'alpha', 'gamma']);
    });

    it('leaves the first item alone when it is moved up and the last when it is moved down', () => {
        const alpha = addItem('alpha', 1);
        addItem('beta', 2);
        const gamma = addItem('gamma', 3);

        database.moveSequence('item', 'items', alpha, 'up');
        database.moveSequence('item', 'items', gamma, 'down');

        expect(itemNames()).toEqual(['alpha', 'beta', 'gamma']);
        expect(itemSequences()).toEqual([1, 2, 3]);
    });

    it('rejects an id the table does not hold', () => {
        addItem('alpha', 1);

        expect(() => database.moveSequence('item', 'items', 9999, 'up')).toThrow('The selected item could not be found.');
    });
});

describe('useDatabase reorderSequence', () => {
    it('clamps the target index to the table bounds', () => {
        const alpha = addItem('alpha', 1);
        addItem('beta', 2);
        addItem('gamma', 3);

        database.reorderSequence('item', 'items', alpha, 99);
        expect(itemNames()).toEqual(['beta', 'gamma', 'alpha']);
        expect(itemSequences()).toEqual([1, 2, 3]);

        database.reorderSequence('item', 'items', alpha, -5);
        expect(itemNames()).toEqual(['alpha', 'beta', 'gamma']);
        expect(itemSequences()).toEqual([1, 2, 3]);
    });

    it('is a no-op when the item already sits at the target index', () => {
        addItem('alpha', 1);
        const beta = addItem('beta', 2);
        addItem('gamma', 3);

        database.reorderSequence('item', 'items', beta, 1);

        expect(itemNames()).toEqual(['alpha', 'beta', 'gamma']);
        expect(itemSequences()).toEqual([1, 2, 3]);
    });

    it('rejects an id the table does not hold', () => {
        addItem('alpha', 1);

        expect(() => database.reorderSequence('item', 'items', 9999, 0)).toThrow('The selected item could not be found.');
    });
});
