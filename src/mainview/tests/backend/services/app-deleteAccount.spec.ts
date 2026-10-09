import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { deleteAccountSecret } = vi.hoisted(() => ({ deleteAccountSecret: vi.fn() }));

vi.mock('../../../../backend/services/auth.js', () => ({
    deleteAccountSecret,
    readAccountSecret: vi.fn(),
    storeAccountSecret: vi.fn(),
}));

import { app } from '../../../../backend/services/app.js';
import { useDb } from '../../../../backend/services/database.js';
import { useDatabase } from '../../../../electronUtils/useDatabase.js';

// The database client is a module singleton that refuses to configure twice.
const userDataDir = mkdtempSync(join(tmpdir(), 'gitvan-delete-account-'));

beforeAll(() => {
    useDb().configureDatabase(userDataDir);
});

afterAll(() => {
    useDatabase().close();
    rmSync(userDataDir, { recursive: true, force: true });
});

async function createSystemAccount(label: string) {
    const bootstrap = await app.createAccount({
        label,
        provider: 'system',
        authKind: 'system-git',
        username: undefined,
        host: undefined,
        accessToken: undefined,
        setAsDefault: false,
    });

    const account = bootstrap.accounts.find((entry) => entry.label === label);
    expect(account).toBeDefined();

    return account!.id;
}

describe('deleteAccount', () => {
    it('removes the account even when its stored secret cannot be deleted', async () => {
        const accountId = await createSystemAccount('Spec keychain failure');
        // A keychain entry owned by another app identity cannot be deleted, and the CLI reports it
        // with a non-zero exit code after the account row would already have been removed.
        deleteAccountSecret.mockRejectedValueOnce(new Error('password has been deleted.'));

        await expect(app.deleteAccount({ accountId })).resolves.toBeDefined();

        const bootstrap = await app.getBootstrap();
        expect(bootstrap.accounts.some((entry) => entry.id === accountId)).toBe(false);
    });

    it('still reports an account that is not there', async () => {
        await expect(app.deleteAccount({ accountId: 987_654 })).rejects.toThrow('The selected account could not be found.');
    });
});
