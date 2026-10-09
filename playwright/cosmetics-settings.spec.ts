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

        // The view auto-selects a file, so its diff can still be on screen while the clicked one
        // loads. Waiting for the clicked file's title means the pane is settled and a later
        // response cannot replace the diff — and any popover opened on it — underneath the test.
        await expect(page.getByTestId('diff-viewer-title')).toHaveText(fileName);
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

        // The toggle re-renders the diff underneath it, so the popover has to stay open or
        // every setting would need the settings button pressed again.
        await expect(dialog).toBeVisible();

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

    test('changing the diff font size resizes the rendered lines in place', async ({ page }) => {
        await openLabFile(page, 'unstaged', 'mixed.txt');

        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        const renderedLine = diffRoot.locator('[data-line]').first();
        await expect(renderedLine).toBeAttached();

        // Marking the node makes a full teardown and rebuild observable: the font size is a CSS
        // custom property, so the diff must not be re-rendered for it.
        await renderedLine.evaluate((element) => {
            (element as HTMLElement & { __kept?: string }).__kept = 'yes';
        });

        const dialog = await openDiffSettings(page);
        const fontSize = dialog.locator('input[type="number"]');
        await fontSize.fill('20');
        await fontSize.press('Tab');
        await closeDiffSettings(page);

        await expect.poll(async () => renderedLine.evaluate((element) => getComputedStyle(element).fontSize)).toBe('20px');
        expect(await renderedLine.evaluate((element) => (element as HTMLElement & { __kept?: string }).__kept)).toBe('yes');
        await expect(page.locator('#app-error-banner p')).toBeHidden();

        // Restore the default so the shared app instance is left as the other specs expect it.
        const reopened = await openDiffSettings(page);
        const restored = reopened.locator('input[type="number"]');
        await restored.fill('12');
        await restored.press('Tab');
        await closeDiffSettings(page);

        await expect.poll(async () => renderedLine.evaluate((element) => getComputedStyle(element).fontSize)).toBe('12px');
    });

    test('real staged changes do not show no-actual-change badge', async ({ page }) => {
        // The staged cosmetics-only file holds a real content change (an added comment).
        await openLabFile(page, 'staged', 'cosmetics-only.txt');

        await expect(noActualChangeBadge(page)).toBeHidden();
    });
});
