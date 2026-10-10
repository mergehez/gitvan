import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCommandError } from '../../../../../backend/services/git/git-common.js';
import { stashGit } from '../../../../../backend/services/git/git-stash.js';
import { repoGit } from '../../../../../backend/services/git/git-repo.js';

const tempDirs: string[] = [];

function runGit(cwd: string, args: string[]) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function createRepo() {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-stash-'));
    tempDirs.push(repoPath);

    runGit(repoPath, ['init', '-b', 'main']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);
    writeFileSync(join(repoPath, 'tracked.txt'), 'one\ntwo\nthree\n', 'utf8');
    writeFileSync(join(repoPath, 'removed.txt'), 'delete me\n', 'utf8');
    runGit(repoPath, ['add', '.']);
    runGit(repoPath, ['commit', '-m', 'base']);

    return repoPath;
}

/** Leaves one modified, one added and one deleted path for a single stash to hold. */
function dirtyWorkingTree(repoPath: string) {
    writeFileSync(join(repoPath, 'tracked.txt'), 'one\nTWO\nthree\n', 'utf8');
    writeFileSync(join(repoPath, 'added.txt'), 'brand new\n', 'utf8');
    rmSync(join(repoPath, 'removed.txt'));
}

afterEach(() => {
    while (tempDirs.length > 0) {
        rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe('stashGit.getRepoStashes', () => {
    it('reports no stashes for a clean repository', async () => {
        expect(await stashGit.getRepoStashes(createRepo())).toEqual([]);
    });

    it('lists each stash newest first with its generated message', async () => {
        const repoPath = createRepo();

        dirtyWorkingTree(repoPath);
        await stashGit.stashRepoChanges(repoPath);
        writeFileSync(join(repoPath, 'second.txt'), 'second\n', 'utf8');
        await stashGit.stashRepoChanges(repoPath);

        const stashes = await stashGit.getRepoStashes(repoPath);

        expect(stashes).toHaveLength(2);
        expect(stashes.map((stash) => stash.ref)).toEqual(['stash@{0}', 'stash@{1}']);
        expect(stashes[0]?.message).toMatch(/^On main: stash-\d{4}-\d{2}-\d{2}T/);
        expect(stashes[0]?.createdAtRelative).toBeTruthy();
        expect(stashes[0]?.message).not.toBe(stashes[1]?.message);
    });
});

describe('stashGit.getRepoStashDetail', () => {
    it('lists the modified, added and deleted paths the stash holds', async () => {
        const repoPath = createRepo();

        dirtyWorkingTree(repoPath);
        await stashGit.stashRepoChanges(repoPath);

        const detail = await stashGit.getRepoStashDetail(repoPath, 'stash@{0}');

        expect(detail.files).toEqual([
            { previousPath: undefined, path: 'added.txt', status: 'added', hadConflict: false },
            { previousPath: undefined, path: 'removed.txt', status: 'deleted', hadConflict: false },
            { previousPath: undefined, path: 'tracked.txt', status: 'modified', hadConflict: false },
        ]);
        expect(detail.message).toMatch(/^On main: stash-/);
    });

    it('includes a stashed untracked file', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'loose.txt'), 'loose\n', 'utf8');

        await stashGit.stashRepoChanges(repoPath);

        const detail = await stashGit.getRepoStashDetail(repoPath, 'stash@{0}');

        expect(detail.files.map((file) => file.path)).toEqual(['loose.txt']);
    });

    it('rejects a reference that is not in the stash list', async () => {
        const repoPath = createRepo();

        await expect(stashGit.getRepoStashDetail(repoPath, 'stash@{4}')).rejects.toThrow('The selected stash could not be found.');
    });
});

describe('stashGit.getRepoStashFileDiff', () => {
    it('diffs a modified file against the commit the stash was taken from', async () => {
        const repoPath = createRepo();

        dirtyWorkingTree(repoPath);
        await stashGit.stashRepoChanges(repoPath);

        const diff = await stashGit.getRepoStashFileDiff(repoPath, 'stash@{0}', 'tracked.txt');

        expect(diff.path).toBe('tracked.txt');
        expect(diff.entry.kind).toBe('staged');
        expect(diff.entry.original).toBe('one\ntwo\nthree\n');
        expect(diff.entry.modified).toBe('one\nTWO\nthree\n');
        expect(diff.entry.patch).toContain('-two');
        expect(diff.entry.patch).toContain('+TWO');
        expect(diff.entry.stats).toMatchObject({ addedLines: 1, removedLines: 1 });
        expect(diff.entry.previewMessage).toBeUndefined();
    });

    it('reports an added file with no original side', async () => {
        const repoPath = createRepo();

        dirtyWorkingTree(repoPath);
        await stashGit.stashRepoChanges(repoPath);

        const diff = await stashGit.getRepoStashFileDiff(repoPath, 'stash@{0}', 'added.txt');

        expect(diff.entry.original).toBe('');
        expect(diff.entry.modified).toBe('brand new\n');
    });

    it('diffs a file that was only staged when the stash was taken', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'staged-new.txt'), 'staged new\n', 'utf8');
        runGit(repoPath, ['add', 'staged-new.txt']);

        await stashGit.stashRepoChanges(repoPath);

        const diff = await stashGit.getRepoStashFileDiff(repoPath, 'stash@{0}', 'staged-new.txt');

        expect(diff.entry.original).toBe('');
        expect(diff.entry.modified).toBe('staged new\n');
        expect(diff.entry.stats.addedLines).toBe(1);
    });

    it('previews an image the stash introduced', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

        await stashGit.stashRepoChanges(repoPath);

        const diff = await stashGit.getRepoStashFileDiff(repoPath, 'stash@{0}', 'logo.png');

        expect(diff.entry.nonCodePreview).toMatchObject({ kind: 'image' });
        expect(diff.entry.nonCodePreview?.originalSrc).toBeUndefined();
        expect(diff.entry.nonCodePreview?.modifiedSrc).toMatch(/^data:image\/png;base64,/);
    });

    it('caps a stash file too large to preview', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'huge.txt'), `${'x'.repeat(1024 * 1024 + 1)}\n`, 'utf8');

        await stashGit.stashRepoChanges(repoPath);

        const diff = await stashGit.getRepoStashFileDiff(repoPath, 'stash@{0}', 'huge.txt');

        expect(diff.entry.previewMessage).toBe('File too big to preview');
        expect(diff.entry.original).toBe('');
        expect(diff.entry.modified).toBe('');
        expect(diff.entry.stats).toMatchObject({ newSizeBytes: 1024 * 1024 + 2 });
    });
});

