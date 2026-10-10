import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { changesGit } from '../../../../../backend/services/git/git-changes.js';
import { parseConflictMarkerPaths, parsePorcelainTrackedEntries, parseRawDiffOutput } from '../../../../../backend/services/git/git-helpers.js';
import { takeInvalidatedRepoPaths } from '../../../../../backend/services/repoStatusCache.js';

function runGit(cwd: string, args: string[]) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function createRepoWithFile(name: string, initialContent: string, nextContent: string) {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-no-actual-change-'));

    runGit(repoPath, ['init']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

    const filePath = join(repoPath, name);
    writeFileSync(filePath, initialContent, 'utf8');
    runGit(repoPath, ['add', name]);
    runGit(repoPath, ['commit', '-m', 'Initial commit']);

    writeFileSync(filePath, nextContent, 'utf8');

    return {
        repoPath,
        filePath,
        cleanup() {
            rmSync(repoPath, { recursive: true, force: true });
        },
    };
}

function createConflictedRepo(kind: 'both-modified' | 'deleted-by-us') {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-conflict-'));

    runGit(repoPath, ['init', '-b', 'main']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);
    writeFileSync(join(repoPath, 'story.txt'), 'base\n', 'utf8');
    runGit(repoPath, ['add', 'story.txt']);
    runGit(repoPath, ['commit', '-m', 'base']);

    runGit(repoPath, ['checkout', '-b', 'other']);
    writeFileSync(join(repoPath, 'story.txt'), 'base\ntheirs\n', 'utf8');
    runGit(repoPath, ['commit', '-am', 'theirs']);

    runGit(repoPath, ['checkout', 'main']);
    if (kind === 'deleted-by-us') {
        runGit(repoPath, ['rm', '-q', 'story.txt']);
        runGit(repoPath, ['commit', '-am', 'delete ours']);
    } else {
        writeFileSync(join(repoPath, 'story.txt'), 'base\nours\n', 'utf8');
        runGit(repoPath, ['commit', '-am', 'ours']);
    }

    expect(() => runGit(repoPath, ['merge', 'other'])).toThrow();

    return {
        repoPath,
        cleanup() {
            rmSync(repoPath, { recursive: true, force: true });
        },
    };
}

function createCommittedRepo(prefix: string, files: Record<string, string>) {
    const repoPath = mkdtempSync(join(tmpdir(), `gitvan-${prefix}-`));

    runGit(repoPath, ['init', '-b', 'main']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

    for (const [name, content] of Object.entries(files)) {
        const filePath = join(repoPath, name);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf8');
    }

    runGit(repoPath, ['add', '.']);
    runGit(repoPath, ['commit', '-m', 'Initial commit']);

    return repoPath;
}

describe('changesGit conflicted index', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    it('reads unmerged porcelain records from their path field', () => {
        const record = [
            'u UU N... 100644 100644 100644 100644',
            '1111111111111111111111111111111111111111',
            '38eed9146d1a4581319c92480a8cc1d5663377d0',
            '98ae9fbd767495a841f2d47b7115b59e2dc5bba6',
            'my file.txt',
        ].join(' ');

        expect(parsePorcelainTrackedEntries(record)).toEqual([{ path: 'my file.txt', stagedStatus: 'unmerged', unstagedStatus: 'unmerged' }]);
    });

    it.each(['both-modified', 'deleted-by-us'] as const)('lists a %s conflict by path, not by index hash', async (kind) => {
        const repo = createConflictedRepo(kind);
        cleanups.push(() => repo.cleanup());

        const changes = await changesGit.getRepoChanges(repo.repoPath);
        const entries = [...changes.staged, ...changes.unstaged];

        const paths = [...new Set(entries.map((entry) => entry.path))];
        expect(paths).toEqual(['story.txt']);
        expect(entries.every((entry) => !/^[0-9a-f]{40}$/i.test(entry.path))).toBe(true);
    });

    it('unstages every file while conflicts are unresolved', async () => {
        const repo = createConflictedRepo('both-modified');
        cleanups.push(() => repo.cleanup());

        await expect(changesGit.unstageAllRepoFiles(repo.repoPath)).resolves.toBeUndefined();
        await expect(changesGit.unstageRepoFile(repo.repoPath, 'story.txt')).resolves.toBeUndefined();

        // Nothing is left in the index, and the conflicted content is still in the working tree.
        expect(runGit(repo.repoPath, ['diff', '--cached', '--name-only'])).toBe('');
        expect(runGit(repo.repoPath, ['ls-files', '-u', '--', 'story.txt'])).toBe('');
        expect(readFileSync(join(repo.repoPath, 'story.txt'), 'utf8')).toContain('<<<<<<<');

        const changes = await changesGit.getRepoChanges(repo.repoPath);
        expect(changes.staged).toHaveLength(0);
        expect(changes.unstaged.map((entry) => entry.path)).toContain('story.txt');
        expect(changes.unstaged.find((entry) => entry.path === 'story.txt')?.unstagedStatus).toBe('modified');
    });

    it('lists the paths that still need conflict resolution', async () => {
        const repo = createConflictedRepo('deleted-by-us');
        cleanups.push(() => repo.cleanup());

        await expect(changesGit.listUnmergedRepoFiles(repo.repoPath)).resolves.toEqual(['story.txt']);
    });

    it('flags a file that keeps conflict markers after its unmerged stages are dropped', async () => {
        const repo = createConflictedRepo('both-modified');
        cleanups.push(() => repo.cleanup());

        runGit(repo.repoPath, ['reset', '--quiet', '--', '.']);

        const changes = await changesGit.getRepoChanges(repo.repoPath);
        const entry = changes.unstaged.find((candidate) => candidate.path === 'story.txt');

        expect(entry?.hasConflictMarkers).toBe(true);
        expect(entry?.unstagedStatus).toBe('modified');
    });

    it('does not flag files that hold no conflict markers', async () => {
        const repo = createRepoWithFile('story.txt', 'base\n', 'base\nchanged\n');
        cleanups.push(() => repo.cleanup());

        const changes = await changesGit.getRepoChanges(repo.repoPath);

        expect(changes.unstaged[0]?.hasConflictMarkers).toBeUndefined();
    });

    it('reads conflict markers in a repository without commits', async () => {
        const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-unborn-'));
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        runGit(repoPath, ['init']);
        writeFileSync(join(repoPath, 'story.txt'), 'base\n', 'utf8');
        runGit(repoPath, ['add', 'story.txt']);

        const changes = await changesGit.getRepoChanges(repoPath);

        expect(changes.staged.map((entry) => entry.path)).toEqual(['story.txt']);
        expect(changes.staged[0]?.hasConflictMarkers).toBeUndefined();
    });

    it('reports a repository without commits as a clean status, not an error', async () => {
        const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-unborn-'));
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        runGit(repoPath, ['init', '-b', 'main']);
        writeFileSync(join(repoPath, 'story.txt'), 'base\n', 'utf8');

        const status = await changesGit.getRepoSidebarStatus(repoPath);

        expect(status.error).toBeUndefined();
        expect(status.branch).toBe('main');
        expect(status.publishableCommits).toBe(0);
        expect(status.changedFiles).toBe(1);
    });

    it('parses leftover conflict markers out of git check output', () => {
        const output = [
            'Data/Core/EezyToolSession.cs:340: trailing whitespace.',
            '+    //   Zivil as CivilStatus, NULL as SalaryDeclaration ',
            'Data/Core/EezyToolSessionModels.cs:423: leftover conflict marker',
            'Portal/Client App/src/pages/a b.tsx:12: leftover conflict marker',
        ].join('\n');

        expect([...parseConflictMarkerPaths(output)]).toEqual(['Data/Core/EezyToolSessionModels.cs', 'Portal/Client App/src/pages/a b.tsx']);
    });

    it('parses raw diff records with their blob shas and statuses', () => {
        const output = [
            ':100644 100644 94954abda49de8615a048f8d2e64b5de848e27a1 8b14c4f055267310b71fb4a50e5a8736644bfc28 M',
            'a file.txt',
            ':100644 100644 0000000000000000000000000000000000000000 45b983be36b73c0788dc9cbcb76cbb80fc7bbf3a A',
            'new.txt',
            ':100644 100644 c1b0730000000000000000000000000000000000 0000000000000000000000000000000000000000 D',
            'gone.txt',
            ':100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100',
            'old.txt',
            'new-name.txt',
            '',
        ].join('\0');

        expect(parseRawDiffOutput(output)).toEqual([
            {
                path: 'a file.txt',
                previousPath: undefined,
                status: 'modified',
                oldSha: '94954abda49de8615a048f8d2e64b5de848e27a1',
                newSha: '8b14c4f055267310b71fb4a50e5a8736644bfc28',
            },
            {
                path: 'new.txt',
                previousPath: undefined,
                status: 'added',
                oldSha: undefined,
                newSha: '45b983be36b73c0788dc9cbcb76cbb80fc7bbf3a',
            },
            {
                path: 'gone.txt',
                previousPath: undefined,
                status: 'deleted',
                oldSha: 'c1b0730000000000000000000000000000000000',
                newSha: undefined,
            },
            {
                path: 'new-name.txt',
                previousPath: 'old.txt',
                status: 'renamed',
                oldSha: '1111111111111111111111111111111111111111',
                newSha: '2222222222222222222222222222222222222222',
            },
        ]);
    });
});

describe('changesGit partial file operations', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    it('marks ignored-character-only unstaged files as no actual change', async () => {
        const repo = createRepoWithFile('story.txt', 'role: "admin";\n', "role:'admin',\n");
        cleanups.push(() => repo.cleanup());

        const changes = await changesGit.getRepoChanges(repo.repoPath, {
            ignoredChars: ',;"\'',
            showWhitespaceChanges: false,
        });

        expect(changes.unstaged).toHaveLength(1);
        expect(changes.unstaged[0]?.path).toBe('story.txt');
        expect(changes.unstaged[0]?.unstagedNoActualChange).toBe(true);
    });

    it('marks reordered imports of a script file as no actual change', async () => {
        const original = "import { b } from './b';\nimport { a } from './a';\n\nconsole.log(a + b);\n";
        const repo = createRepoWithFile('app.ts', original, "import { a } from './a';\nimport { b } from './b';\n\nconsole.log(a + b);\n");
        cleanups.push(() => repo.cleanup());

        const changes = await changesGit.getRepoChanges(repo.repoPath, {
            ignoredChars: '',
            showWhitespaceChanges: false,
        });

        expect(changes.unstaged).toHaveLength(1);
        expect(changes.unstaged[0]?.path).toBe('app.ts');
        expect(changes.unstaged[0]?.unstagedNoActualChange).toBe(true);
    });

    it('keeps reordered imports of a non-script file as an actual change', async () => {
        const original = "import { b } from './b';\nimport { a } from './a';\n";
        const repo = createRepoWithFile('story.txt', original, "import { a } from './a';\nimport { b } from './b';\n");
        cleanups.push(() => repo.cleanup());

        const changes = await changesGit.getRepoChanges(repo.repoPath, {
            ignoredChars: '',
            showWhitespaceChanges: false,
        });

        expect(changes.unstaged).toHaveLength(1);
        expect(changes.unstaged[0]?.path).toBe('story.txt');
        expect(changes.unstaged[0]?.unstagedNoActualChange).toBe(false);
    });

    it('skips the cosmetic check and flags files larger than 50kb', async () => {
        const largeContent = 'role: "admin";\n'.repeat(4000);
        const repo = createRepoWithFile('big.txt', largeContent, largeContent.replaceAll('"', "'"));
        cleanups.push(() => repo.cleanup());

        const changes = await changesGit.getRepoChanges(repo.repoPath, {
            ignoredChars: ',;"\'',
            showWhitespaceChanges: false,
        });

        expect(changes.unstaged).toHaveLength(1);
        expect(changes.unstaged[0]?.path).toBe('big.txt');
        expect(changes.unstaged[0]?.unstagedNoActualChange).toBe(false);
        expect(changes.unstaged[0]?.unstagedTooLargeForCosmeticCheck).toBe(true);
    });

    it('classifies a staged ignored-character-only change as no actual change', async () => {
        const repo = createRepoWithFile('story.txt', 'role: "admin";\n', "role:'admin',\n");
        cleanups.push(() => repo.cleanup());
        runGit(repo.repoPath, ['add', 'story.txt']);

        const changes = await changesGit.getRepoChanges(repo.repoPath, {
            ignoredChars: ',;"\'',
            showWhitespaceChanges: false,
        });

        expect(changes.staged).toHaveLength(1);
        expect(changes.staged[0]?.stagedNoActualChange).toBe(true);
        expect(changes.staged[0]?.stagedTooLargeForCosmeticCheck).toBe(false);
    });

    it('classifies the staged and unstaged sides of one file independently', async () => {
        const repo = createRepoWithFile('story.txt', 'role: "admin";\n', "role:'admin',\n");
        cleanups.push(() => repo.cleanup());
        runGit(repo.repoPath, ['add', 'story.txt']);
        writeFileSync(repo.filePath, "role:'admin';\nconsole.log(1);\n", 'utf8');

        const changes = await changesGit.getRepoChanges(repo.repoPath, {
            ignoredChars: ',;"\'',
            showWhitespaceChanges: false,
        });

        expect(changes.staged.find((entry) => entry.path === 'story.txt')?.stagedNoActualChange).toBe(true);
        expect(changes.unstaged.find((entry) => entry.path === 'story.txt')?.unstagedNoActualChange).toBe(false);
    });

    it('classifies several multibyte files in one batched pass', async () => {
        const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-multibyte-'));
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        runGit(repoPath, ['init']);
        runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
        runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

        writeFileSync(join(repoPath, 'accents.txt'), 'const café = "admin";\nconst naïve = "user";\n', 'utf8');
        writeFileSync(join(repoPath, 'cjk.txt'), 'const 名前 = "admin";\nconst 都市 = "user";\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Initial commit']);

        writeFileSync(join(repoPath, 'accents.txt'), "const café = 'admin';\nconst naïve = 'user';\n", 'utf8');
        writeFileSync(join(repoPath, 'cjk.txt'), "const 名前 = 'admin';\nconst 都市 = 'user';\n", 'utf8');

        const changes = await changesGit.getRepoChanges(repoPath, {
            ignoredChars: ',;"\'',
            showWhitespaceChanges: false,
        });

        expect(changes.unstaged.map((entry) => [entry.path, entry.unstagedNoActualChange])).toEqual([
            ['accents.txt', true],
            ['cjk.txt', true],
        ]);
    });
});

