import type { Locator, Page } from '@playwright/test';
import { confirmPopover } from './support/confirmation';
import { expect, openSandboxRepo, test } from './support/sandbox';

function repoRow(page: Page, name: string): Locator {
    return page.getByRole('button', { name, exact: true });
}

/** A tree header is identified by its id, so a group can be found by the name it shows. */
function groupHeader(page: Page, name: string): Locator {
    return page.locator('[data-testid^="file-tree-header-"]').filter({ hasText: name });
}

/** The section a tree header lives in, which is also where that group's repositories render. */
function groupSection(page: Page, name: string): Locator {
    return page.locator('section').filter({ has: groupHeader(page, name) });
}

async function runRepoMenuAction(page: Page, repoName: string, label: string): Promise<void> {
    await repoRow(page, repoName).click({ button: 'right' });

    const entry = page.getByRole('menuitem', { name: label, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
}

async function runGroupMenuAction(page: Page, groupName: string, label: string): Promise<void> {
    await groupHeader(page, groupName).click({ button: 'right' });

    const entry = page.getByRole('menuitem', { name: label, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
}

async function fillCenteredInput(page: Page, modalTitle: string, label: string, value: string, submitLabel: string): Promise<void> {
    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: modalTitle });
    await expect(modal).toBeVisible();
    await modal.getByLabel(label).fill(value);
    await modal.getByRole('button', { name: submitLabel, exact: true }).click();
}

async function createGroup(page: Page, name: string): Promise<void> {
    await page.getByTestId('repos-add-group').click();
    await fillCenteredInput(page, 'Create Repository Group', 'Group name', name, 'Create');
    await expect(page.getByText(`Group ${name} created.`)).toBeVisible();
}

test.describe('repository lifecycle and groups', () => {
    test('refreshes the repository list', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        await page.getByTestId('repos-refresh').click();

        await expect(page.getByText('Repositories refreshed.')).toBeVisible();
        await expect(repoRow(page, 'partial-changes')).toBeVisible();
    });

    test('renames a repository from its context menu', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        await runRepoMenuAction(page, 'partial-changes', 'Rename...');

        const modal = page.getByTestId('centered-modal-surface').filter({ hasText: 'Rename Repository' });
        await expect(modal).toBeVisible();
        // The modal opens on the current name.
        await expect(modal.getByLabel('Repository name')).toHaveValue('partial-changes');
        await modal.getByLabel('Repository name').fill('renamed-lab');
        await modal.getByRole('button', { name: 'Rename', exact: true }).click();

        await expect(page.getByText('Repository renamed to renamed-lab.')).toBeVisible();
        await expect(repoRow(page, 'renamed-lab')).toBeVisible();
        await expect(repoRow(page, 'partial-changes')).toBeHidden();
    });

    test('removes a repository behind a confirmation', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        await runRepoMenuAction(page, 'cosmetics', 'Remove Repository');
        await confirmPopover(page);

        await expect(page.getByText('Repository removed.')).toBeVisible();
        await expect(repoRow(page, 'cosmetics')).toBeHidden();
        await expect(repoRow(page, 'partial-changes')).toBeVisible();
    });

    test('creates, renames and deletes a group', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        await createGroup(page, 'Feature Work');
        await expect(groupHeader(page, 'Feature Work')).toBeVisible();

        await runGroupMenuAction(page, 'Feature Work', 'Rename...');
        await fillCenteredInput(page, 'Rename Repository Group', 'Group name', 'Release Work', 'Rename');
        await expect(page.getByText('Group renamed to Release Work.')).toBeVisible();
        await expect(groupHeader(page, 'Release Work')).toBeVisible();

        await runGroupMenuAction(page, 'Release Work', 'Delete Group');
        await confirmPopover(page);
        await expect(page.getByText('Group "Release Work" deleted.')).toBeVisible();
        await expect(groupHeader(page, 'Release Work')).toBeHidden();
    });

    test('moves a repository into another group', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        await createGroup(page, 'Feature Work');

        await runRepoMenuAction(page, 'partial-changes', 'Move to Group...');
        // The submenu lists the groups the repository can move to.
        await page.getByRole('menuitem', { name: 'Feature Work', exact: true }).click();

        await expect(page.getByText('Moved to Feature Work.')).toBeVisible();
        // The repository row now renders inside that group's section.
        await expect(groupSection(page, 'Feature Work').getByRole('button', { name: 'partial-changes', exact: true })).toBeVisible();
    });
});
