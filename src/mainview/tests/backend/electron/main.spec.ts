import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
    BrowserWindow: vi.fn(),
    app: { whenReady: vi.fn(), on: vi.fn() },
    dialog: {},
    shell: {},
}));
vi.mock('electron', () => electron);

const nativeMethods = vi.hoisted(() => ({
    createNativeMethods: vi.fn(() => ({ openExternalUrl: vi.fn() })),
    createApplicationMenu: vi.fn(() => [{ label: 'Gitvan' }]),
}));
vi.mock('../../../../electron/nativeMethods.js', () => nativeMethods);

const helpers = vi.hoisted(() => ({ start: vi.fn() }));
const captured = vi.hoisted(() => ({ options: undefined as any }));
vi.mock('../../../../electronUtils/mainProloadHelpers.js', () => ({
    createElectronHelpers: vi.fn((options: any) => {
        captured.options = options;

        return helpers;
    }),
}));

describe('the electron main entry point', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('builds the helpers, the native methods and the menu, then starts', async () => {
        const mainWindow = { webContents: { send: vi.fn() } };

        await import('../../../../electron/main.js');

        // The real, generated method list is handed straight to the helpers factory.
        expect(captured.options.apiMethods).toContain('abortMerge');
        expect(captured.options.getNativeMethods(mainWindow, expect.any(Function))).toEqual({ openExternalUrl: expect.any(Function) });
        expect(nativeMethods.createNativeMethods).toHaveBeenCalledWith({ mainWindow, apiPost: expect.any(Function) });
        expect(captured.options.getMenu(mainWindow)).toEqual([{ label: 'Gitvan' }]);
        expect(nativeMethods.createApplicationMenu).toHaveBeenCalledWith(mainWindow);
        expect(helpers.start).toHaveBeenCalledTimes(1);
    });
});