describe('changesGit bulk discard', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function createRepoWithTrackedFile() {
        const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-bulk-discard-'));
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        runGit(repoPath, ['init']);
        runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
        runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);
        writeFileSync(join(repoPath, 'tracked.txt'), 'base\n', 'utf8');
        runGit(repoPath, ['add', 'tracked.txt']);
        runGit(repoPath, ['commit', '-m', 'Initial commit']);

        return repoPath;
    }

    it('restores tracked edits and deletes untracked files in one call', async () => {
        const repoPath = createRepoWithTrackedFile();
        writeFileSync(join(repoPath, 'tracked.txt'), 'edited\n', 'utf8');
        writeFileSync(join(repoPath, 'untracked.txt'), 'new\n', 'utf8');
        writeFileSync(join(repoPath, 'also-untracked.txt'), 'new\n', 'utf8');

        await changesGit.discardRepoFiles(repoPath, ['tracked.txt', 'untracked.txt', 'also-untracked.txt']);

        expect(readFileSync(join(repoPath, 'tracked.txt'), 'utf8')).toBe('base\n');
        expect(existsSync(join(repoPath, 'untracked.txt'))).toBe(false);
        expect(existsSync(join(repoPath, 'also-untracked.txt'))).toBe(false);
    });

    it('restores a tracked file that was deleted from the working tree', async () => {
        const repoPath = createRepoWithTrackedFile();
        rmSync(join(repoPath, 'tracked.txt'));

        await changesGit.discardRepoFiles(repoPath, ['tracked.txt']);

        expect(readFileSync(join(repoPath, 'tracked.txt'), 'utf8')).toBe('base\n');
    });

    it('removes untracked directories passed as a file path', async () => {
        const repoPath = createRepoWithTrackedFile();
        mkdirSync(join(repoPath, 'nested'));
        writeFileSync(join(repoPath, 'nested', 'inner.txt'), 'new\n', 'utf8');

        await changesGit.discardRepoFiles(repoPath, ['nested/inner.txt']);

        expect(existsSync(join(repoPath, 'nested', 'inner.txt'))).toBe(false);
    });

    it('does nothing for an empty path list', async () => {
        const repoPath = createRepoWithTrackedFile();
        writeFileSync(join(repoPath, 'tracked.txt'), 'edited\n', 'utf8');

        await changesGit.discardRepoFiles(repoPath, []);

        expect(readFileSync(join(repoPath, 'tracked.txt'), 'utf8')).toBe('edited\n');
    });
});

