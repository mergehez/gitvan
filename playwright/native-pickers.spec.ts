import type { Locator, Page } from '@playwright/test';
import { createTempGitRepo, resetNativePickerStub, setNativePickerStub } from './support/nativeStub';
import { expect, openSandboxRepo, test } from './support/sandbox';

/** A tree header is identified by its id, so a group can be found by the name it shows. */
function groupHeader(page: Page, name: string): Locator {
    return page.locator('[data-testid^="file-tree-header-"]').filter({ hasText: name });
}

async function openSettingsPanel(page: Page, panel: string): Promise<Locator> {
    await page.getByTestId('repos-settings').click();

    const modal = page.getByTestId('centered-modal-surface').filter({ hasText: 'Settings' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: panel, exact: true }).click();

    return modal;
}

test.describe('native pickers', () => {
    const tempRepos: Array<{ remove: () => void }> = [];

    test.afterEach(() => {
        while (tempRepos.length > 0) {
            tempRepos.pop()!.remove();
        }

        resetNativePickerStub();
    });

    test('adds a repository chosen in the directory picker', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');

        const picked = createTempGitRepo();
        tempRepos.push(picked);
        setNativePickerStub({ directory: picked.path });

        await groupHeader(page, 'Sandbox').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Add Repository to Sandbox', exact: true }).click();

        await expect(page.getByText('Repository added.')).toBeVisible();
        await expect(page.getByRole('button', { name: picked.name, exact: true })).toBeVisible();
    });

    test('adds an editor chosen from disk', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        const modal = await openSettingsPanel(page, 'Editors');
        await expect(modal.getByText('No editors configured yet.')).toBeVisible();

        // The label the row shows comes from the file name, which the picker derives.
        setNativePickerStub({ editor: { path: '/Applications/Spec Editor.app' } });
        await modal.getByRole('button', { name: 'Add editor' }).click();

        await expect(modal.getByTestId('settings-editor-/Applications/Spec Editor.app')).toContainText('Spec Editor');
    });

    test('adds a terminal chosen from disk', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        const modal = await openSettingsPanel(page, 'Terminals');

        setNativePickerStub({ terminal: { path: '/opt/homebrew/bin/spec-shell' } });
        await modal.getByRole('button', { name: 'Add terminal' }).click();

        await expect(modal.getByTestId('settings-terminal-/opt/homebrew/bin/spec-shell')).toContainText('spec-shell');
    });

    test('a cancelled picker adds nothing and reports nothing', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        const modal = await openSettingsPanel(page, 'Editors');

        // The picker answers `undefined`, which the browser transport carries as `null`. Before the
        // dev server answered a body for that, the renderer failed parsing the empty response.
        setNativePickerStub({});
        await modal.getByRole('button', { name: 'Add editor' }).click();

        await expect(modal.getByText('No editors configured yet.')).toBeVisible();
        await expect(page.locator('#app-error-banner')).toBeHidden();
    });
});
