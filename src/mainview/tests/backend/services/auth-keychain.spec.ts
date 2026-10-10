import { afterAll, describe, expect, it } from 'vitest';
import {
    deleteAccountAccessToken,
    deleteAccountSecret,
    readAccountAccessToken,
    readAccountSecret,
    storeAccountAccessToken,
    storeAccountSecret,
} from '../../../../backend/services/auth.js';

/**
 * These cases drive the real `security` CLI instead of a stub, so they only run when asked for:
 *
 *     GITVAN_KEYCHAIN_TESTS=1 bun run test:ui src/mainview/tests/backend/services/auth-keychain.spec.ts
 *
 * They write under a throwaway service name and remove what they created, so an opted-in run
 * never touches the `Gitvan` entries the app itself reads.
 */
const optedIn = process.env.GITVAN_KEYCHAIN_TESTS === '1';
const accountsOnThisHost = new Set<number>();
const serviceName = `GitvanSpec ${process.pid}-${Date.now()}`;
const unusedAccount = 900_001;

async function probeRealKeychain() {
    try {
        await storeAccountSecret(unusedAccount, 'Gitvan keychain spec probe', 'probe', { serviceName });
        await deleteAccountSecret(unusedAccount, { serviceName });

        return true;
    } catch {
        return false;
    }
}

const keychainWorks = optedIn && process.platform === 'darwin' && (await probeRealKeychain());

afterAll(async () => {
    if (!keychainWorks) return;

    for (const accountId of accountsOnThisHost) {
        await deleteAccountAccessToken(accountId, { serviceName }).catch(() => {});
    }
});

describe.skipIf(!keychainWorks)('the real macOS keychain', () => {
    it('round-trips a secret through add and find', async () => {
        accountsOnThisHost.add(1);

        await storeAccountAccessToken(1, 'Gitvan keychain spec', 'ghp_spec-secret', { serviceName });

        await expect(readAccountAccessToken(1, { serviceName })).resolves.toBe('ghp_spec-secret');
    });

    it('deletes the entry and reports a missing item', async () => {
        accountsOnThisHost.add(2);
        await storeAccountAccessToken(2, 'Gitvan keychain spec', 'ghp_to-delete', { serviceName });

        await deleteAccountAccessToken(2, { serviceName });

        // `security` answers a missing item with exit code 44, which the wrapper tolerates.
        await expect(readAccountSecret(2, { serviceName })).rejects.toThrow();
    });

    it('treats deleting an entry that is already gone as success', async () => {
        accountsOnThisHost.add(3);
        await storeAccountAccessToken(3, 'Gitvan keychain spec', 'ghp_twice', { serviceName });
        await deleteAccountSecret(3, { serviceName });

        await expect(deleteAccountSecret(3, { serviceName })).resolves.toBeUndefined();
    });

    it('fails on a service name that cannot exist', async () => {
        await expect(readAccountSecret(4, { serviceName: `${serviceName} missing` })).rejects.toThrow();
    });
});