describe('stashGit.stashRepoChanges', () => {
    it('stashes tracked and untracked changes and leaves the tree clean', async () => {
        const repoPath = createRepo();

        dirtyWorkingTree(repoPath);
        writeFileSync(join(repoPath, 'loose.txt'), 'loose\n', 'utf8');

        await stashGit.stashRepoChanges(repoPath);

        expect(runGit(repoPath, ['status', '--short'])).toBe('');
        expect(await stashGit.getRepoStashes(repoPath)).toHaveLength(1);
        expect((await stashGit.getRepoStashDetail(repoPath, 'stash@{0}')).files.map((file) => file.path)).toEqual(['added.txt', 'loose.txt', 'removed.txt', 'tracked.txt']);
    });

    it('rejects a token account when the repository has no remote', async () => {
        const repoPath = createRepo();
        dirtyWorkingTree(repoPath);

        await expect(stashGit.stashRepoChanges(repoPath, { kind: 'https-token', username: 'user', password: 'token', host: undefined })).rejects.toThrow(
            'The repository does not have an origin remote configured.'
        );
        expect(await stashGit.getRepoStashes(repoPath)).toEqual([]);
    });
});

describe('stashGit.restoreRepoStash', () => {
    it('restores the changes, the staged state and drops the entry', async () => {
        const repoPath = createRepo();
        runGit(repoPath, ['rm', '-q', 'removed.txt']);
        runGit(repoPath, ['commit', '-m', 'drop removed file']);
        writeFileSync(join(repoPath, 'tracked.txt'), 'one\nTWO\nthree\n', 'utf8');
        writeFileSync(join(repoPath, 'added.txt'), 'brand new\n', 'utf8');
        await stashGit.stashRepoChanges(repoPath);

        await stashGit.restoreRepoStash(repoPath, 'stash@{0}');

        expect(await stashGit.getRepoStashes(repoPath)).toEqual([]);
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('');
        expect(runGit(repoPath, ['status', '--short'])).toBe('M tracked.txt\n?? added.txt');
    });

    it('keeps the stash when the restored change conflicts with a later commit', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'tracked.txt'), 'one\nSTASHED\nthree\n', 'utf8');
        await stashGit.stashRepoChanges(repoPath);
        writeFileSync(join(repoPath, 'tracked.txt'), 'one\nCOMMITTED\nthree\n', 'utf8');
        runGit(repoPath, ['commit', '-am', 'move on']);

        let thrown: unknown;
        try {
            await stashGit.restoreRepoStash(repoPath, 'stash@{0}');
        } catch (error) {
            thrown = error;
        }

        expect(repoGit.isStashRestoreConflictError(thrown)).toBe(true);
        expect(await stashGit.getRepoStashes(repoPath)).toHaveLength(1);
        expect(runGit(repoPath, ['status', '--short'])).toBe('UU tracked.txt');
        expect(runGit(repoPath, ['show', 'HEAD:tracked.txt'])).toBe('one\nCOMMITTED\nthree');
    });

    it('classifies a failed untracked restore as a conflict too', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'loose.txt'), 'stashed\n', 'utf8');
        await stashGit.stashRepoChanges(repoPath);
        writeFileSync(join(repoPath, 'loose.txt'), 'in the way\n', 'utf8');

        let thrown: unknown;
        try {
            await stashGit.restoreRepoStash(repoPath, 'stash@{0}');
        } catch (error) {
            thrown = error;
        }

        expect(repoGit.isStashRestoreConflictError(thrown)).toBe(true);
        expect(await stashGit.getRepoStashes(repoPath)).toHaveLength(1);
    });

    it('does not classify an unrelated failure as a stash conflict', () => {
        expect(repoGit.isStashRestoreConflictError(new Error('boom'))).toBe(false);
        expect(repoGit.isStashRestoreConflictError(new GitCommandError('The selected stash could not be found.', ['git'], ''))).toBe(false);
    });
});

describe('stashGit.discardRepoStash', () => {
    it('drops only the requested entry', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'first.txt'), 'first\n', 'utf8');
        await stashGit.stashRepoChanges(repoPath);
        writeFileSync(join(repoPath, 'second.txt'), 'second\n', 'utf8');
        await stashGit.stashRepoChanges(repoPath);

        await stashGit.discardRepoStash(repoPath, 'stash@{0}');

        const remaining = await stashGit.getRepoStashes(repoPath);
        expect(remaining).toHaveLength(1);
        expect((await stashGit.getRepoStashDetail(repoPath, remaining[0]!.ref)).files.map((file) => file.path)).toEqual(['first.txt']);
    });

    it('rejects a reference the repository does not have', async () => {
        await expect(stashGit.discardRepoStash(createRepo(), 'stash@{3}')).rejects.toThrow();
    });
});
