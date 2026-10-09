import type { Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

async function openTagsView(page: Page) {
    await openSandboxRepo(page, 'partial-changes');
    await page.getByRole('button', { name: 'Tags', exact: true }).click();
    await expect(page.getByTestId('tags-search')).toBeVisible();
}

async function createTag(page: Page, name: string, message?: string) {
    await page.getByTestId('tags-create').click();

    const nameInput = page.locator('#create-tag-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(name);

    if (message !== undefined) {
        await page.locator('#create-tag-message').fill(message);
    }

    await page.getByRole('button', { name: 'Create Tag' }).click();
}

async function openTagContextMenuAction(page: Page, tagName: string, label: string) {
    const row = page.getByTestId(`file-tree-item-${tagName}`);
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });

    const entry = page.getByRole('menuitem', { name: label, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
}

test.describe('tags view', () => {
    test('creates a lightweight tag at HEAD and selects it', async ({ page }) => {
        await openTagsView(page);
        await expect(page.getByText('No tags yet')).toBeVisible();

        await createTag(page, 'v1.0.0');

        await expect(page.getByTestId('file-tree-item-v1.0.0')).toBeVisible();
        // Creating a tag selects it, so the header shows it and the pane inspects its commit.
        await expect(page.getByTestId('selected-tag-name')).toHaveText('v1.0.0');
        await expect(page.getByText('No tags yet')).toBeHidden();
        // No message was given, so the tag stays lightweight.
        await expect(page.getByTestId('file-tree-item-v1.0.0')).not.toContainText('annotated');
    });

    test('creates an annotated tag and shows its message', async ({ page }) => {
        await openTagsView(page);

        await createTag(page, 'v2.0.0', 'Release notes from the browser');

        await expect(page.getByTestId('file-tree-item-v2.0.0')).toBeVisible();
        await expect(page.getByTestId('selected-tag-name')).toHaveText('v2.0.0');
        await expect(page.getByTestId('file-tree-item-v2.0.0')).toContainText('annotated');
        await expect(page.getByText('Release notes from the browser')).toBeVisible();
    });

    test('filters the tag list from the search box', async ({ page }) => {
        await openTagsView(page);

        await createTag(page, 'v1.0.0');
        await expect(page.getByTestId('file-tree-item-v1.0.0')).toBeVisible();

        await createTag(page, 'nightly');
        await expect(page.getByTestId('file-tree-item-nightly')).toBeVisible();

        await page.getByTestId('tags-search').fill('night');

        await expect(page.getByTestId('file-tree-item-nightly')).toBeVisible();
        await expect(page.getByTestId('file-tree-item-v1.0.0')).toBeHidden();

        await page.getByTestId('tags-search').fill('');

        await expect(page.getByTestId('file-tree-item-v1.0.0')).toBeVisible();
    });

    test('renames a tag from its row context menu', async ({ page }) => {
        await openTagsView(page);

        await createTag(page, 'old-name');
        await expect(page.getByTestId('file-tree-item-old-name')).toBeVisible();

        await openTagContextMenuAction(page, 'old-name', 'Rename Tag...');

        const input = page.locator('#rename-repository-name');
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('old-name');
        await input.fill('new-name');

        await page.getByRole('button', { name: 'Rename Tag' }).click();

        await expect(page.getByTestId('file-tree-item-new-name')).toBeVisible();
        await expect(page.getByTestId('file-tree-item-old-name')).toBeHidden();
        // The renamed tag stays selected.
        await expect(page.getByTestId('selected-tag-name')).toHaveText('new-name');
    });

    test('deletes a tag from its row context menu', async ({ page }) => {
        await openTagsView(page);

        await createTag(page, 'to-delete');
        await expect(page.getByTestId('file-tree-item-to-delete')).toBeVisible();

        await openTagContextMenuAction(page, 'to-delete', 'Delete Tag');

        await page.getByTestId('confirmation-popover-confirm').click();

        await expect(page.getByTestId('file-tree-item-to-delete')).toBeHidden();
        await expect(page.getByText('No tags yet')).toBeVisible();
    });
});
