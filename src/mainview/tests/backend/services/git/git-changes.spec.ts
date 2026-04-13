import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { changesGit } from '../../../../../backend/services/git/git-changes.js';

function runGit(cwd: string, args: string[]) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function createRepo() {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-partial-changes-'));

    runGit(repoPath, ['init']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

    const filePath = join(repoPath, 'story.txt');
    const initialContent = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    writeFileSync(filePath, initialContent, 'utf8');
    runGit(repoPath, ['add', 'story.txt']);
    runGit(repoPath, ['commit', '-m', 'Initial commit']);

    writeFileSync(
        filePath,
        [
            'line 1',
            'line 2 changed',
            'line 3',
            'line 4',
            'line 5',
            'line 6',
            'line 7',
            'line 8',
            'line 9',
            'line 10',
            'line 11',
            'line 12',
            'line 13',
            'line 14',
            'line 15',
            'line 16',
            'line 17',
            'line 18 changed',
            'line 19',
            'line 20',
            '',
        ].join('\n'),
        'utf8'
    );

    return {
        repoPath,
        filePath,
        cleanup() {
            rmSync(repoPath, { recursive: true, force: true });
        },
    };
}

function createRepoWithContent(lines: string[]) {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-partial-changes-'));

    runGit(repoPath, ['init']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

    const filePath = join(repoPath, 'story.txt');
    const initialContent = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    writeFileSync(filePath, initialContent, 'utf8');
    runGit(repoPath, ['add', 'story.txt']);
    runGit(repoPath, ['commit', '-m', 'Initial commit']);

    writeFileSync(filePath, [...lines, ''].join('\n'), 'utf8');

    return {
        repoPath,
        filePath,
        cleanup() {
            rmSync(repoPath, { recursive: true, force: true });
        },
    };
}

describe('changesGit partial file operations', () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    it('stages only the selected hunk from an unstaged file', async () => {
        const repo = createRepo();
        cleanups.push(() => repo.cleanup());

        const diff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');
        expect(diff.entry.hunks).toHaveLength(2);
        expect(diff.entry.supportsPartialStage).toBe(true);

        await changesGit.stageRepoFileHunks(repo.repoPath, 'story.txt', [diff.entry.hunks[0]!.id]);

        const changes = await changesGit.getRepoChanges(repo.repoPath);
        expect(changes.staged.map((entry) => entry.path)).toContain('story.txt');
        expect(changes.unstaged.map((entry) => entry.path)).toContain('story.txt');

        const stagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'staged');
        const unstagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');

        expect(stagedDiff.entry.hunks).toHaveLength(1);
        expect(unstagedDiff.entry.hunks).toHaveLength(1);
    });

    it('unstages only the selected hunk from a staged file', async () => {
        const repo = createRepo();
        cleanups.push(() => repo.cleanup());

        await changesGit.stageRepoFile(repo.repoPath, 'story.txt');

        const stagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'staged');
        expect(stagedDiff.entry.hunks).toHaveLength(2);
        expect(stagedDiff.entry.supportsPartialUnstage).toBe(true);

        await changesGit.unstageRepoFileHunks(repo.repoPath, 'story.txt', [stagedDiff.entry.hunks[0]!.id]);

        const changes = await changesGit.getRepoChanges(repo.repoPath);
        expect(changes.staged.map((entry) => entry.path)).toContain('story.txt');
        expect(changes.unstaged.map((entry) => entry.path)).toContain('story.txt');

        const nextStagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'staged');
        const nextUnstagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');

        expect(nextStagedDiff.entry.hunks).toHaveLength(1);
        expect(nextUnstagedDiff.entry.hunks).toHaveLength(1);
    });

    it('discards only the selected unstaged hunk', async () => {
        const repo = createRepo();
        cleanups.push(() => repo.cleanup());

        const diff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');
        expect(diff.entry.hunks).toHaveLength(2);
        expect(diff.entry.supportsPartialDiscard).toBe(true);

        await changesGit.discardRepoFileHunks(repo.repoPath, 'story.txt', [diff.entry.hunks[0]!.id]);

        const content = readFileSync(repo.filePath, 'utf8');
        expect(content).toContain('line 2\n');
        expect(content).toContain('line 18 changed\n');

        const remainingDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');
        expect(remainingDiff.entry.hunks).toHaveLength(1);
    });

    it('keeps nearby visual changes as separate partial hunks', async () => {
        const repo = createRepoWithContent([
            'line 1',
            'line 2 changed',
            'line 3',
            'line 4',
            'line 5',
            'line 6 changed',
            'line 7',
            'line 8',
            'line 9 changed',
            'line 10',
            'line 11',
            'line 12',
            'line 13',
            'line 14',
            'line 15',
            'line 16',
            'line 17',
            'line 18',
            'line 19',
            'line 20',
        ]);
        cleanups.push(() => repo.cleanup());

        const diff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');

        expect(diff.entry.hunks).toHaveLength(3);
        expect(diff.entry.hunks.map((hunk) => hunk.newStart)).toEqual([2, 6, 9]);

        await changesGit.stageRepoFileHunks(repo.repoPath, 'story.txt', [diff.entry.hunks[1]!.id]);

        const stagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'staged');
        const unstagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');

        expect(stagedDiff.entry.hunks).toHaveLength(1);
        expect(stagedDiff.entry.hunks[0]?.newStart).toBe(6);
        expect(unstagedDiff.entry.hunks).toHaveLength(2);
        expect(unstagedDiff.entry.hunks.map((hunk) => hunk.newStart)).toEqual([2, 9]);
    });

    it('stages a later addition-only hunk without requiring earlier additions', async () => {
        const repo = createRepoWithContent([
            'line 1',
            'line 2',
            'inserted after line 2',
            'line 3',
            'line 4',
            'line 5',
            'inserted after line 5',
            'line 6',
            'line 7',
            'inserted after line 7',
            'line 8',
            'line 9',
            'line 10',
            'line 11',
            'line 12',
            'line 13',
            'line 14',
            'line 15',
            'line 16',
            'line 17',
            'line 18',
            'line 19',
            'line 20',
        ]);
        cleanups.push(() => repo.cleanup());

        const diff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');

        expect(diff.entry.hunks).toHaveLength(3);
        expect(diff.entry.hunks.every((hunk) => hunk.oldLines === 0 && hunk.newLines === 1)).toBe(true);

        await changesGit.stageRepoFileHunks(repo.repoPath, 'story.txt', [diff.entry.hunks[1]!.id]);

        const stagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'staged');
        const unstagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');

        expect(stagedDiff.entry.hunks).toHaveLength(1);
        expect(stagedDiff.entry.hunks[0]?.newStart).toBe(6);
        expect(unstagedDiff.entry.hunks).toHaveLength(2);
        expect(unstagedDiff.entry.hunks.map((hunk) => hunk.newStart)).toEqual([3, 10]);
    });

    it('unstages a later addition-only hunk without requiring earlier staged additions', async () => {
        const repo = createRepoWithContent([
            'line 1',
            'line 2',
            'inserted after line 2',
            'line 3',
            'line 4',
            'line 5',
            'inserted after line 5',
            'line 6',
            'line 7',
            'inserted after line 7',
            'line 8',
            'line 9',
            'line 10',
            'line 11',
            'line 12',
            'line 13',
            'line 14',
            'line 15',
            'line 16',
            'line 17',
            'line 18',
            'line 19',
            'line 20',
        ]);
        cleanups.push(() => repo.cleanup());

        await changesGit.stageRepoFile(repo.repoPath, 'story.txt');

        const stagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'staged');

        expect(stagedDiff.entry.hunks).toHaveLength(3);
        expect(stagedDiff.entry.hunks.every((hunk) => hunk.oldLines === 0 && hunk.newLines === 1)).toBe(true);

        await changesGit.unstageRepoFileHunks(repo.repoPath, 'story.txt', [stagedDiff.entry.hunks[1]!.id]);

        const nextStagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'staged');
        const nextUnstagedDiff = await changesGit.getFileDiff(repo.repoPath, 'story.txt', 'unstaged');

        expect(nextStagedDiff.entry.hunks).toHaveLength(2);
        expect(nextStagedDiff.entry.hunks.map((hunk) => hunk.newStart)).toEqual([3, 9]);
        expect(nextUnstagedDiff.entry.hunks).toHaveLength(1);
        expect(nextUnstagedDiff.entry.hunks[0]?.newStart).toBe(7);
    });
});
