import type { Locator, Page } from '@playwright/test';
import { confirmPopover } from './support/confirmation';
import { expect, openSandboxRepo, seedEditorApps, test } from './support/sandbox';

async function openSettingsPanel(page: Page, panel: string): Promise<Locator> {
    await page.getByTestId('repos-settings').click();

    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: 'Settings' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: panel, exact: true }).click();

    return modal;
}

/**
 * The panels list what is in the stored settings, which no browser flow can add (both Add buttons
 * open a native picker), so the seed is written through the API and the app reloads to read it.
 */
async function openPanelWithSeed(page: Page, seed: Parameters<typeof seedEditorApps>[0], panel: string): Promise<Locator> {
    await openSandboxRepo(page, 'partial-changes');
    await seedEditorApps(seed);
    await page.reload();
    await expect(page.getByTestId('repos-settings')).toBeVisible();

    return await openSettingsPanel(page, panel);
}

const nova = { path: '/Applications/Nova.app', label: 'Nova' };
const zed = { path: '/Applications/Zed.app', label: 'Zed' };
const fish = { path: '/opt/homebrew/bin/fish', label: 'fish' };

test.describe('settings editors and terminals', () => {
    test('shows the empty editor list and the built-in terminal', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        const modal = await openSettingsPanel(page, 'Editors');

        await expect(modal.getByText('No editors configured yet.')).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Add editor' })).toBeVisible();

        await modal.getByRole('button', { name: 'Terminals', exact: true }).click();

        // The platform's built-in shell is locked, so it can be the default but not removed.
        const builtIn = modal.locator('[data-testid^="settings-terminal-"]').filter({ hasText: 'Built-in' });
        await expect(builtIn).toBeVisible();
        await expect(builtIn.getByRole('button', { name: 'Default' })).toBeVisible();
        await expect(builtIn.getByRole('button', { name: 'Remove' })).toBeDisabled();
    });

    test('switches the default editor and removes one', async ({ page }) => {
        const modal = await openPanelWithSeed(page, { editors: [nova, zed], defaultEditorPath: nova.path }, 'Editors');

        const novaRow = modal.getByTestId(`settings-editor-${nova.path}`);
        const zedRow = modal.getByTestId(`settings-editor-${zed.path}`);
        await expect(novaRow.getByRole('button', { name: 'Default' })).toBeVisible();
        await expect(zedRow.getByRole('button', { name: 'Make default' })).toBeVisible();

        await zedRow.getByRole('button', { name: 'Make default' }).click();

        await expect(zedRow.getByRole('button', { name: 'Default' })).toBeVisible();
        await expect(novaRow.getByRole('button', { name: 'Make default' })).toBeVisible();

        await novaRow.getByRole('button', { name: 'Remove' }).click();
        await confirmPopover(page);

        await expect(novaRow).toBeHidden();
        await expect(zedRow).toBeVisible();
    });

    test('switches the default terminal and removes a custom one', async ({ page }) => {
        const modal = await openPanelWithSeed(page, { terminals: [fish, { path: '/bin/zsh', label: 'zsh' }], defaultTerminalPath: '/bin/zsh' }, 'Terminals');

        const fishRow = modal.getByTestId(`settings-terminal-${fish.path}`);
        const zshRow = modal.getByTestId('settings-terminal-/bin/zsh');
        await expect(zshRow.getByRole('button', { name: 'Default' })).toBeVisible();
        await expect(fishRow.getByRole('button', { name: 'Make default' })).toBeVisible();
        await expect(fishRow).not.toContainText('Built-in');

        await fishRow.getByRole('button', { name: 'Make default' }).click();

        await expect(fishRow.getByRole('button', { name: 'Default' })).toBeVisible();

        await fishRow.getByRole('button', { name: 'Remove' }).click();
        await confirmPopover(page);

        await expect(fishRow).toBeHidden();
        await expect(zshRow).toBeVisible();
    });
});