describe('changesGit content key', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    it('stays stable while the file does not change and moves when it does', async () => {
        const repo = createRepoWithFile('story.txt', 'base\n', 'base\nchanged\n');
        cleanups.push(() => repo.cleanup());

        const first = await changesGit.getRepoChanges(repo.repoPath);
        const second = await changesGit.getRepoChanges(repo.repoPath);

        expect(first.unstaged[0]?.contentKey).toBeTruthy();
        expect(second.unstaged[0]?.contentKey).toBe(first.unstaged[0]?.contentKey);

        writeFileSync(repo.filePath, 'base\nchanged again\n', 'utf8');

        const third = await changesGit.getRepoChanges(repo.repoPath);
        expect(third.unstaged[0]?.contentKey).not.toBe(first.unstaged[0]?.contentKey);
    });

    it('moves when the staged content changes', async () => {
        const repo = createRepoWithFile('story.txt', 'base\n', 'base\nstaged\n');
        cleanups.push(() => repo.cleanup());
        runGit(repo.repoPath, ['add', 'story.txt']);

        const first = await changesGit.getRepoChanges(repo.repoPath);
        writeFileSync(repo.filePath, 'base\nstaged again\n', 'utf8');
        runGit(repo.repoPath, ['add', 'story.txt']);

        const second = await changesGit.getRepoChanges(repo.repoPath);
        expect(second.staged[0]?.contentKey).not.toBe(first.staged[0]?.contentKey);
    });
});

