import { expect, type Page } from '@playwright/test';

/**
 * Resets the sandbox labs, opens the named one and leaves the app on the Changes view.
 * The active view and the selected repository are persisted, so specs must not assume them.
 */
export async function openSandboxRepo(page: Page, name: string) {
    await page.goto('/');
    await page.waitForTimeout(500);

    const resetFinished = page.waitForResponse((response) => response.url().includes('/api/resetSandboxRepos'), { timeout: 10_000 });
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#hidden-reset-sandboxes')?.click());
    await resetFinished;

    const repoButton = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();
    await expect(repoButton).toBeVisible({ timeout: 5000 });
    await repoButton.click({ force: true });
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Changes', exact: true }).click();
}
