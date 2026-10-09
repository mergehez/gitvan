import { expect, type Page } from '@playwright/test';

/**
 * Opens the named sandbox lab. The repository the app auto-selects after a reset can be a merge
 * lab, whose conflict modal covers the sidebar, so the selection is dispatched on the button
 * itself instead of hit-tested through that overlay.
 */
async function selectRepo(page: Page, name: string) {
    const repoButton = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();
    await expect(repoButton).toBeVisible({ timeout: 5000 });
    await repoButton.dispatchEvent('click');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Changes', exact: true }).click();
}

/** Resets every sandbox lab, then opens the named one on the Changes view. */
export async function openSandboxRepo(page: Page, name: string) {
    await page.goto('/');

    // The reset button lives in the sidebar, which only renders once the bootstrap has landed.
    // A cold dev server can take longer than the default assertion timeout to get there.
    const resetButton = page.locator('#hidden-reset-sandboxes');
    await expect(resetButton).toBeAttached({ timeout: 10_000 });

    const resetFinished = page.waitForResponse((response) => response.url().includes('/api/resetSandboxRepos'), { timeout: 10_000 });
    // The button is deliberately hidden, so it can only be triggered programmatically.
    await resetButton.dispatchEvent('click');
    await resetFinished;

    await selectRepo(page, name);
}

/**
 * Opens the named sandbox lab without resetting it, for specs that deliberately continue from
 * the state a previous test left behind.
 */
export async function reopenSandboxRepo(page: Page, name: string) {
    await page.goto('/');
    await page.waitForTimeout(500);

    await selectRepo(page, name);
}
