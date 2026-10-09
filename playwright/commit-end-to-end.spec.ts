import type { Page } from '@playwright/test';
import { changeRow, runChangeRowAction } from './support/changes';
import { expect, openSandboxRepo, test } from './support/sandbox';

async function openChangesView(page: Page) {
    await openSandboxRepo(page, 'partial-changes');
    await expect(page.getByTestId('commit-summary-input')).toBeVisible();
}

async function openHistoryView(page: Page) {
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByTestId('history-search')).toBeVisible();
}

/** Commit rows are the history tree entries, whose ids are commit shas. */
function commitRows(page: Page) {
    return page.getByTestId(/^file-tree-item-[0-9a-f]{7,40}$/);
}

test.describe('committing a change', () => {
    test('stages a file, commits a typed summary and shows the commit in History', async ({ page }) => {
        await openChangesView(page);

        // The lab starts with first.txt staged; staging second.txt leaves two staged entries,
        // which is also why nothing is committed until a summary is typed.
        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Stage File');
        await expect(changeRow(page, 'staged', 'second.txt')).toBeVisible();

        await page.getByTestId('commit-summary-input').fill('Commit from the browser');
        await page.getByTestId('commit-submit').click();

        // Committing takes the staged pair out of the changes view.
        await expect(changeRow(page, 'staged', 'first.txt')).toBeHidden();
        await expect(changeRow(page, 'staged', 'second.txt')).toBeHidden();

        await openHistoryView(page);
        await expect(commitRows(page).first()).toContainText('Commit from the browser');
    });

    test('keeps Commit disabled until a summary is typed', async ({ page }) => {
        await openChangesView(page);

        // With two staged files no summary is suggested, so the button depends on the input.
        await runChangeRowAction(page, 'unstaged', 'second.txt', 'Stage File');

        const submit = page.getByTestId('commit-submit');
        const summary = page.getByTestId('commit-summary-input');

        await expect(submit).toBeDisabled();

        await summary.fill('   ');
        await expect(submit).toBeDisabled();

        await summary.fill('Ready to commit');
        await expect(submit).toBeEnabled();
    });

    test('commits with Cmd+Enter from the summary field', async ({ page }) => {
        await openChangesView(page);

        const summary = page.getByTestId('commit-summary-input');
        await summary.fill('Committed with the keyboard');
        await summary.press('Meta+Enter');

        await openHistoryView(page);
        await expect(commitRows(page).first()).toContainText('Committed with the keyboard');
    });

    test('amends the latest unpushed commit', async ({ page }) => {
        await openChangesView(page);

        await page.getByTestId('changes-amend-latest').click();
        await expect(page.getByText('Amending the latest unpushed commit')).toBeVisible();

        const summary = page.getByTestId('commit-summary-input');
        await expect(summary).toHaveValue('Initial baseline');
        await summary.fill('Amended from the browser');
        await page.getByTestId('commit-submit').click();

        // Amend rewrites the only commit instead of adding one.
        await openHistoryView(page);
        await expect(commitRows(page)).toHaveCount(1);
        await expect(commitRows(page).first()).toContainText('Amended from the browser');
    });
});
