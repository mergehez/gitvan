import type { Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** The empty lab is a repository that was created but never committed to. */
async function openEmptyRepo(page: Page) {
    await openSandboxRepo(page, 'empty');
}

function errorBanner(page: Page) {
    return page.locator('#app-error-banner p');
}

function repoStatus(page: Page) {
    return page.getByRole('button', { name: 'empty', exact: true }).locator('xpath=..');
}

test.describe('repository without commits', () => {
    test('lists the untracked file and reports a clean status', async ({ page }) => {
        await openEmptyRepo(page);

        await expect(page.getByTestId('file-tree-item-unstaged-README.md')).toBeVisible();

        // The branch is read before the first commit, and nothing about the repository is an error.
        await expect(page.getByTestId('toggle-branches-sidebar')).toContainText('main');
        await expect(repoStatus(page).getByTitle('Dirty')).toBeVisible();
        await expect(repoStatus(page).getByTitle('Error')).toBeHidden();
        await expect(errorBanner(page)).toBeHidden();
    });

    test('shows an empty history instead of failing the walk', async ({ page }) => {
        await openEmptyRepo(page);
        await page.getByRole('button', { name: 'History', exact: true }).click();

        await expect(page.getByTestId('history-search')).toBeVisible();
        await expect(page.getByText('No history found')).toBeVisible();
        await expect(errorBanner(page)).toBeHidden();
    });

    test('shows an empty explorer instead of failing the snapshot', async ({ page }) => {
        await openEmptyRepo(page);
        await page.getByRole('button', { name: 'Explorer', exact: true }).click();

        await expect(page.getByText('No commits found.')).toBeVisible();
        await expect(page.getByText('No committed files found')).toBeVisible();
        await expect(errorBanner(page)).toBeHidden();
    });
});
