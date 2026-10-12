import { rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { expect, expectBackendError, openSandboxRepo, test } from './support/sandbox';

/**
 * A `.git/index.lock` — another Git program mid-write, or one a killed run left behind — makes git
 * refuse to write the index. The lab is rebuilt by `openSandboxRepo`, so the lock is written after
 * the repository is open and removed again when the spec ends.
 */
const labRepoPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'sandbox', 'partial-changes-lab', 'repo');
const lockPath = join(labRepoPath, '.git', 'index.lock');

test.afterEach(() => {
    rmSync(lockPath, { force: true });
});

test.describe('staging while the index is locked', () => {
    test('reports a friendly message instead of the raw git lock failure', async ({ page }) => {
        expectBackendError('Another Git program is using this repository');
        await openSandboxRepo(page, 'partial-changes');

        writeFileSync(lockPath, '', 'utf8');

        await page.getByTestId('changes-stage-all').click();

        const banner = page.locator('#app-error-banner p');
        await expect(banner).toContainText('Another Git program is using this repository');
        await expect(banner).not.toContainText('index.lock');
    });
});
