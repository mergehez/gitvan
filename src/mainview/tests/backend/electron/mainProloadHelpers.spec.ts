import { sep } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronHelpers, createPreloadApi } from '../../../../electronUtils/mainProloadHelpers.js';

// The window helpers read `process.env` and `process.argv` when the helpers object is created, and
// the fs mock cannot survive `vi.resetModules()`, so every case builds its helpers right before use.
function withArgv(argv: string[], run: () => void) {
    const original = process.argv;

    process.argv = argv;
    try {
        run();
    } finally {
        process.argv = original;
    }
}

const electron = vi.hoisted(() => {
    const windowInstance = {
        webContents: { send: vi.fn(), on: vi.fn(), reload: vi.fn(), toggleDevTools: vi.fn() },
        loadURL: vi.fn().mockResolvedValue(undefined),
        loadFile: vi.fn().mockResolvedValue(undefined),
        getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1440, height: 1200 }),
        show: vi.fn(),
    };

    return {
        windowInstance,
        BrowserWindow: Object.assign(
            vi.fn(function BrowserWindow(this: unknown, _options?: Record<string, unknown>) {
                return windowInstance;
            }),
            { getAllWindows: vi.fn().mockReturnValue([windowInstance]) }
        ),
        app: {
            whenReady: vi.fn().mockReturnValue({ then: (fn: () => unknown) => Promise.resolve().then(fn) }),
            on: vi.fn(),
            quit: vi.fn(),
        },
        ipcMain: { handle: vi.fn(), on: vi.fn() },
        Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((template: unknown) => ({ template })) },
        screen: {
            getCursorScreenPoint: vi.fn().mockReturnValue({ x: 0, y: 0 }),
            getDisplayNearestPoint: vi.fn().mockReturnValue({ workAreaSize: { width: 2560, height: 1440 } }),
        },
        dialog: {},
        shell: {},
    };
});

vi.mock('electron', () => ({
    app: electron.app,
    BrowserWindow: electron.BrowserWindow,
    ipcMain: electron.ipcMain,
    Menu: electron.Menu,
    screen: electron.screen,
    dialog: electron.dialog,
    shell: electron.shell,
}));

/** `callApiPost` has its own spec; here it only has to record what the handlers forward. */
const callApiPost = vi.hoisted(() => vi.fn());
vi.mock('../../../../electronUtils/helpers.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../electronUtils/helpers.js')>();

    return { ...actual, callApiPost };
});

const existsSync = vi.fn(() => true);

function makeOptions() {
    const mainWindow = electron.windowInstance as unknown as Electron.BrowserWindow;
    const nativeMethod = vi.fn().mockResolvedValue('native-result');

    return {
        mainWindow,
        nativeMethod,
        opts: {
            apiMethods: ['loadRepos', 'stageFile'],
            getNativeMethods: vi.fn(() => ({ openPathWithDefaultProgram: nativeMethod })),
            getMenu: vi.fn(() => [{ label: 'Test' }]),
            fileExists: existsSync,
        },
    };
}

/** The factory's generics are inferred from a real service module; a fixture list needs the cast. */
function buildHelpers(opts: object) {
    return createElectronHelpers(opts as any);
}

describe('createElectronHelpers.generateHandlers', () => {
    beforeEach(() => {
        callApiPost.mockReset().mockResolvedValue({ ok: true });
    });

    it('builds one handler per backend method name plus the native methods', () => {
        const { opts, mainWindow, nativeMethod } = makeOptions();

        const handlers = buildHelpers(opts).generateHandlers(mainWindow);

        expect(Object.keys(handlers).sort()).toEqual(['loadRepos', 'openPathWithDefaultProgram', 'stageFile']);
        expect(typeof handlers.loadRepos).toBe('function');
        expect(handlers.openPathWithDefaultProgram).toBe(nativeMethod);
    });

    it('forwards the method name and the params to the API request wrapper', async () => {
        const { opts, mainWindow } = makeOptions();

        const handlers = buildHelpers(opts).generateHandlers(mainWindow);
        await handlers.loadRepos({ limit: 20 });

        expect(callApiPost).toHaveBeenCalledWith('loadRepos', { limit: 20 });
    });

    it('forwards an omitted params argument as undefined', async () => {
        const { opts, mainWindow } = makeOptions();

        const handlers = buildHelpers(opts).generateHandlers(mainWindow);
        await handlers.loadRepos();

        expect(callApiPost).toHaveBeenCalledWith('loadRepos', undefined);
    });

    it('hands the shared apiPost function and the window to getNativeMethods', () => {
        const { opts, mainWindow } = makeOptions();

        buildHelpers(opts).generateHandlers(mainWindow);

        expect(opts.getNativeMethods).toHaveBeenCalledWith(mainWindow, callApiPost);
    });

    it('resolves with whatever the API request wrapper returned', async () => {
        callApiPost.mockResolvedValue({ repos: [{ id: 1 }] });
        const { opts, mainWindow } = makeOptions();

        const handlers = buildHelpers(opts).generateHandlers(mainWindow);

        await expect(handlers.loadRepos()).resolves.toEqual({ repos: [{ id: 1 }] });
    });
});