describe('changesGit reword', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function createRepoWithUnpushedCommits() {
        const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-reword-'));
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        runGit(repoPath, ['init', '-b', 'main']);
        runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
        runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

        for (const name of ['first', 'second', 'third']) {
            writeFileSync(join(repoPath, `${name}.txt`), `${name}\n`, 'utf8');
            runGit(repoPath, ['add', '.']);
            runGit(repoPath, ['commit', '-m', `Commit ${name}`]);
        }

        // `origin/main` stops at the first commit, so the two newer ones are unpushed.
        runGit(repoPath, ['update-ref', 'refs/remotes/origin/main', runGit(repoPath, ['rev-parse', 'HEAD~2'])]);

        return repoPath;
    }

    function commitShas(repoPath: string) {
        return runGit(repoPath, ['log', '--format=%H']).split('\n');
    }

    it('rewords an older unpushed commit and replays its descendants', async () => {
        const repoPath = createRepoWithUnpushedCommits();
        const secondSha = commitShas(repoPath)[1]!;
        const originalAuthor = runGit(repoPath, ['show', '-s', '--format=%an|%ae|%aI', secondSha]);

        await changesGit.rewordRepoCommit(repoPath, secondSha, 'Renamed second', 'A fresh body');

        expect(runGit(repoPath, ['log', '--format=%s']).split('\n')).toEqual(['Commit third', 'Renamed second', 'Commit first']);
        expect(runGit(repoPath, ['log', '--format=%s%n%b', '-1', 'HEAD~1'])).toBe('Renamed second\nA fresh body');
        // The rewrite copies the author, so reworded history keeps its attribution.
        expect(runGit(repoPath, ['show', '-s', '--format=%an|%ae|%aI', 'HEAD~1'])).toBe(originalAuthor);
    });

    it('rewords the head commit without touching its tree', async () => {
        const repoPath = createRepoWithUnpushedCommits();
        const [headSha] = commitShas(repoPath);
        const treeBefore = runGit(repoPath, ['rev-parse', `${headSha}^{tree}`]);

        await changesGit.rewordRepoCommit(repoPath, headSha!, 'Reworded head', '');

        expect(runGit(repoPath, ['log', '--format=%s', '-1'])).toBe('Reworded head');
        expect(runGit(repoPath, ['show', '-s', '--format=%b', '-1'])).toBe('');
        expect(runGit(repoPath, ['rev-parse', 'HEAD^{tree}'])).toBe(treeBefore);
    });

    it('rewords the root commit and keeps it parentless', async () => {
        const repoPath = createRepoWithUnpushedCommits();
        // Without any remote-tracking ref the whole history counts as unpushed.
        runGit(repoPath, ['update-ref', '-d', 'refs/remotes/origin/main']);
        const rootSha = runGit(repoPath, ['rev-list', '--max-parents=0', 'HEAD']);

        await changesGit.rewordRepoCommit(repoPath, rootSha, 'Reworded root', '');

        expect(runGit(repoPath, ['log', '--format=%s']).split('\n')).toEqual(['Commit third', 'Commit second', 'Reworded root']);
        expect(runGit(repoPath, ['show', '-s', '--format=%P', 'HEAD~2'])).toBe('');
    });

    it('carries a dirty working tree across the rewrite', async () => {
        const repoPath = createRepoWithUnpushedCommits();
        const secondSha = commitShas(repoPath)[1]!;
        writeFileSync(join(repoPath, 'third.txt'), 'edited\n', 'utf8');
        writeFileSync(join(repoPath, 'untracked.txt'), 'new\n', 'utf8');

        await changesGit.rewordRepoCommit(repoPath, secondSha, 'Renamed second', '');

        // The edits stay uncommitted and unstaged, and the temporary autostash is gone.
        expect(runGit(repoPath, ['diff', '--name-only'])).toBe('third.txt');
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('');
        expect(runGit(repoPath, ['status', '--porcelain', '-uall'])).toContain('?? untracked.txt');
        expect(runGit(repoPath, ['stash', 'list'])).toBe('');
    });

    it('keeps local merge commits in place', async () => {
        const repoPath = createRepoWithUnpushedCommits();
        runGit(repoPath, ['checkout', '-b', 'side', 'HEAD~1']);
        writeFileSync(join(repoPath, 'side.txt'), 'side\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Side work']);
        runGit(repoPath, ['checkout', 'main']);
        runGit(repoPath, ['merge', '--no-ff', 'side', '-m', 'Merge side']);
        const targetSha = runGit(repoPath, ['rev-parse', 'HEAD~2']);

        await changesGit.rewordRepoCommit(repoPath, targetSha, 'Renamed second', '');

        const graph = runGit(repoPath, ['log', '--format=%s', '--graph']);
        expect(graph).toContain('*   Merge side');
        expect(graph).toContain('|\\');
        expect(graph).toContain('Renamed second');
    });

    it('refuses to rewrite a commit that has already been pushed', async () => {
        const repoPath = createRepoWithUnpushedCommits();
        const pushedSha = runGit(repoPath, ['rev-parse', 'HEAD~2']);

        await expect(changesGit.rewordRepoCommit(repoPath, pushedSha, 'Rewritten', '')).rejects.toThrow(/Only unpushed commits can be edited/);

        expect(runGit(repoPath, ['log', '--format=%s', '--skip=2', '-1'])).toBe('Commit first');
    });

    it('refuses an empty summary', async () => {
        const repoPath = createRepoWithUnpushedCommits();
        const headSha = commitShas(repoPath)[0]!;

        await expect(changesGit.rewordRepoCommit(repoPath, headSha, '   ', '')).rejects.toThrow(/Commit summary is required/);
    });
});

