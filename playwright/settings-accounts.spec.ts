import type { Locator, Page } from '@playwright/test';
import { confirmPopover } from './support/confirmation';
import { expect, openSandboxRepo, test } from './support/sandbox';

async function openSettingsAccounts(page: Page): Promise<Locator> {
    await openSandboxRepo(page, 'partial-changes');
    await page.getByTestId('repos-settings').click();

    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: 'Settings' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Accounts', exact: true }).click();

    return modal;
}

function accountRows(modal: Locator): Locator {
    return modal.locator('[data-testid^="draggable-list-item-"]');
}

/**
 * A System Git account is the only kind a spec can create: the other kinds verify the token
 * against the provider, and an HTTPS token account would also write to the system keychain.
 */
async function createSystemGitAccount(page: Page, modal: Locator, label: string): Promise<void> {
    await modal.getByTestId('settings-create-account').click();
    await modal.getByPlaceholder('Account label').fill(label);
    await modal.locator('select').first().selectOption('system');
    await modal.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Account created.')).toBeVisible();
}

test.describe('settings accounts', () => {
    test('creates a System Git account', async ({ page }) => {
        const modal = await openSettingsAccounts(page);

        await createSystemGitAccount(page, modal, 'Spec System');

        await expect(modal.getByRole('button', { name: 'Spec System', exact: true })).toBeVisible();
        await expect(accountRows(modal).filter({ hasText: 'Spec System' })).toContainText('system · system-git');
    });

    test('renames an account and saves it', async ({ page }) => {
        const modal = await openSettingsAccounts(page);
        await createSystemGitAccount(page, modal, 'Spec Before');

        await modal.getByRole('button', { name: 'Spec Before', exact: true }).click();

        const label = modal.getByPlaceholder('Account label');
        await expect(label).toHaveValue('Spec Before');
        await label.fill('Spec After');
        await modal.getByRole('button', { name: 'Save account' }).click();

        await expect(page.getByText('Account updated.')).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Spec After', exact: true })).toBeVisible();
    });

    test('keeps Create account disabled until the form is valid', async ({ page }) => {
        const modal = await openSettingsAccounts(page);
        await modal.getByTestId('settings-create-account').click();

        const create = modal.getByRole('button', { name: 'Create account' });
        const authKind = modal.locator('select').nth(1);
        await expect(create).toBeDisabled();

        await modal.getByPlaceholder('Account label').fill('Spec Token');
        await authKind.selectOption('https-token');

        // A token account needs its token before it can be submitted.
        await expect(create).toBeDisabled();
        await expect(modal.getByText('Supported providers verify the token before the account is saved.')).toBeVisible();

        await authKind.selectOption('system-git');

        await expect(create).toBeEnabled();
    });

    test('deletes an account behind a confirmation', async ({ page }) => {
        const modal = await openSettingsAccounts(page);
        await createSystemGitAccount(page, modal, 'Spec Doomed');
        await modal.getByRole('button', { name: 'Spec Doomed', exact: true }).click();

        await modal.getByRole('button', { name: 'Delete account' }).click();
        await confirmPopover(page);

        await expect(page.getByText('Account deleted.')).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Spec Doomed', exact: true })).toBeHidden();
        await expect(modal.getByRole('button', { name: 'System Git', exact: true })).toBeVisible();
    });

    test('reorders accounts by dragging them', async ({ page }) => {
        const modal = await openSettingsAccounts(page);
        await createSystemGitAccount(page, modal, 'Spec One');
        await createSystemGitAccount(page, modal, 'Spec Two');

        // Accounts are appended, so the second one is last to begin with.
        await expect(accountRows(modal).last()).toContainText('Spec Two');

        await modal.getByRole('button', { name: 'Reorder Spec Two', exact: true }).dragTo(accountRows(modal).first(), { targetPosition: { x: 20, y: 2 } });

        await expect(accountRows(modal).first()).toContainText('Spec Two');
    });
});
