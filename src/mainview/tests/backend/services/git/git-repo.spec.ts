import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repoGit } from '../../../../../backend/services/git/git-repo.js';

const { runGit, resolveRemoteName, createRemoteGitEnv, GitCommandError } = vi.hoisted(() => {
    class GitCommandError extends Error {
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

    return {
        GitCommandError,
        runGit: vi.fn(),
        resolveRemoteName: vi.fn(),
        createRemoteGitEnv: vi.fn(async () => ({})),
    };
});

vi.mock('../../../../../backend/services/git/git-common.js', () => ({
    createRemoteGitEnv,
    createRemoteGitEnvForUrl: vi.fn(() => ({})),
    GitCommandError,
    resolveRemoteName,
    runGit,
}));

function mockBranches(output: string) {
    runGit.mockResolvedValueOnce(output);
}

beforeEach(() => {
    runGit.mockReset();
    resolveRemoteName.mockReset();
    createRemoteGitEnv.mockClear();
});

describe('repoGit.getRepoBranches', () => {
    it('asks git for the refs it parses, in the order it parses them', async () => {
        mockBranches('main\trefs/heads/main\t*\torigin/main\t[behind 2]\tabc1234\tfix phpstan errors');

        await repoGit.getRepoBranches('/tmp/arg-starter-kit');

        expect(runGit).toHaveBeenCalledExactlyOnceWith(
            [
                'for-each-ref',
                '--sort=-committerdate',
                '--format=%(refname:short)\t%(refname)\t%(HEAD)\t%(upstream:short)\t%(upstream:track)\t%(objectname:short)\t%(contents:subject)',
                'refs/heads',
                'refs/remotes',
            ],
            '/tmp/arg-starter-kit'
        );
    });

    it('keeps the first non-current branch when stdout is trimmed', async () => {
        mockBranches(
            'bun\trefs/heads/bun\t\t\t\t76b9eac\tfix phpstan erors\nmain\trefs/heads/main\t*\torigin/main\t\t76b9eac\tfix phpstan erors\norigin\trefs/remotes/origin/HEAD\t \t\t\t76b9eac\tfix phpstan erors\norigin/main\trefs/remotes/origin/main\t \t\t\t76b9eac\tfix phpstan erors\nmaster\trefs/heads/master\t \torigin/master\t\tbdc22a0\tchange package name set version\norigin/master\trefs/remotes/origin/master\t \t\t\tbdc22a0\tchange package name set version'
        );

        const branches = await repoGit.getRepoBranches('/tmp/arg-starter-kit');

        expect(branches.currentBranch).toBe('main');
        expect(branches.local.map((branch) => branch.name)).toEqual(['bun', 'main', 'master']);
        expect(branches.remote.map((branch) => branch.name)).toEqual(['origin/main', 'origin/master']);
        expect(branches.local[0]).toEqual({
            name: 'bun',
            refName: 'refs/heads/bun',
            kind: 'local',
            isCurrent: false,
            upstream: undefined,
            ahead: 0,
            behind: 0,
            commit: '76b9eac',
            subject: 'fix phpstan erors',
        });
    });

    it('reads the upstream tracking counts and the current branch', async () => {
        mockBranches('main\trefs/heads/main\t*\torigin/main\t[ahead 3, behind 2]\tabc1234\tship it');

        const branches = await repoGit.getRepoBranches('/tmp/repo');

        expect(branches.currentBranch).toBe('main');
        expect(branches.local[0]).toMatchObject({ isCurrent: true, upstream: 'origin/main', ahead: 3, behind: 2, commit: 'abc1234', subject: 'ship it' });
    });

    it('reports no current branch when HEAD is detached', async () => {
        mockBranches('main\trefs/heads/main\t \torigin/main\t\t76b9eac\tsubject');

        const branches = await repoGit.getRepoBranches('/tmp/repo');

        expect(branches.currentBranch).toBeUndefined();
    });

    it('drops the remote HEAD alias instead of listing it as a branch', async () => {
        mockBranches('origin\trefs/remotes/origin/HEAD\t \t\t\t76b9eac\tsubject\norigin/main\trefs/remotes/origin/main\t \t\t\t76b9eac\tsubject');

        const branches = await repoGit.getRepoBranches('/tmp/repo');

        expect(branches.remote.map((branch) => branch.name)).toEqual(['origin/main']);
    });

    it('reports empty branch lists for a repository without refs', async () => {
        mockBranches('');

        await expect(repoGit.getRepoBranches('/tmp/repo')).resolves.toEqual({ currentBranch: undefined, local: [], remote: [] });
    });
});

describe('repoGit pull error classification', () => {
    it('recognises the pull-blocked error and lists the files it names', () => {
        const error = new GitCommandError(
            'git pull failed',
            ['git', 'pull'],
            'error: Your local changes to the following files would be overwritten by merge:\n\tsrc/app.ts\n\tsrc/main.ts\nPlease commit your changes or stash them before you merge.\nAborting'
        );

        expect(repoGit.isPullBlockedByLocalChangesError(error)).toBe(true);
        expect(repoGit.getPullBlockedByLocalChangesFiles(error)).toEqual(['src/app.ts', 'src/main.ts']);
    });

    it('reports no blocked files for an unrelated failure', () => {
        const error = new GitCommandError('git pull failed', ['git', 'pull'], 'fatal: unable to access the remote');

        expect(repoGit.isPullBlockedByLocalChangesError(error)).toBe(false);
        expect(repoGit.getPullBlockedByLocalChangesFiles(error)).toEqual([]);
    });

    it('ignores values that are not git command errors', () => {
        expect(repoGit.isPullBlockedByLocalChangesError(new Error('nope'))).toBe(false);
        expect(repoGit.isPullMergeConflictError(undefined)).toBe(false);
        expect(repoGit.isStashRestoreConflictError('local changes')).toBe(false);
    });

    it('recognises a merge conflict and a stash restore conflict', () => {
        const mergeConflict = new GitCommandError(
            'git pull failed',
            ['git', 'pull'],
            'CONFLICT (content): Merge conflict in src/app.ts\nAutomatic merge failed; fix conflicts and then commit the result.'
        );
        const stashConflict = new GitCommandError('git stash pop failed', ['git', 'stash', 'pop'], 'error: could not restore untracked files from stash');

        expect(repoGit.isPullMergeConflictError(mergeConflict)).toBe(true);
        expect(repoGit.isStashRestoreConflictError(stashConflict)).toBe(true);
    });
});

describe('repoGit.resolveGitRepo', () => {
    it('names the repository after the top-level directory git reports', async () => {
        runGit.mockResolvedValueOnce('/tmp/work/gitvan');

        await expect(repoGit.resolveGitRepo('/tmp/work/gitvan/src')).resolves.toEqual({ name: 'gitvan', path: '/tmp/work/gitvan' });
        expect(runGit).toHaveBeenCalledWith(['rev-parse', '--show-toplevel'], '/tmp/work/gitvan/src');
    });
});

describe('repoGit.checkoutRepoBranch', () => {
    it('switches to a local branch', async () => {
        runGit.mockResolvedValueOnce('').mockResolvedValueOnce(undefined);

        await repoGit.checkoutRepoBranch('/tmp/repo', 'refs/heads/feature');

        expect(runGit).toHaveBeenNthCalledWith(1, ['rev-parse', '--verify', '--quiet', 'refs/remotes/feature'], '/tmp/repo', [0, 1, 128]);
        expect(runGit).toHaveBeenNthCalledWith(2, ['switch', 'feature'], '/tmp/repo');
    });

    it('tracks the remote branch when a matching local branch already exists', async () => {
        runGit.mockResolvedValueOnce('abc123\n').mockResolvedValueOnce('def456\n').mockResolvedValueOnce(undefined);

        await repoGit.checkoutRepoBranch('/tmp/repo', 'origin/feature');

        expect(runGit).toHaveBeenNthCalledWith(2, ['rev-parse', '--verify', '--quiet', 'refs/heads/feature'], '/tmp/repo', [0, 1, 128]);
        expect(runGit).toHaveBeenNthCalledWith(3, ['switch', 'feature'], '/tmp/repo');
    });

    it('creates a tracking branch when only the remote exists', async () => {
        runGit.mockResolvedValueOnce('abc123\n').mockResolvedValueOnce('').mockResolvedValueOnce(undefined);

        await repoGit.checkoutRepoBranch('/tmp/repo', 'origin/feature');

        expect(runGit).toHaveBeenNthCalledWith(3, ['switch', '-c', 'feature', '--track', 'origin/feature'], '/tmp/repo');
    });
});

describe('repoGit.createRepoBranch', () => {
    it('creates the branch', async () => {
        runGit.mockResolvedValueOnce(undefined);

        await repoGit.createRepoBranch('/tmp/repo', '  feature/new  ');

        expect(runGit).toHaveBeenCalledExactlyOnceWith(['switch', '-c', 'feature/new'], '/tmp/repo');
    });

    it('refuses an empty branch name', async () => {
        await expect(repoGit.createRepoBranch('/tmp/repo', '   ')).rejects.toThrow('Branch name is required.');
        expect(runGit).not.toHaveBeenCalled();
    });
});

describe('repoGit.createRemoteRepoBranch', () => {
    it('creates the branch locally and pushes it to the configured remote', async () => {
        resolveRemoteName.mockResolvedValue('origin');
        runGit.mockResolvedValue(undefined);

        await repoGit.createRemoteRepoBranch('/tmp/repo', 'feature');

        expect(runGit).toHaveBeenNthCalledWith(1, ['switch', '-c', 'feature'], '/tmp/repo');
        expect(runGit).toHaveBeenNthCalledWith(2, ['push', '-u', 'origin', 'feature'], '/tmp/repo', [0], true, {});
    });

    it('refuses when no remote is configured', async () => {
        resolveRemoteName.mockResolvedValue(undefined);

        await expect(repoGit.createRemoteRepoBranch('/tmp/repo', 'feature')).rejects.toThrow('no remote is configured');
        expect(runGit).not.toHaveBeenCalled();
    });
});

describe('repoGit.publishRepoBranch', () => {
    it('pushes the current branch and sets its upstream', async () => {
        runGit.mockImplementation(async (args: string[]) => (args[0] === 'branch' ? 'feature\n' : undefined));
        resolveRemoteName.mockResolvedValue('origin');

        await repoGit.publishRepoBranch('/tmp/repo');

        expect(runGit).toHaveBeenCalledWith(['push', '-u', 'origin', 'feature'], '/tmp/repo', [0], true, {});
    });

    it('refuses a detached HEAD', async () => {
        runGit.mockResolvedValue('');
        resolveRemoteName.mockResolvedValue('origin');

        await expect(repoGit.publishRepoBranch('/tmp/repo')).rejects.toThrow('detached HEAD');
    });

    it('refuses when no remote is configured', async () => {
        runGit.mockResolvedValue('feature\n');
        resolveRemoteName.mockResolvedValue(undefined);

        await expect(repoGit.publishRepoBranch('/tmp/repo')).rejects.toThrow('no remote is configured');
    });
});

describe('repoGit.runRepoRemoteOperation', () => {
    it.each([
        ['fetch', ['fetch', '--all', '--prune']],
        ['pull', ['pull', '--no-rebase']],
        ['push', ['push']],
    ] as const)('runs %s with the arguments the app expects', async (operation, expectedArgs) => {
        runGit.mockResolvedValue(undefined);

        await repoGit.runRepoRemoteOperation('/tmp/repo', operation);

        expect(runGit).toHaveBeenCalledExactlyOnceWith(expectedArgs, '/tmp/repo', [0], true, {});
    });

    it('rejects an operation it does not implement', async () => {
        await expect(repoGit.runRepoRemoteOperation('/tmp/repo', 'rebase' as never)).rejects.toThrow('Unsupported remote operation: rebase');
    });
});

describe('repoGit.cloneGitRepo and initializeGitRepo', () => {
    it('refuses a clone without a url or destination', async () => {
        await expect(repoGit.cloneGitRepo('  ', '/tmp/destination')).rejects.toThrow('A repository URL is required to clone.');
        await expect(repoGit.cloneGitRepo('https://example.com/repo.git', ' ')).rejects.toThrow('A destination path is required to clone.');
        expect(runGit).not.toHaveBeenCalled();
    });

    it('refuses to clone into a folder that already exists', async () => {
        await expect(repoGit.cloneGitRepo('https://example.com/repo.git', process.cwd())).rejects.toThrow('The destination folder already exists.');
        expect(runGit).not.toHaveBeenCalled();
    });

    it('refuses to initialize a repository without a destination', async () => {
        await expect(repoGit.initializeGitRepo('   ')).rejects.toThrow('A destination path is required to create a repository.');
    });

    it('refuses to initialize into a folder that already exists', async () => {
        await expect(repoGit.initializeGitRepo(process.cwd())).rejects.toThrow('The destination folder already exists.');
        expect(runGit).not.toHaveBeenCalled();
    });
});
