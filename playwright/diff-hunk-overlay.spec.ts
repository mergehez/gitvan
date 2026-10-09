import { expect, openSandboxRepo, test } from './support/sandbox';

test('keeps hunk action buttons aligned with their hunks while the diff scrolls', async ({ page }) => {
    await openSandboxRepo(page, 'partial-changes');

    const changedFileButton = page.locator('[data-testid="file-tree-item-unstaged-second.txt"]').first();
    await expect(changedFileButton).toBeVisible();
    await changedFileButton.click();

    const diffRoot = page.getByTestId('diffs-diff-editor-root');
    await expect(diffRoot).toBeVisible();

    const firstHunkButton = diffRoot.locator('.gitvan-hunk-button').first();
    await expect(firstHunkButton).toBeVisible();

    const boxBeforeScroll = await firstHunkButton.boundingBox();
    const scrollBefore = await diffRoot.evaluate((element) => element.scrollTop);
    expect(boxBeforeScroll).not.toBeNull();

    await diffRoot.evaluate((element) => {
        element.scrollTop += 800;
    });

    // The diff really moved...
    await expect.poll(async () => (await diffRoot.evaluate((element) => element.scrollTop)) - scrollBefore).toBeGreaterThan(400);

    // ...and the overlay followed it instead of staying pinned to the viewport. Waiting on the
    // moved position is what the old fixed sleep was standing in for.
    const movedBy = async () => boxBeforeScroll!.y - ((await firstHunkButton.boundingBox())?.y ?? boxBeforeScroll!.y);
    await expect.poll(movedBy).toBeGreaterThan(300);

    await expect(firstHunkButton).toBeAttached();
});
