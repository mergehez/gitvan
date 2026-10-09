import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

test.describe('cosmetics settings', () => {
    function getFile(page: Page, section: 'staged' | 'unstaged', fileName: string) {
        return page.locator(`[data-testid="file-tree-item-${section}-${fileName}"]`).first();
    }

    /** The badge the diff header shows when a change turns out to be cosmetic only. */
    function noActualChangeBadge(page: Page): Locator {
        return page.getByText('no actual change');
    }

    async function openLabFile(page: Page, section: 'staged' | 'unstaged', fileName: string) {
        await openSandboxRepo(page, 'cosmetics');

        const file = getFile(page, section, fileName);
        await expect(file).toBeVisible();
        await file.click();
        await expect(page.getByTestId('diffs-diff-editor-root')).toBeVisible();
    }

    async function openDiffSettings(page: Page): Promise<Locator> {
        const dialog = page.getByRole('dialog', { name: 'Diff settings' });

        if (!(await dialog.isVisible())) {
            await page.getByTestId('diff-settings-button').first().click();
        }

        await expect(dialog).toBeVisible();

        return dialog;
    }

    async function closeDiffSettings(page: Page) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'Diff settings' })).toBeHidden();
    }

    /**
     * Changes the setting from the keyboard. Toggling re-renders the diff, and changing the view
     * mode can replace the popover it lives in, so a pointer click is not reliably actionable.
     */
    async function toggleSetting(page: Page, checkbox: Locator) {
        await checkbox.focus();
        await page.keyboard.press('Space');
    }

    test('"Hide whitespace changes" reveals no-actual-change on whitespace-only file', async ({ page }) => {
        await openLabFile(page, 'unstaged', 'whitespace-demo.txt');

        // Whitespace changes are hidden by default, so the change looks cosmetic.
        await expect(noActualChangeBadge(page)).toBeVisible();

        const dialog = await openDiffSettings(page);
        const hideWhitespace = dialog.getByLabel('Hide whitespace changes');
        await expect(hideWhitespace).toBeChecked();
        await toggleSetting(page, hideWhitespace);

        await closeDiffSettings(page);

        // Showing whitespace means the change is real, so the badge goes away.
        await expect(noActualChangeBadge(page)).toBeHidden();

        const reopened = await openDiffSettings(page);
        await expect(reopened.getByLabel('Hide whitespace changes')).not.toBeChecked();
        await toggleSetting(page, reopened.getByLabel('Hide whitespace changes'));
        await closeDiffSettings(page);

        await expect(noActualChangeBadge(page)).toBeVisible();
    });

    test('"Chars To Ignore" with quotes reveals no-actual-change on cosmetic-chars file', async ({ page }) => {
        await openLabFile(page, 'unstaged', 'cosmetic-chars.txt');

        // Quote changes are real diffs until the quotes are ignored.
        await expect(noActualChangeBadge(page)).toBeHidden();

        const dialog = await openDiffSettings(page);
        await dialog.locator('input[type="text"]').fill('"\'');

        await closeDiffSettings(page);

        await expect(noActualChangeBadge(page)).toBeVisible();
    });

    test('combined: "Chars To Ignore" + "Hide whitespace changes" on mixed file', async ({ page }) => {
        await openLabFile(page, 'unstaged', 'mixed.txt');

        // Setting the ignored characters reloads the diff, which closes the popover, so the
        // whitespace toggle needs a fresh one.
        const dialog = await openDiffSettings(page);
        await dialog.locator('input[type="text"]').fill('<>/');
        await closeDiffSettings(page);

        const reopened = await openDiffSettings(page);
        await expect(reopened.locator('input[type="text"]')).toHaveValue('<>/');
        await toggleSetting(page, reopened.getByLabel('Hide whitespace changes'));

        await closeDiffSettings(page);

        // mixed.txt still has a real change, so the badge must not appear.
        await expect(noActualChangeBadge(page)).toBeHidden();
    });

    test('"Show changes only" toggle changes diff rendering', async ({ page }) => {
        await openLabFile(page, 'unstaged', 'whitespace-demo.txt');

        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect(diffRoot).toBeVisible();

        const dialog = await openDiffSettings(page);
        await expect(dialog.getByLabel('Show changes only')).not.toBeChecked();
        await toggleSetting(page, dialog.getByLabel('Show changes only'));

        await expect(page.locator('#app-error-banner p')).toBeHidden();
        await expect(diffRoot).toBeVisible();

        // The mode stuck, and turning it back off leaves the diff on screen.
        const reopened = await openDiffSettings(page);
        await expect(reopened.getByLabel('Show changes only')).toBeChecked();
        await toggleSetting(page, reopened.getByLabel('Show changes only'));

        await closeDiffSettings(page);
        await expect(diffRoot).toBeVisible();
    });

    test('real staged changes do not show no-actual-change badge', async ({ page }) => {
        // The staged cosmetics-only file holds a real content change (an added comment).
        await openLabFile(page, 'staged', 'cosmetics-only.txt');

        await expect(noActualChangeBadge(page)).toBeHidden();
    });
});
