import { app, type BrowserWindow } from 'electron';
import { spawn, type IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IntegratedTerminalEvent, IntegratedTerminalSession } from '../shared/gitClient.js';

const integratedTerminalEventChannel = 'gitvan:integrated-terminal-event';

type TerminalSessionRecord = {
    id: string;
    window: BrowserWindow;
    pty: IPty;
    cwd: string;
    shellPath: string;
};

const terminalSessions = new Map<string, TerminalSessionRecord>();
const require = createRequire(import.meta.url);

function resolveShellCandidates(preferredShellPath?: string) {
    if (process.platform === 'win32') {
        return [preferredShellPath, process.env.ComSpec || 'cmd.exe', 'powershell.exe', 'cmd.exe'].filter((value, index, items): value is string => {
            return Boolean(value) && items.indexOf(value) === index;
        });
    }

    return [preferredShellPath, process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter((value, index, items): value is string => {
        return Boolean(value) && items.indexOf(value) === index;
    });
}

function resolveShellArgs(shellPath: string) {
    if (process.platform === 'win32') {
        return [];
    }

    const shellName = shellPath.split('/').pop();
    return shellName === 'bash' || shellName === 'zsh' ? ['-l'] : [];
}

function resolveTerminalCwd(cwd: string) {
    if (existsSync(cwd)) {
        return cwd;
    }

    return process.cwd() || homedir();
}

function sanitizeEnv() {
    return Object.fromEntries(
        Object.entries({
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: process.env.COLORTERM || 'truecolor',
        }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
}

function ensureNodePtySpawnHelperExecutable() {
    if (process.platform === 'win32' || app.isPackaged) {
        return;
    }

    const packageJsonPath = require.resolve('node-pty/package.json');
    const packageRoot = dirname(packageJsonPath);
    const helperCandidates = [
        join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
        join(packageRoot, 'build', 'Release', 'spawn-helper'),
        join(packageRoot, 'build', 'Debug', 'spawn-helper'),
    ];

    for (const helperPath of helperCandidates) {
        if (!existsSync(helperPath)) {
            continue;
        }

        const mode = statSync(helperPath).mode;
        if ((mode & 0o111) === 0o111) {
            continue;
        }

        chmodSync(helperPath, mode | 0o755);
    }
}

function emitTerminalEvent(window: BrowserWindow, event: IntegratedTerminalEvent) {
    if (window.isDestroyed()) {
        return;
    }

    window.webContents.send(integratedTerminalEventChannel, event);
}

function removeSession(sessionId: string) {
    terminalSessions.delete(sessionId);
}

export function createIntegratedTerminalSession(
    window: BrowserWindow,
    cwd: string,
    preferredShellPath?: string,
    size?: { cols?: number; rows?: number }
): IntegratedTerminalSession {
    const sessionId = randomUUID();
    const terminalCwd = resolveTerminalCwd(cwd);
    const env = sanitizeEnv();

    ensureNodePtySpawnHelperExecutable();

    let shellPath = '';
    let pty: IPty | undefined;
    let lastError: unknown;

    for (const candidate of resolveShellCandidates(preferredShellPath)) {
        if (process.platform !== 'win32' && candidate.startsWith('/') && !existsSync(candidate)) {
            continue;
        }

        try {
            pty = spawn(candidate, resolveShellArgs(candidate), {
                name: 'xterm-256color',
                cols: Math.max(20, size?.cols ?? 80),
                rows: Math.max(5, size?.rows ?? 24),
                cwd: terminalCwd,
                env,
            });
            shellPath = candidate;
            break;
        } catch (error) {
            lastError = error;
        }
    }

    if (!pty || !shellPath) {
        const details = lastError instanceof Error ? lastError.message : String(lastError?.toString() ?? 'Unknown error');
        throw new Error(`Failed to start integrated terminal in '${terminalCwd}': ${details}`);
    }

    const session: TerminalSessionRecord = {
        id: sessionId,
        window,
        pty,
        cwd: terminalCwd,
        shellPath,
    };

    terminalSessions.set(sessionId, session);

    pty.onData((data) => {
        emitTerminalEvent(window, {
            sessionId,
            kind: 'data',
            data,
        });
    });

    pty.onExit(({ exitCode }) => {
        emitTerminalEvent(window, {
            sessionId,
            kind: 'exit',
            exitCode,
        });
        removeSession(sessionId);
    });

    return {
        sessionId,
        cwd: terminalCwd,
        shellPath,
    };
}

export function writeIntegratedTerminalSession(sessionId: string, data: string) {
    const session = terminalSessions.get(sessionId);
    if (!session) {
        return;
    }

    session.pty.write(data);
}

export function resizeIntegratedTerminalSession(sessionId: string, cols: number, rows: number) {
    const session = terminalSessions.get(sessionId);
    if (!session) {
        return;
    }

    session.pty.resize(Math.max(20, cols), Math.max(5, rows));
}

export function closeIntegratedTerminalSession(sessionId: string) {
    const session = terminalSessions.get(sessionId);
    if (!session) {
        return;
    }

    removeSession(sessionId);
    session.pty.kill();
}

export { integratedTerminalEventChannel };
