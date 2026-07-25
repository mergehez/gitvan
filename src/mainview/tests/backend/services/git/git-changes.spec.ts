import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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
});
