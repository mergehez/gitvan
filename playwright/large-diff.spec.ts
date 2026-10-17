import { rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';
import { expect, openSandboxRepo, test } from './support/sandbox';

/**
 * A 790 KB untracked JSON is what freezes the changes view: the diff renderer used to mount every
 * line, and the app stayed slow after that DOM was built. This spec grows the partial-changes lab
 * with a comparable file (the lab repo is gitignored and rebuilt by `openSandboxRepo`).
 */
const labRepoPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'sandbox', 'partial-changes-lab', 'repo');
// Sorts before the lab's own unstaged files, so the changes view selects it on reload.
const largeDiffFile = join(labRepoPath, 'aaa-large-diff.json');
const largeDiffRecordCount = 14_000;

function writeLargeDiffFile() {
    const lines = ['{', '  "records": ['];

    for (let index = 0; index < largeDiffRecordCount; index += 1) {
        lines.push(`    { "id": ${index}, "label": "record-${index}", "value": "value-${index}" }`);
    }

    lines.push('  ]', '}');
    writeFileSync(largeDiffFile, `${lines.join('\n')}\n`, 'utf8');
}

async function reloadChanges(page: Page) {
    // Selecting another repository and coming back re-reads the changes list from disk.
    await page.getByRole('button', { name: 'cosmetics', exact: true }).click();
    await page.getByRole('button', { name: 'partial-changes', exact: true }).click();
}

function readDiffRender(page: Page) {
    return page.evaluate(() => {
        const container = document.querySelector('[data-testid="diffs-diff-editor-root"]')?.querySelector('diffs-container');
        const shadow = container?.shadowRoot;
        const lines = shadow ? [...shadow.querySelectorAll('[data-line]')] : [];

        return {
            lines: lines.length,
            lastText: lines.at(-1)?.textContent ?? '',
        };
    });
}

test.afterAll(() => {
    rmSync(largeDiffFile, { force: true });
});

test.describe('large diff rendering', () => {
    test('mounts only a window of a 14k-line diff and keeps its end reachable', async ({ page }) => {
        await openSandboxRepo(page, 'partial-changes');
        writeLargeDiffFile();
        await reloadChanges(page);

        await expect(page.getByTestId('diff-viewer-title')).toHaveText('aaa-large-diff.json');

        // The renderer's own rows, not the whole file: 14k lines would block the renderer for
        // seconds and keep the app slow while that DOM stays mounted.
        await expect.poll(async () => (await readDiffRender(page)).lines).toBeGreaterThan(0);
        expect((await readDiffRender(page)).lines).toBeLessThan(1_000);

        const diffRoot = page.getByTestId('diffs-diff-editor-root');
        await expect.poll(() => diffRoot.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(true);

        await diffRoot.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });

        // The spacer stands in for the unmounted rows, so the end of the file is still reachable.
        await expect.poll(async () => (await readDiffRender(page)).lastText).toContain('}');
        expect((await readDiffRender(page)).lines).toBeLessThan(1_000);
    });
});
