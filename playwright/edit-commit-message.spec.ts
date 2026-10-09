import { expect, test, type Page } from '@playwright/test';
import { openSandboxRepo } from './support/sandbox';

async function openHistoryView(page: Page) {
    await openSandboxRepo(page, 'partial-changes');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByTestId('history-search')).toBeVisible({ timeout: 5000 });
}

function firstCommitRow(page: Page) {
    return page.getByTestId(/^file-tree-item-[0-9a-f]{7,40}$/).first();
}

async function openCommitContextMenuAction(page: Page, label: string) {
    const row = firstCommitRow(page);
    await expect(row).toBeVisible({ timeout: 5000 });
    const rowBox = await row.boundingBox();
    await row.click({ button: 'right' });

    const entry = page.getByRole('menuitem', { name: label });
    await expect(entry).toBeVisible({ timeout: 5000 });
    await entry.click();

    return rowBox;
}

test.afterEach(async ({ page }) => {
    // The active view is persisted, so leave the app where the other specs expect it.
    const changesButton = page.getByRole('button', { name: 'Changes', exact: true });
    if (await changesButton.isVisible().catch(() => false)) {
        await changesButton.click();
    }
});

test.describe('commit message editing', () => {
    test('rewords a commit message from the history row context menu', async ({ page }) => {
        await openHistoryView(page);

        const rowBox = await openCommitContextMenuAction(page, 'Edit Commit Message...');

        const popover = page.getByTestId('commit-message-popover');
        await expect(popover).toBeVisible({ timeout: 5000 });

        // The popover opens beside the row it was invoked from.
        const popoverBox = await popover.boundingBox();
        expect(popoverBox).not.toBeNull();
        expect(popoverBox!.x).toBeGreaterThan(rowBox!.x);

        const input = page.getByTestId('commit-message-input');
        await expect(input).toHaveValue('Initial baseline');

        await input.fill('reworded from the browser');
        await page.getByTestId('commit-message-save').click();

        await expect(popover).toBeHidden({ timeout: 5000 });
        await expect(firstCommitRow(page)).toContainText('reworded from the browser');
    });

    test('edits a commit description from the history row context menu', async ({ page }) => {
        await openHistoryView(page);

        await openCommitContextMenuAction(page, 'Edit Commit Description...');

        const popover = page.getByTestId('commit-message-popover');
        await expect(popover).toBeVisible({ timeout: 5000 });

        // The lab's commit has no body yet.
        const description = page.getByTestId('commit-description-input');
        await expect(description).toHaveValue('');

        await description.fill('described from the browser');
        await page.getByTestId('commit-message-save').click();

        await expect(popover).toBeHidden({ timeout: 5000 });
        // The reworded commit stays selected, so the inspect pane shows the new body.
        await expect(page.getByText('described from the browser')).toBeVisible({ timeout: 5000 });
    });
});
