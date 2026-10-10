import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGit } from '../../../../../backend/services/git/git-common.js';
import {
    appendGitIgnoreEntry,
    buildDiffStats,
    buildImagePreview,
    countConflictMarkers,
    extractConflictPathsFromCommitBody,
    getUnpushedCommitSet,
    isPreviewTooLarge,
    labelForStatus,
    normalizeGitIgnoreEntry,
    parseCommitFilesWithConflicts,
    parseConflictMarkerPaths,
    parseIncomingBranchFromMergeMessage,
    parseTrackCounts,
    readGitIndexStageFile,
    readGitMetadataFile,
    textByteSize,
} from '../../../../../backend/services/git/git-helpers.js';
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

describe('appendGitIgnoreEntry', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function tempDir() {
        const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-gitignore-'));
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    it('creates the file with the entry when there is none', () => {
        const repoPath = tempDir();

        appendGitIgnoreEntry(repoPath, 'dist/');

        expect(readFileSync(join(repoPath, '.gitignore'), 'utf8')).toBe('dist/\n');
    });

    it('appends to the existing rules and keeps them', () => {
        const repoPath = tempDir();
        writeFileSync(join(repoPath, '.gitignore'), 'node_modules/\n', 'utf8');

        appendGitIgnoreEntry(repoPath, 'dist/');

        expect(readFileSync(join(repoPath, '.gitignore'), 'utf8')).toBe('node_modules/\ndist/\n');
    });

    it('does not write an entry the file already holds', () => {
        const repoPath = tempDir();
        writeFileSync(join(repoPath, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');

        appendGitIgnoreEntry(repoPath, 'dist/');

        expect(readFileSync(join(repoPath, '.gitignore'), 'utf8')).toBe('node_modules/\ndist/\n');
    });

    it('does not treat a line with surrounding spaces as a different entry', () => {
        const repoPath = tempDir();
        writeFileSync(join(repoPath, '.gitignore'), '  dist/  \n', 'utf8');

        appendGitIgnoreEntry(repoPath, 'dist/');

        expect(readFileSync(join(repoPath, '.gitignore'), 'utf8')).toBe('  dist/  \n');
    });
});

describe('parseTrackCounts', () => {
    it('reads each combination git reports', () => {
        expect(parseTrackCounts('[ahead 2]')).toEqual({ ahead: 2, behind: 0 });
        expect(parseTrackCounts('[behind 3]')).toEqual({ ahead: 0, behind: 3 });
        expect(parseTrackCounts('[ahead 2, behind 3]')).toEqual({ ahead: 2, behind: 3 });
        expect(parseTrackCounts('[gone]')).toEqual({ ahead: 0, behind: 0 });
        expect(parseTrackCounts('')).toEqual({ ahead: 0, behind: 0 });
    });

    it('falls back to zero for a count that is not a number', () => {
        expect(parseTrackCounts('[ahead nope, behind 4]')).toEqual({ ahead: 0, behind: 4 });
    });
});

describe('labelForStatus', () => {
    it('labels every status the app renders', () => {
        expect(labelForStatus('modified')).toBe('Modified');
        expect(labelForStatus('added')).toBe('Added');
        expect(labelForStatus('deleted')).toBe('Deleted');
        expect(labelForStatus('renamed')).toBe('Renamed');
        expect(labelForStatus('copied')).toBe('Copied');
        expect(labelForStatus('untracked')).toBe('Untracked');
        expect(labelForStatus('unmerged')).toBe('Conflicted');
        expect(labelForStatus('type-changed')).toBe('Type changed');
        expect(labelForStatus('clean')).toBe('Clean');
    });
});

describe('countConflictMarkers', () => {
    it('counts only the opening markers at the start of a line', () => {
        expect(countConflictMarkers('plain\n')).toBe(0);
        expect(countConflictMarkers('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n')).toBe(1);
        expect(countConflictMarkers('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n<<<<<<< HEAD\n')).toBe(2);
        // A marker that is not alone at the start of its line is text, not a conflict.
        expect(countConflictMarkers('note: <<<<<<< HEAD\n')).toBe(0);
    });
});

describe('parseIncomingBranchFromMergeMessage', () => {
    it('reads the branch out of each merge message shape', () => {
        expect(parseIncomingBranchFromMergeMessage("Merge branch 'feature/login'\n")).toBe('feature/login');
        expect(parseIncomingBranchFromMergeMessage("Merge remote-tracking branch 'origin/main'")).toBe('origin/main');
        expect(parseIncomingBranchFromMergeMessage('Merge pull request #42 from acme/fix-thing\n\nBody')).toBe('acme/fix-thing');
    });

    it('returns nothing when the message names no branch', () => {
        expect(parseIncomingBranchFromMergeMessage(undefined)).toBeUndefined();
        expect(parseIncomingBranchFromMergeMessage('')).toBeUndefined();
        expect(parseIncomingBranchFromMergeMessage('Merge commit abc123')).toBeUndefined();
    });
});

describe('extractConflictPathsFromCommitBody', () => {
    it('lifts the conflict block out of the body', () => {
        const result = extractConflictPathsFromCommitBody("Merge branch 'feature'\n\n# Conflicts:\n#\tstory.txt\n#\tsrc/app.ts\n");

        expect([...result.conflictPaths]).toEqual(['story.txt', 'src/app.ts']);
        expect(result.body).toBe("Merge branch 'feature'");
    });

    it('also accepts the block without the leading hash on the conflict lines', () => {
        const result = extractConflictPathsFromCommitBody('Merge branch feature\nConflicts:\n#\tstory.txt\n');

        expect([...result.conflictPaths]).toEqual(['story.txt']);
        expect(result.body).toBe('Merge branch feature');
    });

    it('keeps a body with no conflict block untouched', () => {
        const result = extractConflictPathsFromCommitBody('Just a message\n\nWith a body');

        expect(result.conflictPaths.size).toBe(0);
        expect(result.body).toBe('Just a message\n\nWith a body');
    });

    it('stops the block at the first line that is not a conflict entry', () => {
        const result = extractConflictPathsFromCommitBody('# Conflicts:\n#\tstory.txt\nSigned-off-by: Someone\n');

        expect([...result.conflictPaths]).toEqual(['story.txt']);
        expect(result.body).toBe('Signed-off-by: Someone');
    });
});

describe('buildDiffStats', () => {
    it('counts the changed lines without the file headers', () => {
        const patch = '--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n same\n-old\n+new\n';

        expect(buildDiffStats(patch, 10, 12)).toEqual({ oldSizeBytes: 10, newSizeBytes: 12, addedLines: 1, removedLines: 1 });
    });

    it('defaults the sizes to zero when git did not report them', () => {
        expect(buildDiffStats('', undefined, undefined)).toEqual({ oldSizeBytes: 0, newSizeBytes: 0, addedLines: 0, removedLines: 0 });
    });
});

describe('isPreviewTooLarge', () => {
    it('only trips on a size above the preview limit', () => {
        expect(isPreviewTooLarge(1024, undefined)).toBe(false);
        expect(isPreviewTooLarge(1024 * 1024, 10)).toBe(false);
        expect(isPreviewTooLarge(1024 * 1024 + 1)).toBe(true);
        expect(isPreviewTooLarge(undefined, undefined)).toBe(false);
    });
});

describe('buildImagePreview', () => {
    it('builds a data URL per image extension', () => {
        const buffer = Buffer.from([1, 2, 3]);

        expect(buildImagePreview('assets/logo.png', undefined, buffer)).toEqual({
            kind: 'image',
            originalSrc: undefined,
            modifiedSrc: 'data:image/png;base64,AQID',
        });
        expect(buildImagePreview('assets/photo.JPEG', buffer, undefined)?.originalSrc).toMatch(/^data:image\/jpeg;base64,/);
        expect(buildImagePreview('assets/icon.svg', buffer, buffer)).toMatchObject({ kind: 'image' });
    });

    it('has no preview for a path that is not an image', () => {
        expect(buildImagePreview('src/app.ts', Buffer.from('x'), undefined)).toBeUndefined();
        expect(buildImagePreview('README', undefined, undefined)).toBeUndefined();
    });

    it('leaves a side undefined when that side is missing', () => {
        expect(buildImagePreview('logo.png', undefined, undefined)).toEqual({ kind: 'image', originalSrc: undefined, modifiedSrc: undefined });
    });
});

describe('parseCommitFilesWithConflicts', () => {
    it('keeps the previous path of a rename and a copy', () => {
        const files = parseCommitFilesWithConflicts('R100\told/name.txt\tnew/name.txt\nC75\tsource.txt\tcopy.txt\nM\tplain.txt\n', new Set(['plain.txt']));

        expect(files).toEqual([
            { previousPath: 'old/name.txt', path: 'new/name.txt', status: 'renamed', hadConflict: false },
            { previousPath: 'source.txt', path: 'copy.txt', status: 'copied', hadConflict: false },
            { previousPath: undefined, path: 'plain.txt', status: 'modified', hadConflict: true },
        ]);
    });

    it('falls back to the second column when a rename line omits the old path', () => {
        const files = parseCommitFilesWithConflicts('R100\trenamed.txt\n', new Set());

        expect(files).toEqual([{ previousPath: 'renamed.txt', path: 'renamed.txt', status: 'renamed', hadConflict: false }]);
    });
});

describe('parseConflictMarkerPaths', () => {
    it('collects the paths git reports as still holding markers', () => {
        const output = 'story.txt: leftover conflict marker\nsrc/app.ts: leftover conflict marker\nother.txt: ok\n';

        expect([...parseConflictMarkerPaths(output)]).toEqual(['story.txt', 'src/app.ts']);
    });

    it('reports nothing for clean output', () => {
        expect(parseConflictMarkerPaths('').size).toBe(0);
    });
});

describe('git metadata and index reads', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    /** Leaves story.txt conflicted, so the merge message and all three stages exist. */
    function conflictedRepo() {
        const repoPath = createRepo();
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        gitSetup(repoPath, ['checkout', '-qb', 'feature']);
        writeFileSync(join(repoPath, 'story.txt'), 'one\ntheirs\n', 'utf8');
        gitSetup(repoPath, ['commit', '-am', 'theirs']);
        gitSetup(repoPath, ['checkout', '-q', 'main']);
        writeFileSync(join(repoPath, 'story.txt'), 'one\nours\n', 'utf8');
        gitSetup(repoPath, ['commit', '-am', 'ours']);

        expect(() => gitSetup(repoPath, ['merge', 'feature'])).toThrow();

        return repoPath;
    }

    it('reads a metadata file out of the repository git directory', async () => {
        const repoPath = conflictedRepo();

        const mergeMessage = await readGitMetadataFile(repoPath, 'MERGE_MSG');

        expect(mergeMessage).toContain("Merge branch 'feature'");
    });

    it('returns nothing for a metadata file that does not exist', async () => {
        expect(await readGitMetadataFile(createRepo(), 'MERGE_MSG')).toBeUndefined();
    });

    it('reads each stage of a conflicted path', async () => {
        const repoPath = conflictedRepo();

        expect(await readGitIndexStageFile(repoPath, 2, 'story.txt')).toBe('one\nours\n');
        expect(await readGitIndexStageFile(repoPath, 3, 'story.txt')).toBe('one\ntheirs\n');
        expect(await readGitIndexStageFile(repoPath, 1, 'story.txt')).toBe('one\n');
    });

    it('reads an empty string for a stage the path has no entry in', async () => {
        expect(await readGitIndexStageFile(createRepo(), 2, 'story.txt')).toBe('');
    });
});
