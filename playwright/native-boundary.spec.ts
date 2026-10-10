import { expect, openSandboxRepo, probeApi, test } from './support/sandbox';

/**
 * The methods only `src/electron/main.ts` implements. Browser dev mode has no native host, so each
 * one has to answer with the boundary message the renderer turns into a recoverable error. A
 * dev-server stub for any of them makes this list fail on purpose, so the guard is updated with it.
 */
const nativeOnlyMethods = [
    'openFileInEditor',
    'revealPathInFileManager',
    'openPathWithDefaultProgram',
    'openDirectoryInTerminal',
    'createIntegratedTerminalSession',
    'writeIntegratedTerminalSession',
    'resizeIntegratedTerminalSession',
    'closeIntegratedTerminalSession',
];

test.describe('native-only calls in browser dev mode', () => {
    test('every native-only RPC reports itself unavailable', async () => {
        for (const method of nativeOnlyMethods) {
            const { status, body } = await probeApi(method, {});

            expect(status, method).toBe(500);
            expect(body, method).toContain(`Method ${method} is not implemented in browser dev mode.`);
        }
    });

    test('the methods the dev server stands in for answer instead of reporting the boundary', async () => {
        // The OAuth device flow opens the provider page and the Settings panels open a file
        // picker, so browser dev mode answers those four rather than reporting the boundary.
        for (const method of ['openExternalUrl', 'pickDirectory', 'pickEditorApplication', 'pickTerminalApplication']) {
            const { status } = await probeApi(method, method === 'openExternalUrl' ? { url: 'https://stub.example.com/device' } : {});

            expect(status, method).toBe(200);
        }
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
