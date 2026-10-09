import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        const computeSpy = vi.spyOn(changesGit, 'getRepoSidebarStatus');

        try {
            const first = await readRepoSidebarStatus(repoPath, () => changesGit.getRepoSidebarStatus(repoPath));
            const second = await readRepoSidebarStatus(repoPath, () => changesGit.getRepoSidebarStatus(repoPath));

            expect(first.error).toBeUndefined();
            expect(second).toBe(first);
            expect(computeSpy).toHaveBeenCalledTimes(1);
        } finally {
            computeSpy.mockRestore();
        }
    });

    it('recomputes once the cached status has outlived its ttl', async () => {
        let computed = 0;
        const compute = async () => {
            computed += 1;
            return await changesGit.getRepoSidebarStatus(repoPath);
        };

        const first = await readRepoSidebarStatus(repoPath, compute, 1);
        const whileValid = await readRepoSidebarStatus(repoPath, compute, 30_000);

        expect(whileValid).toBe(first);
        expect(computed).toBe(1);

        // The ttl is applied when the entry is written, so a 1ms entry is stale by the next read.
        await new Promise((resolve) => setTimeout(resolve, 5));

        const afterExpiry = await readRepoSidebarStatus(repoPath, compute, 1);

        expect(computed).toBe(2);
        expect(afterExpiry).not.toBe(first);
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

    it('does not let a scan that started before invalidateAll repopulate the cache', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const staleScan = readRepoSidebarStatus(repoPath, async () => {
            await gate;
            return await changesGit.getRepoSidebarStatus(repoPath);
        });

        // The refresh empties the cache while that scan is still reading the old state.
        invalidateAllRepoSidebarStatuses();
        release();

        const staleStatus = await staleScan;
        expect(staleStatus.error).toBeUndefined();

        const compute = vi.fn(() => changesGit.getRepoSidebarStatus(repoPath));
        const freshStatus = await readRepoSidebarStatus(repoPath, compute);

        expect(compute).toHaveBeenCalledTimes(1);
        expect(freshStatus).not.toBe(staleStatus);
    });
});
