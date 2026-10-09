import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

test.describe('partial hunk actions', () => {
    async function expectNoErrorBanner(page: Page) {
        await expect(page.locator('#app-error-banner p')).toBeHidden();
    }

    async function waitForStableCount(locator: Locator): Promise<number> {
        let previous = -1;

        // Hunk buttons are appended as the diff renders, so a single count is a moving target.
        await expect
            .poll(async () => {
                const current = await locator.count();
                const settled = current > 0 && current === previous;
                previous = current;
                return settled;
            })
            .toBe(true);

        return await locator.count();
    }

    async function getHunkButtons(diffRoot: Locator) {
        const hunkButtons = diffRoot.locator('.gitvan-hunk-button');
        await expect(hunkButtons.first()).toBeVisible();

        return {
            locator: hunkButtons,
            get: (index: number) => hunkButtons.nth(index),
            async getDataHunkPatch(index: number) {
                const patch = await hunkButtons.nth(index).getAttribute('data-hunk-patch');
                return (patch ?? '').split('\n').slice(5).join('\n');
            },
            count: await waitForStableCount(hunkButtons),
        };
    }

    function getFile(page: Page, section: 'staged' | 'unstaged', fileName: string) {
        return page.locator(`[data-testid="file-tree-item-${section}-${fileName}"]`).first();
    }

    async function openFile(page: Page, section: 'staged' | 'unstaged', fileName: string): Promise<Locator> {
        const file = getFile(page, section, fileName);
        await expect(file).toBeVisible();
        await file.click();

        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible();

        return diffRoot;
    }

    test('reset sandboxes button works', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
    });

    test('shows hunk action buttons for unstaged file', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        const diffRoot = await openFile(page, 'unstaged', 'second.txt');

        // Modify, delete and add hunks are all present in this lab's file.
        expect((await getHunkButtons(diffRoot)).count).toBeGreaterThanOrEqual(3);
    });

    test('hovering a hunk button shows the action popover', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        const diffRoot = await openFile(page, 'unstaged', 'second.txt');
        const hunkButton = (await getHunkButtons(diffRoot)).get(0);

        await hunkButton.hover();

        await expect(diffRoot.locator('.gitvan-hunk-actions')).toBeVisible();
    });

    test('stages a single hunk from the unstaged file', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        const diffRoot = await openFile(page, 'unstaged', 'second.txt');
        const hunkButtons = await getHunkButtons(diffRoot);

        await hunkButtons.get(0).hover();
        const stageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /stage change/i });
        await expect(stageBtn).toBeVisible();
        await stageBtn.click();

        await expectNoErrorBanner(page);
        await expect(hunkButtons.locator).toHaveCount(hunkButtons.count - 1);
    });

    test('discards a single hunk from the unstaged file', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        const diffRoot = await openFile(page, 'unstaged', 'second.txt');
        const hunkButtons = await getHunkButtons(diffRoot);

        await hunkButtons.get(1).hover();
        const discardBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /discard change/i });
        await expect(discardBtn).toBeVisible();
        await discardBtn.click();

        await expectNoErrorBanner(page);
        await expect(hunkButtons.locator).toHaveCount(hunkButtons.count - 1);
    });

    test('unstages a single hunk from the staged file', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        const diffRoot = await openFile(page, 'staged', 'first.txt');
        const hunkButtons = await getHunkButtons(diffRoot);

        await hunkButtons.get(0).hover();
        const unstageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /unstage change/i });
        await expect(unstageBtn).toBeVisible();
        await unstageBtn.click();

        await expectNoErrorBanner(page);
        await expect(hunkButtons.locator).toHaveCount(hunkButtons.count - 1);
    });

    test('stages the second and fourth hunks, then unstages the last hunk from the staged file', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        // ── Step 1: stage the second and fourth hunks of stub.txt ──
        let diffRoot = await openFile(page, 'unstaged', 'stub.txt');
        let unstagedHunks = await getHunkButtons(diffRoot);
        const fourthHunkPatch = await unstagedHunks.getDataHunkPatch(3);
        expect(fourthHunkPatch).toBeTruthy();

        await unstagedHunks.get(1).hover();
        let stageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /stage change/i });
        await expect(stageBtn).toBeVisible();
        await stageBtn.click();

        await expectNoErrorBanner(page);
        await expect(unstagedHunks.locator).toHaveCount(unstagedHunks.count - 1);

        // ── The fourth hunk is now at index 2, because the second one was staged away ──
        unstagedHunks = await getHunkButtons(diffRoot);
        const fourthHunkPatchAfter = await unstagedHunks.getDataHunkPatch(2);
        expect(fourthHunkPatchAfter).toBe(fourthHunkPatch);

        await unstagedHunks.get(2).hover();
        stageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /stage change/i });
        await expect(stageBtn).toBeVisible();
        await stageBtn.click();

        await expectNoErrorBanner(page);
        await expect(unstagedHunks.locator).toHaveCount(unstagedHunks.count - 1);

        // ── Step 2: unstage the last hunk of the staged file ──
        diffRoot = await openFile(page, 'staged', 'stub.txt');
        const stagedHunks = await getHunkButtons(diffRoot);
        expect(stagedHunks.count).toBe(2);

        await stagedHunks.get(stagedHunks.count - 1).hover();
        const unstageBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /unstage change/i });
        await expect(unstageBtn).toBeVisible();
        await unstageBtn.click();

        await expectNoErrorBanner(page);
        await expect(stagedHunks.locator).toHaveCount(1);

        // ── Step 3: discarding still works after the staging round-trip ──
        diffRoot = await openFile(page, 'unstaged', 'stub.txt');
        const unstagedHunks2 = await getHunkButtons(diffRoot);

        await unstagedHunks2.get(5).hover();
        const discardBtn = diffRoot.locator('.gitvan-hunk-actions button').filter({ hasText: /discard change/i });
        await expect(discardBtn).toBeVisible();
        await discardBtn.click();

        await expectNoErrorBanner(page);
        await expect(unstagedHunks2.locator).toHaveCount(unstagedHunks2.count - 1);
    });
});
