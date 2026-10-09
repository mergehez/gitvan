import type { Locator, Page } from '@playwright/test';
import { expect } from './sandbox';

export type ChangeSection = 'staged' | 'unstaged';

/** A change row carries its section, so the same path resolves on either side of the view. */
export function changeRow(page: Page, section: ChangeSection, fileName: string): Locator {
    return page.getByTestId(`file-tree-item-${section}-${fileName}`).first();
}

/**
 * Opens a change row's context menu and picks one labelled entry. The menu is the only way to
 * reach the stage, discard, delete and revert actions, because the row buttons are hover-only.
 */
export async function runChangeRowAction(page: Page, section: ChangeSection, fileName: string, label: string): Promise<void> {
    const row = changeRow(page, section, fileName);
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });

    const entry = page.getByRole('menuitem', { name: label, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
}
