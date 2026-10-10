import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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

describe('historyGit commit detail and file diffs', () => {
    function createDetailRepo() {
        const repoPath = createRepoWithCommits(0);

        writeFileSync(join(repoPath, 'small.txt'), 'before\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Base commit']);

        writeFileSync(join(repoPath, 'small.txt'), 'before\nafter\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Edit small file']);

        return repoPath;
    }

    it('returns the file list without a patch payload', async () => {
        const repoPath = createDetailRepo();

        const detail = await historyGit.getCommitDetail(repoPath, 'HEAD');

        expect(detail.summary).toBe('Edit small file');
        expect(detail.files.map((file) => file.path)).toEqual(['small.txt']);
        expect(detail).not.toHaveProperty('patch');
    });

    it('serves the patch for the selected file on demand', async () => {
        const repoPath = createDetailRepo();

        const diff = await historyGit.getCommitFileDiff(repoPath, 'HEAD', 'small.txt');

        expect(diff.entry.patch).toContain('+after');
        expect(diff.entry.original).toBe('before\n');
        expect(diff.entry.modified).toBe('before\nafter\n');
        expect(diff.entry.previewMessage).toBeUndefined();
    });

    it('refuses a file above the preview cap before reading its patch', async () => {
        const repoPath = createRepoWithCommits(0);
        writeFileSync(join(repoPath, 'large.txt'), 'x'.repeat(1_200_000), 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add a large file']);

        const diff = await historyGit.getCommitFileDiff(repoPath, 'HEAD', 'large.txt');

        expect(diff.entry.previewMessage).toBe('Diff too large to display');
        expect(diff.entry.patch).toBe('Diff too large to display');
        expect(diff.entry.original).toBe('');
        expect(diff.entry.modified).toBe('');
    });
});

describe('historyGit.getRepoHistory without any commits', () => {
    it('reports an empty history instead of failing the walk', async () => {
        // A repository created but not committed to yet is a normal starting point.
        const repoPath = createRepoWithCommits(0);

        await expect(historyGit.getRepoHistory(repoPath, { limit: 10 })).resolves.toMatchObject({ commits: [], hasMore: false });
    });
});

describe('historyGit.getCommittedTree', () => {
    /** A tree with a nested path, a file whose name sorts late, and a submodule entry. */
    function createTreeRepo() {
        const repoPath = createRepoWithCommits(0);

        runGit(repoPath, ['commit', '--allow-empty', '-m', 'Initial baseline']);
        writeFileSync(join(repoPath, 'README.md'), '# Readme\n', 'utf8');
        writeFileSync(join(repoPath, 'zeta.txt'), 'z\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add top level files']);

        mkdirSync(join(repoPath, 'src'), { recursive: true });
        writeFileSync(join(repoPath, 'src/app.ts'), 'export const value = 1;\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add a nested path']);

        return repoPath;
    }

    it('lists every blob sorted by path with its size', async () => {
        const tree = await historyGit.getCommittedTree(createTreeRepo());

        expect(tree.files).toEqual([
            { path: 'README.md', sizeBytes: 9 },
            { path: 'src/app.ts', sizeBytes: 24 },
            { path: 'zeta.txt', sizeBytes: 2 },
        ]);
    });

    it('reads the tree of an older commit when one is named', async () => {
        const repoPath = createTreeRepo();
        const olderSha = runGit(repoPath, ['rev-parse', 'HEAD~1']);

        const tree = await historyGit.getCommittedTree(repoPath, olderSha);

        expect(tree.commitSha).toBe(olderSha);
        expect(tree.files.map((file) => file.path)).toEqual(['README.md', 'zeta.txt']);
    });

    it('reports an empty tree for a repository with no commits yet', async () => {
        await expect(historyGit.getCommittedTree(createRepoWithCommits(0))).resolves.toEqual({ commitSha: undefined, files: [] });
    });

    it('ignores a nested repository entry, which has no blob size', async () => {
        const repoPath = createRepoWithCommits(0);
        runGit(repoPath, ['commit', '--allow-empty', '-m', 'Initial baseline']);
        writeFileSync(join(repoPath, 'module.txt'), 'kept\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add a file']);

        // Committing a nested repository records a gitlink, which `ls-tree` reports with `-` size.
        const nestedPath = join(repoPath, 'linked');
        mkdirSync(nestedPath, { recursive: true });
        runGit(nestedPath, ['init', '-b', 'main']);
        runGit(nestedPath, ['config', 'user.name', 'Gitvan Nested']);
        runGit(nestedPath, ['config', 'user.email', 'nested@example.com']);
        writeFileSync(join(nestedPath, 'inside.txt'), 'inside\n', 'utf8');
        runGit(nestedPath, ['add', '.']);
        runGit(nestedPath, ['commit', '-m', 'Nested baseline']);
        runGit(repoPath, ['add', 'linked']);
        runGit(repoPath, ['commit', '-m', 'Link a nested repository']);

        const tree = await historyGit.getCommittedTree(repoPath);

        expect(tree.files.map((file) => file.path)).toEqual(['module.txt']);
    });
});

