import type { Page } from '@playwright/test';
import { changeRow, runChangeRowAction } from './support/changes';
import { cancelPopover, confirmationPopover, confirmPopover } from './support/confirmation';
import { expect, openSandboxRepo, test } from './support/sandbox';

async function openChangesView(page: Page) {
    await openSandboxRepo(page, 'partial-changes');
    await expect(page.getByTestId('commit-summary-input')).toBeVisible();
}

test.describe('destructive changes', () => {
    test('discards a single file after confirmation', async ({ page }) => {
        await openChangesView(page);

        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Discard Changes');

        await expect(confirmationPopover(page)).toContainText("Discard changes in 'second.txt'?");
        await confirmPopover(page);

        await expect(changeRow(page, 'unstaged', 'second.txt')).toBeHidden();
    });

    test('keeps the change when the confirmation is cancelled', async ({ page }) => {
        await openChangesView(page);

        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Discard Changes');
        await cancelPopover(page);

        await expect(changeRow(page, 'unstaged', 'second.txt')).toBeVisible();
    });

    test('discards every unstaged change at once', async ({ page }) => {
        await openChangesView(page);

        await page.getByTestId('changes-discard-all').click();

        await expect(confirmationPopover(page)).toContainText('Discard all unstaged changes in this repository?');
        await confirmPopover(page);

        // The modified, untracked and deleted entries all go; the staged file stays.
        await expect(changeRow(page, 'unstaged', 'second.txt')).toBeHidden();
        await expect(changeRow(page, 'unstaged', 'untracked.txt')).toBeHidden();
        await expect(changeRow(page, 'unstaged', 'removed.txt')).toBeHidden();
        await expect(changeRow(page, 'staged', 'first.txt')).toBeVisible();
    });

    test('skips locked files when discarding all changes', async ({ page }) => {
        await openChangesView(page);

        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Lock file (disable staging)');
        await page.getByTestId('changes-discard-all').click();

        await expect(confirmationPopover(page)).toContainText('1 locked file will be skipped');
        await confirmPopover(page);

        // The locked file keeps its edits while the rest are discarded.
        await expect(changeRow(page, 'unstaged', 'second.txt')).toBeVisible();
        await expect(changeRow(page, 'unstaged', 'untracked.txt')).toBeHidden();
    });

    test('discards without confirmation once Confirm Discards is off', async ({ page }) => {
        await openChangesView(page);

        await page.getByTestId('changes-view-menu').click();
        // A checked menu entry carries the check glyph in its accessible name.
        await page.getByRole('menuitem', { name: 'Confirm Discards' }).click();

        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Discard Changes');

        await expect(confirmationPopover(page)).toBeHidden();
        await expect(changeRow(page, 'unstaged', 'second.txt')).toBeHidden();
    });

    test('deletes an untracked file', async ({ page }) => {
        await openChangesView(page);

        await runChangeRowAction(page, 'unstaged', 'untracked.txt', 'Delete File');

        await expect(confirmationPopover(page)).toContainText("Delete 'untracked.txt'?");
        await confirmPopover(page);

        await expect(changeRow(page, 'unstaged', 'untracked.txt')).toBeHidden();
    });

    test('reverts a deletion', async ({ page }) => {
        await openChangesView(page);

        await runChangeRowAction(page, 'unstaged', 'removed.txt', 'Revert Deletion');

        await expect(confirmationPopover(page)).toContainText("Restore 'removed.txt'?");
        await confirmPopover(page);

        // Restoring the file returns it to the committed state, so it leaves the changes view.
        await expect(changeRow(page, 'unstaged', 'removed.txt')).toBeHidden();
    });
});
