import type { Page } from '@playwright/test';
import { confirmationPopover, confirmPopover } from './support/confirmation';
import { expect, openSandboxRepo, test } from './support/sandbox';

function resolver(page: Page) {
    return page.getByTestId('merge-conflict-modal');
}

function conflictCard(page: Page, path: string) {
    return page.getByTestId(`merge-conflict-file-${path}`);
}

/**
 * The per-block actions are rendered as Monaco view zones, which stay out of the accessibility
 * tree, so they are matched by their class and text instead of by role.
 */
function conflictAction(page: Page, label: string) {
    return page.locator('.merge-conflict-actions__button').filter({ hasText: label });
}

/** The resolver opens by itself on selection, and its overlay covers the view buttons. */
async function openConflictedRepo(page: Page) {
    await openSandboxRepo(page, 'merge-conflict', { openChangesView: false });
    await expect(resolver(page)).toBeVisible();
}

/**
 * story.txt holds three adjacent conflict blocks, one per rewritten field, so each per-block
 * action clears exactly one of them.
 */
async function resolveStoryInline(page: Page) {
    await page.getByTestId('merge-conflict-resolve-inline-story.txt').click();

    const acceptMine = conflictAction(page, 'Accept Mine');
    await expect(acceptMine).toHaveCount(3);

    await acceptMine.first().click();
    await expect(acceptMine).toHaveCount(2);

    const acceptIncoming = conflictAction(page, 'Accept Incoming');
    await acceptIncoming.first().click();
    await expect(acceptIncoming).toHaveCount(1);

    const acceptBoth = conflictAction(page, 'Accept Both');
    await acceptBoth.first().click();
    await expect(acceptBoth).toHaveCount(0);

    const save = page.getByTestId('merge-conflict-save');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByTestId('merge-conflict-merged-story.txt')).toBeVisible();
}

test.describe('merge conflict resolution', () => {
    test('opens the resolver on its own and lists every conflicted file', async ({ page }) => {
        await openConflictedRepo(page);

        await expect(resolver(page)).toContainText('3 conflicted files remaining');
        await expect(conflictCard(page, 'story.txt')).toContainText('3 conflicts');
        for (const path of ['story.txt', 'config.json', 'notes.md']) {
            await expect(conflictCard(page, path)).toBeVisible();
        }

        // The header offers the same resolver and reports how many files are left.
        await expect(page.getByRole('button', { name: 'Resolve Conflicts (3)' })).toBeVisible();
    });

    test('marks a conflicted file resolved from its card', async ({ page }) => {
        await openConflictedRepo(page);

        await page.getByTestId('merge-conflict-mark-resolved-notes.md').click();

        await expect(page.getByTestId('merge-conflict-merged-notes.md')).toBeVisible();
        await expect(conflictCard(page, 'notes.md')).toBeHidden();
        await expect(resolver(page)).toContainText('2 conflicted files remaining');
        await expect(page.getByRole('button', { name: 'Resolve Conflicts (2)' })).toBeVisible();
    });

    test('resolves conflict markers inline and stages the result', async ({ page }) => {
        await openConflictedRepo(page);

        // Nothing can be saved while the file still holds conflict markers.
        await page.getByTestId('merge-conflict-resolve-inline-story.txt').click();
        await expect(page.getByTestId('merge-conflict-save')).toBeDisabled();
        await expect(conflictAction(page, 'Accept Mine')).toHaveCount(3);

        await conflictAction(page, 'Accept Mine').first().click();
        await expect(conflictAction(page, 'Accept Mine')).toHaveCount(2);

        await conflictAction(page, 'Accept Incoming').first().click();
        await expect(conflictAction(page, 'Accept Incoming')).toHaveCount(1);

        await conflictAction(page, 'Accept Both').first().click();
        await expect(conflictAction(page, 'Accept Both')).toHaveCount(0);

        const save = page.getByTestId('merge-conflict-save');
        await expect(save).toBeEnabled();
        await save.click();

        // Saving closes the inline editor and moves the file into the staged list.
        await expect(page.getByTestId('merge-conflict-merged-story.txt')).toBeVisible();
        await expect(conflictCard(page, 'story.txt')).toBeHidden();
        await expect(resolver(page)).toContainText('2 conflicted files remaining');
    });

    test('commits the merge once every conflict is resolved', async ({ page }) => {
        await openConflictedRepo(page);

        const commit = page.getByTestId('merge-conflict-commit');
        await expect(commit).toBeDisabled();

        // Each resolution rebuilds the list, so the next click waits for its file to move over
        // rather than landing on a card the re-render has already replaced.
        await page.getByTestId('merge-conflict-mark-resolved-notes.md').click();
        await expect(page.getByTestId('merge-conflict-merged-notes.md')).toBeVisible();

        await page.getByTestId('merge-conflict-mark-resolved-config.json').click();
        await expect(page.getByTestId('merge-conflict-merged-config.json')).toBeVisible();

        await resolveStoryInline(page);

        await expect(resolver(page)).toContainText('All conflicts are resolved');
        await expect(commit).toBeEnabled();
        await commit.click();

        await expect(resolver(page)).toBeHidden();
        await expect(page.getByRole('button', { name: 'Resolve Conflicts (3)' })).toBeHidden();
    });

    test('aborts the merge from the resolver', async ({ page }) => {
        await openConflictedRepo(page);

        await page.getByTestId('merge-conflict-abort').click();
        await expect(confirmationPopover(page)).toContainText('Abort the current merge?');
        await confirmPopover(page);

        await expect(resolver(page)).toBeHidden();
        await expect(page.getByRole('button', { name: 'Resolve Conflicts (3)' })).toBeHidden();
    });
});
