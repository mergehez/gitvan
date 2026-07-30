import { expect, test } from '@playwright/test';

test.describe('partial hunk actions', () => {
    // test.setTimeout(10_000);

    async function resetSandboxAndOpenRepo(page: any) {
        await page.goto('/');
        await page.waitForTimeout(500);

        // Reset sandbox repos via the hidden button (fires async reset)
        await page.evaluate(() => {
            const btn = document.querySelector('#hidden-reset-sandboxes') as HTMLButtonElement;
            if (btn) btn.click();
        });

        // Wait for sandbox repos to be registered
        await page.waitForTimeout(3000);
        await ensureRepoOpen(page);
    }
    async function ensureRepoOpen(page: any) {
        await page.goto('/');
        await page.waitForTimeout(500);

        // Open the partial-changes repo (the folder property in app.ts)
        const repoBtn = page.getByRole('button', { name: /^partial-changes$/i }).first();
        await expect(repoBtn).toBeVisible({ timeout: 5000 });
        await repoBtn.click({ force: true });
        await page.waitForTimeout(1000);
    }

    async function getError(page: any) {
        const errorBanner = page.locator('#app-error-banner p');
        return (await errorBanner.isVisible()) ? await errorBanner.textContent() : '';
    }

    async function getHunkButtons(diffRoot: any) {
        const hunkButtons = diffRoot.locator('.gitvan-hunk-button');
        const initialCount = await hunkButtons.count();
        return {
            get: (index: number) => hunkButtons.nth(index),
            async getDataHunkPatch(index: number) {
                return (await hunkButtons.nth(index).getAttribute('data-hunk-patch')).split('\n').slice(5).join('\n');
            },
            initialCount,
            getCount: async () => await hunkButtons.count(),
        };
    }

    function getFile(page: any, section: 'staged' | 'unstaged', fileName: string) {
        return page.locator(`[data-testid="file-tree-item-${section}-${fileName}"]`).first();
    }

    test('reset sandboxes button works', async ({ page }) => {
        await resetSandboxAndOpenRepo(page);
    });

    test('shows hunk action buttons for unstaged file', async ({ page }) => {
        await ensureRepoOpen(page);

        // Click on the unstaged file
        const unstagedFile = getFile(page, 'unstaged', 'second.txt');
        await expect(unstagedFile).toBeVisible({ timeout: 5000 });
        await unstagedFile.click();
        await page.waitForTimeout(500);

        // The diff editor should be visible
        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 5000 });

        // Wait for hunk buttons to appear inside the shadow DOM
        const hunkButtons = diffRoot.locator('.gitvan-hunk-button');
        await expect(hunkButtons.first()).toBeVisible({ timeout: 8000 });

        // Count hunk buttons — should be at least 3 (modify, delete, add)
        const btnCount = await hunkButtons.count();
        expect(btnCount).toBeGreaterThanOrEqual(3);
    });

    test('hovering a hunk button shows the action popover', async ({ page }) => {
        await ensureRepoOpen(page);

        // Open unstaged file
        const unstagedFile = getFile(page, 'unstaged', 'second.txt');
        await expect(unstagedFile).toBeVisible({ timeout: 5000 });
        await unstagedFile.click();
        await page.waitForTimeout(1000);

        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 5000 });

        // Hover the first hunk button
        const hunkButton = diffRoot.locator('.gitvan-hunk-button').first();
        await expect(hunkButton).toBeVisible({ timeout: 8000 });
        await hunkButton.hover();
        await page.waitForTimeout(500);

        // The actions popover should appear inside the shadow DOM
        const actionsPopover = diffRoot.locator('.gitvan-hunk-actions');
        await expect(actionsPopover).toBeVisible({ timeout: 3000 });
    });

    test('stages a single hunk from the unstaged file', async ({ page }) => {
        await ensureRepoOpen(page);

        const unstagedFile = getFile(page, 'unstaged', 'second.txt');
        await expect(unstagedFile).toBeVisible({ timeout: 5000 });
        await unstagedFile.click();
        await page.waitForTimeout(1000);

        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 5000 });

        const hunkButtons = await getHunkButtons(diffRoot);

        // Hover first hunk button to reveal actions
        const hunkButton = hunkButtons.get(0);
        await expect(hunkButton).toBeVisible({ timeout: 8000 });
        await hunkButton.hover();
        await page.waitForTimeout(500);

        // Click "Stage Change" in the popover
        const stageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /stage change/i });
        await expect(stageBtn).toBeVisible({ timeout: 3000 });
        await stageBtn.click();
        await page.waitForTimeout(2000);

        expect(await getError(page)).toBeFalsy();

        // After staging one hunk, the unstaged diff should have fewer hunks
        expect(await hunkButtons.getCount()).toBe(hunkButtons.initialCount - 1);
    });

    test('discards a single hunk from the unstaged file', async ({ page }) => {
        await ensureRepoOpen(page);

        const unstagedFile = getFile(page, 'unstaged', 'second.txt');
        await expect(unstagedFile).toBeVisible({ timeout: 5000 });
        await unstagedFile.click();
        await page.waitForTimeout(1000);

        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 5000 });

        const hunkButtons = await getHunkButtons(diffRoot);

        // Hover second hunk button to reveal actions
        const hunkButton = hunkButtons.get(1);
        await expect(hunkButton).toBeVisible({ timeout: 8000 });
        await hunkButton.hover();
        await page.waitForTimeout(500);

        // Click "Discard Change"
        const discardBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /discard change/i });
        await expect(discardBtn).toBeVisible({ timeout: 3000 });
        await discardBtn.click();
        await page.waitForTimeout(2000);

        expect(await getError(page)).toBeFalsy();

        // After discarding one hunk, the remaining count should decrease
        expect(await hunkButtons.getCount()).toBe(hunkButtons.initialCount - 1);
    });

    test('unstages a single hunk from the staged file', async ({ page }) => {
        await ensureRepoOpen(page);

        // Open the staged file
        const stagedFile = getFile(page, 'staged', 'first.txt');
        await expect(stagedFile).toBeVisible({ timeout: 5000 });
        await stagedFile.click();
        await page.waitForTimeout(1000);

        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 5000 });

        const hunkButtons = await getHunkButtons(diffRoot);
        const initialCount = hunkButtons.initialCount;
        const getCount = hunkButtons.getCount;

        // Hover first hunk button to reveal actions
        const hunkButton = hunkButtons.get(0);
        await expect(hunkButton).toBeVisible({ timeout: 8000 });
        await hunkButton.hover();
        await page.waitForTimeout(500);

        // Click "Unstage Change"
        const unstageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /unstage change/i });
        await expect(unstageBtn).toBeVisible({ timeout: 3000 });
        await unstageBtn.click();
        await page.waitForTimeout(2000);

        expect(await getError(page)).toBeFalsy();

        // After unstaging one hunk, the staged diff should have fewer hunks
        expect(await getCount()).toBe(initialCount - 1);
    });

    test('stages the second and fourth hunks, then unstages the last hunk from the staged file', async ({ page }) => {
        await resetSandboxAndOpenRepo(page);

        // ── Step 1: Stage the second and fourth hunks from unstaged.txt ──
        const unstagedFile = getFile(page, 'unstaged', 'stub.txt');
        await expect(unstagedFile).toBeVisible({ timeout: 5000 });
        await unstagedFile.click();
        await page.waitForTimeout(1000);

        let diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 5000 });

        // --- Stage the 2nd hunk (index 1) ---
        let unstagedHunks = await getHunkButtons(diffRoot);
        let unstagedCount = unstagedHunks.initialCount;

        const fourthHunkPatch = await unstagedHunks.getDataHunkPatch(3);
        expect(fourthHunkPatch).toBeTruthy();

        const secondHunk = unstagedHunks.get(1);
        await expect(secondHunk).toBeVisible({ timeout: 8000 });
        await secondHunk.hover();
        await page.waitForTimeout(500);

        let stageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /stage change/i });
        await expect(stageBtn).toBeVisible({ timeout: 3000 });
        await stageBtn.click();
        await page.waitForTimeout(2000);

        expect(await getError(page)).toBeFalsy();
        expect(await unstagedHunks.getCount()).toBe(unstagedCount - 1);

        // --- Stage the 4th hunk (now at index 2, since 2nd was removed) ---
        unstagedHunks = await getHunkButtons(diffRoot);
        unstagedCount = unstagedHunks.initialCount;

        const fourthHunk = unstagedHunks.get(2);
        await expect(fourthHunk).toBeVisible({ timeout: 8000 });
        const fourthHunkPatchAfter = await unstagedHunks.getDataHunkPatch(2);
        expect(fourthHunkPatchAfter).toBeTruthy();
        await expect(fourthHunkPatchAfter).toBe(fourthHunkPatch);
        await fourthHunk.hover();
        await page.waitForTimeout(500);

        stageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /stage change/i });
        await expect(stageBtn).toBeVisible({ timeout: 3000 });
        await stageBtn.click();
        await page.waitForTimeout(2000);

        expect(await getError(page)).toBeFalsy();
        expect(await unstagedHunks.getCount()).toBe(unstagedCount - 1);

        // ── Step 2: Now open the staged file and unstage the last hunk ──
        const stagedFile = getFile(page, 'staged', 'stub.txt');
        await expect(stagedFile).toBeVisible({ timeout: 5000 });
        await stagedFile.click();
        await page.waitForTimeout(1000);

        diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 5000 });

        const stagedHunks = await getHunkButtons(diffRoot);
        const stagedInitialCount = stagedHunks.initialCount;
        expect(stagedInitialCount).toBe(2);

        // Hover the last hunk button and click "Unstage Change"
        const lastHunk = stagedHunks.get(stagedInitialCount - 1);
        await expect(lastHunk).toBeVisible({ timeout: 8000 });
        await lastHunk.hover();
        await page.waitForTimeout(500);

        const unstageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /unstage change/i });
        await expect(unstageBtn).toBeVisible({ timeout: 3000 });
        await unstageBtn.click();
        await page.waitForTimeout(2000);

        expect(await getError(page)).toBeFalsy();

        // After unstaging the last hunk, the staged file should remain with 1 hunk
        // Verify by checking the staged file still has one hunk
        expect(await stagedHunks.getCount()).toBe(stagedInitialCount - 1);

        // let's also discard a hunk from the unstaged file to ensure it works after staging/unstaging
        const unstagedFile2 = getFile(page, 'unstaged', 'stub.txt');
        await expect(unstagedFile2).toBeVisible({ timeout: 5000 });
        await unstagedFile2.click();
        await page.waitForTimeout(1000);

        diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 5000 });

        const unstagedHunks2 = await getHunkButtons(diffRoot);
        const unstagedCount2 = unstagedHunks2.initialCount;

        // Hover the first hunk button and click "Discard Change"
        const toDiscard = unstagedHunks2.get(5);
        await expect(toDiscard).toBeVisible({ timeout: 8000 });
        await toDiscard.hover();
        await page.waitForTimeout(500);

        const discardBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /discard change/i });
        await expect(discardBtn).toBeVisible({ timeout: 3000 });
        await discardBtn.click();
        await page.waitForTimeout(2000);

        expect(await getError(page)).toBeFalsy();
        expect(await unstagedHunks2.getCount()).toBe(unstagedCount2 - 1);
    });
});