describe('changesGit file diff', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function createRepo(name = 'tracked.txt', content = 'base\n') {
        const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-file-diff-'));

        runGit(repoPath, ['init']);
        runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
        runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);
        writeFileSync(join(repoPath, name), content, 'utf8');
        runGit(repoPath, ['add', name]);
        runGit(repoPath, ['commit', '-m', 'Initial commit']);
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    it('reads both sides of an unstaged tracked file', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'tracked.txt'), 'base\nchanged\n', 'utf8');

        const diff = await changesGit.getFileDiff(repoPath, 'tracked.txt', 'unstaged');

        expect(diff.entry.label).toBe('Unstaged');
        expect(diff.entry.original).toBe('base\n');
        expect(diff.entry.modified).toBe('base\nchanged\n');
        expect(diff.entry.patch).toContain('+changed');
        expect(diff.entry.stats.addedLines).toBe(1);
        expect(diff.entry.previewMessage).toBeUndefined();
    });

    it('reads both sides of a staged file', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'tracked.txt'), 'base\nstaged\n', 'utf8');
        runGit(repoPath, ['add', 'tracked.txt']);

        const diff = await changesGit.getFileDiff(repoPath, 'tracked.txt', 'staged');

        expect(diff.entry.label).toBe('Staged');
        expect(diff.entry.original).toBe('base\n');
        expect(diff.entry.modified).toBe('base\nstaged\n');
    });

    it('reads an untracked file as an all-additions diff', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'brand-new.txt'), 'one\ntwo\n', 'utf8');

        const diff = await changesGit.getFileDiff(repoPath, 'brand-new.txt', 'unstaged');

        expect(diff.entry.label).toBe('Untracked');
        expect(diff.entry.original).toBe('');
        expect(diff.entry.modified).toBe('one\ntwo\n');
        expect(diff.entry.stats.addedLines).toBe(2);
    });

    it('rejects a huge untracked file without buffering its patch', async () => {
        const repoPath = createRepo();
        const lineCount = 600_000; // ~1.2 MB, over the 1 MB preview cap
        writeFileSync(join(repoPath, 'generated.txt'), 'x\n'.repeat(lineCount), 'utf8');

        const diff = await changesGit.getFileDiff(repoPath, 'generated.txt', 'unstaged');

        expect(diff.entry.label).toBe('Untracked');
        expect(diff.entry.previewMessage).toBe('File too big to preview');
        // The giant patch is never carried; only the line count survives.
        expect(diff.entry.patch).toBe('File too big to preview');
        expect(diff.entry.modified).toBe('');
        expect(diff.entry.stats).toEqual({ oldSizeBytes: 0, newSizeBytes: lineCount * 2, addedLines: lineCount, removedLines: 0 });
    });

    it('keeps the image preview for a small untracked image', async () => {
        const repoPath = createRepo();
        writeFileSync(join(repoPath, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

        const diff = await changesGit.getFileDiff(repoPath, 'logo.png', 'unstaged');

        expect(diff.entry.modified).toBe('');
        expect(diff.entry.nonCodePreview).toMatchObject({ kind: 'image' });
        expect(diff.entry.nonCodePreview?.modifiedSrc).toMatch(/^data:image\/png;base64,/);
    });

    it('falls back to a no-diff entry for a path that has no diff and no file', async () => {
        const repoPath = createRepo();

        const diff = await changesGit.getFileDiff(repoPath, 'ghost.txt', 'unstaged');

        expect(diff.entry.patch).toBe('No diff content was returned for this file.');
        expect(diff.entry.modified).toBe('No diff content was returned for this file.');
    });
});

