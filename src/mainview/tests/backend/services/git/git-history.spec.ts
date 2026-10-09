import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { historyGit } from '../../../../../backend/services/git/git-history.js';

const tempRepos: string[] = [];

function runGit(cwd: string, args: string[]) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function createRepoWithCommits(count: number) {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-history-'));
    tempRepos.push(repoPath);

    runGit(repoPath, ['init']);
    runGit(repoPath, ['config', 'user.name', 'Gitvan Test']);
    runGit(repoPath, ['config', 'user.email', 'gitvan@example.com']);

    for (let index = 0; index < count; index += 1) {
        writeFileSync(join(repoPath, `file-${index}.txt`), `content ${index}`, 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', `Commit ${index}`]);
    }

    return repoPath;
}

afterEach(() => {
    while (tempRepos.length) {
        rmSync(tempRepos.pop()!, { recursive: true, force: true });
    }
});

describe('historyGit.getRepoHistory pagination', () => {
    it('returns the newest commits first and reports that older commits exist', async () => {
        const repoPath = createRepoWithCommits(5);

        const page = await historyGit.getRepoHistory(repoPath, { limit: 2 });

        expect(page.commits.map((commit) => commit.summary)).toEqual(['Commit 4', 'Commit 3']);
        expect(page.hasMore).toBe(true);
    });

    it('walks older commits with skip and stops reporting more at the end', async () => {
        const repoPath = createRepoWithCommits(5);

        const secondPage = await historyGit.getRepoHistory(repoPath, { limit: 2, skip: 2 });
        const lastPage = await historyGit.getRepoHistory(repoPath, { limit: 2, skip: 4 });

        expect(secondPage.commits.map((commit) => commit.summary)).toEqual(['Commit 2', 'Commit 1']);
        expect(secondPage.hasMore).toBe(true);
        expect(lastPage.commits.map((commit) => commit.summary)).toEqual(['Commit 0']);
        expect(lastPage.hasMore).toBe(false);
    });

    it('defaults to a single recent page without more results for small repositories', async () => {
        const repoPath = createRepoWithCommits(5);

        const page = await historyGit.getRepoHistory(repoPath);

        expect(page.commits).toHaveLength(5);
        expect(page.hasMore).toBe(false);
    });

    it('marks unpushed commits inside a paginated window', async () => {
        const repoPath = createRepoWithCommits(3);

        const page = await historyGit.getRepoHistory(repoPath, { limit: 1, skip: 1 });

        expect(page.commits.map((commit) => commit.summary)).toEqual(['Commit 1']);
        expect(page.commits[0]!.isUnpushed).toBe(true);
    });
});

describe('historyGit.getRepoHistory search', () => {
    function createSearchRepo() {
        const repoPath = createRepoWithCommits(0);

        writeFileSync(join(repoPath, 'a.txt'), 'a', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add login flow']);

        writeFileSync(join(repoPath, 'b.txt'), 'b', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Fix typo in docs']);

        writeFileSync(join(repoPath, 'c.txt'), 'c', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add [bracket] guard']);

        return repoPath;
    }

    it('matches commit messages across the whole history, ignoring case', async () => {
        const repoPath = createSearchRepo();

        const page = await historyGit.getRepoHistory(repoPath, { search: 'LOGIN' });

        expect(page.commits.map((commit) => commit.summary)).toEqual(['Add login flow']);
        expect(page.hasMore).toBe(false);
    });

    it('treats the query as a literal string instead of a regex', async () => {
        const repoPath = createSearchRepo();

        const page = await historyGit.getRepoHistory(repoPath, { search: '[bracket]' });

        expect(page.commits.map((commit) => commit.summary)).toEqual(['Add [bracket] guard']);
    });

    it('returns no commits when nothing matches', async () => {
        const repoPath = createSearchRepo();

        const page = await historyGit.getRepoHistory(repoPath, { search: 'does-not-exist' });

        expect(page.commits).toEqual([]);
        expect(page.hasMore).toBe(false);
    });

    it('paginates search matches with limit and skip', async () => {
        const repoPath = createSearchRepo();

        const firstPage = await historyGit.getRepoHistory(repoPath, { search: 'Add', limit: 1 });
        const secondPage = await historyGit.getRepoHistory(repoPath, { search: 'Add', limit: 1, skip: 1 });

        expect(firstPage.commits.map((commit) => commit.summary)).toEqual(['Add [bracket] guard']);
        expect(firstPage.hasMore).toBe(true);
        expect(secondPage.commits.map((commit) => commit.summary)).toEqual(['Add login flow']);
        expect(secondPage.hasMore).toBe(false);
    });

    it('marks matched commits inside a search page as unpushed', async () => {
        const repoPath = createSearchRepo();

        const page = await historyGit.getRepoHistory(repoPath, { search: 'typo' });

        expect(page.commits.map((commit) => commit.summary)).toEqual(['Fix typo in docs']);
        expect(page.commits[0]!.isUnpushed).toBe(true);
    });
});

describe('historyGit.getRepoHistory file path', () => {
    function createRenameRepo() {
        const repoPath = createRepoWithCommits(0);

        writeFileSync(join(repoPath, 'old-name.txt'), 'one', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add old name']);

        writeFileSync(join(repoPath, 'old-name.txt'), 'two', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Edit old name']);

        runGit(repoPath, ['mv', 'old-name.txt', 'new-name.txt']);
        runGit(repoPath, ['commit', '-m', 'Rename to new name']);

        writeFileSync(join(repoPath, 'new-name.txt'), 'three', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Edit new name']);

        writeFileSync(join(repoPath, 'unrelated.txt'), 'x', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Unrelated work']);

        return repoPath;
    }

    it('keeps only the commits that touched the path', async () => {
        const repoPath = createRenameRepo();

        const page = await historyGit.getRepoHistory(repoPath, { path: 'new-name.txt' });

        expect(page.commits.map((commit) => commit.summary)).toEqual(['Edit new name', 'Rename to new name']);
        expect(page.hasMore).toBe(false);
    });

    it('follows the path across renames when asked', async () => {
        const repoPath = createRenameRepo();

        const page = await historyGit.getRepoHistory(repoPath, { path: 'new-name.txt', followRenames: true });

        expect(page.commits.map((commit) => commit.summary)).toEqual(['Edit new name', 'Rename to new name', 'Edit old name', 'Add old name']);
        expect(page.hasMore).toBe(false);
    });

    it('returns no commits for a path that was never committed', async () => {
        const repoPath = createRenameRepo();

        const page = await historyGit.getRepoHistory(repoPath, { path: 'never/existed.txt' });

        expect(page.commits).toEqual([]);
        expect(page.hasMore).toBe(false);
    });

    it('paginates file commits with limit and skip', async () => {
        const repoPath = createRenameRepo();

        const firstPage = await historyGit.getRepoHistory(repoPath, { path: 'new-name.txt', followRenames: true, limit: 2 });
        const secondPage = await historyGit.getRepoHistory(repoPath, { path: 'new-name.txt', followRenames: true, limit: 2, skip: 2 });

        expect(firstPage.commits.map((commit) => commit.summary)).toEqual(['Edit new name', 'Rename to new name']);
        expect(firstPage.hasMore).toBe(true);
        expect(secondPage.commits.map((commit) => commit.summary)).toEqual(['Edit old name', 'Add old name']);
        expect(secondPage.hasMore).toBe(false);
    });
});

describe('historyGit.getRepoCommitMessage', () => {
    it('reads the subject and the body of a commit', async () => {
        const repoPath = createRepoWithCommits(1);
        writeFileSync(join(repoPath, 'body.txt'), 'body', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Subject line', '-m', 'First body line\nSecond body line']);

        const message = await historyGit.getRepoCommitMessage(repoPath, 'HEAD');

        expect(message).toEqual({ summary: 'Subject line', body: 'First body line\nSecond body line' });
    });

    it('returns an empty body for a subject-only commit', async () => {
        const repoPath = createRepoWithCommits(1);

        const message = await historyGit.getRepoCommitMessage(repoPath, 'HEAD');

        expect(message).toEqual({ summary: 'Commit 0', body: '' });
    });
});
