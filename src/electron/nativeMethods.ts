// NOTE:
// this file holds the native commands the Electron host owns: pickers, external programs and the
// integrated terminal. It is built by `main.ts`, which passes the live window and the API poster in.
import { BrowserWindow, dialog, shell } from 'electron';
import { existsSync } from 'fs';
import { executeCommand } from '../electronUtils/executeCommand.ts';
import type { NativeCommand } from '../shared/types.ts';

type ApiPost = (method: string, params?: unknown) => Promise<unknown>;

type NativeMethodsOptions = {
    mainWindow: BrowserWindow;
    apiPost: ApiPost;
    /** Defaults to the platform the host runs on; injected so the fallbacks can be tested per OS. */
    platform?: NodeJS.Platform;
    fileExists?: (path: string) => boolean;
    /** Defaults to the shared command runner; injected so the terminal fallbacks can be faked. */
    runCommand?: typeof executeCommand;
};

function applicationLabel(path: string) {
    const name = path.split('/').pop() || path;

    return name.endsWith('.app') || name.endsWith('.exe') ? name.slice(0, -4) : name;
}

/** The home directory without pulling in `os`, which the bundled main process does not require. */
function homeDirectory() {
    return process.env.HOME || process.env.USERPROFILE || '/';
}

export function createNativeMethods(options: NativeMethodsOptions) {
    const { mainWindow, apiPost } = options;
    const platform = options.platform ?? process.platform;
    const fileExists = options.fileExists ?? existsSync;
    const runCommand = options.runCommand ?? executeCommand;

    return {
        pickEditorApplication: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
                defaultPath: platform === 'darwin' ? '/Applications' : homeDirectory(),
                filters: platform === 'darwin' ? [{ name: 'Applications', extensions: ['app'] }] : undefined,
                properties: ['openFile'],
            });
            if (result.canceled || !result.filePaths[0]) return undefined;
            const path = result.filePaths[0];

            return { path, label: applicationLabel(path) };
        },

        pickTerminalApplication: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
                defaultPath: platform === 'darwin' ? '/bin' : platform === 'win32' ? `${process.env.SystemRoot || 'C:\\Windows'}\\System32` : homeDirectory(),
                properties: ['openFile'],
            });
            if (result.canceled || !result.filePaths[0]) return undefined;
            const path = result.filePaths[0];

            return { path, label: applicationLabel(path), locked: false };
        },

        pickDirectory: async (ps?: { defaultPath?: string; title?: string; buttonLabel?: string }) => {
            const result = await dialog.showOpenDialog(mainWindow, {
                defaultPath: ps?.defaultPath || homeDirectory(),
                properties: ['openDirectory'],
            });

            return result.canceled ? undefined : result.filePaths[0]?.trim();
        },

        openExternalUrl: async (ps: { url: string }) => {
            await shell.openExternal(ps.url);
        },

        openFileInEditor: async (ps: { repoId: number; path: string; editorPath: string }) => {
            const response = await apiPost('resolveRepoFilePath', { repoId: ps.repoId, path: ps.path });
            if (typeof response !== 'string') throw new Error('Invalid response from resolveRepoFilePath');
            const filePath: string = response;
            if (!fileExists(filePath)) throw new Error('The selected file no longer exists in the working tree.');
            if (!fileExists(ps.editorPath)) throw new Error('The selected editor no longer exists on disk.');
            const { execFileSync } = await import('child_process');
            if (platform === 'darwin') {
                execFileSync('open', ['-a', ps.editorPath, filePath]);
            } else {
                execFileSync(ps.editorPath, [filePath]);
            }
        },

        revealPathInFileManager: async (ps: { path: string; mode: string }) => {
            if (ps.mode === 'reveal-item') shell.showItemInFolder(ps.path);
            else await shell.openPath(ps.path);
        },

        openPathWithDefaultProgram: async (ps: { path: string }) => {
            await shell.openPath(ps.path);
        },

        openDirectoryInTerminal: async (ps: { directoryPath: string; applicationPath?: string }) => {
            const { directoryPath, applicationPath } = ps;
            type CommandAttempt = {
                command: string;
                args: string[];
            };
            const attempts: CommandAttempt[] = (() => {
                const configuredApplicationPath = applicationPath && fileExists(applicationPath) ? applicationPath : undefined;

                if (configuredApplicationPath) {
                    if (platform === 'darwin') {
                        return [{ command: 'open', args: ['-a', configuredApplicationPath, directoryPath] }];
                    }

                    if (platform === 'win32') {
                        return [{ command: 'cmd.exe', args: ['/c', 'start', '', '/D', directoryPath, configuredApplicationPath] }];
                    }

                    return [{ command: configuredApplicationPath, args: [] }];
                }

                if (platform === 'darwin') {
                    return [{ command: 'open', args: ['-a', 'Terminal', directoryPath] }];
                }

                if (platform === 'win32') {
                    return [
                        { command: 'cmd.exe', args: ['/c', 'start', '', 'wt.exe', '-d', directoryPath] },
                        { command: 'cmd.exe', args: ['/c', 'start', '', 'cmd.exe', '/K', 'cd', '/d', directoryPath] },
                    ];
                }

                return [
                    { command: 'x-terminal-emulator', args: ['--working-directory', directoryPath] },
                    { command: 'gnome-terminal', args: ['--working-directory', directoryPath] },
                    { command: 'konsole', args: ['--workdir', directoryPath] },
                    { command: 'xfce4-terminal', args: ['--working-directory', directoryPath] },
                    { command: 'kitty', args: ['--directory', directoryPath] },
                    { command: 'alacritty', args: ['--working-directory', directoryPath] },
                ];
            })();

            let lastError: unknown;

            for (const attempt of attempts) {
                try {
                    await runCommand({
                        ...attempt,
                        cwd: directoryPath,
                        detached: platform !== 'win32',
                        allowedExitCodes: [0],
                        getErrorToThrow: (_, stderr) =>
                            new Error(`Failed to open the directory in a terminal application using command: ${attempt.command} ${attempt.args.join(' ')}\n\n${stderr}`),
                    });
                    return;
                } catch (error) {
                    lastError = error;
                }
            }

            throw lastError instanceof Error ? lastError : new Error('Failed to open the directory in a terminal application.');
        },

        createIntegratedTerminalSession: async (ps: { repoId: number; terminalPath?: string; cols?: number; rows?: number }) => {
            const { createIntegratedTerminalSession } = await import('./integratedTerminal.ts');
            const repoPathResponse = await apiPost('resolveRepoFilePath', { repoId: ps.repoId, path: '' });
            if (typeof repoPathResponse !== 'string') throw new Error('Invalid response from resolveRepoFilePath');
            const repoPath: string = repoPathResponse;
            const size = ps.cols !== undefined ? { cols: ps.cols, rows: ps.rows } : undefined;
            return createIntegratedTerminalSession(
                {
                    emitIntegratedTerminalEvent(event: any) {
                        const command: NativeCommand =
                            event.kind === 'data'
                                ? { kind: 'integrated-terminal-data', sessionId: event.sessionId, data: event.data }
                                : { kind: 'integrated-terminal-exit', sessionId: event.sessionId, exitCode: event.exitCode };
                        mainWindow.webContents.send('native-command', command);
                    },
                },
                repoPath,
                ps.terminalPath,
                size
            );
        },

        writeIntegratedTerminalSession: async (ps: { sessionId: string; data: string }) => {
            const { writeIntegratedTerminalSession } = await import('./integratedTerminal.ts');
            return writeIntegratedTerminalSession(ps);
        },

        resizeIntegratedTerminalSession: async (ps: { sessionId: string; cols: number; rows: number }) => {
            const { resizeIntegratedTerminalSession } = await import('./integratedTerminal.ts');
            return resizeIntegratedTerminalSession(ps);
        },

        closeIntegratedTerminalSession: async (ps: { sessionId: string }) => {
            const { closeIntegratedTerminalSession } = await import('./integratedTerminal.ts');
            return closeIntegratedTerminalSession(ps);
        },
    };
}

export function createApplicationMenu(mainWindow: BrowserWindow): Electron.MenuItemConstructorOptions[] {
    return [
        {
            label: 'Gitvan',
            submenu: [
                { role: 'about' },
                { label: 'Open Settings', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('native-command', { kind: 'open-settings' }) },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                {
                    label: 'Show All',
                    click: () => {
                        for (const win of BrowserWindow.getAllWindows()) win.show();
                    },
                },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
        },
        {
            label: 'View',
            submenu: [
                { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Alt+I', click: () => mainWindow?.webContents.toggleDevTools() },
                { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
            ],
        },
    ];
}
