import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

async function openSettingsRepositories(page: Page): Promise<Locator> {
    await openSandboxRepo(page, 'partial-changes');
    await page.getByTestId('repos-settings').click();

    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: 'Settings' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Repositories', exact: true }).click();

    return modal;
}

function groupRows(modal: Locator): Locator {
    return modal.locator('button[aria-label^="Open group "]');
}

function repositoryRows(modal: Locator): Locator {
    return modal.locator('[data-testid^="draggable-list-item-"]');
}

async function createGroup(modal: Locator, name: string): Promise<void> {
    await modal.getByPlaceholder('Frontend apps').fill(name);
    await modal.getByRole('button', { name: 'Create group' }).click();
    await expect(modal.getByRole('heading', { name })).toBeVisible();
}

/** The sidebar renders one section per group, which is where its repositories live. */
function sidebarGroupSection(page: Page, name: string): Locator {
    return page.locator('section').filter({ has: page.locator('[data-testid^="file-tree-header-"]').filter({ hasText: name }) });
}

test.describe('settings repositories', () => {
    // Groups survive the sandbox reset, so every test creates its own rather than reusing a name.
    test('creates a group that appears in the sidebar', async ({ page }) => {
        const modal = await openSettingsRepositories(page);

        await createGroup(modal, 'Feature Work');

        await expect(sidebarGroupSection(page, 'Feature Work')).toBeVisible();
    });

    test('renames a group and moves it above the existing one', async ({ page }) => {
        const modal = await openSettingsRepositories(page);
        await createGroup(modal, 'Delivery Work');

        await modal.getByPlaceholder('Frontend apps').fill('Platform Work');
        await modal.getByRole('button', { name: 'Save changes' }).click();
        await expect(modal.getByRole('heading', { name: 'Platform Work' })).toBeVisible();

        await modal.getByRole('button', { name: 'Move up' }).click();

        await expect(groupRows(modal).first()).toHaveAttribute('aria-label', 'Open group Platform Work');
    });

    test('moves a repository into a group from the panel', async ({ page }) => {
        const modal = await openSettingsRepositories(page);
        await createGroup(modal, 'Release Work');

        // A new group starts empty; selecting a repository adds it on save.
        await modal.getByRole('button', { name: 'cosmetics', exact: true }).click();
        await modal.getByRole('button', { name: 'Save changes' }).click();

        await expect(page.getByText('Group Release Work updated.')).toBeVisible();
        await expect(sidebarGroupSection(page, 'Release Work').getByRole('button', { name: 'cosmetics', exact: true })).toBeVisible();
    });

    test('reorders repositories by dragging them inside the group', async ({ page }) => {
        const modal = await openSettingsRepositories(page);

        // The list is only editable once a group is open rather than being created.
        await modal.getByRole('button', { name: 'Open group Sandbox' }).click();
        await expect(repositoryRows(modal).first()).toContainText('merge-conflict');

        await modal.getByRole('button', { name: 'Reorder partial-changes', exact: true }).dragTo(repositoryRows(modal).first(), { targetPosition: { x: 20, y: 2 } });

        await expect(repositoryRows(modal).first()).toContainText('partial-changes');
    });
});
