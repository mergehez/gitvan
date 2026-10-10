import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplicationMenu, createNativeMethods } from '../../../../electron/nativeMethods.js';

const electron = vi.hoisted(() => ({
    dialog: { showOpenDialog: vi.fn() },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn(), openPath: vi.fn() },
    BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

vi.mock('electron', () => ({
    dialog: electron.dialog,
    shell: electron.shell,
    BrowserWindow: electron.BrowserWindow,
}));

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('child_process')>();

    return { ...actual, default: actual, execFileSync };
});

const integratedTerminal = vi.hoisted(() => ({
    createIntegratedTerminalSession: vi.fn(),
    writeIntegratedTerminalSession: vi.fn(),
    resizeIntegratedTerminalSession: vi.fn(),
    closeIntegratedTerminalSession: vi.fn(),
}));
vi.mock('../../../../electron/integratedTerminal.js', () => integratedTerminal);

type RunCommand = Parameters<typeof createNativeMethods>[0]['runCommand'];

function setup(options: { platform?: NodeJS.Platform; fileExists?: (path: string) => boolean; runCommand?: RunCommand } = {}) {
    const mainWindow = { webContents: { send: vi.fn(), toggleDevTools: vi.fn(), reload: vi.fn(), show: vi.fn() } };
    const apiPost = vi.fn();
    const fileExists = options.fileExists ?? vi.fn(() => true);
    const runCommand = vi.fn<NonNullable<RunCommand>>().mockResolvedValue(undefined as never);
    if (options.runCommand) runCommand.mockImplementation(options.runCommand);
    const methods = createNativeMethods({
        mainWindow: mainWindow as any,
        apiPost,
        platform: options.platform ?? 'darwin',
        fileExists,
        runCommand,
    });

    return { mainWindow, apiPost, fileExists, runCommand, methods };
}

function openDialogResult(filePaths: string[], canceled = false) {
    return { canceled, filePaths };
}

beforeEach(() => {
    electron.dialog.showOpenDialog.mockReset();
    electron.shell.openExternal.mockReset().mockResolvedValue(undefined);
    electron.shell.showItemInFolder.mockReset();
    electron.shell.openPath.mockReset().mockResolvedValue('');
    electron.BrowserWindow.getAllWindows.mockReset().mockReturnValue([]);
    execFileSync.mockReset();
});

describe('the pickers', () => {
    it('returns the chosen editor with a trimmed label', async () => {
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult(['/Applications/Visual Studio Code.app']));
        const { methods, mainWindow } = setup();

        await expect(methods.pickEditorApplication()).resolves.toEqual({ path: '/Applications/Visual Studio Code.app', label: 'Visual Studio Code' });
        expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(mainWindow, {
            defaultPath: '/Applications',
            filters: [{ name: 'Applications', extensions: ['app'] }],
            properties: ['openFile'],
        });
    });

    it('trims a Windows executable suffix too', async () => {
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult(['C:/Tools/editor.exe']));
        const { methods } = setup({ platform: 'linux' });

        await expect(methods.pickEditorApplication()).resolves.toEqual({ path: 'C:/Tools/editor.exe', label: 'editor' });
    });

    it('returns undefined when the editor picker is cancelled', async () => {
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult([], true));
        const { methods } = setup();

        await expect(methods.pickEditorApplication()).resolves.toBeUndefined();
    });

    it('returns undefined when the editor picker reports no file', async () => {
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult([]));
        const { methods } = setup();

        await expect(methods.pickEditorApplication()).resolves.toBeUndefined();
    });

    it('offers /bin and an unlocked result for a terminal on darwin', async () => {
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult(['/bin/zsh']));
        const { methods } = setup();

        await expect(methods.pickTerminalApplication()).resolves.toEqual({ path: '/bin/zsh', label: 'zsh', locked: false });
        expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ defaultPath: '/bin', properties: ['openFile'] }));
    });

    it('offers System32 for a terminal on Windows', async () => {
        process.env.SystemRoot = 'D:\\Windows';
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult([]));

        try {
            const { methods } = setup({ platform: 'win32' });

            await methods.pickTerminalApplication();

            expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ defaultPath: 'D:\\Windows\\System32' }));
        } finally {
            delete process.env.SystemRoot;
        }
    });

    it('returns undefined when the terminal picker is cancelled', async () => {
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult([], true));
        const { methods } = setup();

        await expect(methods.pickTerminalApplication()).resolves.toBeUndefined();
    });

    it('returns the trimmed directory and keeps an explicit default path', async () => {
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult(['  /Users/me/work  ']));
        const { methods, mainWindow } = setup();

        await expect(methods.pickDirectory({ defaultPath: '/tmp' })).resolves.toBe('/Users/me/work');
        expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(mainWindow, { defaultPath: '/tmp', properties: ['openDirectory'] });
    });

    it('returns undefined when the directory picker is cancelled', async () => {
        electron.dialog.showOpenDialog.mockResolvedValue(openDialogResult(['/tmp'], true));
        const { methods } = setup();

        await expect(methods.pickDirectory()).resolves.toBeUndefined();
    });
});

