import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type GitRemoteAuth = {
    kind: 'https-token';
    username: string;
    password: string;
    host: string | undefined;
};

const askPassScriptPath = join(tmpdir(), 'gitvan-git-askpass.js');
const askPassLauncherPath = join(tmpdir(), 'gitvan-git-askpass');
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
    return await new Promise<string>((resolve, reject) => {
        try {
            const gitExecutable = resolveGitExecutable();
            const child = spawn(gitExecutable, args, {
                cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: createGitProcessEnv(env),
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
                reject(new GitCommandError(error.message, [gitExecutable, ...args], error.message));
            });

            child.on('close', (code) => {
                const exitCode = code ?? -1;
                if (!allowedExitCodes.includes(exitCode)) {
                    const normalizedStderr = stderr.trim();
                    const normalizedStdout = stdout.trim();

                    reject(new GitCommandError(normalizedStderr || normalizedStdout || 'Git command failed.', [gitExecutable, ...args], normalizedStderr, normalizedStdout));
                    return;
                }

                resolve(trimOutput ? stdout.trim() : stdout);
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reject(new GitCommandError(message, [resolveGitExecutable(), ...args], message));
        }
    });
}

export async function runGitWithInput(args: string[], cwd: string, input: string, allowedExitCodes: number[] = [0], trimOutput = true, env: NodeJS.ProcessEnv = {}) {
    return await new Promise<string>((resolve, reject) => {
        try {
            const gitExecutable = resolveGitExecutable();
            const child = spawn(gitExecutable, args, {
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: createGitProcessEnv(env),
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
                reject(new GitCommandError(error.message, [gitExecutable, ...args], error.message));
            });

            child.on('close', (code) => {
                const exitCode = code ?? -1;
                if (!allowedExitCodes.includes(exitCode)) {
                    const normalizedStderr = stderr.trim();
                    const normalizedStdout = stdout.trim();

                    reject(new GitCommandError(normalizedStderr || normalizedStdout || 'Git command failed.', [gitExecutable, ...args], normalizedStderr, normalizedStdout));
                    return;
                }

                resolve(trimOutput ? stdout.trim() : stdout);
            });

            child.stdin.end(input, 'utf8');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reject(new GitCommandError(message, [resolveGitExecutable(), ...args], message));
        }
    });
}

export async function runGitBuffer(args: string[], cwd: string, allowedExitCodes: number[] = [0], env: NodeJS.ProcessEnv = {}) {
    return await new Promise<Buffer>((resolve, reject) => {
        try {
            const gitExecutable = resolveGitExecutable();
            const child = spawn(gitExecutable, args, {
                cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: createGitProcessEnv(env),
            });

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            child.stdout.on('data', (chunk) => {
                stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });

            child.stderr.on('data', (chunk) => {
                stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });

            child.on('error', (error) => {
                reject(new GitCommandError(error.message, [gitExecutable, ...args], error.message));
            });

            child.on('close', (code) => {
                const exitCode = code ?? -1;
                const stdout = Buffer.concat(stdoutChunks);
                const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

                if (!allowedExitCodes.includes(exitCode)) {
                    reject(new GitCommandError(stderr || 'Git command failed.', [gitExecutable, ...args], stderr, stdout.toString('utf8').trim()));
                    return;
                }

                resolve(stdout);
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reject(new GitCommandError(message, [resolveGitExecutable(), ...args], message));
        }
    });
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
            remoteUrl,
        );
    }

    return {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: ensureAskPassScript(),
        GITVAN_ASKPASS_SCRIPT: askPassScriptPath,
        GITVAN_ELECTRON_EXECUTABLE: process.execPath,
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
        askPassScriptPath,
        `const prompt = (process.argv[2] || "").toLowerCase();
if (prompt.includes("username")) {
    process.stdout.write(process.env.GITVAN_ASKPASS_USERNAME || "");
} else {
    process.stdout.write(process.env.GITVAN_ASKPASS_PASSWORD || "");
}
`,
        'utf8',
    );
    writeFileSync(
        askPassLauncherPath,
        `#!/bin/sh
ELECTRON_RUN_AS_NODE=1 exec "$GITVAN_ELECTRON_EXECUTABLE" "$GITVAN_ASKPASS_SCRIPT" "$@"
`,
        'utf8',
    );
    chmodSync(askPassScriptPath, 0o755);
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
