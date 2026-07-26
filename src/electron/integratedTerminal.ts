import { existsSync } from 'fs';
import { homedir } from 'os';
import type { IntegratedTerminalEvent, IntegratedTerminalSession } from '../shared/gitClient.js';

type TerminalEventTarget = {
    emitIntegratedTerminalEvent(event: IntegratedTerminalEvent): void;
};

const terminalSessions = new Map<
    string,
    {
        id: string;
        target: TerminalEventTarget;
        process: Bun.Subprocess;
        terminal: Bun.Terminal;
        shellPath: string;
    }
>();

function resolveShellArgs(shellPath: string) {
    const shellName = shellPath.split('/').pop();
    return shellName === 'bash' || shellName === 'zsh' ? ['-l'] : [];
}

function emitData(target: TerminalEventTarget, sessionId: string, data: string) {
    if (!data) {
        return;
    }

    target.emitIntegratedTerminalEvent({
        sessionId,
        kind: 'data',
        data,
    });
}

function emitExit(sessionId: string, exitCode: number) {
    const session = terminalSessions.get(sessionId);
    if (!session) {
        return;
    }

    session.target.emitIntegratedTerminalEvent({
        sessionId,
        kind: 'exit',
        exitCode,
    });
    terminalSessions.delete(sessionId);
}

export function createIntegratedTerminalSession(
    target: TerminalEventTarget,
    cwd: string,
    preferredShellPath?: string,
    size?: { cols?: number; rows?: number }
): IntegratedTerminalSession {
    if (process.platform === 'win32') {
        throw new Error('Integrated terminal PTY sessions are not supported on Windows in the Electrobun runtime.');
    }

    const sessionId = crypto.randomUUID();
    const terminalCwd = existsSync(cwd) ? cwd : process.cwd() || homedir();
    const env = Object.fromEntries(
        Object.entries({
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: process.env.COLORTERM || 'truecolor',
        }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
    const decoder = new TextDecoder();

    let shellPath = '';
    let terminal: Bun.Terminal | undefined;
    let processHandle: Bun.Subprocess | undefined;
    let lastError: unknown;

    const candidates = [preferredShellPath, process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter((value, index, items): value is string => {
        return Boolean(value) && items.indexOf(value) === index;
    });
    for (const candidate of candidates) {
        if (candidate.startsWith('/') && !existsSync(candidate)) {
            continue;
        }

        try {
            const spawnedProcess = Bun.spawn({
                cmd: [candidate, ...resolveShellArgs(candidate)],
                cwd: terminalCwd,
                env,
                onExit(_subprocess, exitCode, signalCode, error) {
                    if (error) {
                        lastError = error;
                    }

                    emitData(target, sessionId, decoder.decode());

                    emitExit(sessionId, exitCode ?? (signalCode ? 1 : 0));
                },
                terminal: {
                    name: 'xterm-256color',
                    cols: Math.max(20, size?.cols ?? 80),
                    rows: Math.max(5, size?.rows ?? 24),
                    data(_terminal, data) {
                        emitData(target, sessionId, decoder.decode(data, { stream: true }));
                    },
                },
            });

            if (!spawnedProcess.terminal) {
                throw new Error('Bun did not attach a PTY terminal to the spawned process.');
            }

            shellPath = candidate;
            processHandle = spawnedProcess;
            terminal = spawnedProcess.terminal;
            break;
        } catch (error) {
            lastError = error;
        }
    }

    if (!processHandle || !terminal || !shellPath) {
        const details = lastError instanceof Error ? lastError.message : String(lastError?.toString() ?? 'Unknown error');
        throw new Error(`Failed to start integrated terminal in '${terminalCwd}': ${details}`);
    }

    terminalSessions.set(sessionId, {
        id: sessionId,
        target,
        process: processHandle,
        terminal,
        shellPath,
    });

    return {
        sessionId,
        cwd: terminalCwd,
        shellPath,
    };
}

export function writeIntegratedTerminalSession(ps: { sessionId: string; data: string }) {
    const session = terminalSessions.get(ps.sessionId);
    if (!session) {
        return;
    }

    session.terminal.write(ps.data);
}

export function resizeIntegratedTerminalSession(ps: { sessionId: string; cols: number; rows: number }) {
    const session = terminalSessions.get(ps.sessionId);
    if (!session) {
        return;
    }

    session.terminal.resize(Math.max(20, ps.cols), Math.max(5, ps.rows));
}

export function closeIntegratedTerminalSession(ps: { sessionId: string }) {
    const session = terminalSessions.get(ps.sessionId);
    if (!session) {
        return;
    }

    terminalSessions.delete(ps.sessionId);
    session.process.kill('SIGHUP');
    session.terminal.close();
}
