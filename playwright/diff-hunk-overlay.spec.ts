import { expect, test } from '@playwright/test';
import { openSandboxRepo } from './support/sandbox';

test('keeps hunk action buttons aligned with their hunks while the diff scrolls', async ({ page }) => {
    await openSandboxRepo(page, 'partial-changes');

    const changedFileButton = page.locator('[data-testid="file-tree-item-unstaged-second.txt"]').first();
    await expect(changedFileButton).toBeVisible({ timeout: 5000 });
    await changedFileButton.click();
    await page.waitForTimeout(1000);

    const diffRoot = page.getByTestId('diffs-diff-editor-root');
    await expect(diffRoot).toBeVisible({ timeout: 5000 });

    const hunkButtons = diffRoot.locator('.gitvan-hunk-button');
    await expect(hunkButtons.first()).toBeVisible({ timeout: 8000 });

    const firstHunkButton = hunkButtons.first();
    const boxBeforeScroll = await firstHunkButton.boundingBox();
    const scrollBefore = await diffRoot.evaluate((element) => element.scrollTop);
    expect(boxBeforeScroll).not.toBeNull();

    await diffRoot.evaluate((element) => {
        element.scrollTop += 800;
    });
    await page.waitForTimeout(500);

    const scrollAfter = await diffRoot.evaluate((element) => element.scrollTop);
    const boxAfterScroll = await firstHunkButton.boundingBox();
    expect(boxAfterScroll).not.toBeNull();

    // The diff really moved...
    expect(scrollAfter - scrollBefore).toBeGreaterThan(400);
    // ...and the hunk overlay moved with it instead of staying pinned to the viewport.
    expect(boxBeforeScroll!.y - boxAfterScroll!.y).toBeGreaterThan(300);
    await expect(hunkButtons.first()).toBeAttached();
});
