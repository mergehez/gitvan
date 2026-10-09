import type { Locator, Page } from '@playwright/test';
import { confirmPopover } from './support/confirmation';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** Commit rows are the history tree entries, whose ids are commit shas. */
function commitRows(page: Page) {
    return page.getByTestId(/^file-tree-item-[0-9a-f]{7,40}$/);
}

/** The deep-history lab has more commits than one page, and older commits for a snapshot. */
async function openHistory(page: Page, lab = 'deep-history') {
    await openSandboxRepo(page, lab);
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByTestId('history-search')).toBeVisible();
    await expect(commitRows(page).first()).toBeVisible();
}

async function openCommitMenuAction(page: Page, row: Locator, label: string): Promise<void> {
    await row.click({ button: 'right' });

    const entry = page.getByRole('menuitem', { name: label, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
}

test.describe('history depth', () => {
    test('searches the commit messages and restores the full list', async ({ page }) => {
        await openHistory(page);
        await expect(commitRows(page)).toHaveCount(60);

        await page.getByTestId('history-search').fill('early-07');

        await expect(commitRows(page)).toHaveCount(1);
        await expect(commitRows(page).first()).toContainText('Add early/early-07.txt');

        await page.getByTestId('history-search').fill('');

        await expect(commitRows(page)).toHaveCount(60);
    });

    test('loads the rest of the history from the footer', async ({ page }) => {
        await openHistory(page);
        await expect(commitRows(page)).toHaveCount(60);

        await page.getByTestId('history-load-more').getByRole('button').click();

        await expect(commitRows(page)).toHaveCount(70);
        await expect(page.getByTestId('history-load-more')).toBeHidden();
    });

    test('selects a commit and one of its files to inspect', async ({ page }) => {
        await openHistory(page, 'partial-changes');

        // The only commit is selected on load, so its files are listed beside it.
        await page.getByTestId('file-tree-item-first.txt').first().click();

        await expect(page.getByTestId('diff-viewer-title')).toHaveText('first.txt');
        await expect(page.getByTestId('diffs-diff-editor-root')).toBeVisible();
    });

    test('pins the file history for a commit file and goes back', async ({ page }) => {
        await openHistory(page, 'partial-changes');

        await page.getByTestId('file-tree-item-first.txt').first().click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'File History', exact: true }).click();

        await expect(page.getByTestId('file-history-header')).toContainText('first.txt');

        // Following renames replaces the button with the badge that says it is on.
        await page.getByTestId('file-history-include-renames').click();
        await expect(page.getByText('renames', { exact: true })).toBeVisible();

        await page.getByTestId('file-history-back').click();
        await expect(page.getByTestId('history-search')).toBeVisible();
    });

    test('amends the latest unpushed commit from its row', async ({ page }) => {
        await openHistory(page, 'partial-changes');

        const row = commitRows(page).first();
        await row.hover();
        await page.getByTestId('history-amend-latest').click();

        // Amend takes over the changes view with the commit's message loaded.
        await expect(page.getByText('Amending the latest unpushed commit')).toBeVisible();
        await expect(page.getByTestId('commit-summary-input')).toHaveValue('Initial baseline');
    });

    test('undoes the latest commit and stages its changes', async ({ page }) => {
        await openHistory(page);

        const latest = commitRows(page).first();
        await expect(latest).toContainText('Add notes/note-38.txt');

        await latest.hover();
        await page.getByTestId('history-undo-latest').click();
        await confirmPopover(page);

        await expect(page.getByText('Last commit undone. Changes are staged.')).toBeVisible();
        await expect(commitRows(page).first()).toContainText('Add notes/note-37.txt');

        // undo resets softly, so the undone file is a staged change in the changes view.
        await page.getByRole('button', { name: 'Changes', exact: true }).click();
        await expect(page.getByTestId('file-tree-item-staged-notes/note-38.txt')).toBeVisible();
    });

    test('adds a tag from the commit context menu', async ({ page }) => {
        await openHistory(page, 'partial-changes');

        await openCommitMenuAction(page, commitRows(page).first(), 'Add Tag...');

        const nameInput = page.locator('#create-tag-name');
        await expect(nameInput).toBeVisible();
        await nameInput.fill('v-from-history');
        await page.getByRole('button', { name: 'Create Tag' }).click();

        await expect(page.getByText('Tag "v-from-history" created.')).toBeVisible();
        // The badge sits beside the row button, not inside it.
        await expect(commitRows(page).first().locator('xpath=..').getByText('v-from-history', { exact: true })).toBeVisible();
    });
});
