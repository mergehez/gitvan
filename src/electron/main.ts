import { BrowserWindow, dialog, shell } from 'electron';
import { existsSync } from 'fs';
import type { app as AppService } from '../backend/services/app.ts';
import { executeCommand } from '../backend/services/subprocess.ts';
import { apiMethods } from '../shared/apiMethods.ts';
import { createElectronHelpers, type CreateGitClientRequestApi } from './helpers.ts';

const helpers = createElectronHelpers('Gitvan', '5176');

function createHandlers(mainWindow: BrowserWindow) {
    return helpers.generateHandlers<typeof AppService>(apiMethods).mergeWithNative((apiPost) => ({
        pickEditorApplication: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
                defaultPath: process.platform === 'darwin' ? '/Applications' : require('os').homedir(),
                filters: process.platform === 'darwin' ? [{ name: 'Applications', extensions: ['app'] }] : undefined,
                properties: ['openFile'],
            });
            if (result.canceled || !result.filePaths[0]) return undefined;
            const path = result.filePaths[0];
            let label = path.split('/').pop() || path;
            if (label.endsWith('.app') || label.endsWith('.exe')) label = label.slice(0, -4);
            return { path, label };
        },

        pickTerminalApplication: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
                defaultPath:
                    process.platform === 'darwin' ? '/bin' : process.platform === 'win32' ? `${process.env.SystemRoot || 'C:\\Windows'}\\System32` : require('os').homedir(),
                properties: ['openFile'],
            });
            if (result.canceled || !result.filePaths[0]) return undefined;
            const path = result.filePaths[0];
            let label = path.split('/').pop() || path;
            if (label.endsWith('.app') || label.endsWith('.exe')) label = label.slice(0, -4);
            return { path, label, locked: false };
        },

        pickDirectory: async (ps?: { defaultPath?: string; title?: string; buttonLabel?: string }) => {
            const result = await dialog.showOpenDialog(mainWindow, {
                defaultPath: ps?.defaultPath || require('os').homedir(),
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
            if (!existsSync(filePath)) throw new Error('The selected file no longer exists in the working tree.');
            if (!existsSync(ps.editorPath)) throw new Error('The selected editor no longer exists on disk.');
            if (process.platform === 'darwin') {
                await shell.openPath(filePath);
            } else {
                const { execFileSync } = await import('child_process');
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
                const configuredApplicationPath = applicationPath && existsSync(applicationPath) ? applicationPath : undefined;

                if (configuredApplicationPath) {
                    if (process.platform === 'darwin') {
                        return [{ command: 'open', args: ['-a', configuredApplicationPath, directoryPath] }];
                    }

                    if (process.platform === 'win32') {
                        return [{ command: 'cmd.exe', args: ['/c', 'start', '', '/D', directoryPath, configuredApplicationPath] }];
                    }

                    return [{ command: configuredApplicationPath, args: [] }];
                }

                if (process.platform === 'darwin') {
                    return [{ command: 'open', args: ['-a', 'Terminal', directoryPath] }];
                }

                if (process.platform === 'win32') {
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
                    await executeCommand({
                        ...attempt,
                        cwd: directoryPath,
                        detached: process.platform !== 'win32',
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
                        mainWindow.webContents.send('integrated-terminal-event', event);
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
    }));
}

export type HandlersMap = ReturnType<typeof createHandlers>;
export type GitClientRequestApi = CreateGitClientRequestApi<HandlersMap>;

helpers.start({
    createHandlers,
    getMenu: (mainWindow: BrowserWindow) => {
        const template: Electron.MenuItemConstructorOptions[] = [
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
        return template;
    },
});
