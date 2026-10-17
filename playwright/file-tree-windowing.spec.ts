import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Locator, Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/**
 * The labs ship only a handful of changed files, so windowing never engages in them. This spec
 * grows the partial-changes lab on disk — `sandbox/partial-changes-lab/repo` is git-ignored and
 * rebuilt by `openSandboxRepo` — and checks that a long list mounts a window, not every row.
 */
const labRepoPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'sandbox', 'partial-changes-lab', 'repo');
const bulkDirectory = join(labRepoPath, 'zz-bulk');
const bulkFileCount = 1000;
const stagedBulkFileCount = 120;

function bulkFileName(index: number) {
    return `zz-bulk-${String(index).padStart(3, '0')}.txt`;
}

function writeBulkFiles() {
    rmSync(bulkDirectory, { recursive: true, force: true });
    mkdirSync(bulkDirectory, { recursive: true });

    for (let index = 0; index < bulkFileCount; index += 1) {
        writeFileSync(join(bulkDirectory, bulkFileName(index)), `bulk ${index}\n`, 'utf8');
    }
}

/** Leaves `stagedBulkFileCount` files in the index and the rest in the working tree. */
function stageBulkFiles() {
    execFileSync('git', ['add', '--', ...Array.from({ length: stagedBulkFileCount }, (_, index) => join('zz-bulk', bulkFileName(index)))], {
        cwd: labRepoPath,
        stdio: 'ignore',
    });
}

function bulkRow(page: Page, index: number, kind: 'staged' | 'unstaged' = 'unstaged') {
    return page.getByTestId(`file-tree-item-${kind}-zz-bulk/${bulkFileName(index)}`);
}

async function reloadChanges(page: Page, expectedRow: Locator) {
    // Selecting another repository and coming back re-reads the changes list from disk.
    await page.getByRole('button', { name: 'cosmetics', exact: true }).click();
    await page.getByRole('button', { name: 'partial-changes', exact: true }).click();
    await expect(expectedRow).toBeAttached();
}

/** The element that owns the scroll position of the changes panel. */
function changesScroller(row: Locator) {
    return row.evaluateHandle((element) => {
        for (let current = element.parentElement; current; current = current.parentElement) {
            const style = getComputedStyle(current);

            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && current.scrollHeight > current.clientHeight + 1) {
                return current;
            }
        }

        throw new Error('No scroll container above the changes tree.');
    });
}

test.afterAll(() => {
    rmSync(bulkDirectory, { recursive: true, force: true });
});

test.describe('file tree windowing', () => {
    test('mounts a window for a long changes list and reveals the rest on scroll', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        writeBulkFiles();
        await reloadChanges(page, bulkRow(page, 0));

        const unstagedRows = page.locator('[data-testid^="file-tree-item-unstaged-"]');

        // Every bulk file is in the model, but only a slice of them is mounted.
        await expect(unstagedRows.first()).toBeVisible();
        expect(await unstagedRows.count()).toBeLessThan(bulkFileCount);

        const scroller = await changesScroller(bulkRow(page, 0));

        // The panel has its final height once the layout settles; a scroll set before that clamps.
        await expect.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(true);

        await scroller.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });

        // The list keeps its full height, so the end of it is reachable.
        await expect(bulkRow(page, bulkFileCount - 1)).toBeVisible();
        expect(await unstagedRows.count()).toBeLessThan(bulkFileCount);
    });

    /**
     * Both sections share the panel's scroll container. A windowed section that scrolls past
     * the viewport must stop at its own end; otherwise its spacer grows with every scroll,
     * pushing the section below it away and leaving the list unreachable.
     */
    test('keeps a windowed section above the viewport at its own height', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        writeBulkFiles();
        stageBulkFiles();
        await reloadChanges(page, bulkRow(page, 0, 'staged'));

        const stagedRows = page.locator('[data-testid^="file-tree-item-staged-"]');
        const unstagedRows = page.locator('[data-testid^="file-tree-item-unstaged-"]');
        const stagedSection = await bulkRow(page, 0, 'staged').evaluateHandle((element) => element!.closest('section'));
        const unstagedCount = bulkFileCount - stagedBulkFileCount;

        await expect(bulkRow(page, 0, 'staged')).toBeVisible();
        expect(await stagedRows.count()).toBeLessThan(stagedBulkFileCount);
        expect(await unstagedRows.count()).toBeLessThan(unstagedCount);

        const scroller = await changesScroller(bulkRow(page, 0, 'staged'));
        const initialScrollHeight = await scroller.evaluate((element) => element.scrollHeight);
        const initialStagedHeight = await stagedSection.evaluate((element) => element!.getBoundingClientRect().height);

        await expect.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(true);

        await scroller.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });

        // The list below is reachable, and scrolling by a fixed amount cannot grow the panel.
        await expect(bulkRow(page, bulkFileCount - 1)).toBeVisible();
        expect(await scroller.evaluate((element) => element.scrollHeight)).toBeLessThanOrEqual(initialScrollHeight + 4);

        // The section above the viewport keeps its real height instead of a spacer that grew with
        // the scroll offset: the extra height would be the blank strip the user scrolls through.
        const stagedHeight = await stagedSection.evaluate((element) => element!.getBoundingClientRect().height);
        expect(stagedHeight).toBeLessThanOrEqual(initialStagedHeight + 4);
        expect(await stagedRows.count()).toBe(0);
    });
});
