import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    createRemoteGitEnv,
    createRemoteGitEnvForUrl,
    runGit,
    runGitBuffer,
    runGitBufferWithInput,
    runGitWithInput,
    runWithConcurrency,
    type GitRemoteAuth,
} from '../../../../../backend/services/git/git-common.js';
import { isRepositoryNotFoundError } from '../../../../../shared/repositoryErrors.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

function tempDir(prefix = 'gitvan-common-') {
    const path = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(path);

    return path;
}

function createRepo() {
    const repoPath = tempDir('gitvan-common-repo-');

    execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Gitvan Test'], { cwd: repoPath, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'gitvan@example.com'], { cwd: repoPath, stdio: 'ignore' });
    writeFileSync(join(repoPath, 'story.txt'), 'one\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'Initial baseline'], { cwd: repoPath, stdio: 'ignore' });

    return repoPath;
}

function missingDirectory() {
    const path = tempDir('gitvan-gone-');
    rmSync(path, { recursive: true, force: true });

    return path;
}

const auth: GitRemoteAuth = { kind: 'https-token', username: 'gitvan-user', password: 'token-value', host: undefined };

describe('a working directory that is gone', () => {
    /**
     * A repository removed while a command was in flight cannot start that command, and the app has
     * to treat it as the removed-repository outcome rather than a raw spawn failure.
     */
    it('is reported as a removed repository by every run variant', async () => {
        const gone = missingDirectory();

        const errors = await Promise.all([
            runGit(['status'], gone).catch((error: unknown) => error),
            runGitWithInput(['hash-object', '--stdin'], gone, 'x').catch((error: unknown) => error),
            runGitBuffer(['status'], gone).catch((error: unknown) => error),
            runGitBufferWithInput(['hash-object', '--stdin'], gone, 'x').catch((error: unknown) => error),
        ]);

        for (const error of errors) {
            expect(isRepositoryNotFoundError(error), String(error)).toBe(true);
        }
    });

    it('still reports a real failure from a directory that exists', async () => {
        const notARepo = tempDir('gitvan-not-a-repo-');

        const error = await runGit(['rev-parse', '--verify', 'HEAD'], notARepo).catch((thrown: unknown) => thrown);

        expect(isRepositoryNotFoundError(error)).toBe(false);
        expect(String(error)).not.toMatch(/could not be found/);
    });
});

function runWithInput(args: string[], cwd: string, input: string) {
    return execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

describe('createRemoteGitEnvForUrl', () => {
    it('has no environment to add without an account', () => {
        expect(createRemoteGitEnvForUrl('https://github.com/acme/repo.git', undefined)).toEqual({});
    });

    it('builds the askpass environment for an HTTPS remote', () => {
        const env = createRemoteGitEnvForUrl('https://github.com/acme/repo.git', auth);

        expect(env).toMatchObject({
            GIT_TERMINAL_PROMPT: '0',
            GITVAN_ASKPASS_USERNAME: 'gitvan-user',
            GITVAN_ASKPASS_PASSWORD: 'token-value',
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'credential.helper',
            // An empty helper stops git from asking a stored credential instead of the token.
            GIT_CONFIG_VALUE_0: '',
        });
        expect(existsSync(env.GIT_ASKPASS!)).toBe(true);
        expect(env.GIT_ASKPASS).toContain('gitvan-git-askpass');
    });

    it('accepts plain http as well', () => {
        expect(createRemoteGitEnvForUrl('http://git.internal/acme/repo.git', auth)).toMatchObject({ GITVAN_ASKPASS_USERNAME: 'gitvan-user' });
    });

    it('refuses a remote that is not HTTP, because the token cannot travel over it', () => {
        expect(() => createRemoteGitEnvForUrl('git@github.com:acme/repo.git', auth)).toThrow(
            'The assigned HTTPS token account can only be used with HTTPS remotes.'
        );
        expect(() => createRemoteGitEnvForUrl('ssh://git@github.com/acme/repo.git', auth)).toThrow(/only be used with HTTPS remotes/);
    });

    it('refuses a remote whose host is not the account host', () => {
        expect(() => createRemoteGitEnvForUrl('https://github.com/acme/repo.git', { ...auth, host: 'gitlab.com' })).toThrow(
            'The assigned account is configured for gitlab.com, but the repository remote points to github.com.'
        );
    });

    it('accepts a remote that matches the account host', () => {
        expect(createRemoteGitEnvForUrl('https://gitlab.com/acme/repo.git', { ...auth, host: 'gitlab.com' })).toMatchObject({ GITVAN_ASKPASS_USERNAME: 'gitvan-user' });
        expect(createRemoteGitEnvForUrl('https://gitlab.com/acme/repo.git', { ...auth, host: 'GITLAB.com' })).toMatchObject({ GITVAN_ASKPASS_PASSWORD: 'token-value' });
    });
});

describe('createRemoteGitEnv', () => {
    it('has no environment to add without an account', async () => {
        expect(await createRemoteGitEnv(createRepo(), undefined)).toEqual({});
    });

    it('reads the origin remote and builds the environment from it', async () => {
        const repoPath = createRepo();
        execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/repo.git'], { cwd: repoPath, stdio: 'ignore' });

        expect(await createRemoteGitEnv(repoPath, auth)).toMatchObject({
            GITVAN_ASKPASS_USERNAME: 'gitvan-user',
            GITVAN_ASKPASS_PASSWORD: 'token-value',
        });
    });

    it('refuses a repository that has no origin remote', async () => {
        await expect(createRemoteGitEnv(createRepo(), auth)).rejects.toThrow('The repository does not have an origin remote configured.');
    });
});

describe('the askpass script', () => {
    it('answers the username prompt and everything else with the password', async () => {
        const env = createRemoteGitEnvForUrl('https://github.com/acme/repo.git', auth);
        const script = env.GIT_ASKPASS!;

        const runScript = (prompt: string) => execFileSync(script, [prompt], { encoding: 'utf8', env: { ...process.env, ...env } });

        expect(runScript('Username for https://github.com')).toBe('gitvan-user');
        expect(runScript('Password for https://gitvan-user@github.com')).toBe('token-value');
        expect(readFileSync(script, 'utf8')).toContain('GITVAN_ASKPASS_PASSWORD');
    });
});

describe('runWithConcurrency', () => {
    function deferred() {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
            release = resolve;
        });

        return { promise, release };
    }

    it('keeps the result order while never exceeding the limit', async () => {
        let inFlight = 0;
        let peak = 0;

        const results = await runWithConcurrency(
            Array.from({ length: 6 }, (_, index) => async () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight -= 1;

                return index;
            }),
            2
        );

        expect(results).toEqual([0, 1, 2, 3, 4, 5]);
        expect(peak).toBeLessThanOrEqual(2);
    });

    it('runs every task even when the limit is above the task count', async () => {
        expect(await runWithConcurrency([async () => 'a', async () => 'b'], 10)).toEqual(['a', 'b']);
        expect(await runWithConcurrency([], 3)).toEqual([]);
    });

    it('waits for the tasks already running before it reports a failure', async () => {
        const first = deferred();
        const finished: string[] = [];

        const run = runWithConcurrency(
            [
                async () => {
                    await first.promise;
                    finished.push('first');

                    return 1;
                },
                async () => {
                    finished.push('second');
                    throw new Error('task failed');
                },
            ],
            2
        );

        first.release();

        await expect(run).rejects.toThrow('task failed');
        expect(finished.sort()).toEqual(['first', 'second']);
    });
});

describe('the buffered and stdin runs', () => {
    it('returns a buffer for the buffered variants', async () => {
        const buffer = await runGitBuffer(['--version'], createRepo());

        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.toString('utf8')).toContain('git version');
    });

    it('feeds the input to git through stdin', async () => {
        const repoPath = createRepo();

        const fromString = await runGitWithInput(['hash-object', '--stdin'], repoPath, 'hello\n');
        const fromBuffer = (await runGitBufferWithInput(['hash-object', '--stdin'], repoPath, 'hello\n')).toString('utf8').trim();

        expect(fromString).toBe(fromBuffer);
        expect(fromString).toBe(runWithInput(['hash-object', '--stdin'], repoPath, 'hello\n'));
    });

    it('honours the exit codes it is told to allow', async () => {
        const repoPath = createRepo();

        // A path git does not know makes `rev-parse --verify` exit 128, which is not allowed here.
        await expect(runGit(['rev-parse', '--verify', 'missing-ref'], repoPath)).rejects.toThrow();
        await expect(runGit(['rev-parse', '--verify', 'missing-ref'], repoPath, [0, 128])).resolves.toBe('');
    });
});