describe('changesGit porcelain paths', () => {
    const cleanups: Array<() => void> = [];
    const sha = 'a'.repeat(40);

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    it('reads a path verbatim out of NUL-separated porcelain records', () => {
        const output = `1 .M N... 100644 100644 100644 ${sha} ${sha} café.txt\0`;

        expect(parsePorcelainTrackedEntries(output)).toEqual([{ path: 'café.txt', stagedStatus: 'clean', unstagedStatus: 'modified' }]);
    });

    it('ignores a NUL-separated rename record and its original path field', () => {
        const output = [`2 R. N... 100644 100644 100644 ${sha} ${sha} R100`, 'new-name.txt', 'old-name.txt', ''].join('\0');

        expect(parsePorcelainTrackedEntries(output)).toEqual([]);
    });

    it('lists a non-ASCII path once, in the spelling the raw diff uses', async () => {
        const repoPath = createCommittedRepo('non-ascii-path', { 'café.txt': 'role: "admin";\n' });
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));
        writeFileSync(join(repoPath, 'café.txt'), "role:'admin',\n", 'utf8');

        const changes = await changesGit.getRepoChanges(repoPath, { ignoredChars: ',;"\'', showWhitespaceChanges: false });

        // `git status` C-quotes a non-ASCII path unless it is asked for NUL-separated records, and
        // the quoted spelling used to be listed as a second file next to the real one.
        expect(changes.unstaged.map((entry) => [entry.path, entry.unstagedNoActualChange])).toEqual([['café.txt', true]]);
    });
});

describe('changesGit index operations', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function repoWithTwoFiles() {
        const repoPath = createCommittedRepo('index-ops', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    it('stages a single file and a batch', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');

        await changesGit.stageRepoFile(repoPath, 'a.txt');
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('a.txt');

        await changesGit.stageRepoFiles(repoPath, ['b.txt']);
        expect(runGit(repoPath, ['diff', '--cached', '--name-only']).split('\n')).toEqual(['a.txt', 'b.txt']);
        expect(runGit(repoPath, ['diff', '--name-only'])).toBe('');
    });

    it('stages every change including untracked and deleted files', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');
        writeFileSync(join(repoPath, 'untracked.txt'), 'new\n', 'utf8');
        rmSync(join(repoPath, 'a.txt'));

        await changesGit.stageAllRepoFiles(repoPath);

        expect(runGit(repoPath, ['status', '--porcelain'])).toBe(['D  a.txt', 'M  b.txt', 'A  untracked.txt'].join('\n'));
    });

    it('unstages a single file and a batch', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');
        runGit(repoPath, ['add', '--all']);

        await changesGit.unstageRepoFile(repoPath, 'a.txt');
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('b.txt');

        await changesGit.unstageRepoFiles(repoPath, ['b.txt']);
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('');
        expect(runGit(repoPath, ['diff', '--name-only']).split('\n')).toEqual(['a.txt', 'b.txt']);
    });

    it('does nothing for an empty path list', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');

        await changesGit.stageRepoFiles(repoPath, []);
        await changesGit.unstageRepoFiles(repoPath, []);
        await changesGit.deleteStagedRepoFiles(repoPath, []);

        expect(runGit(repoPath, ['diff', '--name-only'])).toBe('a.txt');
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('');
    });

    it('unstages everything at once', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');
        runGit(repoPath, ['add', '--all']);

        await changesGit.unstageAllRepoFiles(repoPath);

        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('');
        expect(runGit(repoPath, ['diff', '--name-only']).split('\n')).toEqual(['a.txt', 'b.txt']);
    });
});

describe('changesGit restore and delete', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function repoWithTwoFiles() {
        const repoPath = createCommittedRepo('restore-delete', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    it('restores one file on the unstaged and the staged side', async () => {
        const repoPath = repoWithTwoFiles();

        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        await changesGit.restoreRepoFile(repoPath, 'a.txt', 'unstaged');
        expect(readFileSync(join(repoPath, 'a.txt'), 'utf8')).toBe('a\n');

        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        runGit(repoPath, ['add', 'a.txt']);
        await changesGit.restoreRepoFile(repoPath, 'a.txt', 'staged');

        // A staged restore rewrites the worktree from HEAD as well.
        expect(runGit(repoPath, ['status', '--porcelain'])).toBe('');
        expect(readFileSync(join(repoPath, 'a.txt'), 'utf8')).toBe('a\n');
    });

    it('restores a batch on both sides', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');

        await changesGit.restoreRepoFiles(repoPath, ['a.txt', 'b.txt'], 'unstaged');
        expect(runGit(repoPath, ['diff', '--name-only', '--', '.'])).toBe('');

        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');
        runGit(repoPath, ['add', '--all']);
        await changesGit.restoreRepoFiles(repoPath, ['a.txt', 'b.txt'], 'staged');

        // A staged restore rewrites the worktree from HEAD as well.
        expect(runGit(repoPath, ['status', '--porcelain'])).toBe('');
        expect(readFileSync(join(repoPath, 'a.txt'), 'utf8')).toBe('a\n');
        expect(readFileSync(join(repoPath, 'b.txt'), 'utf8')).toBe('b\n');
    });

    it('deletes one staged file and a batch', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');
        runGit(repoPath, ['add', '--all']);

        await changesGit.deleteStagedRepoFile(repoPath, 'a.txt');
        expect(existsSync(join(repoPath, 'a.txt'))).toBe(false);
        expect(runGit(repoPath, ['status', '--porcelain'])).toBe(['D  a.txt', 'M  b.txt'].join('\n'));

        await changesGit.deleteStagedRepoFiles(repoPath, ['b.txt']);
        expect(existsSync(join(repoPath, 'b.txt'))).toBe(false);
        expect(runGit(repoPath, ['status', '--porcelain'])).toBe(['D  a.txt', 'D  b.txt'].join('\n'));
    });

    it('discards a tracked edit and removes an untracked file', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'untracked.txt'), 'new\n', 'utf8');

        await changesGit.discardRepoFile(repoPath, 'a.txt');
        await changesGit.discardRepoFile(repoPath, 'untracked.txt');

        expect(readFileSync(join(repoPath, 'a.txt'), 'utf8')).toBe('a\n');
        expect(existsSync(join(repoPath, 'untracked.txt'))).toBe(false);
    });
});

