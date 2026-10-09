import type { Locator, Page } from '@playwright/test';
import { confirmPopover } from './support/confirmation';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** Pushing tags needs a remote, which the pull-conflict lab has. */
async function openTagsView(page: Page, lab = 'pull-conflict') {
    await openSandboxRepo(page, lab);
    await page.getByRole('button', { name: 'Tags', exact: true }).click();
    await expect(page.getByTestId('tags-search')).toBeVisible();
}

function tagRows(page: Page): Locator {
    const tagsTree = page.locator('section', { has: page.getByTestId('file-tree-header-tags') });
    return tagsTree.locator('[data-testid^="file-tree-item-"]');
}

function commitRows(page: Page): Locator {
    return page.getByTestId(/^file-tree-item-[0-9a-f]{7,40}$/);
}

/** Tags are ordered by their commit's date, so two tags only differ in age on two commits. */
async function addTagFromHistory(page: Page, commitSummary: string, tagName: string): Promise<void> {
    await commitRows(page).filter({ hasText: commitSummary }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add Tag...', exact: true }).click();

    const nameInput = page.locator('#create-tag-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(tagName);
    await page.getByRole('button', { name: 'Create Tag' }).click();

    await expect(page.getByText(`Tag "${tagName}" created.`)).toBeVisible();
}

async function createTag(page: Page, name: string): Promise<void> {
    await page.getByTestId('tags-create').click();

    const nameInput = page.locator('#create-tag-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Create Tag' }).click();

    await expect(page.getByTestId(`file-tree-item-${name}`)).toBeVisible();
}

async function runTagMenuAction(page: Page, tagName: string, label: string): Promise<void> {
    await page.getByTestId(`file-tree-item-${tagName}`).click({ button: 'right' });

    const entry = page.getByRole('menuitem', { name: label, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
}

async function runTagsHeaderMenuAction(page: Page, label: string): Promise<void> {
    await page.getByTestId('file-tree-header-tags').click({ button: 'right' });

    const entry = page.getByRole('menuitem', { name: label, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
}

test.describe('tag actions beyond CRUD', () => {
    test('sorts the tags by newest and by name', async ({ page }) => {
        await openSandboxRepo(page, 'deep-history');
        await page.getByRole('button', { name: 'History', exact: true }).click();
        await expect(page.getByTestId('history-search')).toBeVisible();

        // The two tags sit on commits of different ages, so newest-first and name order disagree.
        await addTagFromHistory(page, 'Add notes/note-38.txt', 'zeta');
        await addTagFromHistory(page, 'Remove every tracked file', 'alpha');

        await page.getByRole('button', { name: 'Tags', exact: true }).click();
        await expect(page.getByTestId('tags-search')).toBeVisible();

        await expect(tagRows(page).first()).toHaveAttribute('data-testid', 'file-tree-item-zeta');

        await runTagsHeaderMenuAction(page, 'Sort by Name');

        await expect(tagRows(page).first()).toHaveAttribute('data-testid', 'file-tree-item-alpha');
    });

    test('pushes a single tag to the remote', async ({ page }) => {
        await openTagsView(page);
        await createTag(page, 'v-release');

        await runTagMenuAction(page, 'v-release', 'Push Tag');

        await expect(page.getByText('Tag "v-release" pushed.')).toBeVisible();
    });

    test('deletes a published tag on the remote and keeps it locally', async ({ page }) => {
        await openTagsView(page);
        await createTag(page, 'v-release');
        await runTagMenuAction(page, 'v-release', 'Push Tag');
        await expect(page.getByText('Tag "v-release" pushed.')).toBeVisible();

        // Deleting it on the remote only works once the push above actually published it.
        await runTagMenuAction(page, 'v-release', 'Delete Tag on Remote');
        await confirmPopover(page);

        await expect(page.getByText('Tag "v-release" deleted on the remote.')).toBeVisible();
        await expect(page.getByTestId('file-tree-item-v-release')).toBeVisible();
    });

    test('pushes every tag at once', async ({ page }) => {
        await openTagsView(page);
        await createTag(page, 'v-one');
        await createTag(page, 'v-two');

        await runTagsHeaderMenuAction(page, 'Push All Tags');

        await expect(page.getByText('Tags pushed.')).toBeVisible();
    });

    test('copies a tag name', async ({ page }) => {
        await openTagsView(page);
        await createTag(page, 'v-copy');
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        await runTagMenuAction(page, 'v-copy', 'Copy Tag Name');

        await expect(page.getByText('Tag name copied.')).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('v-copy');
    });

    test('disables pushing when the repository has no remote', async ({ page }) => {
        await openTagsView(page, 'partial-changes');
        await createTag(page, 'v-local');

        await page.getByTestId('file-tree-item-v-local').click({ button: 'right' });

        await expect(page.getByRole('menuitem', { name: 'Push Tag', exact: true })).toBeDisabled();
        await expect(page.getByRole('menuitem', { name: 'Delete Tag on Remote', exact: true })).toBeDisabled();
    });
});
