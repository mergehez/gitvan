import { writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { spawn } from 'node-pty';
import { expect, test } from '@playwright/test';
import { launchApp, modalBackdrop, openRepoContextMenu, resetSandboxRepos, type LaunchedApp } from './support/electron';

/**
 * A sandboxed runner refuses `posix_openpt`, so the session never starts and the terminal dialog stays
 * on "Starting shell…". The unit PTY cases stand down the same way; probe it once here too, because a
 * failure in this case would also skip the window-quit case that follows it in serial mode.
 */
function detectPtySupport() {
    try {
        const probe = spawn('/bin/sh', ['-c', 'true'], { name: 'xterm-256color', cols: 80, rows: 24 });
        probe.kill('SIGHUP');

        return true;
    } catch {
        return false;
    }
}

const ptyWorks = process.platform !== 'win32' && detectPtySupport();

/**
 * The Electron shell, end to end against the packaged bundle: the real preload bridge, the IPC
 * registration, window creation, the application menu, a native command driven into the renderer,
 * the localhost backend answered through IPC, and the integrated terminal's PTY.
 *
 * The browser specs prove the opposite boundary — see `native-boundary.spec.ts` — so together they
 * pin both sides of "native only exists in the shell".
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('the Electron shell', () => {
    let launched: LaunchedApp;

    test.beforeAll(async () => {
        launched = await launchApp();
    });

    test.afterAll(async () => {
        await launched?.close();
    });

    test('loads the built renderer over the file protocol with the window the host created', async () => {
        const { app, page } = launched;

        expect(page.url()).toMatch(/^file:\/\/.*\/dist\/index\.html$/);

        // The real window, created by `createWindow`, not a page Playwright opened.
        const windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
        expect(windowCount).toBe(1);

        const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
        expect(bounds.width).toBeGreaterThan(500);
        expect(bounds.height).toBeGreaterThan(400);

        const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
        expect(title).toBe('Gitvan');
    });

    test('installs the application menu with its settings accelerator', async () => {
        const { app } = launched;

        const menu = await app.evaluate(({ Menu }) => {
            const flatten = (items: Electron.MenuItem[], trail: string[] = []): Array<{ label: string; accelerator: string | null; trail: string[] }> =>
                items.flatMap((item) => [
                    { label: item.label, accelerator: item.accelerator, trail },
                    ...(item.submenu ? flatten(item.submenu.items, [...trail, item.label]) : []),
                ]);

            return flatten(Menu.getApplicationMenu()?.items ?? []);
        });

        expect(menu.map((item) => item.label)).toEqual(expect.arrayContaining(['Gitvan', 'Edit', 'View']));
        expect(menu.find((item) => item.label === 'Open Settings')).toMatchObject({ accelerator: 'CmdOrCtrl+,', trail: ['Gitvan'] });
        expect(menu.find((item) => item.label === 'Toggle Developer Tools')).toMatchObject({ accelerator: 'CmdOrCtrl+Alt+I', trail: ['View'] });
        expect(menu.find((item) => item.label === 'Reload')).toMatchObject({ accelerator: 'CmdOrCtrl+R', trail: ['View'] });
    });

    test('opens Settings from the real menu item through the native-command channel', async () => {
        const { app, page } = launched;

        expect(await page.getByText('Settings', { exact: true }).count()).toBe(0);

        await app.evaluate(({ Menu }) => {
            const gitvan = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Gitvan');
            gitvan?.submenu?.items.find((item) => item.label === 'Open Settings')?.click();
        });

        const modal = page.getByRole('dialog');
        await expect(modal).toBeVisible();
        // The modal draws the title twice (header and panel heading).
        await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible();
        for (const panel of ['Repositories', 'Editors', 'Terminals', 'Accounts']) {
            await expect(page.getByRole('button', { name: panel, exact: true })).toBeVisible();
        }

        await modalBackdrop(page).click({ position: { x: 10, y: 10 } });
        await expect(modal).toBeHidden();
    });

    test('answers the backend through the real preload bridge', async () => {
        const { page } = launched;

        const bootstrap = (await page.evaluate(() => window.electronAPI!.invoke('getBootstrap'))) as {
            sandboxLabsAvailable: boolean;
            repos: Array<{ id: number; name: string }>;
            groups: unknown[];
        };

        expect(bootstrap.sandboxLabsAvailable).toBe(true);
        expect(bootstrap.repos.every((repo) => typeof repo.id === 'number' && typeof repo.name === 'string')).toBe(true);
        expect(Array.isArray(bootstrap.groups)).toBe(true);

        // A method the browser dev server answers instead of the backend still travels the same
        // `api:<name>` channel, so the unknown-method error proves the channel is registered.
        await expect(page.evaluate(() => window.electronAPI!.invoke('notARealApiMethod', {}))).rejects.toThrow(/No handler registered for 'api:notARealApiMethod'/);
    });

    test('runs a native method that has no browser counterpart', async () => {
        const { page } = launched;
        const probePath = join(tmpdir(), 'gitvan-electron-spec-probe.txt');
        writeFileSync(probePath, 'probe\n');

        try {
            // `revealPathInFileManager` exists only in the shell; the same call reports the native
            // boundary in browser dev mode (see `native-boundary.spec.ts`). Both modes have to reach
            // the host: `shell.showItemInFolder` and `shell.openPath` each answer differently.
            const results = await page.evaluate(
                async ({ filePath, directoryPath }) => {
                    return [
                        await window.electronAPI!.invoke('revealPathInFileManager', { path: filePath, mode: 'reveal-item' }),
                        await window.electronAPI!.invoke('revealPathInFileManager', { path: directoryPath, mode: 'open-directory' }),
                    ];
                },
                { filePath: probePath, directoryPath: dirname(probePath) }
            );

            expect(results).toEqual([undefined, undefined]);
        } finally {
            rmSync(probePath, { force: true });
        }
    });

    test('opens and closes the integrated terminal on a real PTY', async () => {
        test.skip(!ptyWorks, 'This runner refuses posix_openpt, so no terminal session can start.');

        const { page } = launched;

        await resetSandboxRepos(page);
        await openRepoContextMenu(page, 'partial-changes');
        await page.getByRole('menuitem', { name: 'Open in Integrated Terminal', exact: true }).click();

        const terminalHost = page.locator('.integrated-terminal-host');
        await expect(terminalHost).toBeVisible();
        // The shell path and its working directory come from the session the main process opened.
        await expect(page.locator('[role="dialog"]')).toContainText('/bin/');

        await terminalHost.click();
        // xterm draws into a canvas-adjacent DOM, so the assertion reads its rendered rows.
        await expect(terminalHost).toContainText(/repo %/);
        await page.keyboard.type('echo shell-round-trip\n');
        // The shell echoes the typed line and then prints the command's output; both arrive through
        // `native-command` events, so two matches mean the PTY sent data and the renderer drew it.
        await expect(terminalHost).toContainText(/(shell-round-trip[\s\S]*){2}/);

        await modalBackdrop(page).click({ position: { x: 10, y: 10 } });
        await expect(page.locator('[role="dialog"]')).toBeHidden();
    });

    test('quits when its last window is closed', async () => {
        const { app } = launched;

        const exited = new Promise<number | null>((resolve) => app.process().once('exit', resolve));

        // This is exactly what the user does: close the window. The app has no dock-only mode, so it
        // must exit with a clean code instead of staying alive and reopening into a blank window.
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());

        expect(await exited).toBe(0);
    });
});
