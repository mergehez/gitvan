import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** The deep-history lab is the only lab with several snapshots to switch between. */
async function openExplorer(page: Page) {
    await openSandboxRepo(page, 'deep-history');
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await expect(page.getByTestId('explorer-commit-select')).toBeVisible();
}

function commitOption(page: Page, summary: string): Locator {
    return page.getByTestId('explorer-commit-select').locator('option').filter({ hasText: summary });
}

async function selectSnapshot(page: Page, summary: string): Promise<void> {
    const value = await commitOption(page, summary).getAttribute('value');
    await page.getByTestId('explorer-commit-select').selectOption(value!);
}

function explorerRow(page: Page, path: string): Locator {
    return page.getByTestId(`file-tree-item-file:${path}`);
}

function snapshotOptions(page: Page): Locator {
    return page.getByTestId('explorer-commit-select').locator('option');
}

async function selectedSnapshotSha(page: Page): Promise<string> {
    return await page.getByTestId('explorer-commit-select').inputValue();
}

/** Monaco renders the committed text into its view lines. */
function previewText(page: Page): Locator {
    return page.locator('.monaco-editor .view-lines');
}

test.describe('explorer view', () => {
    test('previews the committed contents of the selected file', async ({ page }) => {
        await openExplorer(page);

        // The newest snapshot is selected, and its first file is previewed.
        await expect(page.getByTestId('explorer-file-title')).toHaveText('notes/note-01.txt');
        await expect(previewText(page)).toContainText('note 01');

        await explorerRow(page, 'notes/note-38.txt').click();

        await expect(page.getByTestId('explorer-file-title')).toHaveText('notes/note-38.txt');
        await expect(previewText(page)).toContainText('note 38');
    });

    test('switches the snapshot commit and shows the tree at that commit', async ({ page }) => {
        await openExplorer(page);
        await expect(explorerRow(page, 'README.md')).toBeHidden();

        await selectSnapshot(page, 'Remove every tracked file');

        // That commit deletes every file, so the tree and the pane both have nothing to show.
        await expect(page.getByText('No committed files found in this snapshot.')).toBeVisible();
        await expect(explorerRow(page, 'notes/note-01.txt')).toBeHidden();

        await selectSnapshot(page, 'Add notes/note-01.txt');

        // That older snapshot stops at the first note, so later files are not part of it.
        await expect(explorerRow(page, 'notes/note-01.txt')).toBeVisible();
        await expect(explorerRow(page, 'notes/note-38.txt')).toBeHidden();
        await expect(page.getByTestId('explorer-file-title')).toHaveText('notes/note-01.txt');
    });

    /**
     * In this layout the tree's own `<section>` is the scroll container, not an ancestor. The tree
     * used to render every row in that case, so a committed tree of a few hundred files froze the
     * whole app as soon as Explorer opened.
     */
    test('windows a long committed tree that scrolls in its own section', async ({ page }) => {
        await openSandboxRepo(page, 'wide-tree');
        await page.getByRole('button', { name: 'Explorer', exact: true }).click();
        await expect(page.getByTestId('file-tree-header-committed-tree')).toBeVisible();

        const tree = page.getByTestId('file-tree-header-committed-tree').locator('xpath=ancestor::section[1]');
        const explorerRows = tree.locator('[data-file-tree-row]');

        // 400 notes + the notes directory + README; only the viewport's window is mounted.
        await expect.poll(async () => explorerRows.count()).toBeLessThan(200);

        // The section is the scroller once the panel has its height; before that it reports the
        // height of its header, and a scroll offset set then is clamped back to zero.
        await expect.poll(() => tree.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(true);

        await tree.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });

        await expect(page.getByTestId('file-tree-item-file:notes/note-400.txt')).toBeVisible();
        await expect(page.getByTestId('file-tree-item-file:README.md')).toBeVisible();
        await expect.poll(async () => explorerRows.count()).toBeLessThan(200);
    });

    test('collapses a directory to hide the files inside it', async ({ page }) => {
        await openExplorer(page);
        await expect(explorerRow(page, 'notes/note-01.txt')).toBeVisible();

        await page.getByTestId('file-tree-item-dir:notes').click();

        await expect(explorerRow(page, 'notes/note-01.txt')).toBeHidden();
    });

    test('loads older commits so a snapshot beyond the first history page is selectable', async ({ page }) => {
        await openExplorer(page);

        // The picker starts on the newest page of history, which is all it can offer upfront.
        await expect(snapshotOptions(page)).toHaveCount(60);
        await expect(commitOption(page, 'Initial baseline')).toHaveCount(0);

        await page.getByTestId('explorer-load-more-snapshots').click();

        // The lab holds 70 commits, so the remaining ten arrive in one older page.
        await expect(snapshotOptions(page)).toHaveCount(70);
        await expect(page.getByTestId('explorer-load-more-snapshots')).toBeHidden();

        await selectSnapshot(page, 'Initial baseline');

        await expect(page.getByTestId('explorer-file-title')).toHaveText('README.md');
        // Switching snapshots remounts the editor, and Monaco briefly reports two line layers.
        await expect(previewText(page)).toHaveCount(1);
        await expect(previewText(page)).toContainText('Deep history lab');
    });

    test('keeps an older snapshot selected when the Explorer reloads', async ({ page }) => {
        await openExplorer(page);
        await page.getByTestId('explorer-load-more-snapshots').click();
        await selectSnapshot(page, 'Initial baseline');

        const olderSha = await selectedSnapshotSha(page);

        // Switching views and back reloads the Explorer data, which used to reset the picker to
        // the newest commit because the older one was outside the reloaded first page.
        await page.getByRole('button', { name: 'Changes', exact: true }).click();
        await expect(page.getByTestId('changes-view-menu')).toBeVisible();
        await page.getByRole('button', { name: 'Explorer', exact: true }).click();

        await expect(page.getByTestId('explorer-commit-select')).toBeVisible();
        await expect.poll(() => selectedSnapshotSha(page)).toBe(olderSha);
        await expect(commitOption(page, 'Initial baseline')).toHaveCount(1);
        await expect(page.getByTestId('explorer-file-title')).toHaveText('README.md');
    });
});