describe('opening paths', () => {
    it('opens an external url in the browser', async () => {
        const { methods } = setup();

        await methods.openExternalUrl({ url: 'https://example.com/docs' });

        expect(electron.shell.openExternal).toHaveBeenCalledWith('https://example.com/docs');
    });

    it('opens a plain path with the default program', async () => {
        const { methods } = setup();

        await methods.openPathWithDefaultProgram({ path: '/tmp/file.txt' });

        expect(electron.shell.openPath).toHaveBeenCalledWith('/tmp/file.txt');
    });

    it('reveals an item in the file manager', async () => {
        const { methods } = setup();

        await methods.revealPathInFileManager({ path: '/tmp/file.txt', mode: 'reveal-item' });

        expect(electron.shell.showItemInFolder).toHaveBeenCalledWith('/tmp/file.txt');
        expect(electron.shell.openPath).not.toHaveBeenCalled();
    });

    it('opens the folder itself for any other mode', async () => {
        const { methods } = setup();

        await methods.revealPathInFileManager({ path: '/tmp', mode: 'open-directory' });

        expect(electron.shell.openPath).toHaveBeenCalledWith('/tmp');
        expect(electron.shell.showItemInFolder).not.toHaveBeenCalled();
    });
});

describe('openFileInEditor', () => {
    it('resolves the path through the backend and opens it with the configured editor', async () => {
        const { methods, apiPost } = setup();
        apiPost.mockResolvedValue('/Users/me/repo/src/index.ts');

        await methods.openFileInEditor({ repoId: 7, path: 'src/index.ts', editorPath: '/Applications/Code.app' });

        expect(apiPost).toHaveBeenCalledWith('resolveRepoFilePath', { repoId: 7, path: 'src/index.ts' });
        expect(execFileSync).toHaveBeenCalledWith('open', ['-a', '/Applications/Code.app', '/Users/me/repo/src/index.ts']);
    });

    it('runs the editor binary directly away from darwin', async () => {
        const { methods, apiPost } = setup({ platform: 'linux' });
        apiPost.mockResolvedValue('/Users/me/repo/src/index.ts');

        await methods.openFileInEditor({ repoId: 7, path: 'src/index.ts', editorPath: '/usr/bin/code' });

        expect(execFileSync).toHaveBeenCalledWith('/usr/bin/code', ['/Users/me/repo/src/index.ts']);
    });

    it('rejects a backend answer that is not a path', async () => {
        const { methods, apiPost } = setup();
        apiPost.mockResolvedValue({ error: 'no such repo' });

        await expect(methods.openFileInEditor({ repoId: 7, path: 'src/index.ts', editorPath: '/Applications/Code.app' })).rejects.toThrow(
            'Invalid response from resolveRepoFilePath'
        );
        expect(execFileSync).not.toHaveBeenCalled();
    });

    it('refuses to open a file that vanished from the working tree', async () => {
        const { methods, apiPost } = setup({ fileExists: (path) => path !== '/Users/me/repo/src/gone.ts' });
        apiPost.mockResolvedValue('/Users/me/repo/src/gone.ts');

        await expect(methods.openFileInEditor({ repoId: 7, path: 'src/gone.ts', editorPath: '/Applications/Code.app' })).rejects.toThrow(
            'The selected file no longer exists in the working tree.'
        );
        expect(execFileSync).not.toHaveBeenCalled();
    });

    it('refuses to open an editor that vanished from disk', async () => {
        const { methods, apiPost } = setup({ fileExists: (path) => path !== '/Applications/Gone.app' });
        apiPost.mockResolvedValue('/Users/me/repo/src/index.ts');

        await expect(methods.openFileInEditor({ repoId: 7, path: 'src/index.ts', editorPath: '/Applications/Gone.app' })).rejects.toThrow(
            'The selected editor no longer exists on disk.'
        );
        expect(execFileSync).not.toHaveBeenCalled();
    });

    it('reports the resolved path when the editor itself fails to launch', async () => {
        const { methods, apiPost } = setup();
        apiPost.mockResolvedValue('/Users/me/repo/src/index.ts');
        execFileSync.mockImplementation(() => {
            throw new Error('spawn open ENOENT');
        });

        await expect(methods.openFileInEditor({ repoId: 7, path: 'src/index.ts', editorPath: '/Applications/Code.app' })).rejects.toThrow('spawn open ENOENT');
    });
});

