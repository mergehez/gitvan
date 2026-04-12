import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

type CommandAttempt = {
    command: string;
    args: string[];
};

function runCommand({ command, args }: CommandAttempt, directoryPath: string) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'ignore',
            cwd: directoryPath,
            detached: process.platform !== 'win32',
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if ((code ?? 1) !== 0) {
                reject(new Error(`Command exited with code ${code ?? 1}.`));
                return;
            }

            resolve();
        });

        if (process.platform !== 'win32') {
            child.unref();
        }
    });
}

export async function openDirectoryInTerminal(directoryPath: string, applicationPath?: string) {
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
            await runCommand(attempt, directoryPath);
            return;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to open the directory in a terminal application.');
}
