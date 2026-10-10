import { executeCommand } from '../../electronUtils/executeCommand.js';

const KEYCHAIN_SERVICE_NAME = 'Gitvan';

function getKeychainAccountName(accountId: number) {
    return `gitvan-account-${accountId}`;
}

/** The service name and the runner are injectable so a spec can exercise the real `security` CLI in isolation. */
export type KeychainOptions = {
    serviceName?: string;
    run?: typeof executeCommand;
};

async function runSecurityCommand(args: string[], allowedExitCodes: number[] = [0], options: KeychainOptions = {}) {
    const run = options.run ?? executeCommand;
    const [, stdout] = await run({
        command: 'security',
        args,
        allowedExitCodes,
        getErrorToThrow: (stdout, stderr) => new Error(stderr.trim() || stdout.trim() || 'Keychain command failed.'),
    });

    return stdout.trim();
}

function ensureSupportedPlatform() {
    if (process.platform !== 'darwin') {
        throw new Error('Secure account storage is currently supported on macOS only.');
    }
}

export async function storeAccountSecret(accountId: number, label: string, secret: string, options: KeychainOptions = {}) {
    ensureSupportedPlatform();

    await runSecurityCommand(
        ['add-generic-password', '-a', getKeychainAccountName(accountId), '-s', options.serviceName ?? KEYCHAIN_SERVICE_NAME, '-l', label, '-w', secret, '-U'],
        [0],
        options
    );
}

export async function readAccountSecret(accountId: number, options: KeychainOptions = {}) {
    ensureSupportedPlatform();

    return await runSecurityCommand(
        ['find-generic-password', '-a', getKeychainAccountName(accountId), '-s', options.serviceName ?? KEYCHAIN_SERVICE_NAME, '-w'],
        [0],
        options
    );
}

export async function deleteAccountSecret(accountId: number, options: KeychainOptions = {}) {
    ensureSupportedPlatform();

    // `security` reports a missing item with exit code 44, which is the same as already deleted.
    await runSecurityCommand(['delete-generic-password', '-a', getKeychainAccountName(accountId), '-s', options.serviceName ?? KEYCHAIN_SERVICE_NAME], [0, 44], options);
}

export async function storeAccountAccessToken(accountId: number, label: string, accessToken: string, options: KeychainOptions = {}) {
    await storeAccountSecret(accountId, label, accessToken, options);
}

export async function readAccountAccessToken(accountId: number, options: KeychainOptions = {}) {
    return await readAccountSecret(accountId, options);
}

export async function deleteAccountAccessToken(accountId: number, options: KeychainOptions = {}) {
    await deleteAccountSecret(accountId, options);
}
