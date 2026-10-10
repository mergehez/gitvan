import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeGit } from '../../../../../backend/services/git/git-merge.js';

const tempDirs: string[] = [];

function runGit(cwd: string, args: string[]) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function createRepo() {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-merge-'));
    tempDirs.push(repoPath);

    runGit(repoPath, ['init', '-b', 'main']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

    return repoPath;
}

/**
 * `story.txt` is edited on both sides so git leaves it conflicted with all three index stages,
 * while `feature-only.txt` is added on the incoming side only, so it merges on its own.
 */
function createConflictedRepo() {
    const repoPath = createRepo();

    writeFileSync(join(repoPath, 'story.txt'), 'base\n', 'utf8');
    runGit(repoPath, ['add', '.']);
    runGit(repoPath, ['commit', '-m', 'base']);

    runGit(repoPath, ['checkout', '-qb', 'feature']);
    writeFileSync(join(repoPath, 'story.txt'), 'base\ntheirs\n', 'utf8');
    writeFileSync(join(repoPath, 'feature-only.txt'), 'theirs\n', 'utf8');
    runGit(repoPath, ['add', '.']);
    runGit(repoPath, ['commit', '-m', 'theirs']);

    runGit(repoPath, ['checkout', '-q', 'main']);
    writeFileSync(join(repoPath, 'story.txt'), 'base\nours\n', 'utf8');
    writeFileSync(join(repoPath, 'main-only.txt'), 'ours\n', 'utf8');
    runGit(repoPath, ['add', '.']);
    runGit(repoPath, ['commit', '-m', 'ours']);

    let conflicted = false;
    try {
        runGit(repoPath, ['merge', 'feature']);
    } catch {
        conflicted = true;
    }

    expect(conflicted, 'the fixture must leave the merge unfinished').toBe(true);

    return repoPath;
}

/** Mirrors what a hand-edited resolution leaves behind: the file is written, never staged. */
function writeConflictFile(repoPath: string, path: string, content: string) {
    writeFileSync(join(repoPath, path), content, 'utf8');
}

function isMergeInProgress(repoPath: string) {
    try {
        return Boolean(runGit(repoPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']));
    } catch {
        return false;
    }
}

afterEach(() => {
    while (tempDirs.length > 0) {
        rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe('mergeGit.getRepoMergeConflictState', () => {
    it('reports a repository that is not merging as idle', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'notes.txt'), 'notes\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'notes']);

        const state = await mergeGit.getRepoMergeConflictState(repoPath);

        expect(state).toEqual({
            isMerging: false,
            targetBranch: undefined,
            incomingBranch: undefined,
            conflictedFiles: [],
            mergedFiles: [],
            canCommit: false,
        });
    });

    it('lists the conflicted and merged files of an unfinished merge', async () => {
        const repoPath = createConflictedRepo();

        const state = await mergeGit.getRepoMergeConflictState(repoPath);

        expect(state.isMerging).toBe(true);
        expect(state.targetBranch).toBe('main');
        expect(state.incomingBranch).toBe('feature');
        expect(state.conflictedFiles).toEqual([{ path: 'story.txt', conflictCount: 1 }]);
        expect(state.mergedFiles).toEqual([{ path: 'feature-only.txt' }]);
        expect(state.canCommit).toBe(false);
    });

    it('allows the merge to be committed once every conflict is staged as resolved', async () => {
        const repoPath = createConflictedRepo();

        await mergeGit.markRepoConflictResolved(repoPath, 'story.txt');

        const state = await mergeGit.getRepoMergeConflictState(repoPath);

        expect(state.conflictedFiles).toEqual([]);
        expect(state.mergedFiles.map((file) => file.path).sort()).toEqual(['feature-only.txt', 'story.txt']);
        expect(state.canCommit).toBe(true);
    });

    it('omits the conflict count for an unmerged entry whose file is gone', async () => {
        const repoPath = createRepo();

        writeFileSync(join(repoPath, 'story.txt'), 'base\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'base']);

        runGit(repoPath, ['checkout', '-qb', 'feature']);
        writeFileSync(join(repoPath, 'story.txt'), 'base\ntheirs\n', 'utf8');
        runGit(repoPath, ['commit', '-am', 'theirs']);

        runGit(repoPath, ['checkout', '-q', 'main']);
        runGit(repoPath, ['rm', '-q', 'story.txt']);
        runGit(repoPath, ['commit', '-m', 'delete ours']);

        expect(() => runGit(repoPath, ['merge', 'feature'])).toThrow();

        const state = await mergeGit.getRepoMergeConflictState(repoPath);

        expect(state.conflictedFiles).toEqual([{ path: 'story.txt', conflictCount: undefined }]);
        expect(state.canCommit).toBe(false);
    });
});

describe('mergeGit.getRepoMergeConflictFileDetails', () => {
    it('reads both sides and the conflicted result from the index', async () => {
        const repoPath = createConflictedRepo();

        const details = await mergeGit.getRepoMergeConflictFileDetails(repoPath, 'story.txt');

        expect(details.path).toBe('story.txt');
        expect(details.base).toBe('base\n');
        expect(details.current).toBe('base\nours\n');
        expect(details.incoming).toBe('base\ntheirs\n');
        expect(details.result).toContain('<<<<<<< HEAD');
        expect(details.result).toContain('=======');
        expect(details.result).toContain('>>>>>>> feature');
        expect(details.conflictCount).toBe(1);
    });

    it('leaves the conflict count undefined when the resolution no longer holds markers', async () => {
        const repoPath = createConflictedRepo();
        writeFileSync(join(repoPath, 'story.txt'), 'base\nours\ntheirs\n', 'utf8');

        const details = await mergeGit.getRepoMergeConflictFileDetails(repoPath, 'story.txt');

        expect(details.result).toBe('base\nours\ntheirs\n');
        expect(details.conflictCount).toBeUndefined();
    });

    it('returns empty sides for a path with no unmerged stages', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'notes.txt'), 'notes\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'notes']);

        const details = await mergeGit.getRepoMergeConflictFileDetails(repoPath, 'notes.txt');

        expect(details.base).toBe('');
        expect(details.current).toBe('');
        expect(details.incoming).toBe('');
        expect(details.result).toBe('notes\n');
        expect(details.conflictCount).toBeUndefined();
    });
});

describe('mergeGit.resolveRepoMergeConflict', () => {
    it('takes our side and stages it', async () => {
        const repoPath = createConflictedRepo();

        await mergeGit.resolveRepoMergeConflict(repoPath, 'story.txt', 'ours');

        expect(runGit(repoPath, ['show', ':story.txt'])).toBe('base\nours');

        // Staging our side leaves the index equal to HEAD, so git reports no staged change for
        // the path even though the conflict is now resolved.
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('feature-only.txt');
        expect(await mergeGit.getRepoMergeConflictState(repoPath)).toMatchObject({
            conflictedFiles: [],
            canCommit: true,
        });
    });

    it('takes the incoming side and stages it', async () => {
        const repoPath = createConflictedRepo();

        await mergeGit.resolveRepoMergeConflict(repoPath, 'story.txt', 'theirs');

        expect(runGit(repoPath, ['show', ':story.txt'])).toBe('base\ntheirs');
        expect(runGit(repoPath, ['diff', '--cached', '--name-only']).split('\n')).toContain('story.txt');
        expect(await mergeGit.getRepoMergeConflictState(repoPath)).toMatchObject({
            conflictedFiles: [],
            canCommit: true,
        });
    });
});

describe('mergeGit.markRepoConflictResolved', () => {
    it('stages the current file content as the resolution', async () => {
        const repoPath = createConflictedRepo();
        writeConflictFile(repoPath, 'story.txt', 'base\nresolved by hand\n');

        await mergeGit.markRepoConflictResolved(repoPath, 'story.txt');

        expect(runGit(repoPath, ['show', ':story.txt'])).toBe('base\nresolved by hand');
        expect(await mergeGit.getRepoMergeConflictState(repoPath)).toMatchObject({ canCommit: true });
    });

    it('stages a file whose content still holds conflict markers', async () => {
        const repoPath = createConflictedRepo();
        writeConflictFile(repoPath, 'story.txt', 'base\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\n');

        await mergeGit.markRepoConflictResolved(repoPath, 'story.txt');

        const details = await mergeGit.getRepoMergeConflictFileDetails(repoPath, 'story.txt');

        expect(runGit(repoPath, ['show', ':story.txt'])).toContain('<<<<<<< HEAD');
        expect(details.conflictCount).toBe(1);
        expect(await mergeGit.getRepoMergeConflictState(repoPath)).toMatchObject({ canCommit: true });
    });
});

describe('mergeGit.saveRepoMergeConflictResolution', () => {
    it('writes the resolution and stages it', async () => {
        const repoPath = createConflictedRepo();

        await mergeGit.saveRepoMergeConflictResolution(repoPath, 'story.txt', 'base\nours\ntheirs\n');

        expect(runGit(repoPath, ['show', ':story.txt'])).toBe('base\nours\ntheirs');
        expect(runGit(repoPath, ['diff', '--name-only'])).toBe('');
        expect(await mergeGit.getRepoMergeConflictState(repoPath)).toMatchObject({
            conflictedFiles: [],
            canCommit: true,
        });
    });
});

describe('mergeGit.abortRepoMerge', () => {
    it('returns the repository to the pre-merge state', async () => {
        const repoPath = createConflictedRepo();

        await mergeGit.abortRepoMerge(repoPath);

        expect(isMergeInProgress(repoPath)).toBe(false);
        expect(runGit(repoPath, ['status', '--short'])).toBe('');
        expect(runGit(repoPath, ['show', 'HEAD:story.txt'])).toBe('base\nours');
        expect(await mergeGit.getRepoMergeConflictState(repoPath)).toMatchObject({ isMerging: false });
    });
});

describe('mergeGit.commitRepoMerge', () => {
    it('commits the resolved merge with both parents', async () => {
        const repoPath = createConflictedRepo();
        const oursSha = runGit(repoPath, ['rev-parse', 'HEAD']);
        const theirsSha = runGit(repoPath, ['rev-parse', 'MERGE_HEAD']);

        await mergeGit.saveRepoMergeConflictResolution(repoPath, 'story.txt', 'base\nours\ntheirs\n');
        await mergeGit.commitRepoMerge(repoPath);

        expect(isMergeInProgress(repoPath)).toBe(false);
        expect(runGit(repoPath, ['rev-parse', 'HEAD^1'])).toBe(oursSha);
        expect(runGit(repoPath, ['rev-parse', 'HEAD^2'])).toBe(theirsSha);
        expect(runGit(repoPath, ['status', '--short'])).toBe('');
        expect(await mergeGit.getRepoMergeConflictState(repoPath)).toMatchObject({ isMerging: false, canCommit: false });
    });
});
