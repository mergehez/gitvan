import { expect, test } from '@playwright/test';

test('shows a hunk action trigger after scrolling lower in the diff view', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Gitvan/i);

    const repoButton = page.getByRole('button', { name: /^gitvan$/i }).first();
    await expect(repoButton).toBeVisible();
    await repoButton.click();

    const changedFileButton = page.getByRole('button', { name: /VLoading\.ts/i }).first();
    await page.waitForTimeout(250);
    await expect(changedFileButton).toBeVisible();
    await changedFileButton.click();

    const diffRoot = page.getByTestId('diffs-diff-editor-root');
    await expect(diffRoot).toBeVisible();

    const firstTriggerBox = await page.getByTestId('diff-hunk-action-trigger').first().boundingBox();
    expect(firstTriggerBox).not.toBeNull();

    const diffBox = await diffRoot.boundingBox();
    expect(diffBox).not.toBeNull();

    // Scroll inside the additions column using mouse wheel to trigger Diffs virtual rendering
    const scrollX = diffBox!.x + diffBox!.width / 2;
    const scrollY = diffBox!.y + diffBox!.height - 10;
    await page.mouse.move(scrollX, scrollY);
    await page.mouse.wheel(0, 5000);

    await page.waitForTimeout(1000);

    const triggerLocator = page.getByTestId('diff-hunk-action-trigger');
    const triggerCount = await triggerLocator.count();
    expect(triggerCount).toBeGreaterThan(0);

    const allTriggerBoxes: number[] = [];
    for (let i = 0; i < triggerCount; i += 1) {
        const box = await triggerLocator.nth(i).boundingBox();
        if (box) allTriggerBoxes.push(box.y + box.height / 2);
    }
    allTriggerBoxes.sort((a, b) => a - b);

    const firstMidY = firstTriggerBox!.y + firstTriggerBox!.height / 2;
    const newTriggerBelowFirst = allTriggerBoxes.some((midY) => midY > firstMidY + 20);
    expect(newTriggerBelowFirst).toBe(true);
});
