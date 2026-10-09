import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGit } from '../../../../../backend/services/git/git-common.js';
import { getUnpushedCommitSet, normalizeGitIgnoreEntry, textByteSize } from '../../../../../backend/services/git/git-helpers.js';
import { invalidateAllUnpushedCommitSets } from '../../../../../backend/services/git/unpushedCommitCache.js';

/** Setup that bypasses the app's invalidation hooks, to model edits made outside Gitvan. */
function gitSetup(cwd: string, args: string[]) {
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createRepo() {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-unpushed-'));

    gitSetup(repoPath, ['init']);
    gitSetup(repoPath, ['config', 'user.name', 'Gitvan Test']);
    gitSetup(repoPath, ['config', 'user.email', 'gitvan@example.com']);
    writeFileSync(join(repoPath, 'story.txt'), 'one\n', 'utf8');
    gitSetup(repoPath, ['add', 'story.txt']);
    gitSetup(repoPath, ['commit', '-m', 'Initial commit']);

    return repoPath;
}

describe('getUnpushedCommitSet', () => {
    const cleanups: Array<() => void> = [];

    beforeEach(() => {
        invalidateAllUnpushedCommitSets();
    });

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function repo() {
        const repoPath = createRepo();
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    it('reuses the cached set until a mutating command drops it', async () => {
        const repoPath = repo();

        // Without a remote every commit is unpushed.
        expect((await getUnpushedCommitSet(repoPath)).size).toBe(1);

        writeFileSync(join(repoPath, 'second.txt'), 'two\n', 'utf8');

        // A read-only command leaves the cached set alone.
        await runGit(['status', '--porcelain'], repoPath);
        expect((await getUnpushedCommitSet(repoPath)).size).toBe(1);

        await runGit(['add', 'second.txt'], repoPath);
        await runGit(['commit', '-m', 'Second commit'], repoPath);

        expect((await getUnpushedCommitSet(repoPath)).size).toBe(2);
    });

    it('reuses a cached full set for a capped walk', async () => {
        const repoPath = repo();

        const full = await getUnpushedCommitSet(repoPath);
        const capped = await getUnpushedCommitSet(repoPath, 1);

        expect(capped).toBe(full);
    });

    it('caps the walk while nothing is cached', async () => {
        const repoPath = repo();
        writeFileSync(join(repoPath, 'second.txt'), 'two\n', 'utf8');
        gitSetup(repoPath, ['add', 'second.txt']);
        gitSetup(repoPath, ['commit', '-m', 'Second commit']);

        invalidateAllUnpushedCommitSets();

        expect((await getUnpushedCommitSet(repoPath, 1)).size).toBe(1);
        expect((await getUnpushedCommitSet(repoPath)).size).toBe(2);
    });

    it('leaves the destructive guard on a fresh walk', async () => {
        const repoPath = repo();

        expect((await getUnpushedCommitSet(repoPath)).size).toBe(1);

        // An out-of-band commit leaves the shared cache stale...
        writeFileSync(join(repoPath, 'third.txt'), 'three\n', 'utf8');
        gitSetup(repoPath, ['add', 'third.txt']);
        gitSetup(repoPath, ['commit', '-m', 'Out of band']);

        expect((await getUnpushedCommitSet(repoPath)).size).toBe(1);
        // ...while the cache-free read the reword guard uses sees it.
        expect((await getUnpushedCommitSet(repoPath, undefined, { cache: false })).size).toBe(2);
    });
});

describe('git-helpers', () => {
    it('normalizes ignore entries for each mode', () => {
        expect(normalizeGitIgnoreEntry('  ./src/app.ts  ', 'file')).toBe('src/app.ts');
        expect(normalizeGitIgnoreEntry('/vendor/', 'directory')).toBe('vendor/');
        expect(normalizeGitIgnoreEntry('src\\lib\\app.ts', 'file')).toBe('src/lib/app.ts');
        expect(normalizeGitIgnoreEntry('node_modules', 'directory')).toBe('node_modules/');
        expect(normalizeGitIgnoreEntry('  build/*.log  ', 'pattern')).toBe('build/*.log');
        expect(() => normalizeGitIgnoreEntry('   ', 'file')).toThrow(/path is required/);
    });

    it('measures text in utf8 bytes', () => {
        expect(textByteSize('abc')).toBe(3);
        expect(textByteSize('é')).toBe(2);
        expect(textByteSize('')).toBe(0);
    });
});