describe('historyGit.getCommittedFile', () => {
    it('returns the committed text of a file', async () => {
        const repoPath = createRepoWithCommits(0);
        writeFileSync(join(repoPath, 'notes.txt'), 'note one\nnote two\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add notes']);

        const file = await historyGit.getCommittedFile(repoPath, 'notes.txt');

        expect(file).toMatchObject({ path: 'notes.txt', content: 'note one\nnote two\n', sizeBytes: 18 });
        expect(file.previewMessage).toBeUndefined();
    });

    it('serves an image as a data URL instead of text', async () => {
        const repoPath = createRepoWithCommits(0);
        writeFileSync(join(repoPath, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add a logo']);

        const file = await historyGit.getCommittedFile(repoPath, 'logo.png');

        expect(file.content).toBe('');
        expect(file.preview).toMatchObject({ kind: 'image' });
        expect(file.preview?.src).toMatch(/^data:image\/png;base64,/);
    });

    it('refuses a binary file with a message instead of content', async () => {
        const repoPath = createRepoWithCommits(0);
        writeFileSync(join(repoPath, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add a binary file']);

        const file = await historyGit.getCommittedFile(repoPath, 'blob.bin');

        expect(file.content).toBe('');
        expect(file.previewMessage).toBe('Binary file cannot be previewed.');
    });

    it('caps a file above the preview limit without reading it', async () => {
        const repoPath = createRepoWithCommits(0);
        writeFileSync(join(repoPath, 'huge.txt'), `${'x'.repeat(1024 * 1024 + 1)}\n`, 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add a large file']);

        const file = await historyGit.getCommittedFile(repoPath, 'huge.txt');

        expect(file.content).toBe('');
        expect(file.previewMessage).toBe('File too big to preview');
    });

    it('reads the version a named commit holds', async () => {
        const repoPath = createRepoWithCommits(0);
        writeFileSync(join(repoPath, 'notes.txt'), 'first\n', 'utf8');
        runGit(repoPath, ['add', '.']);
        runGit(repoPath, ['commit', '-m', 'Add notes']);
        const firstSha = runGit(repoPath, ['rev-parse', 'HEAD']);
        writeFileSync(join(repoPath, 'notes.txt'), 'second\n', 'utf8');
        runGit(repoPath, ['commit', '-am', 'Edit notes']);

        const file = await historyGit.getCommittedFile(repoPath, 'notes.txt', firstSha);

        expect(file.commitSha).toBe(firstSha);
        expect(file.content).toBe('first\n');
    });

    it('refuses a repository with no commits yet', async () => {
        await expect(historyGit.getCommittedFile(createRepoWithCommits(0), 'anything.txt')).rejects.toThrow('The repository does not have any commits yet.');
    });
});

describe('historyGit pagination bounds', () => {
    it('falls back to the default page for a limit that is not a number', async () => {
        const repoPath = createRepoWithCommits(80);

        const history = await historyGit.getRepoHistory(repoPath, { limit: Number.NaN });

        // The default page is 60, and the extra walk finds the one that makes `hasMore` true.
        expect(history.commits).toHaveLength(60);
        expect(history.hasMore).toBe(true);
    });

    it('never returns an empty page for a limit below one', async () => {
        const repoPath = createRepoWithCommits(3);

        expect((await historyGit.getRepoHistory(repoPath, { limit: 0 })).commits).toHaveLength(1);
        expect((await historyGit.getRepoHistory(repoPath, { limit: -5 })).commits).toHaveLength(1);
    });

    it('treats a negative skip as the first page', async () => {
        const repoPath = createRepoWithCommits(3);

        const history = await historyGit.getRepoHistory(repoPath, { limit: 2, skip: -10 });

        expect(history.commits.map((commit) => commit.summary)).toEqual(['Commit 2', 'Commit 1']);
    });
});

describe('historyGit tag refs', () => {
    it('reads the tags the ref decoration carries', async () => {
        const repoPath = createRepoWithCommits(2);
        const headSha = runGit(repoPath, ['rev-parse', 'HEAD']);
        runGit(repoPath, ['tag', 'v1.0.0']);
        runGit(repoPath, ['tag', '-a', 'v1.1.0', '-m', 'Release v1.1.0']);
        runGit(repoPath, ['tag', 'v1.2.0', 'HEAD~1']);

        const history = await historyGit.getRepoHistory(repoPath, { limit: 10 });

        expect(history.commits[0]?.sha).toBe(headSha);
        expect(history.commits[0]?.tags.map((tag) => tag.name).sort()).toEqual(['v1.0.0', 'v1.1.0']);
        expect(history.commits[0]?.tags.every((tag) => tag.isUnpushed)).toBe(true);
        expect(history.commits[1]?.tags.map((tag) => tag.name)).toEqual(['v1.2.0']);
    });
});