describe('createElectronHelpers.createWindow', () => {
    beforeEach(() => {
        electron.BrowserWindow.mockClear();
        electron.Menu.setApplicationMenu.mockClear();
        electron.Menu.buildFromTemplate.mockClear();
        electron.ipcMain.handle.mockClear();
        electron.ipcMain.on.mockClear();
        electron.windowInstance.loadURL.mockClear();
        electron.windowInstance.loadFile.mockClear();
        electron.windowInstance.webContents.send.mockClear();
        electron.app.whenReady.mockClear();
        electron.app.on.mockClear();
        electron.BrowserWindow.getAllWindows.mockReturnValue([electron.windowInstance]);
        existsSync.mockReset().mockReturnValue(true);
        callApiPost.mockReset().mockResolvedValue({ ok: true });

    });

    /**
     * The helpers expose no direct `createWindow`, so it is reached through `start()`, with a backend
     * stand-in that resolves at once so the real bundle (and its server) never boots.
     */
    async function runCreateWindow(opts: object, argv: string[] = process.argv) {
        withArgv(argv, () => buildHelpers(opts).start(() => ({ ready: Promise.resolve() })));
        await vi.waitFor(() => expect(electron.Menu.setApplicationMenu).toHaveBeenCalled());
        // `loadFile`/`loadURL` are awaited inside `createWindow`, so they land a tick after the menu.
        await vi.waitFor(() => expect(electron.windowInstance.loadFile.mock.calls.length + electron.windowInstance.loadURL.mock.calls.length).toBe(1));
    }

    it('creates the window with the configured title, the resolved bounds and the hardened preload options', async () => {
        const { opts } = makeOptions();

        await runCreateWindow(opts);

        expect(electron.BrowserWindow).toHaveBeenCalledTimes(1);
        const options = electron.BrowserWindow.mock.calls[0][0] as Record<string, any>;
        expect(options).toMatchObject({
            title: 'Gitvan',
            x: 0,
            y: 0,
            width: 1440,
            height: 1440,
            titleBarStyle: 'default',
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
        });
        expect(options.webPreferences.preload.endsWith('preload.cjs')).toBe(true);
    });

    it('derives the default size from the display work area', async () => {
        const { opts } = makeOptions();
        const windowSize = vi.fn(() => ({ width: 800, height: 600, x: 10, y: 20 }));

        await runCreateWindow({ ...opts, windowSize });

        expect(windowSize).toHaveBeenCalledWith({ width: 2560, height: 1440 });
        expect(electron.BrowserWindow.mock.calls[0]?.[0]).toMatchObject({ width: 800, height: 600, x: 10, y: 20 });
    });

    it('installs the application menu built from the provided template', async () => {
        const { opts, mainWindow } = makeOptions();

        await runCreateWindow(opts);

        expect(opts.getMenu).toHaveBeenCalledWith(mainWindow);
        expect(electron.Menu.buildFromTemplate).toHaveBeenCalledWith([{ label: 'Test' }]);
        expect(electron.Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
    });

    it('registers the IPC handlers before loading the frontend', async () => {
        const { opts } = makeOptions();

        await runCreateWindow(opts);

        expect(electron.ipcMain.handle).toHaveBeenCalledWith('api:loadRepos', expect.any(Function));
        expect(electron.ipcMain.handle).toHaveBeenCalledWith('api:stageFile', expect.any(Function));
        expect(electron.ipcMain.handle).toHaveBeenCalledWith('api:openPathWithDefaultProgram', expect.any(Function));
        expect(electron.windowInstance.loadFile).toHaveBeenCalledTimes(1);
    });

    it('loads the built index file and reads the final bounds', async () => {
        const { opts } = makeOptions();

        await runCreateWindow(opts);

        expect(existsSync).toHaveBeenCalledWith(expect.stringContaining(`dist${sep}index.html`));
        const [loadedPath] = electron.windowInstance.loadFile.mock.calls[0] as unknown as [string];
        expect(loadedPath.endsWith(`dist${sep}index.html`)).toBe(true);
        expect(electron.windowInstance.getBounds).toHaveBeenCalled();
        expect(electron.windowInstance.loadURL).not.toHaveBeenCalled();
    });

    it('throws the missing-build error instead of loading a file that does not exist', async () => {
        existsSync.mockReturnValue(false);
        const { opts } = makeOptions();
        const rejection = new Promise<Error>((resolve) => {
            process.once('unhandledRejection', (reason) => resolve(reason as Error));
        });

        buildHelpers(opts).start(() => ({ ready: Promise.resolve() }));

        await expect(rejection).resolves.toMatchObject({ message: expect.stringMatching(/Frontend build not found/) });
        expect(electron.windowInstance.loadFile).not.toHaveBeenCalled();
    });

    it('uses the Vite dev server in dev mode when the probe answers', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchSpy);

        try {
            const { opts } = makeOptions();

            await runCreateWindow(opts, [...process.argv, '--dev']);

            expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:5177', { method: 'HEAD' });
            expect(electron.windowInstance.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5177');
            expect(electron.windowInstance.loadFile).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('falls back to the build when the dev-server probe rejects', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

        try {
            const { opts } = makeOptions();

            await runCreateWindow(opts, [...process.argv, '--dev']);

            expect(electron.windowInstance.loadFile).toHaveBeenCalledTimes(1);
            expect(electron.windowInstance.loadURL).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('recreates the window on activate only while none is open', async () => {
        const { opts } = makeOptions();

        await runCreateWindow(opts);

        const activate = electron.app.on.mock.calls.find(([event]) => event === 'activate')?.[1] as () => void;
        electron.BrowserWindow.getAllWindows.mockReturnValueOnce([]);

        activate();

        await vi.waitFor(() => expect(electron.BrowserWindow).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(electron.windowInstance.loadFile).toHaveBeenCalledTimes(2));
    });

    it('registers the lifecycle listeners that stop the backend', async () => {
        const { opts } = makeOptions();

        await runCreateWindow(opts);

        expect(electron.app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
        expect(electron.app.on).toHaveBeenCalledWith('will-quit', expect.any(Function));
    });
});

describe('createElectronHelpers.registerIpcHandlers', () => {
    const ANSI_RESET = '\x1b[0m';

    beforeEach(() => {
        electron.ipcMain.on.mockClear();
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function registerAndGetDiagnosticListener() {
        const { opts } = makeOptions();

        buildHelpers(opts).start(() => ({ ready: Promise.resolve() }));
        await vi.waitFor(() => expect(electron.ipcMain.on).toHaveBeenCalled());

        return electron.ipcMain.on.mock.calls.find(([channel]) => channel === 'renderer:diagnostic')?.[1] as (event: unknown, payload: any) => void;
    }

    it('routes every renderer diagnostic type to the matching console method', async () => {
        const listener = await registerAndGetDiagnosticListener();

        listener({}, { type: 'console-debug', message: 'dbg' });
        listener({}, { type: 'console-info', message: 'inf' });
        listener({}, { type: 'console-log', message: 'log' });
        listener({}, { type: 'console-warn', message: 'wrn' });
        listener({}, { type: 'console-error', message: 'err' });
        listener({}, { type: 'window-error', message: 'win' });
        listener({}, { type: 'unhandled-rejection', message: 'rej' });

        expect(console.debug).toHaveBeenCalledWith(`\x1b[32m[renderer:console-debug] dbg${ANSI_RESET}`);
        expect(console.log).toHaveBeenCalledWith(`\x1b[32m[renderer:console-info] inf${ANSI_RESET}`);
        expect(console.log).toHaveBeenCalledWith(`\x1b[32m[renderer:console-log] log${ANSI_RESET}`);
        expect(console.warn).toHaveBeenCalledWith(`\x1b[33m[renderer:console-warn] wrn${ANSI_RESET}`);
        expect(console.error).toHaveBeenCalledWith(`\x1b[31m[renderer:console-error] err${ANSI_RESET}`);
        expect(console.error).toHaveBeenCalledWith(`\x1b[31m[renderer:window-error] win${ANSI_RESET}`);
        expect(console.error).toHaveBeenCalledWith(`\x1b[31m[renderer:unhandled-rejection] rej${ANSI_RESET}`);
    });

    it('appends the optional details on their own line', async () => {
        const listener = await registerAndGetDiagnosticListener();

        listener({}, { type: 'console-error', message: 'boom', details: 'stack line' });

        expect(console.error).toHaveBeenCalledWith(`\x1b[31m[renderer:console-error] boom\nstack line${ANSI_RESET}`);
    });
});

describe('createPreloadApi', () => {
    function setup() {
        const nativeCommandListener = vi.fn();
        const ipcRenderer = {
            on: vi.fn((channel: string, listener: (event: unknown, command: unknown) => void) => {
                if (channel === 'native-command') nativeCommandListener.mockImplementation((command: unknown) => listener({}, command));
            }),
            invoke: vi.fn().mockResolvedValue('invoked'),
            send: vi.fn(),
        };
        const contextBridge = { exposeInMainWorld: vi.fn() };

        return { ipcRenderer, contextBridge, nativeCommandListener };
    }

    it('exposes the api on the electronAPI global and returns it', () => {
        const { ipcRenderer, contextBridge } = setup();

        const api = createPreloadApi(ipcRenderer as any, contextBridge as any);

        expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith('electronAPI', api);
        expect(api).toMatchObject({ invoke: expect.any(Function), onNativeCommand: expect.any(Function), sendDiagnostic: expect.any(Function) });
    });

    it('invokes the api:<name> channel with the params', async () => {
        const { ipcRenderer, contextBridge } = setup();
        const api = createPreloadApi(ipcRenderer as any, contextBridge as any);

        await expect(api.invoke('loadRepos', { limit: 5 })).resolves.toBe('invoked');

        expect(ipcRenderer.invoke).toHaveBeenCalledWith('api:loadRepos', { limit: 5 });
    });

    it('sends diagnostics on the renderer:diagnostic channel', () => {
        const { ipcRenderer, contextBridge } = setup();
        const api = createPreloadApi(ipcRenderer as any, contextBridge as any);

        api.sendDiagnostic({ type: 'console-log', message: 'hi' });

        expect(ipcRenderer.send).toHaveBeenCalledWith('renderer:diagnostic', { type: 'console-log', message: 'hi' });
    });

    it('fans a native command out to every subscriber', () => {
        const { ipcRenderer, contextBridge, nativeCommandListener } = setup();
        const api = createPreloadApi(ipcRenderer as any, contextBridge as any);
        const first = vi.fn();
        const second = vi.fn();

        api.onNativeCommand(first);
        api.onNativeCommand(second);
        nativeCommandListener({ kind: 'open-settings' });

        expect(first).toHaveBeenCalledWith({ kind: 'open-settings' });
        expect(second).toHaveBeenCalledWith({ kind: 'open-settings' });
    });

    it('stops calling a subscriber after it unsubscribes', () => {
        const { ipcRenderer, contextBridge, nativeCommandListener } = setup();
        const api = createPreloadApi(ipcRenderer as any, contextBridge as any);
        const listener = vi.fn();

        const unsubscribe = api.onNativeCommand(listener);
        nativeCommandListener({ kind: 'open-settings' });
        unsubscribe();
        nativeCommandListener({ kind: 'open-settings' });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('registers a single native-command listener no matter how many subscribers arrive', () => {
        const { ipcRenderer, contextBridge } = setup();
        const api = createPreloadApi(ipcRenderer as any, contextBridge as any);

        api.onNativeCommand(vi.fn());
        api.onNativeCommand(vi.fn());

        expect(ipcRenderer.on.mock.calls.filter(([channel]) => channel === 'native-command')).toHaveLength(1);
    });
});
