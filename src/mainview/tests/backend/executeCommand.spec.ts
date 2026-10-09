import { describe, expect, it } from 'vitest';
import { executeCommand } from '../../../electronUtils/executeCommand.js';
import { runWithRequestAbortSignal } from '../../../electronUtils/requestContext.js';

function runSleep(seconds: number, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    return executeCommand({
        command: '/bin/sh',
        args: ['-c', `sleep ${seconds}`],
        allowedExitCodes: [0],
        getErrorToThrow: (stdout, stderr, exitCode) => new Error(`exit ${exitCode}: ${stderr || stdout}`),
        ...options,
    });
}

describe('executeCommand timeouts and cancellation', () => {
    it('resolves a command that finishes inside its timeout', async () => {
        await expect(
            executeCommand({
                command: '/bin/sh',
                args: ['-c', 'printf ok'],
                allowedExitCodes: [0],
                getErrorToThrow: () => new Error('unexpected'),
                timeoutMs: 5000,
            })
        ).resolves.toBeDefined();
    });

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

        await expect(runWithRequestAbortSignal(controller.signal, () => runSleep(0.05))).resolves.toBeDefined();
    });
});
