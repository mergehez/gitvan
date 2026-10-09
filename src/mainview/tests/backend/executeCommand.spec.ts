import { describe, expect, it } from 'vitest';
import { executeCommand } from '../../../electronUtils/executeCommand.js';
import { runWithRequestAbortSignal } from '../../../electronUtils/requestContext.js';

// `executeCommand` resolves a tuple: [raw stdout, decoded stdout, stderr, exit code].
type CommandResult = Awaited<ReturnType<typeof executeCommand>>;

function results(result: CommandResult) {
    const [, stdout, stderr, exitCode] = result;

    return { stdout, stderr, exitCode };
}

function runCommand(args: string[], options: Partial<Parameters<typeof executeCommand>[0]> = {}) {
    return executeCommand({
        command: '/bin/sh',
        args: ['-c', args.join(' ')],
        allowedExitCodes: [0],
        getErrorToThrow: (stdout, stderr, exitCode) => new Error(`exit ${exitCode}: ${stderr || stdout}`),
        ...options,
    });
}

function runSleep(seconds: number, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    return runCommand([`sleep ${seconds}`], options);
}

describe('executeCommand output and exit codes', () => {
    it('returns the decoded output and the exit code of a command that finishes inside its timeout', async () => {
        const result = await runCommand(['printf out; printf err >&2'], { timeoutMs: 5000 });

        expect(results(result)).toEqual({ stdout: 'out', stderr: 'err', exitCode: 0 });
    });

    it('honours the extra exit codes a caller allows', async () => {
        const result = await runCommand(['printf partial; exit 3'], { allowedExitCodes: [0, 3], timeoutMs: 5000 });

        expect(results(result)).toEqual({ stdout: 'partial', stderr: '', exitCode: 3 });
    });

    it('throws the caller-provided error for a disallowed exit code', async () => {
        await expect(runCommand(['printf boom >&2; exit 4'], { timeoutMs: 5000 })).rejects.toThrow('exit 4: boom');
    });

    it('feeds the provided input to the command stdin', async () => {
        const result = await runCommand(['cat'], { input: 'piped through', timeoutMs: 5000 });

        expect(results(result).stdout).toBe('piped through');
    });

    it('rejects when the command cannot be spawned', async () => {
        await expect(
            executeCommand({
                command: '/definitely/not/a/real/binary',
                args: [],
                allowedExitCodes: [0],
                getErrorToThrow: () => new Error('unexpected'),
                timeoutMs: 5000,
            })
        ).rejects.toThrow();
    });
});

describe('executeCommand timeouts and cancellation', () => {
    it('kills a command that outlives its timeout', async () => {
        const startedAt = Date.now();

        await expect(runSleep(5, { timeoutMs: 200 })).rejects.toThrow(/timed out after 200ms/);
        expect(Date.now() - startedAt).toBeLessThan(5000);
    });

    it('kills a command when its abort signal fires', async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error('gone')), 100);

        await expect(runSleep(5, { signal: controller.signal })).rejects.toThrow(/Command cancelled: gone/);
    });

    it('kills a command when the request scope it runs in aborts', async () => {
        const controller = new AbortController();
        const pending = runWithRequestAbortSignal(controller.signal, () => runSleep(5));

        setTimeout(() => controller.abort(new Error('renderer left')), 100);

        await expect(pending).rejects.toThrow(/Command cancelled: renderer left/);
    });

    it('does not kill a command whose request scope stays alive', async () => {
        const controller = new AbortController();

        const result = await runWithRequestAbortSignal(controller.signal, () => runSleep(0.05));

        expect(results(result).exitCode).toBe(0);
    });

    it('does not start a command whose signal already aborted', async () => {
        const controller = new AbortController();
        controller.abort(new Error('already gone'));

        await expect(runSleep(5, { signal: controller.signal })).rejects.toThrow(/Command cancelled: already gone/);
    });
});
