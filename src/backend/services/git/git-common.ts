import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeCommand } from '../../../electronUtils/executeCommand.js';
import { invalidateRepoSidebarStatus } from '../repoStatusCache.js';

/**
 * `git` subcommands that can change working-tree, index or ref state. A cached sidebar
 * status for the repository they ran in is no longer trustworthy afterwards, and missing one
 * of them would only serve a stale status until the next poll.
 */
const statusInvalidatingSubcommands = new Set([
    'add',
    'am',
    'apply',
    'checkout',
    'cherry-pick',
    'clean',
    'commit',
    'fetch',
    'merge',
    'mv',
    'pull',
    'push',
    'rebase',
    'reset',
    'restore',
    'revert',
    'rm',
    'stash',
    'switch',
    'symbolic-ref',
    'tag',
    'update-ref',
]);

function invalidateStatusForMutatingCommand(args: string[], cwd: string) {
    const subcommand = args.find((arg) => !arg.startsWith('-'));
    if (subcommand && statusInvalidatingSubcommands.has(subcommand)) {
        invalidateRepoSidebarStatus(cwd);
    }
}

export type GitRemoteAuth = {
    kind: 'https-token';
    username: string;
    password: string;
    host: string | undefined;
};

const askPassLauncherPath = join(tmpdir(), 'gitvan-git-askpass-v2.sh');
const defaultMacPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

export class GitCommandError extends Error {
    command: string[];
    stderr: string;
    stdout: string;

    constructor(message: string, command: string[], stderr: string, stdout = '') {
        super(message);
        this.name = 'GitCommandError';
        this.command = command;
        this.stderr = stderr;
        this.stdout = stdout;
    }
}

export async function runGit(args: string[], cwd: string, allowedExitCodes: number[] = [0], trimOutput = true, env: NodeJS.ProcessEnv = {}) {
    try {
        const gitExecutable = resolveGitExecutable();
        invalidateStatusForMutatingCommand(args, cwd);
        const [, stdout] = await executeCommand({
            command: gitExecutable,
            args,
            cwd,
            env: createGitProcessEnv(env),
            allowedExitCodes,
            getErrorToThrow: (stdout, stderr) => new GitCommandError(stderr || stdout || 'Git command failed.', [gitExecutable, ...args], stderr, stdout),
        });

        return trimOutput ? stdout.trim() : stdout;
    } catch (error) {
        if (error instanceof GitCommandError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new GitCommandError(message, [resolveGitExecutable(), ...args], message);
    }
}

export async function runGitWithInput(args: string[], cwd: string, input: string, allowedExitCodes: number[] = [0], trimOutput = true, env: NodeJS.ProcessEnv = {}) {
    try {
        const gitExecutable = resolveGitExecutable();
        invalidateStatusForMutatingCommand(args, cwd);
        const [, stdout] = await executeCommand({
            command: gitExecutable,
            args,
            cwd,
            env: createGitProcessEnv(env),
            input,
            allowedExitCodes,
            getErrorToThrow: (stdout, stderr) => new GitCommandError(stderr || stdout || 'Git command failed.', [gitExecutable, ...args], stderr, stdout),
        });

        return trimOutput ? stdout.trim() : stdout;
    } catch (error) {
        if (error instanceof GitCommandError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new GitCommandError(message, [resolveGitExecutable(), ...args], message);
    }
}

export async function runGitBuffer(args: string[], cwd: string, allowedExitCodes: number[] = [0], env: NodeJS.ProcessEnv = {}) {
    try {
        const gitExecutable = resolveGitExecutable();
        invalidateStatusForMutatingCommand(args, cwd);
        const [stdout] = await executeCommand({
            command: gitExecutable,
            args,
            cwd,
            env: createGitProcessEnv(env),
            bufferOnly: true,
            allowedExitCodes,
            getErrorToThrow: (stdout, stderr) => new GitCommandError(stderr || stdout || 'Git command failed.', [gitExecutable, ...args], stderr, stdout),
        });

        return stdout;
    } catch (error) {
        if (error instanceof GitCommandError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new GitCommandError(message, [resolveGitExecutable(), ...args], message);
    }
}

export function createRemoteGitEnvForUrl(remoteUrl: string, auth: GitRemoteAuth | undefined) {
    if (!auth) {
        return {};
    }

    if (!remoteUrl.startsWith('https://') && !remoteUrl.startsWith('http://')) {
        throw new GitCommandError('The assigned HTTPS token account can only be used with HTTPS remotes.', ['git', 'remote', 'get-url', 'origin'], remoteUrl);
    }

    const remoteHost = parseRemoteHost(remoteUrl);
    if (auth.host && remoteHost && auth.host !== remoteHost) {
        throw new GitCommandError(
            `The assigned account is configured for ${auth.host}, but the repository remote points to ${remoteHost}.`,
            ['git', 'remote', 'get-url', 'origin'],
            remoteUrl
        );
    }

    return {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: ensureAskPassScript(),
        GITVAN_ASKPASS_USERNAME: auth.username,
        GITVAN_ASKPASS_PASSWORD: auth.password,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'credential.helper',
        GIT_CONFIG_VALUE_0: '',
    };
}

export async function createRemoteGitEnv(repoPath: string, auth: GitRemoteAuth | undefined) {
    if (!auth) {
        return {};
    }

    const remoteUrl = await runGit(['remote', 'get-url', 'origin'], repoPath, [0, 2]);
    if (!remoteUrl) {
        throw new GitCommandError('The repository does not have an origin remote configured.', ['git', 'remote', 'get-url', 'origin'], '');
    }

    return createRemoteGitEnvForUrl(remoteUrl, auth);
}

function createGitProcessEnv(env: NodeJS.ProcessEnv = {}) {
    const mergedEnv = {
        ...process.env,
        ...env,
    };

    if (process.platform === 'darwin') {
        mergedEnv.PATH = mergedEnv.PATH?.trim() ? `${mergedEnv.PATH}:${defaultMacPath}` : defaultMacPath;
    }

    return mergedEnv;
}

function resolveGitExecutable() {
    const candidates = process.platform === 'darwin' ? ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git', 'git'] : ['git'];

    for (const candidate of candidates) {
        if (candidate === 'git' || existsSync(candidate)) {
            return candidate;
        }
    }

    return 'git';
}

function ensureAskPassScript() {
    mkdirSync(tmpdir(), { recursive: true });
    writeFileSync(
        askPassLauncherPath,
        [
            '#!/bin/sh',
            "prompt=$(printf '%s' \"$1\" | tr '[:upper:]' '[:lower:]')",
            'case "$prompt" in',
            '  *username*)',
            '    printf \'%s\' "$GITVAN_ASKPASS_USERNAME"',
            '    ;;',
            '  *)',
            '    printf \'%s\' "$GITVAN_ASKPASS_PASSWORD"',
            '    ;;',
            'esac',
            '',
        ].join('\n'),
        'utf8'
    );
    chmodSync(askPassLauncherPath, 0o755);
    return askPassLauncherPath;
}

function parseRemoteHost(remoteUrl: string) {
    const normalized = remoteUrl.trim();

    if (!normalized) {
        return undefined;
    }

    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        try {
            return new URL(normalized).hostname.toLowerCase();
        } catch {
            return undefined;
        }
    }

    const scpMatch = normalized.match(/^[^@]+@([^:]+):/);
    if (scpMatch?.[1]) {
        return scpMatch[1].toLowerCase();
    }

    return undefined;
}
