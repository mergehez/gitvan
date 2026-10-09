import type { Locator, Page } from '@playwright/test';
import { expect } from './sandbox';

/** The compact popover every discard, delete, revert and abort flow confirms through. */
export function confirmationPopover(page: Page): Locator {
    return page.getByTestId('confirmation-popover');
}

export async function confirmPopover(page: Page): Promise<void> {
    const popover = confirmationPopover(page);
    await expect(popover).toBeVisible();
    await page.getByTestId('confirmation-popover-confirm').click();
    await expect(popover).toBeHidden();
}

export async function cancelPopover(page: Page): Promise<void> {
    const popover = confirmationPopover(page);
    await expect(popover).toBeVisible();
    await page.getByTestId('confirmation-popover-cancel').click();
    await expect(popover).toBeHidden();
}