describe('changesGit apply patch', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function repoWithTwoFiles() {
        const repoPath = createCommittedRepo('apply-patch', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    it('stages only the file a patch covers', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');

        await changesGit.applyPatch(repoPath, runGit(repoPath, ['diff', '--', 'a.txt']), 'stage');

        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('a.txt');
        expect(runGit(repoPath, ['diff', '--name-only'])).toBe('b.txt');
    });

    it('unstages only the file a patch covers', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');
        runGit(repoPath, ['add', '--all']);

        await changesGit.applyPatch(repoPath, runGit(repoPath, ['diff', '--staged', '--', 'a.txt']), 'unstage');

        // Unstaging leaves the worktree copy of a.txt changed against the index.
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('b.txt');
        expect(runGit(repoPath, ['diff', '--name-only'])).toBe('a.txt');
    });

    it('discards only the file a patch covers', async () => {
        const repoPath = repoWithTwoFiles();
        writeFileSync(join(repoPath, 'a.txt'), 'a changed\n', 'utf8');
        writeFileSync(join(repoPath, 'b.txt'), 'b changed\n', 'utf8');

        await changesGit.applyPatch(repoPath, runGit(repoPath, ['diff', '--', 'a.txt']), 'discard');

        expect(readFileSync(join(repoPath, 'a.txt'), 'utf8')).toBe('a\n');
        expect(runGit(repoPath, ['diff', '--name-only'])).toBe('b.txt');
    });

    it('propagates a patch git refuses instead of leaving a half-applied index', async () => {
        const repoPath = repoWithTwoFiles();

        await expect(changesGit.applyPatch(repoPath, 'this is not a patch', 'stage')).rejects.toThrow();

        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('');
        expect(runGit(repoPath, ['status', '--porcelain'])).toBe('');
    });
});

