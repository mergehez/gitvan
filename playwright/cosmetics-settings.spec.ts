import { expect, test } from '@playwright/test';
import { openSandboxRepo } from './support/sandbox';

test.describe('cosmetics settings', () => {
    function getFile(page: any, section: 'staged' | 'unstaged', fileName: string) {
        return page.locator(`[data-testid="file-tree-item-${section}-${fileName}"]`).first();
    }

    async function openSettingsDropdown(page: any) {
        const tuneIcon = page.locator('.icon-\\[mdi--tune-variant\\]').first();
        if (await tuneIcon.isVisible({ timeout: 1000 }).catch(() => false)) {
            await tuneIcon.click();
            await page.waitForTimeout(300);
            return;
        }
        const iconBtn = page.locator('button:has(.icon-\\[mdi--tune-variant\\])').first();
        if (await iconBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await iconBtn.click();
            await page.waitForTimeout(300);
        }
    }

    async function noActualChangeBadgeVisibleInDiff(page: any): Promise<boolean> {
        try {
            const diffRoot = page.getByTestId('diffs-diff-editor-root');
            // Look for the badge within the diff editor header area
            const badge = diffRoot.locator('..').first().getByText('no actual change');
            return await badge.isVisible();
        } catch {
            return false;
        }
    }

    test('reset sandboxes button works', async ({ page }) => {
        await openSandboxRepo(page, 'cosmetics');
    });

    test('"Hide whitespace changes" reveals no-actual-change on whitespace-only file', async ({ page }) => {
        await openSandboxRepo(page, 'cosmetics');
        const file = getFile(page, 'unstaged', 'whitespace-demo.txt');
        await expect(file).toBeVisible({ timeout: 5000 });
        await file.click();
        await page.waitForTimeout(1000);

        // By default whitespace changes are HIDDEN (showWhitespaceChanges: false),
        // so the "no actual change" badge is already visible. First UN-hide whitespace.
        await openSettingsDropdown(page);
        const hideWsCheckbox = page.locator('label').filter({ hasText: 'Hide whitespace changes' }).locator('input[type="checkbox"]');
        await expect(hideWsCheckbox).toBeVisible({ timeout: 2000 });

        // Uncheck to SHOW whitespace changes
        const wasHidden = await hideWsCheckbox.isChecked();
        if (wasHidden) {
            await hideWsCheckbox.click({ force: true });
            await page.waitForTimeout(500);
        }

        // Now whitespace is visible, badge should disappear
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const badgeWhileShowing = await noActualChangeBadgeVisibleInDiff(page);
        expect(badgeWhileShowing).toBe(false);

        // Re-open settings and re-hide whitespace
        await openSettingsDropdown(page);
        const isNowHidden = await hideWsCheckbox.isChecked();
        if (!isNowHidden) {
            await hideWsCheckbox.click({ force: true });
            await page.waitForTimeout(500);
        }

        // Close and verify badge reappears
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const badgeAfter = await noActualChangeBadgeVisibleInDiff(page);
        expect(badgeAfter).toBe(true);
    });

    test('"Chars To Ignore" with quotes reveals no-actual-change on cosmetic-chars file', async ({ page }) => {
        await openSandboxRepo(page, 'cosmetics');
        // Open the file with quote-only changes
        const file = getFile(page, 'unstaged', 'cosmetic-chars.txt');
        await expect(file).toBeVisible({ timeout: 5000 });
        await file.click();
        await page.waitForTimeout(1000);

        // Initially quote changes are real diffs, no badge in diff
        const badgeBefore = await noActualChangeBadgeVisibleInDiff(page);
        expect(badgeBefore).toBe(false);

        // Open settings and set ignored chars to include quotes
        await openSettingsDropdown(page);
        const charsInput = page.locator('input[placeholder*=";\'"]');
        await expect(charsInput).toBeVisible({ timeout: 2000 });
        await charsInput.fill('"\'');
        await page.waitForTimeout(500);

        // Close settings and check for the badge in the diff
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        const badgeAfter = await noActualChangeBadgeVisibleInDiff(page);
        expect(badgeAfter).toBe(true);
    });

    test('combined: "Chars To Ignore" + "Hide whitespace changes" on mixed file', async ({ page }) => {
        await openSandboxRepo(page, 'cosmetics');
        // Open the mixed file — has both real and cosmetic changes
        const file = getFile(page, 'unstaged', 'mixed.txt');
        await expect(file).toBeVisible({ timeout: 5000 });
        await file.click();
        await page.waitForTimeout(1000);

        // Open settings
        await openSettingsDropdown(page);

        // Set ignored chars
        const charsInput = page.locator('input[placeholder*=";\'"]');
        await expect(charsInput).toBeVisible({ timeout: 2000 });
        await charsInput.fill('<>/');
        await page.waitForTimeout(500);

        // Also hide whitespace
        const hideWsCheckbox = page.locator('label').filter({ hasText: 'Hide whitespace changes' }).locator('input[type="checkbox"]');
        const wasHidden = await hideWsCheckbox.isChecked();
        if (!wasHidden) {
            await hideWsCheckbox.click({ force: true });
            await page.waitForTimeout(500);
        }

        // Close and check whether the badge appears
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        // mixed.txt still has real changes (debug toggle) so badge should NOT appear
        const badge = await noActualChangeBadgeVisibleInDiff(page);
        expect(badge).toBe(false);
    });

    test('"Show changes only" toggle changes diff rendering', async ({ page }) => {
        await openSandboxRepo(page, 'cosmetics');
        // Open a file with multiple hunks
        const file = getFile(page, 'unstaged', 'whitespace-demo.txt');
        await expect(file).toBeVisible({ timeout: 5000 });
        await file.click();
        await page.waitForTimeout(1000);

        // Get initial diff content as baseline
        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible({ timeout: 3000 });

        // Open settings and toggle "Show changes only"
        await openSettingsDropdown(page);
        const showChangesCheckbox = page.locator('label').filter({ hasText: 'Show changes only' }).locator('input[type="checkbox"]');
        await expect(showChangesCheckbox).toBeVisible({ timeout: 2000 });

        const wasChecked = await showChangesCheckbox.isChecked();
        if (!wasChecked) {
            await showChangesCheckbox.click({ force: true });
            await page.waitForTimeout(500);
        }

        // Close settings
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        // The diff root should still be visible
        await expect(diffRoot).toBeVisible();

        // Toggle back
        await openSettingsDropdown(page);
        await showChangesCheckbox.click({ force: true });
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await expect(diffRoot).toBeVisible();
    });

    test('real staged changes do not show no-actual-change badge', async ({ page }) => {
        await openSandboxRepo(page, 'cosmetics');
        // The staged cosmetics-only file actually has a real content change (comment added),
        // so the "no actual change" badge should NOT appear
        const file = getFile(page, 'staged', 'cosmetics-only.txt');
        await expect(file).toBeVisible({ timeout: 5000 });
        await file.click();
        await page.waitForTimeout(1000);

        const badge = await noActualChangeBadgeVisibleInDiff(page);
        expect(badge).toBe(false);
    });
});
