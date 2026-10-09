import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** The pull-conflict lab has an origin remote, so publishing a new branch there can succeed. */
async function openBranches(page: Page) {
    await openSandboxRepo(page, 'pull-conflict');
    await page.getByTestId('toggle-branches-sidebar').click();
    await expect(page.getByTestId('file-tree-header-local-branches')).toBeVisible();
}

function branchRow(page: Page, name: string): Locator {
    return page.getByRole('button', { name, exact: true });
}

async function addBranch(page: Page, kind: 'local' | 'remote', name: string) {
    await page.getByTestId(`branches-add-${kind}`).click();

    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: `Add ${kind === 'local' ? 'Local' : 'Remote'} Branch` });
    await expect(modal).toBeVisible();
    await modal.getByLabel('Branch name').fill(name);
    await modal.getByRole('button', { name: 'Create' }).click();
}

/** The publish control lives beside its repository row, not inside the branch list. */
function publishButton(page: Page, repoName: string): Locator {
    return branchRow(page, repoName).locator('xpath=..').getByTestId('repo-publish-branch');
}

test.describe('branches sidebar', () => {
    test('toggles open with the local and remote branch lists', async ({ page }) => {
        await openBranches(page);

        await expect(branchRow(page, 'main')).toBeVisible();
        await expect(page.getByTestId('file-tree-header-remote-branches')).toBeVisible();
        await expect(branchRow(page, 'origin/main')).toBeVisible();
    });

    test('creates a local branch from the local list', async ({ page }) => {
        await openBranches(page);

        await addBranch(page, 'local', 'feature');

        // A local branch is created on its own, without pushing it to the remote.
        await expect(page.getByText('Branch "feature" created.')).toBeVisible();
        await expect(branchRow(page, 'feature')).toBeVisible();
        await expect(branchRow(page, 'origin/feature')).toBeHidden();
    });

    test('creates and pushes a branch from the remote list', async ({ page }) => {
        await openBranches(page);

        await addBranch(page, 'remote', 'release');

        await expect(page.getByText('Remote branch "release" created.')).toBeVisible();
        await expect(branchRow(page, 'release')).toBeVisible();
        await expect(branchRow(page, 'origin/release')).toBeVisible();

        // The pushed branch has an upstream, so the repository needs no publishing.
        await expect(publishButton(page, 'pull-conflict')).toBeHidden();
    });

    test('switches branches by clicking a row', async ({ page }) => {
        await openBranches(page);
        await addBranch(page, 'local', 'feature');
        await expect(branchRow(page, 'feature')).toBeVisible();

        await branchRow(page, 'main').click();

        await expect(page.getByText('Switched to main.')).toBeVisible();
    });

    test('publishes a local branch that has no upstream', async ({ page }) => {
        await openBranches(page);
        await addBranch(page, 'local', 'feature');

        // Creating the branch switched to it, so the repository row now offers to publish it.
        const publish = publishButton(page, 'pull-conflict');
        await expect(publish).toBeVisible();
        await publish.click();

        await expect(page.getByText('Branch published.')).toBeVisible();
        // Publishing sets the upstream, so the repository has nothing left to publish.
        await expect(publish).toBeHidden();
    });
});
