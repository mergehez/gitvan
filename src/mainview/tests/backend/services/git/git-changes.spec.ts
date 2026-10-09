import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { changesGit } from '../../../../../backend/services/git/git-changes.js';
import { parseConflictMarkerPaths, parsePorcelainTrackedEntries, parseRawDiffOutput } from '../../../../../backend/services/git/git-helpers.js';

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
