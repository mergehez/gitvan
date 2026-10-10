import { afterEach, describe, expect, it, vi } from 'vitest';

const { executeCommandMock } = vi.hoisted(() => ({
    executeCommandMock: vi.fn(),
}));

vi.mock('../../../../electronUtils/executeCommand.js', () => ({
    executeCommand: executeCommandMock,
}));

import {
    deleteAccountAccessToken,
    readAccountAccessToken,
    storeAccountAccessToken,
} from '../../../../backend/services/auth.js';

/** `executeCommand` resolves `[, stdout, stderr, exitCode]`. */
function commandSucceeds(stdout = '') {
    executeCommandMock.mockResolvedValue([undefined, stdout, '', 0]);
}

function lastCommand() {
    return executeCommandMock.mock.calls.at(-1)?.[0] as { command: string; args: string[]; allowedExitCodes: number[] } | undefined;
}

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
    executeCommandMock.mockReset();
    setPlatform(originalPlatform);
});

describe('account secrets', () => {
    it('stores a secret under the account name with the keychain service', async () => {
        commandSucceeds();

        await storeAccountAccessToken(7, 'Spec Account', 'ghp_token');

        expect(lastCommand()).toMatchObject({
            command: 'security',
            args: ['add-generic-password', '-a', 'gitvan-account-7', '-s', 'Gitvan', '-l', 'Spec Account', '-w', 'ghp_token', '-U'],
            allowedExitCodes: [0],
        });
    });

    it('returns the secret the keychain prints', async () => {
        commandSucceeds('  ghp_from_keychain  \n');

        expect(await readAccountAccessToken(7)).toBe('ghp_from_keychain');
        expect(lastCommand()?.args).toEqual(['find-generic-password', '-a', 'gitvan-account-7', '-s', 'Gitvan', '-w']);
    });

    it('treats a missing entry as already deleted', async () => {
        commandSucceeds();

        await deleteAccountAccessToken(7);

        // `security` reports a missing item with exit code 44.
        expect(lastCommand()).toMatchObject({
            args: ['delete-generic-password', '-a', 'gitvan-account-7', '-s', 'Gitvan'],
            allowedExitCodes: [0, 44],
        });
    });

    it('turns a failing keychain command into its message', async () => {
        executeCommandMock.mockImplementation(async (params: { allowedExitCodes: number[]; getErrorToThrow: (stdout: string, stderr: string) => Error }) => {
            throw params.getErrorToThrow('', 'security: SecKeychainSearchCopyNext: The specified item could not be found.');
        });

        await expect(readAccountAccessToken(7)).rejects.toThrow('The specified item could not be found.');
    });

    it('throws the macOS-only error on the platform the keychain cannot run on', async () => {
        setPlatform('linux');
        commandSucceeds();

        await expect(storeAccountAccessToken(1, 'Blocked', 'token')).rejects.toThrow('Secure account storage is currently supported on macOS only.');
        await expect(readAccountAccessToken(1)).rejects.toThrow('Secure account storage is currently supported on macOS only.');
        await expect(deleteAccountAccessToken(1)).rejects.toThrow('Secure account storage is currently supported on macOS only.');
        expect(executeCommandMock).not.toHaveBeenCalled();
    });
});
