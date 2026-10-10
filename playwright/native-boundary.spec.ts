import type { Page } from '@playwright/test';
import { expect, openSandboxRepo, probeApi, test } from './support/sandbox';

/**
 * The methods only `src/electron/main.ts` implements. Browser dev mode has no native host, so each
 * one has to answer with the boundary message the renderer turns into a recoverable error. A
 * dev-server stub for any of them makes this list fail on purpose, so the guard is updated with it.
 */
const nativeOnlyMethods = [
    'pickDirectory',
    'pickEditorApplication',
    'pickTerminalApplication',
    'openFileInEditor',
    'revealPathInFileManager',
    'openPathWithDefaultProgram',
    'openDirectoryInTerminal',
    'createIntegratedTerminalSession',
    'writeIntegratedTerminalSession',
    'resizeIntegratedTerminalSession',
    'closeIntegratedTerminalSession',
];

function errorBanner(page: Page) {
    return page.locator('#app-error-banner p');
}

async function openSettingsPanel(page: Page, panel: string) {
    await page.getByTestId('repos-settings').click();

    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: 'Settings' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: panel, exact: true }).click();

    return modal;
}

test.describe('native-only calls in browser dev mode', () => {
    test('every native-only RPC reports itself unavailable', async () => {
        for (const method of nativeOnlyMethods) {
            const { status, body } = await probeApi(method, {});

            expect(status, method).toBe(500);
            expect(body, method).toContain(`Method ${method} is not implemented in browser dev mode.`);
        }
    });

    test('opening an external URL is the one stand-in the dev server provides', async () => {
        // The OAuth device flow opens the provider page, so browser dev mode answers it instead of
        // reporting the boundary the other methods do.
        const { status } = await probeApi('openExternalUrl', { url: 'https://stub.example.com/device' });

        expect(status).toBe(200);
    });

    test('a native file picker reports the failure and leaves Settings usable', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        const modal = await openSettingsPanel(page, 'Editors');

        await modal.getByRole('button', { name: 'Add editor' }).click();

        await expect(errorBanner(page)).toContainText('Method pickEditorApplication is not implemented in browser dev mode.');
        // Nothing hangs: the panel still answers while the failure sits in the banner.
        await expect(modal.getByRole('button', { name: 'Add editor' })).toBeEnabled();
    });

    test('adding an existing repository reports the missing folder picker', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        await page.getByTestId('repos-add').click();
        await page.getByRole('button', { name: 'Add Existing Repository...' }).click();

        await expect(errorBanner(page)).toContainText('Method pickDirectory is not implemented in browser dev mode.');
        // The add menu closes and the sidebar keeps working, so the failure can be dismissed.
        await expect(page.getByRole('button', { name: 'Add Existing Repository...' })).toBeHidden();
        await page.locator('#app-error-banner').getByRole('button').click();
        await expect(errorBanner(page)).toBeHidden();
        await expect(page.getByTestId('repos-settings')).toBeEnabled();
    });

    test('the integrated terminal reports the missing session instead of opening', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        await page.getByRole('button', { name: 'partial-changes', exact: true }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Open in Integrated Terminal', exact: true }).click();

        await expect(page.getByText('Method createIntegratedTerminalSession is not implemented in browser dev mode.')).toBeVisible();
        // The modal closes itself instead of sitting on a shell that never starts.
        await expect(page.getByTestId('centered-modal-surface')).toBeHidden();
    });
});
