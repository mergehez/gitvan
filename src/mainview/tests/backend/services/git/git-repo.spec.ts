import { beforeEach, describe, expect, it, vi } from 'vitest';

const runGit = vi.fn();

vi.mock('../../../../../backend/services/git/git-common.js', async () => {
    const actual = await vi.importActual<typeof import('../../../../../backend/services/git/git-common.js')>('../../../../../backend/services/git/git-common.js');

    return {
        ...actual,
        runGit,
    };
});

describe('repoGit.getRepoBranches', () => {
    beforeEach(() => {
        runGit.mockReset();
    });

    it('keeps the first non-current branch when stdout is trimmed', async () => {
        runGit.mockResolvedValue(
            'bun\trefs/heads/bun\t\t\t\t76b9eac\tfix phpstan erors\nmain\trefs/heads/main\t*\torigin/main\t\t76b9eac\tfix phpstan erors\norigin\trefs/remotes/origin/HEAD\t \t\t\t76b9eac\tfix phpstan erors\norigin/main\trefs/remotes/origin/main\t \t\t\t76b9eac\tfix phpstan erors\nmaster\trefs/heads/master\t \torigin/master\t\tbdc22a0\tchange package name set version\norigin/master\trefs/remotes/origin/master\t \t\t\tbdc22a0\tchange package name set version'
        );

        const { repoGit } = await import('../../../../../backend/services/git/git-repo.js');
        const branches = await repoGit.getRepoBranches('/tmp/arg-starter-kit');

        expect(branches.currentBranch).toBe('main');
        expect(branches.local.map((branch) => branch.name)).toEqual(['bun', 'main', 'master']);
        expect(branches.remote.map((branch) => branch.name)).toEqual(['origin/main', 'origin/master']);
        expect(branches.local[0]).toMatchObject({
            name: 'bun',
            refName: 'refs/heads/bun',
            isCurrent: false,
        });
    });
});
