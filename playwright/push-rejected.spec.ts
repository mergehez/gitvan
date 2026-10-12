import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** Every centered modal renders one dialog surface; this is the push prompt by its title. */
function pushRejectedModal(page: Page): Locator {
    return page.getByTestId('centered-modal-surface').filter({ hasText: 'Push rejected' });
}

async function startPush(page: Page): Promise<Locator> {
    await openSandboxRepo(page, 'push-rejected');

    await page.getByRole('button', { name: 'Push', exact: true }).click();

    const modal = pushRejectedModal(page);
    await expect(modal).toBeVisible();

    return modal;
}

test.describe('push rejected by the remote', () => {
    test('explains the rejection with the count the fetch found', async ({ page }) => {
        const modal = await startPush(page);

        await expect(modal).toContainText('Git refused the push');
        await expect(modal).toContainText('push-rejected');
        await expect(modal).toContainText('main');
        // The stale tracking ref says nothing is behind, so only the fetch the rejection triggers
        // can know about the incoming commit the dialog counts here.
        await expect(modal).toContainText('1 commit behind');
        await expect(modal.getByRole('button', { name: 'Pull' })).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Close' })).toBeVisible();
    });

    test('closing leaves the fetched commit in place', async ({ page }) => {
        const modal = await startPush(page);

        await modal.getByRole('button', { name: 'Close' }).click();
        await expect(modal).toBeHidden();

        // Nothing was merged, but the fetch made the incoming commit visible to Pull.
        await expect(page.getByRole('button', { name: 'Pull', exact: true })).toBeEnabled();
        await expect(page.getByTestId('file-tree-item-unstaged-notes.md')).toBeHidden();
    });

    test('pulling from the dialog merges the incoming commit and pushes again', async ({ page }) => {
        const modal = await startPush(page);

        await modal.getByRole('button', { name: 'Pull' }).click();

        await expect(page.getByText('Pull completed.')).toBeVisible();
        await expect(modal).toBeHidden();

        // The merge commit puts the branch ahead of origin again, so the push now goes through.
        await page.getByRole('button', { name: 'Push', exact: true }).click();
        await expect(page.getByText('Push completed.')).toBeVisible();
    });
});
