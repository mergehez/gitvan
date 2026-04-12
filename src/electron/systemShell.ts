import { spawn } from 'node:child_process';

type CommandAttempt = {
    command: string;
    args: string[];
};

function runCommand({ command, args }: CommandAttempt) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'ignore',
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if ((code ?? 1) !== 0) {
                reject(new Error(`Command exited with code ${code ?? 1}.`));
                return;
            }

            resolve();
        });
    });
}

export async function openDirectoryInTerminal(directoryPath: string) {
    const attempts: CommandAttempt[] = (() => {
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
            await runCommand(attempt);
            return;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to open the directory in a terminal application.');
}
