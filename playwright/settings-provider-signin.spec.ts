import type { Locator, Page } from '@playwright/test';
import { expect, expectBackendError, openSandboxRepo, setProviderStubMode, test } from './support/sandbox';

async function openCreateAccount(page: Page): Promise<Locator> {
    await openSandboxRepo(page, 'partial-changes');
    await page.getByTestId('repos-settings').click();

    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: 'Settings' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Accounts', exact: true }).click();
    await modal.getByTestId('settings-create-account').click();

    return modal;
}

function accountRows(modal: Locator): Locator {
    return modal.locator('[data-testid^="draggable-list-item-"]');
}

/** GitHub is the provider whose client id the OAuth form can carry on its own. */
async function startGithubOAuthSignIn(page: Page, modal: Locator, label: string): Promise<void> {
    await modal.getByPlaceholder('Account label').fill(label);
    await modal.locator('select').first().selectOption('github');
    await modal.locator('select').nth(1).selectOption('oauth');
    // The backend starts the flow from the saved settings, so the client id has to be stored first.
    await modal.getByPlaceholder('GitHub OAuth client ID').fill('spec-client-id');
    await modal.getByRole('button', { name: 'Save OAuth settings' }).click();
    await expect(page.getByText('OAuth settings saved.')).toBeVisible();
    await modal.getByRole('button', { name: 'Start sign-in' }).click();
}

test.describe('provider-backed settings', () => {
    test('verifies a token against the provider and keeps the account', async ({ page }) => {
        await setProviderStubMode('slow');

        const modal = await openCreateAccount(page);
        await modal.getByPlaceholder('Account label').fill('Spec Token');
        await modal.locator('select').first().selectOption('github');
        await modal.locator('select').nth(1).selectOption('https-token');
        await modal.getByPlaceholder('Personal access token').fill('stub-token');
        await modal.getByRole('button', { name: 'Create account' }).click();

        await expect(page.getByText('Account created.')).toBeVisible();
        const row = accountRows(modal).filter({ hasText: 'Spec Token' });
        await expect(row).toBeVisible();
        // The account carries the username the provider's answer named, not anything typed here.
        await expect(row).toContainText('github · https-token');
        await expect(modal.getByRole('button', { name: 'Spec Token', exact: true })).toBeVisible();
    });

    test('reports a rejected token instead of creating the account', async ({ page }) => {
        expectBackendError('GitHub token verification failed.');
        await setProviderStubMode('fail');

        const modal = await openCreateAccount(page);
        await modal.getByPlaceholder('Account label').fill('Spec Rejected');
        await modal.locator('select').first().selectOption('github');
        await modal.locator('select').nth(1).selectOption('https-token');
        await modal.getByPlaceholder('Personal access token').fill('bad-token');
        await modal.getByRole('button', { name: 'Create account' }).click();

        await expect(page.locator('#app-error-banner')).toContainText('GitHub token verification failed.');
        await expect(accountRows(modal).filter({ hasText: 'Spec Rejected' })).toHaveCount(0);
    });

    test('starts a device sign-in and finishes it into an account', async ({ page }) => {
        // The slow interval keeps the waiting state on screen before the provider is polled again.
        await setProviderStubMode('slow');

        const modal = await openCreateAccount(page);
        await startGithubOAuthSignIn(page, modal, 'Spec OAuth');

        // The code and the URL come from the provider's device authorization answer.
        await expect(modal.getByText('Waiting for github authorization')).toBeVisible();
        await expect(modal.getByText('Code: STUB-CODE')).toBeVisible();
        await expect(modal.getByText('URL: https://stub.example.com/device')).toBeVisible();

        // The device flow reports its own success, and the account it created shows up beside it.
        await expect(page.getByText('GitHub account connected.')).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Spec OAuth', exact: true })).toBeVisible();
        await expect(accountRows(modal).filter({ hasText: 'Spec OAuth' })).toContainText('github · oauth');
    });

    test('reports a device sign-in that the provider refuses', async ({ page }) => {
        expectBackendError('GitHub device sign-in could not be started.');
        await setProviderStubMode('fail');

        const modal = await openCreateAccount(page);
        await startGithubOAuthSignIn(page, modal, 'Spec OAuth Failed');

        await expect(page.locator('#app-error-banner')).toContainText('GitHub device sign-in could not be started.');
        await expect(modal.getByText(/Waiting for github authorization/)).toBeHidden();
        await expect(accountRows(modal).filter({ hasText: 'Spec OAuth Failed' })).toHaveCount(0);
    });
});
