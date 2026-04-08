import { spawn } from 'node:child_process';

const KEYCHAIN_SERVICE_NAME = 'Gitvan';

function getKeychainAccountName(accountId: number) {
    return `gitvan-account-${accountId}`;
}

async function runSecurityCommand(args: string[], allowedExitCodes: number[] = [0]) {
    return await new Promise<string>((resolve, reject) => {
        const child = spawn('security', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            const exitCode = code ?? -1;
            if (!allowedExitCodes.includes(exitCode)) {
                reject(new Error(stderr.trim() || stdout.trim() || 'Keychain command failed.'));
                return;
            }

            resolve(stdout.trim());
        });
    });
}

function ensureSupportedPlatform() {
    if (process.platform !== 'darwin') {
        throw new Error('Secure account storage is currently supported on macOS only.');
    }
}

export async function storeAccountSecret(accountId: number, label: string, secret: string) {
    ensureSupportedPlatform();

    await runSecurityCommand(['add-generic-password', '-a', getKeychainAccountName(accountId), '-s', KEYCHAIN_SERVICE_NAME, '-l', label, '-w', secret, '-U']);
}

export async function readAccountSecret(accountId: number) {
    ensureSupportedPlatform();

    return await runSecurityCommand(['find-generic-password', '-a', getKeychainAccountName(accountId), '-s', KEYCHAIN_SERVICE_NAME, '-w']);
}

export async function deleteAccountSecret(accountId: number) {
    ensureSupportedPlatform();

    await runSecurityCommand(['delete-generic-password', '-a', getKeychainAccountName(accountId), '-s', KEYCHAIN_SERVICE_NAME], [0, 44]);
}

export async function storeAccountAccessToken(accountId: number, label: string, accessToken: string) {
    await storeAccountSecret(accountId, label, accessToken);
}

export async function readAccountAccessToken(accountId: number) {
    return await readAccountSecret(accountId);
}

export async function deleteAccountAccessToken(accountId: number) {
    await deleteAccountSecret(accountId);
}