describe('openDirectoryInTerminal', () => {
    it('prefers a configured darwin application that exists', async () => {
        const { methods, runCommand } = setup();

        await methods.openDirectoryInTerminal({ directoryPath: '/Users/me/repo', applicationPath: '/Applications/iTerm.app' });

        expect(runCommand).toHaveBeenCalledTimes(1);
        expect((runCommand.mock.calls[0] as any[])[0]).toMatchObject({
            command: 'open',
            args: ['-a', '/Applications/iTerm.app', '/Users/me/repo'],
            cwd: '/Users/me/repo',
            detached: true,
            allowedExitCodes: [0],
        });
    });

    it('falls back to Terminal when the configured application is missing', async () => {
        const { methods, runCommand } = setup({ fileExists: () => false });

        await methods.openDirectoryInTerminal({ directoryPath: '/Users/me/repo', applicationPath: '/Applications/Gone.app' });

        expect((runCommand.mock.calls[0] as any[])[0]).toMatchObject({ command: 'open', args: ['-a', 'Terminal', '/Users/me/repo'] });
    });

    it('launches a configured non-darwin application with no arguments', async () => {
        const { methods, runCommand } = setup({ platform: 'linux' });

        await methods.openDirectoryInTerminal({ directoryPath: '/home/me/repo', applicationPath: '/usr/bin/kitty' });

        expect((runCommand.mock.calls[0] as any[])[0]).toMatchObject({ command: '/usr/bin/kitty', args: [], detached: true });
    });

    it('starts the Windows terminal through cmd.exe', async () => {
        const { methods, runCommand } = setup({ platform: 'win32' });

        await methods.openDirectoryInTerminal({ directoryPath: 'C:\\repo' });

        expect((runCommand.mock.calls[0] as any[])[0]).toMatchObject({
            command: 'cmd.exe',
            args: ['/c', 'start', '', 'wt.exe', '-d', 'C:\\repo'],
            detached: false,
        });
    });

    it('walks the Linux fallback list until one command succeeds', async () => {
        const runCommand = vi.fn().mockRejectedValueOnce(new Error('no x-terminal-emulator')).mockResolvedValueOnce(undefined);
        const { methods } = setup({ platform: 'linux', runCommand });

        await methods.openDirectoryInTerminal({ directoryPath: '/home/me/repo' });

        expect(runCommand.mock.calls.map(([attempt]) => (attempt as any).command)).toEqual(['x-terminal-emulator', 'gnome-terminal']);
        expect(runCommand.mock.calls[1]?.[0]).toMatchObject({ args: ['--working-directory', '/home/me/repo'] });
    });

    it('tries both Windows fallbacks and throws the last failure', async () => {
        const failure = new Error('wt.exe is not installed');
        const runCommand = vi.fn().mockRejectedValue(failure);
        const { methods } = setup({ platform: 'win32', runCommand });

        await expect(methods.openDirectoryInTerminal({ directoryPath: 'C:\\repo' })).rejects.toThrow('wt.exe is not installed');
        expect(runCommand).toHaveBeenCalledTimes(2);
        expect(runCommand.mock.calls.map(([attempt]) => (attempt as any).args.join(' '))).toEqual([
            '/c start  wt.exe -d C:\\repo',
            '/c start  cmd.exe /K cd /d C:\\repo',
        ]);
    });

    it('names the failing command in the error it throws', async () => {
        const runCommand = vi.fn().mockRejectedValue(new Error('boom'));
        const { methods } = setup({ runCommand });

        await expect(methods.openDirectoryInTerminal({ directoryPath: '/Users/me/repo' })).rejects.toThrow('boom');
        expect(runCommand).toHaveBeenCalledTimes(1);
        const getErrorToThrow = (runCommand.mock.calls[0] as any[])[0].getErrorToThrow as (stdout: string, stderr: string) => Error;
        expect(getErrorToThrow('', 'permission denied').message).toBe(
            'Failed to open the directory in a terminal application using command: open -a Terminal /Users/me/repo\n\npermission denied'
        );
    });

    it('throws a generic error when the attempts report no error at all', async () => {
        const runCommand = vi.fn().mockRejectedValue(undefined);
        const { methods } = setup({ platform: 'linux', runCommand });

        await expect(methods.openDirectoryInTerminal({ directoryPath: '/home/me/repo' })).rejects.toThrow('Failed to open the directory in a terminal application.');
        expect(runCommand).toHaveBeenCalledTimes(6);
    });
});

