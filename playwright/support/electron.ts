import { createServer } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Launching the built app rather than the Vite dev server is the point of this spec: it is the only
 * run that exercises `dist-electron/main.cjs`, the real preload bridge, the IPC registration, the
 * window and the application menu.
 *
 * Requires `bun run build` first; `bun run test:electron` does that for you, and
 * `PLAYWRIGHT_SKIP_BUILD=1` reuses whatever is already in `dist/` and `dist-electron/`.
 */

/** `playwright/electron.config.ts` created this before the workers started. */
const dataDir = process.env.GITVAN_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'gitvan-electron-'));

export type LaunchedApp = {
    app: ElectronApplication;
    page: Page;
    close: () => Promise<void>;
};

/** A port pair the running app and the browser run are both unlikely to hold. */
async function freePortPair(): Promise<[number, number]> {
    async function isFree(port: number) {
        return await new Promise<boolean>((resolve) => {
            const probe = createServer()
                .once('error', () => resolve(false))
                .once('listening', () => probe.close(() => resolve(true)))
                .listen(port, '127.0.0.1');
        });
    }

    for (let port = 5376; port < 5500; port += 2) {
        if ((await isFree(port)) && (await isFree(port + 1))) {
            return [port, port + 1];
        }
    }

    throw new Error('No free port pair for the Electron run.');
}

/** `ELECTRON_RUN_AS_NODE` would turn the launch into a plain Node run, so it never travels along. */
function electronEnv(extra: Record<string, string>): Record<string, string> {
    const base = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined));

    return { ...base, ...extra } as Record<string, string>;
}

export async function launchApp(): Promise<LaunchedApp> {
    const [apiPort, vuePort] = await freePortPair();
    const app = await electron.launch({
        args: [join(process.cwd(), 'dist-electron', 'main.cjs')],
        cwd: process.cwd(),
        env: electronEnv({
            APP_DATA_DIR: join(dataDir, `app-${apiPort}`),
            GITVAN_API_PORT: String(apiPort),
            GITVAN_VUE_PORT: String(vuePort),
            GITVAN_PROVIDER_BASE: process.env.PLAYWRIGHT_PROVIDER_STUB_BASE ?? 'http://127.0.0.1:5278',
            NODE_ENV: 'production',
        }),
        timeout: 60_000,
    });

    const page = await app.firstWindow({ timeout: 60_000 });
    // The sidebar renders its reset control only after the bootstrap has landed, so it doubles as
    // the signal that the backend answered through the real IPC bridge.
    await page.waitForSelector('#hidden-reset-sandboxes', { state: 'attached', timeout: 60_000 });

    return {
        app,
        page,
        close: async () => {
            await app.close();
            rmSync(join(dataDir, `app-${apiPort}`), { recursive: true, force: true });
        },
    };
}

/** The backdrop is the dialog's parent and closes the modal on a self click. */
export function modalBackdrop(page: Page) {
    return page.locator('[role="dialog"]').locator('xpath=..');
}

/** Recreates the sandbox labs, which are the only repositories this run has. */
export async function resetSandboxRepos(page: Page) {
    await page.evaluate(() => window.electronAPI!.invoke('resetSandboxRepos', {}));
}

export async function openRepoContextMenu(page: Page, name: string) {
    await page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first().click({ button: 'right' });
}
