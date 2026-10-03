import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { changesGit } from '../../../../../backend/services/git/git-changes.js';
import { parseConflictMarkerPaths, parsePorcelainTrackedEntries } from '../../../../../backend/services/git/git-helpers.js';

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

        const changes = await changesGit.getRepoChanges(repo.repoPath);
        expect(changes.staged).toHaveLength(0);
        expect(changes.unstaged.map((entry) => entry.path)).toContain('story.txt');
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

    it('parses leftover conflict markers out of git check output', () => {
        const output = [
            'Data/Core/EezyToolSession.cs:340: trailing whitespace.',
            '+    //   Zivil as CivilStatus, NULL as SalaryDeclaration ',
            'Data/Core/EezyToolSessionModels.cs:423: leftover conflict marker',
            'Portal/Client App/src/pages/a b.tsx:12: leftover conflict marker',
        ].join('\n');

        expect([...parseConflictMarkerPaths(output)]).toEqual(['Data/Core/EezyToolSessionModels.cs', 'Portal/Client App/src/pages/a b.tsx']);
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
});
