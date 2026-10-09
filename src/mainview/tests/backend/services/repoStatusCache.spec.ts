import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invalidateAllRepoSidebarStatuses, invalidateRepoSidebarStatus, readRepoSidebarStatus } from '../../../../backend/services/repoStatusCache.js';
import { runGit } from '../../../../backend/services/git/git-common.js';
import { changesGit } from '../../../../backend/services/git/git-changes.js';
import type { RepoSidebarStatus } from '../../../../shared/types.js';

function gitSetup(cwd: string, args: string[]) {
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createRepo() {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-repo-status-'));

    gitSetup(repoPath, ['init']);
    gitSetup(repoPath, ['config', 'user.name', 'Gitvan Test']);
    gitSetup(repoPath, ['config', 'user.email', 'gitvan@example.com']);
    writeFileSync(join(repoPath, 'tracked.txt'), 'initial\n', 'utf8');
    gitSetup(repoPath, ['add', 'tracked.txt']);
    gitSetup(repoPath, ['commit', '-m', 'Initial commit']);

    return repoPath;
}

function statusWithError(): RepoSidebarStatus {
    return {
        branch: undefined,
        ahead: 0,
        behind: 0,
        hasRemote: false,
        hasUpstream: false,
        publishableCommits: 0,
        changedFiles: 0,
        stagedFiles: 0,
        unstagedFiles: 0,
        isDirty: false,
        error: 'boom',
        lastScannedAt: undefined,
    };
}

describe('repo sidebar status cache', () => {
    let repoPath: string;

    beforeEach(() => {
        invalidateAllRepoSidebarStatuses();
        repoPath = createRepo();
    });

    afterEach(() => {
        invalidateAllRepoSidebarStatuses();
        rmSync(repoPath, { recursive: true, force: true });
    });

    it('reuses a cached status until it is invalidated', async () => {
        let computed = 0;

        const first = await readRepoSidebarStatus(repoPath, async () => {
            computed += 1;
            return statusWithError();
        });

        expect(first.error).toBe('boom');
        expect(computed).toBe(1);

        invalidateRepoSidebarStatus(repoPath);

        await readRepoSidebarStatus(repoPath, async () => {
            computed += 1;
            return statusWithError();
        });

        expect(computed).toBe(2);
    });

    it('does not cache a failed scan so the next caller retries', async () => {
        let computed = 0;
        const compute = async () => {
            computed += 1;
            return statusWithError();
        };

        await readRepoSidebarStatus(repoPath, compute);
        await readRepoSidebarStatus(repoPath, compute);

        expect(computed).toBe(2);
    });

    it('shares one computation between concurrent callers', async () => {
        let computed = 0;
        const compute = async () => {
            computed += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return statusWithError();
        };

        await Promise.all([readRepoSidebarStatus(repoPath, compute), readRepoSidebarStatus(repoPath, compute), readRepoSidebarStatus(repoPath, compute)]);

        expect(computed).toBe(1);
    });

    it('returns the cached status without touching git while it is valid', async () => {
        const first = await readRepoSidebarStatus(repoPath, () => changesGit.getRepoSidebarStatus(repoPath));
        const second = await readRepoSidebarStatus(repoPath, () => changesGit.getRepoSidebarStatus(repoPath));

        expect(first.error).toBeUndefined();
        expect(second).toBe(first);
    });

    it('drops the cached status when a mutating git command runs in the repository', async () => {
        const cleanStatus = await readRepoSidebarStatus(repoPath, () => changesGit.getRepoSidebarStatus(repoPath));
        expect(cleanStatus.changedFiles).toBe(0);

        writeFileSync(join(repoPath, 'staged.txt'), 'staged\n', 'utf8');
        await runGit(['add', '--', 'staged.txt'], repoPath);

        const afterStage = await readRepoSidebarStatus(repoPath, () => changesGit.getRepoSidebarStatus(repoPath));

        expect(afterStage).not.toBe(cleanStatus);
        expect(afterStage.stagedFiles).toBe(1);
    });

    it('keeps the cached status across a read-only git command', async () => {
        const first = await readRepoSidebarStatus(repoPath, () => changesGit.getRepoSidebarStatus(repoPath));
        await runGit(['status', '--porcelain=v2', '--branch'], repoPath);
        const second = await readRepoSidebarStatus(repoPath, () => changesGit.getRepoSidebarStatus(repoPath));

        expect(second).toBe(first);
    });
});
