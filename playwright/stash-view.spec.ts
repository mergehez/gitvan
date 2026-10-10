import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** The pull-stash lab has an edited story.txt and an untracked scratch.txt for one stash. */
async function stashLocalChanges(page: Page): Promise<void> {
    await openSandboxRepo(page, 'pull-stash');
    await page.getByRole('button', { name: 'Pull', exact: true }).click();

    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: 'Pull blocked by local changes' });
    await modal.getByRole('button', { name: 'Stash changes and retry' }).click();
    await expect(page.getByText('Changes stashed. Pull completed.')).toBeVisible();
    await page.getByTestId('file-tree-item-stash@{0}').click();
}

function stashFile(page: Page, path: string): Locator {
    return page.getByTestId(`file-tree-item-${path}`);
}

test.describe('stash view', () => {
    test('previews a modified stashed file against the commit the stash was taken from', async ({ page }) => {
        await stashLocalChanges(page);

        await stashFile(page, 'story.txt').click();

        const diff = page.getByTestId('diffs-diff-editor-root');
        await expect(diff).toBeVisible();
        // The stashed side of the file, not an empty pane.
        await expect(diff).toContainText('Local working tree draft');
    });

    test('previews a stashed file the stash added on its own', async ({ page }) => {
        await stashLocalChanges(page);

        // A stash commit does not track a file it introduced; the diff has to read the untracked
        // commit instead, or this pane comes up empty.
        await stashFile(page, 'scratch.txt').click();

        const diff = page.getByTestId('diffs-diff-editor-root');
        await expect(diff).toBeVisible();
        await expect(diff).toContainText('Untracked lab note');
    });
});
