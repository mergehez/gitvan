import type { Locator, Page } from '@playwright/test';
import { changeRow, runChangeRowAction } from './support/changes';
import { expect, openSandboxRepo, test } from './support/sandbox';

async function openChangesView(page: Page) {
    await openSandboxRepo(page, 'partial-changes');
    await expect(page.getByTestId('commit-summary-input')).toBeVisible();
}

function fileFilter(page: Page): Locator {
    return page.getByPlaceholder('Search files...');
}

async function openViewMenuAction(page: Page, label: string): Promise<void> {
    await page.getByTestId('changes-view-menu').click();

    const entry = page.getByRole('menuitem', { name: label, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
}

test.describe('changes view chrome', () => {
    test('opens the file filter with Cmd+F and narrows the list', async ({ page }) => {
        await openChangesView(page);
        await expect(fileFilter(page)).toBeHidden();

        await page.keyboard.press('Meta+f');
        await expect(fileFilter(page)).toBeVisible();

        await fileFilter(page).fill('second');

        await expect(changeRow(page, 'unstaged', 'second.txt')).toBeVisible();
        await expect(changeRow(page, 'unstaged', 'first.txt')).toBeHidden();
        await expect(changeRow(page, 'unstaged', 'untracked.txt')).toBeHidden();
    });

    test('shows the no-files-match state for a filter nothing matches', async ({ page }) => {
        await openChangesView(page);
        await page.keyboard.press('Meta+f');

        await fileFilter(page).fill('nothing-matches-this');

        // The staged and unstaged sections each report the filter.
        await expect(page.getByText('No files match the search')).toHaveCount(2);
    });

    test('shows and hides the file filter from the view menu', async ({ page }) => {
        await openChangesView(page);

        await openViewMenuAction(page, 'Show Search Bar');
        await expect(fileFilter(page)).toBeVisible();

        await openViewMenuAction(page, 'Hide Search Bar');
        await expect(fileFilter(page)).toBeHidden();
    });

    test('sorts the files from the view menu', async ({ page }) => {
        await openChangesView(page);

        const rows = page.locator('[data-testid^="file-tree-item-unstaged-"]');

        await page.getByTestId('changes-view-menu').click();
        await page.getByRole('menuitem', { name: 'Sort by' }).click();
        await page.getByRole('menuitem', { name: 'Z-A', exact: true }).click();

        await expect(rows.nth(0)).toHaveAttribute('data-testid', 'file-tree-item-unstaged-untracked.txt');
        await expect(rows.nth(1)).toHaveAttribute('data-testid', 'file-tree-item-unstaged-stub.txt');
        await expect(rows.nth(2)).toHaveAttribute('data-testid', 'file-tree-item-unstaged-second.txt');
    });

    test('copies the file path and the relative file path', async ({ page }) => {
        await openChangesView(page);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Copy File Path');

        await expect(page.getByText('File path copied.')).toBeVisible();
        const absolutePath = await page.evaluate(() => navigator.clipboard.readText());
        expect(absolutePath.endsWith('/second.txt')).toBe(true);

        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Copy Relative File Path');

        await expect(page.getByText('Relative path copied.')).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('second.txt');
    });

    test('locks a file so the staging actions disappear', async ({ page }) => {
        await openChangesView(page);

        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Lock file (disable staging)');

        // The row now offers to unlock instead, and the staging actions are gone.
        await changeRow(page, 'unstaged', 'second.txt').click({ button: 'right' });
        await expect(page.getByRole('menuitem', { name: 'Unlock file (enable staging)', exact: true })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Stage File', exact: true })).toBeHidden();
    });

    test('ignores a file and drops it from the changes list', async ({ page }) => {
        await openChangesView(page);

        await runChangeRowAction(page, 'unstaged', 'untracked.txt', 'Ignore...');
        await page.getByRole('menuitem', { name: 'untracked.txt', exact: true }).click();

        await expect(page.getByText('Ignore rule added to .gitignore.')).toBeVisible();
        await expect(changeRow(page, 'unstaged', 'untracked.txt')).toBeHidden();
    });

    test('offers the external editors in the Open with submenu', async ({ page }) => {
        await openChangesView(page);

        await changeRow(page, 'unstaged', 'second.txt').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Open with...', exact: true }).click();

        // No editor is configured for a fresh run, so the picker is the only entry.
        await expect(page.getByRole('menuitem', { name: 'Pick Program', exact: true })).toBeVisible();
    });
});
