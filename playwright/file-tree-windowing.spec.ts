import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/**
 * The labs ship only a handful of changed files, so windowing never engages in them. This spec
 * grows the partial-changes lab on disk — `sandbox/partial-changes-lab/repo` is git-ignored and
 * rebuilt by `openSandboxRepo` — and checks that a long list mounts a window, not every row.
 */
const labRepoPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'sandbox', 'partial-changes-lab', 'repo');
const bulkDirectory = join(labRepoPath, 'zz-bulk');
const bulkFileCount = 140;

function writeBulkFiles() {
    rmSync(bulkDirectory, { recursive: true, force: true });
    mkdirSync(bulkDirectory, { recursive: true });

    for (let index = 0; index < bulkFileCount; index += 1) {
        writeFileSync(join(bulkDirectory, `zz-bulk-${String(index).padStart(3, '0')}.txt`), `bulk ${index}\n`, 'utf8');
    }
}

function bulkRow(page: Page, index: number) {
    return page.getByTestId(`file-tree-item-unstaged-zz-bulk/zz-bulk-${String(index).padStart(3, '0')}.txt`);
}

async function reloadChanges(page: Page) {
    // Selecting another repository and coming back re-reads the changes list from disk.
    await page.getByRole('button', { name: 'cosmetics', exact: true }).click();
    await page.getByRole('button', { name: 'partial-changes', exact: true }).click();
    await expect(bulkRow(page, 0)).toBeAttached();
}

test.afterAll(() => {
    rmSync(bulkDirectory, { recursive: true, force: true });
});

test.describe('file tree windowing', () => {
    test('mounts a window for a long changes list and reveals the rest on scroll', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        writeBulkFiles();
        await reloadChanges(page);

        const unstagedRows = page.locator('[data-testid^="file-tree-item-unstaged-"]');

        // Every bulk file is in the model, but only a slice of them is mounted.
        await expect(unstagedRows.first()).toBeVisible();
        expect(await unstagedRows.count()).toBeLessThan(bulkFileCount);

        await bulkRow(page, 0).hover();

        for (let step = 0; step < 6; step += 1) {
            await page.mouse.wheel(0, 1200);
        }

        // The list keeps its full height, so the end of it is reachable.
        await expect(bulkRow(page, bulkFileCount - 1)).toBeVisible();
        expect(await unstagedRows.count()).toBeLessThan(bulkFileCount);
    });
});
