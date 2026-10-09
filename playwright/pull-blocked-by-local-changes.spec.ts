import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** Every centered modal renders one dialog surface; this is the pull prompt by its title. */
function pullBlockedModal(page: Page): Locator {
    return page.getByTestId('centered-modal-surface').filter({ hasText: 'Pull blocked by local changes' });
}

async function startPull(page: Page, lab: string): Promise<Locator> {
    await openSandboxRepo(page, lab);

    await page.getByRole('button', { name: 'Pull', exact: true }).click();

    const modal = pullBlockedModal(page);
    await expect(modal).toBeVisible();

    return modal;
}

test.describe('pull blocked by local changes', () => {
    test('lists the files that stand in the way', async ({ page }) => {
        const modal = await startPull(page, 'pull-conflict');

        await expect(modal).toContainText('Git cannot pull yet');
        await expect(modal).toContainText('pull-conflict');
        await expect(modal).toContainText('story.txt');
        await expect(modal.getByRole('button', { name: 'Stash changes and retry' })).toBeVisible();
    });

    test('cancelling leaves the working tree alone', async ({ page }) => {
        const modal = await startPull(page, 'pull-conflict');

        await modal.getByRole('button', { name: 'Cancel' }).click();
        await expect(modal).toBeHidden();

        // The pull never ran: the local edits are still there and nothing was stashed.
        await expect(page.getByTestId('file-tree-item-unstaged-story.txt')).toBeVisible();
        await expect(page.getByTestId('file-tree-item-stash@{0}')).toBeHidden();
    });

    test('stash and retry completes the pull when the edits merge cleanly', async ({ page }) => {
        const modal = await startPull(page, 'pull-stash');

        await modal.getByRole('button', { name: 'Stash changes and retry' }).click();

        await expect(page.getByText('Changes stashed. Pull completed.')).toBeVisible();
        await expect(modal).toBeHidden();

        // The stashed edits are kept so they can be restored onto the pulled branch.
        await expect(page.getByTestId('file-tree-item-stash@{0}')).toBeVisible();
    });

    test('stash and retry stops on a merge conflict and keeps the stash', async ({ page }) => {
        const modal = await startPull(page, 'pull-conflict');

        await modal.getByRole('button', { name: 'Stash changes and retry' }).click();

        await expect(page.getByText(/Changes stashed\. Pull stopped with merge conflicts in \d+ files?; the stash entry was kept\./)).toBeVisible();

        // The retried pull leaves the resolver open on the conflicted file.
        await expect(page.getByTestId('merge-conflict-modal')).toBeVisible();
        await expect(page.getByTestId('merge-conflict-file-story.txt')).toBeVisible();

        // Keeping the stash is what makes the stashed edits recoverable after the conflict.
        await expect(page.getByTestId('file-tree-item-stash@{0}')).toBeVisible();
    });
});
