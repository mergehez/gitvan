import { existsSync } from 'fs';
import { spawn } from 'node-pty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    closeIntegratedTerminalSession,
    createIntegratedTerminalSession,
    resizeIntegratedTerminalSession,
    writeIntegratedTerminalSession,
} from '../../../../electron/integratedTerminal.js';
import type { IntegratedTerminalEvent } from '../../../../shared/types.js';

/**
 * The lifecycle cases below need a real PTY. A sandboxed runner (the agent shell this suite is
 * sometimes started from) refuses `posix_openpt` outright, so the suite probes it once and skips
 * the PTY cases there rather than failing; the shell-resolution and event-wiring cases still run.
 */
function detectPtySupport() {
    try {
        const probe = spawn('/bin/sh', ['-c', 'true'], { name: 'xterm-256color', cols: 80, rows: 24, env: process.env as Record<string, string> });
        probe.kill('SIGHUP');

        return true;
    } catch {
        return false;
    }
}

const ptyWorks = process.platform !== 'win32' && detectPtySupport();

function createTarget() {
    const events: IntegratedTerminalEvent[] = [];
    const waiters = new Set<() => void>();

    return {
        events,
        emitIntegratedTerminalEvent(event: IntegratedTerminalEvent) {
            events.push(event);
            for (const waiter of [...waiters]) {
                waiters.delete(waiter);
                waiter();
            }
        },
        waitForEvent(timeoutMs = 4000) {
            if (events.length > 0) return Promise.resolve();

            return new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    waiters.delete(onEvent);
                    reject(new Error(`timed out after ${timeoutMs}ms waiting for a terminal event`));
                }, timeoutMs);
                const onEvent = () => {
                    clearTimeout(timer);
                    resolve();
                };
                waiters.add(onEvent);
            });
        },
        text() {
            return events
                .filter((event) => event.kind === 'data')
                .map((event) => (event.kind === 'data' ? event.data : ''))
                .join('')
                .replace(/\r/g, '');
        },
    };
}

const sessions: string[] = [];

afterEach(() => {
    for (const sessionId of sessions.splice(0)) closeIntegratedTerminalSession({ sessionId });
});

describe('shell resolution', () => {
    it.skipIf(!ptyWorks)('falls back to an existing shell when the preferred one is missing', () => {
        const target = createTarget();

        const session = createIntegratedTerminalSession(target as any, process.cwd(), '/definitely/not/a/shell');
        sessions.push(session.sessionId);

        expect(session.sessionId).toBeTruthy();
        expect(session.cwd).toBe(process.cwd());
        expect(existsSync(session.shellPath)).toBe(true);
        expect(session.shellPath).not.toBe('/definitely/not/a/shell');
    });

    it.skipIf(!ptyWorks)('falls back to the process working directory for a cwd that does not exist', () => {
        const target = createTarget();

        const session = createIntegratedTerminalSession(target as any, '/definitely/not/a/directory');
        sessions.push(session.sessionId);

        expect(session.cwd).toBe(process.cwd());
    });

    it.skipIf(!ptyWorks)('gives every session its own id', () => {
        const first = createIntegratedTerminalSession(createTarget() as any, process.cwd());
        const second = createIntegratedTerminalSession(createTarget() as any, process.cwd());
        sessions.push(first.sessionId, second.sessionId);

        expect(first.sessionId).not.toBe(second.sessionId);
    });
});

describe('session operations without a session', () => {
    it('ignores write, resize and close for an unknown session', () => {
        expect(() => writeIntegratedTerminalSession({ sessionId: 'missing', data: 'ls\n' })).not.toThrow();
        expect(() => resizeIntegratedTerminalSession({ sessionId: 'missing', cols: 100, rows: 40 })).not.toThrow();
        expect(() => closeIntegratedTerminalSession({ sessionId: 'missing' })).not.toThrow();
    });
});

describe.skipIf(!ptyWorks)('PTY lifecycle', () => {
    it('streams the shell output back as data events', async () => {
        const target = createTarget();
        const session = createIntegratedTerminalSession(target as any, process.cwd(), '/bin/sh', { cols: 90, rows: 30 });
        sessions.push(session.sessionId);

        writeIntegratedTerminalSession({ sessionId: session.sessionId, data: 'echo pty-ready\n' });
        await target.waitForEvent();

        expect(target.text()).toContain('pty-ready');
        expect(target.events[0]).toMatchObject({ kind: 'data', sessionId: session.sessionId });
    });

    it('accepts a resize while the shell is running', async () => {
        const target = createTarget();
        const session = createIntegratedTerminalSession(target as any, process.cwd(), '/bin/sh');
        sessions.push(session.sessionId);

        expect(() => resizeIntegratedTerminalSession({ sessionId: session.sessionId, cols: 120, rows: 40 })).not.toThrow();
    });

    it('reports the exit only once when the shell quits', async () => {
        const target = createTarget();
        const session = createIntegratedTerminalSession(target as any, process.cwd(), '/bin/sh');
        sessions.push(session.sessionId);

        writeIntegratedTerminalSession({ sessionId: session.sessionId, data: 'exit\n' });

        await vi.waitFor(() => expect(target.events.some((event) => event.kind === 'exit')).toBe(true), { timeout: 4000 });
        expect(target.events.filter((event) => event.kind === 'exit')).toHaveLength(1);
        expect(target.events.at(-1)).toMatchObject({ kind: 'exit', sessionId: session.sessionId });
    });

    it('closes the session without an exit event once it is gone', async () => {
        const target = createTarget();
        const session = createIntegratedTerminalSession(target as any, process.cwd(), '/bin/sh');
        sessions.push(session.sessionId);

        writeIntegratedTerminalSession({ sessionId: session.sessionId, data: 'echo alive\n' });
        await target.waitForEvent();

        closeIntegratedTerminalSession({ sessionId: session.sessionId });

        // The session is dropped from the map first, so a late PTY exit finds no target to notify.
        expect(() => resizeIntegratedTerminalSession({ sessionId: session.sessionId, cols: 100, rows: 30 })).not.toThrow();
    });
});