describe('changesGit ignore path', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function repoWithTwoFiles() {
        const repoPath = createCommittedRepo('ignore-path', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    function readGitIgnore(repoPath: string) {
        return readFileSync(join(repoPath, '.gitignore'), 'utf8');
    }

    it('writes the entry each mode normalizes to', async () => {
        const repoPath = repoWithTwoFiles();

        await changesGit.ignoreRepoPath(repoPath, './logs/output.log', 'file');
        await changesGit.ignoreRepoPath(repoPath, 'node_modules/', 'directory');
        await changesGit.ignoreRepoPath(repoPath, '*.tmp', 'pattern');

        expect(readGitIgnore(repoPath)).toBe(['logs/output.log', 'node_modules/', '*.tmp', ''].join('\n'));
    });

    it('does not add an entry the file already holds', async () => {
        const repoPath = repoWithTwoFiles();

        await changesGit.ignoreRepoPath(repoPath, '*.log', 'pattern');
        await changesGit.ignoreRepoPath(repoPath, '*.log', 'pattern');

        expect(readGitIgnore(repoPath)).toBe('*.log\n');
    });

    it('invalidates the cached sidebar status for the repository', async () => {
        const repoPath = repoWithTwoFiles();
        takeInvalidatedRepoPaths();

        await changesGit.ignoreRepoPath(repoPath, '*.log', 'pattern');

        expect(takeInvalidatedRepoPaths()).toEqual(new Set([repoPath]));
    });
});

describe('changesGit commit', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function repoWithOneFile() {
        const repoPath = createCommittedRepo('commit', { 'a.txt': 'a\n' });
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    function stageEdit(repoPath: string, content: string) {
        writeFileSync(join(repoPath, 'a.txt'), content, 'utf8');
        runGit(repoPath, ['add', 'a.txt']);
    }

    it('commits the staged changes with a summary and a body', async () => {
        const repoPath = repoWithOneFile();
        stageEdit(repoPath, 'a changed\n');

        await changesGit.commitRepoChanges(repoPath, 'Add the feature', 'It does a useful thing.');

        expect(runGit(repoPath, ['log', '-1', '--format=%B'])).toBe('Add the feature\n\nIt does a useful thing.');
        expect(runGit(repoPath, ['status', '--porcelain'])).toBe('');
    });

    it('leaves the body out when the description is blank', async () => {
        const repoPath = repoWithOneFile();
        stageEdit(repoPath, 'a changed\n');

        await changesGit.commitRepoChanges(repoPath, 'Only a summary', '   ');

        expect(runGit(repoPath, ['log', '-1', '--format=%B'])).toBe('Only a summary');
    });

    it('amends the last commit in place', async () => {
        const repoPath = repoWithOneFile();
        stageEdit(repoPath, 'a changed\n');
        await changesGit.commitRepoChanges(repoPath, 'First message', '');

        stageEdit(repoPath, 'a changed again\n');
        await changesGit.commitRepoChanges(repoPath, 'Reworded message', '', true);

        // The amend replaces the second commit instead of adding a third.
        expect(runGit(repoPath, ['rev-list', '--count', 'HEAD'])).toBe('2');
        expect(runGit(repoPath, ['log', '-1', '--format=%B'])).toBe('Reworded message');
    });

    it('refuses an empty summary', async () => {
        const repoPath = repoWithOneFile();
        stageEdit(repoPath, 'a changed\n');

        await expect(changesGit.commitRepoChanges(repoPath, '   ', 'A body without a subject')).rejects.toThrow('Commit summary is required.');
        expect(runGit(repoPath, ['rev-list', '--count', 'HEAD'])).toBe('1');
    });

    it('undoes the last commit and keeps its changes staged', async () => {
        const repoPath = repoWithOneFile();
        stageEdit(repoPath, 'a changed\n');
        await changesGit.commitRepoChanges(repoPath, 'Second commit', '');

        await changesGit.undoLastRepoCommit(repoPath);

        expect(runGit(repoPath, ['log', '-1', '--format=%s'])).toBe('Initial commit');
        expect(runGit(repoPath, ['diff', '--cached', '--name-only'])).toBe('a.txt');
        expect(runGit(repoPath, ['diff', '--name-only'])).toBe('');
    });
});

describe('changesGit sidebar status', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    function repoWithOneCommit() {
        const repoPath = createCommittedRepo('sidebar-status', { 'tracked.txt': 'base\n' });
        cleanups.push(() => rmSync(repoPath, { recursive: true, force: true }));

        return repoPath;
    }

    it('reports the branch, the publishable commits and the working-tree counts', async () => {
        const repoPath = repoWithOneCommit();

        await expect(changesGit.getRepoSidebarStatus(repoPath)).resolves.toMatchObject({
            branch: 'main',
            ahead: 0,
            behind: 0,
            hasRemote: false,
            hasUpstream: false,
            publishableCommits: 1,
            changedFiles: 0,
            stagedFiles: 0,
            unstagedFiles: 0,
            isDirty: false,
            error: undefined,
        });

        writeFileSync(join(repoPath, 'tracked.txt'), 'changed\n', 'utf8');
        writeFileSync(join(repoPath, 'untracked.txt'), 'new\n', 'utf8');

        expect(await changesGit.getRepoSidebarStatus(repoPath)).toMatchObject({ changedFiles: 2, stagedFiles: 0, unstagedFiles: 2, isDirty: true });

        runGit(repoPath, ['add', 'tracked.txt']);

        expect(await changesGit.getRepoSidebarStatus(repoPath)).toMatchObject({ changedFiles: 2, stagedFiles: 1, unstagedFiles: 1, isDirty: true });
    });

    it('reads ahead, behind and the upstream from the branch header', async () => {
        const repoPath = repoWithOneCommit();
        writeFileSync(join(repoPath, 'tracked.txt'), 'base\nsecond\n', 'utf8');
        runGit(repoPath, ['add', 'tracked.txt']);
        runGit(repoPath, ['commit', '-m', 'Second commit']);

        const firstSha = runGit(repoPath, ['rev-list', '--max-parents=0', 'HEAD']);
        runGit(repoPath, ['remote', 'add', 'origin', 'https://example.invalid/gitvan.git']);
        runGit(repoPath, ['update-ref', 'refs/remotes/origin/main', firstSha]);

        // A remote is configured but the branch does not track it yet, so the commit it would publish is counted.
        expect(await changesGit.getRepoSidebarStatus(repoPath)).toMatchObject({ hasRemote: true, hasUpstream: false, publishableCommits: 1, ahead: 0, behind: 0 });

        runGit(repoPath, ['branch', '--set-upstream-to=origin/main', 'main']);

        expect(await changesGit.getRepoSidebarStatus(repoPath)).toMatchObject({ hasUpstream: true, publishableCommits: 0, ahead: 1, behind: 0 });

        // Point the upstream at a descendant of HEAD so the branch is one commit behind it.
        runGit(repoPath, ['checkout', '-q', '-b', 'upstream-work']);
        writeFileSync(join(repoPath, 'upstream.txt'), 'upstream\n', 'utf8');
        runGit(repoPath, ['add', 'upstream.txt']);
        runGit(repoPath, ['commit', '-m', 'Upstream commit']);
        runGit(repoPath, ['update-ref', 'refs/remotes/origin/main', runGit(repoPath, ['rev-parse', 'upstream-work'])]);
        runGit(repoPath, ['checkout', '-q', 'main']);

        expect(await changesGit.getRepoSidebarStatus(repoPath)).toMatchObject({ ahead: 0, behind: 1, publishableCommits: 0 });
    });

    it('reports a detached head without publishable commits', async () => {
        const repoPath = repoWithOneCommit();
        runGit(repoPath, ['checkout', '-q', '--detach']);

        expect(await changesGit.getRepoSidebarStatus(repoPath)).toMatchObject({ branch: 'Detached HEAD', publishableCommits: 0, error: undefined });
    });

    it('reports a failed scan as an error instead of throwing', async () => {
        const missingPath = join(tmpdir(), `gitvan-missing-${Math.random().toString(36).slice(2)}`);

        await expect(changesGit.getRepoSidebarStatus(missingPath)).resolves.toMatchObject({
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
            error: expect.stringContaining('could not be found'),
        });
    });
});
