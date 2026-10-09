import { describe, expect, it } from 'vitest';
import {
    isButtonBusyStateSilenced,
    isButtonLoadingIndicatorSilenced,
    runWithButtonBusyStateSilenced,
    runWithButtonLoadingIndicatorSilenced,
} from '../../lib/loadingIndicatorState';

describe('loadingIndicatorState', () => {
    it('silences the loading and busy indicators only while the task runs', async () => {
        expect(isButtonLoadingIndicatorSilenced.value).toBe(false);
        expect(isButtonBusyStateSilenced.value).toBe(false);

        let during = false;
        await runWithButtonLoadingIndicatorSilenced(async () => {
            during = isButtonLoadingIndicatorSilenced.value && isButtonBusyStateSilenced.value;
        });

        expect(during).toBe(true);
        expect(isButtonLoadingIndicatorSilenced.value).toBe(false);
        expect(isButtonBusyStateSilenced.value).toBe(false);
    });

    it('returns the task result', async () => {
        await expect(runWithButtonBusyStateSilenced(async () => 42)).resolves.toBe(42);
    });

    it('restores the counter when the task throws', async () => {
        await expect(
            runWithButtonLoadingIndicatorSilenced(async () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');

        expect(isButtonLoadingIndicatorSilenced.value).toBe(false);
    });

    it('stays silenced while a second task is still running', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const first = runWithButtonBusyStateSilenced(async () => await gate);
        await runWithButtonBusyStateSilenced(async () => undefined);

        expect(isButtonBusyStateSilenced.value).toBe(true);

        release();
        await first;

        expect(isButtonBusyStateSilenced.value).toBe(false);
    });
});