describe('the integrated terminal bridge', () => {
    beforeEach(() => {
        integratedTerminal.createIntegratedTerminalSession.mockReset().mockReturnValue({ sessionId: 'session-1', cwd: '/repo', shellPath: '/bin/zsh' });
        integratedTerminal.writeIntegratedTerminalSession.mockReset();
        integratedTerminal.resizeIntegratedTerminalSession.mockReset();
        integratedTerminal.closeIntegratedTerminalSession.mockReset();
    });

    it('resolves the repo path and forwards the requested size', async () => {
        const { methods, apiPost } = setup();
        apiPost.mockResolvedValue('/Users/me/repo');

        await expect(methods.createIntegratedTerminalSession({ repoId: 4, terminalPath: '/bin/bash', cols: 120, rows: 30 })).resolves.toEqual({
            sessionId: 'session-1',
            cwd: '/repo',
            shellPath: '/bin/zsh',
        });

        expect(apiPost).toHaveBeenCalledWith('resolveRepoFilePath', { repoId: 4, path: '' });
        expect(integratedTerminal.createIntegratedTerminalSession).toHaveBeenCalledWith(
            expect.objectContaining({ emitIntegratedTerminalEvent: expect.any(Function) }),
            '/Users/me/repo',
            '/bin/bash',
            { cols: 120, rows: 30 }
        );
    });

    it('omits the size when the renderer did not ask for one', async () => {
        const { methods, apiPost } = setup();
        apiPost.mockResolvedValue('/Users/me/repo');

        await methods.createIntegratedTerminalSession({ repoId: 4 });

        expect(integratedTerminal.createIntegratedTerminalSession).toHaveBeenCalledWith(expect.anything(), '/Users/me/repo', undefined, undefined);
    });

    it('rejects a repo path the backend did not answer with', async () => {
        const { methods, apiPost } = setup();
        apiPost.mockResolvedValue(42);

        await expect(methods.createIntegratedTerminalSession({ repoId: 4 })).rejects.toThrow('Invalid response from resolveRepoFilePath');
        expect(integratedTerminal.createIntegratedTerminalSession).not.toHaveBeenCalled();
    });

    it('turns PTY data into a native command for the renderer', async () => {
        const { methods, apiPost, mainWindow } = setup();
        apiPost.mockResolvedValue('/Users/me/repo');
        await methods.createIntegratedTerminalSession({ repoId: 4 });

        const target = integratedTerminal.createIntegratedTerminalSession.mock.calls[0][0];
        target.emitIntegratedTerminalEvent({ kind: 'data', sessionId: 'session-1', data: 'hello' });

        expect(mainWindow.webContents.send).toHaveBeenCalledWith('native-command', { kind: 'integrated-terminal-data', sessionId: 'session-1', data: 'hello' });
    });

    it('turns a PTY exit into a native command for the renderer', async () => {
        const { methods, apiPost, mainWindow } = setup();
        apiPost.mockResolvedValue('/Users/me/repo');
        await methods.createIntegratedTerminalSession({ repoId: 4 });

        const target = integratedTerminal.createIntegratedTerminalSession.mock.calls[0][0];
        target.emitIntegratedTerminalEvent({ kind: 'exit', sessionId: 'session-1', exitCode: 130 });

        expect(mainWindow.webContents.send).toHaveBeenCalledWith('native-command', { kind: 'integrated-terminal-exit', sessionId: 'session-1', exitCode: 130 });
    });

    it('forwards write, resize and close straight to the session module', async () => {
        const { methods } = setup();

        await methods.writeIntegratedTerminalSession({ sessionId: 'session-1', data: 'ls\n' });
        await methods.resizeIntegratedTerminalSession({ sessionId: 'session-1', cols: 100, rows: 40 });
        await methods.closeIntegratedTerminalSession({ sessionId: 'session-1' });

        expect(integratedTerminal.writeIntegratedTerminalSession).toHaveBeenCalledWith({ sessionId: 'session-1', data: 'ls\n' });
        expect(integratedTerminal.resizeIntegratedTerminalSession).toHaveBeenCalledWith({ sessionId: 'session-1', cols: 100, rows: 40 });
        expect(integratedTerminal.closeIntegratedTerminalSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    });
});

describe('createApplicationMenu', () => {
    function menuWith(mainWindow: any) {
        const template = createApplicationMenu(mainWindow);
        const submenuOf = (label: string) => template.find((item) => item.label === label)?.submenu as Electron.MenuItemConstructorOptions[];
        const itemWith = (menu: string, label: string) => submenuOf(menu).find((item) => item.label === label) as Electron.MenuItemConstructorOptions;

        return { template, submenuOf, itemWith };
    }

    it('builds the Gitvan, Edit and View menus', () => {
        const { template } = menuWith({ webContents: { send: vi.fn() } });

        expect(template.map((item) => item.label)).toEqual(['Gitvan', 'Edit', 'View']);
    });

    it('sends the open-settings command and owns the CmdOrCtrl+, accelerator', () => {
        const send = vi.fn();
        const { itemWith } = menuWith({ webContents: { send, toggleDevTools: vi.fn(), reload: vi.fn() } });

        const settings = itemWith('Gitvan', 'Open Settings');

        expect(settings.accelerator).toBe('CmdOrCtrl+,');
        settings.click?.({} as any, undefined as any, undefined as any);
        expect(send).toHaveBeenCalledWith('native-command', { kind: 'open-settings' });
    });

    it('shows every open window from Show All', () => {
        const windows = [{ show: vi.fn() }, { show: vi.fn() }];
        electron.BrowserWindow.getAllWindows.mockReturnValue(windows);
        const { itemWith } = menuWith({ webContents: { send: vi.fn(), toggleDevTools: vi.fn(), reload: vi.fn() } });

        itemWith('Gitvan', 'Show All').click?.({} as any, undefined as any, undefined as any);

        expect(windows[0].show).toHaveBeenCalled();
        expect(windows[1].show).toHaveBeenCalled();
    });

    it('drives dev tools and reload from the View menu', () => {
        const webContents = { send: vi.fn(), toggleDevTools: vi.fn(), reload: vi.fn() };
        const { itemWith } = menuWith({ webContents });

        const devTools = itemWith('View', 'Toggle Developer Tools');
        const reload = itemWith('View', 'Reload');

        expect(devTools.accelerator).toBe('CmdOrCtrl+Alt+I');
        expect(reload.accelerator).toBe('CmdOrCtrl+R');
        devTools.click?.({} as any, undefined as any, undefined as any);
        reload.click?.({} as any, undefined as any, undefined as any);
        expect(webContents.toggleDevTools).toHaveBeenCalled();
        expect(webContents.reload).toHaveBeenCalled();
    });
});
