import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { tagsGit } from '../../../../../backend/services/git/git-tags.js';

const tempDirs: string[] = [];

function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
    }).trim();
}

function createRepo() {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-tags-'));
    tempDirs.push(repoPath);

    runGit(repoPath, ['init']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

    return repoPath;
}

function commit(repoPath: string, fileName: string, message: string, date?: string) {
    writeFileSync(join(repoPath, fileName), message, 'utf8');
    const env = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {};
    runGit(repoPath, ['add', '.'], env);
    runGit(repoPath, ['commit', '-m', message], env);

    return runGit(repoPath, ['rev-parse', 'HEAD']);
}

function createBareRemote() {
    const remotePath = mkdtempSync(join(tmpdir(), 'gitvan-tags-remote-'));
    tempDirs.push(remotePath);
    runGit(remotePath, ['init', '--bare']);

    return remotePath;
}

afterEach(() => {
    while (tempDirs.length) {
        rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe('tagsGit.getRepoTags', () => {
    it('describes lightweight and annotated tags with their target commits', async () => {
        const repoPath = createRepo();
        const firstCommit = commit(repoPath, 'a.txt', 'First commit', '2020-01-01T00:00:00+00:00');
        const secondCommit = commit(repoPath, 'b.txt', 'Second commit', '2021-01-01T00:00:00+00:00');

        runGit(repoPath, ['tag', 'v0.1.0', firstCommit]);
        runGit(repoPath, ['tag', '-a', 'v0.2.0', '-m', 'Release v0.2.0', secondCommit]);

        const { tags } = await tagsGit.getRepoTags(repoPath);
        const lightweight = tags.find((tag) => tag.name === 'v0.1.0')!;
        const annotated = tags.find((tag) => tag.name === 'v0.2.0')!;

        // Newest first: the annotated tag was created now, the lightweight one dates back to its commit.
        expect(tags.map((tag) => tag.name)).toEqual(['v0.2.0', 'v0.1.0']);

        expect(lightweight.isAnnotated).toBe(false);
        expect(lightweight.message).toBeUndefined();
        expect(lightweight.commitSha).toBe(firstCommit);
        expect(lightweight.shortSha).toBe(firstCommit.slice(0, 7));
        expect(lightweight.commitSummary).toBe('First commit');

        expect(annotated.isAnnotated).toBe(true);
        expect(annotated.message).toBe('Release v0.2.0');
        expect(annotated.commitSha).toBe(secondCommit);
        expect(annotated.commitSummary).toBe('Second commit');
        expect(annotated.taggerName).toBe('Gitvan Test');
    });

    it('flags tags whose commit has not been pushed yet', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'Only local');
        runGit(repoPath, ['tag', 'v1.0.0', commitSha]);

        const { tags } = await tagsGit.getRepoTags(repoPath);

        expect(tags).toHaveLength(1);
        expect(tags[0]!.isTargetUnpushed).toBe(true);
    });

    it('returns an empty list for a repository without tags', async () => {
        const repoPath = createRepo();
        commit(repoPath, 'a.txt', 'First commit');

        const { tags } = await tagsGit.getRepoTags(repoPath);

        expect(tags).toEqual([]);
    });
});

describe('tagsGit mutations', () => {
    it('creates a lightweight tag without a message and an annotated tag with one', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'First commit');

        await tagsGit.createRepoTag(repoPath, commitSha, 'v1.0.0');
        await tagsGit.createRepoTag(repoPath, commitSha, 'v1.1.0', 'Annotated message');

        const { tags } = await tagsGit.getRepoTags(repoPath);
        const lightweight = tags.find((tag) => tag.name === 'v1.0.0')!;
        const annotated = tags.find((tag) => tag.name === 'v1.1.0')!;

        expect(lightweight.isAnnotated).toBe(false);
        expect(annotated.isAnnotated).toBe(true);
        expect(annotated.message).toBe('Annotated message');
        expect(annotated.commitSummary).toBe('First commit');
    });

    it('rejects invalid tag names', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'First commit');

        await expect(tagsGit.createRepoTag(repoPath, commitSha, 'not a valid tag')).rejects.toThrow();
    });

    it('deletes a local tag', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'First commit');
        runGit(repoPath, ['tag', 'v1.0.0', commitSha]);

        await tagsGit.deleteRepoTag(repoPath, 'v1.0.0');

        expect((await tagsGit.getRepoTags(repoPath)).tags).toEqual([]);
    });

    it('renames an annotated tag without losing its message or target', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'First commit');
        runGit(repoPath, ['tag', '-a', 'v1.0.0', '-m', 'Release notes', commitSha]);

        await tagsGit.renameRepoTag(repoPath, 'v1.0.0', 'v1.0.1');

        const { tags } = await tagsGit.getRepoTags(repoPath);

        expect(tags.map((tag) => tag.name)).toEqual(['v1.0.1']);
        expect(tags[0]!.isAnnotated).toBe(true);
        expect(tags[0]!.message).toBe('Release notes');
        expect(tags[0]!.commitSha).toBe(commitSha);
    });

    it('renames a lightweight tag', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'First commit');
        runGit(repoPath, ['tag', 'v1.0.0', commitSha]);

        await tagsGit.renameRepoTag(repoPath, 'v1.0.0', 'v1.0.1');

        const { tags } = await tagsGit.getRepoTags(repoPath);

        expect(tags.map((tag) => tag.name)).toEqual(['v1.0.1']);
        expect(tags[0]!.isAnnotated).toBe(false);
        expect(tags[0]!.commitSha).toBe(commitSha);
    });
});

describe('tagsGit remote operations', () => {
    it('pushes a single tag and deletes it from the remote again', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'First commit');
        runGit(repoPath, ['tag', 'v1.0.0', commitSha]);
        const remotePath = createBareRemote();
        runGit(repoPath, ['remote', 'add', 'origin', remotePath]);

        await tagsGit.pushRepoTag(repoPath, 'v1.0.0');
        expect(runGit(remotePath, ['tag', '-l'])).toBe('v1.0.0');

        await tagsGit.deleteRemoteRepoTag(repoPath, 'v1.0.0');
        expect(runGit(remotePath, ['tag', '-l'])).toBe('');
    });

    it('pushes every tag at once', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'First commit');
        runGit(repoPath, ['tag', 'v1.0.0', commitSha]);
        runGit(repoPath, ['tag', 'v1.1.0', commitSha]);
        const remotePath = createBareRemote();
        runGit(repoPath, ['remote', 'add', 'origin', remotePath]);

        await tagsGit.pushRepoAllTags(repoPath);

        expect(runGit(remotePath, ['tag', '-l']).split('\n').sort()).toEqual(['v1.0.0', 'v1.1.0']);
    });

    it('fails clearly when no remote is configured', async () => {
        const repoPath = createRepo();
        const commitSha = commit(repoPath, 'a.txt', 'First commit');
        runGit(repoPath, ['tag', 'v1.0.0', commitSha]);

        await expect(tagsGit.pushRepoTag(repoPath, 'v1.0.0')).rejects.toThrow(/no remote is configured/i);
    });
});
