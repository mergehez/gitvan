import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../../composables/useToast';

describe('useToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        toast.dismissSuccessToast();
        toast.dismissErrorToast();
    });

    afterEach(() => {
        toast.dismissSuccessToast();
        toast.dismissErrorToast();
        vi.useRealTimers();
    });

    it('clears a success toast after its lifetime', () => {
        toast.showSuccessToast('Saved.');

        expect(toast.successToastMessage).toBe('Saved.');

        vi.advanceTimersByTime(3199);
        expect(toast.successToastMessage).toBe('Saved.');

        vi.advanceTimersByTime(1);
        expect(toast.successToastMessage).toBeUndefined();
    });

    it('keeps the newest message and restarts its timer', () => {
        toast.showSuccessToast('First');
        vi.advanceTimersByTime(2000);
        toast.showSuccessToast('Second');

        vi.advanceTimersByTime(2000);
        expect(toast.successToastMessage).toBe('Second');

        vi.advanceTimersByTime(1200);
        expect(toast.successToastMessage).toBeUndefined();
    });

    it('does not let a stale timer clear a toast shown after a dismissal', () => {
        toast.showSuccessToast('First');
        vi.advanceTimersByTime(100);
        toast.dismissSuccessToast();

        toast.showSuccessToast('Second');
        // The first toast's timer would have fired by now if dismissing had not cancelled it.
        vi.advanceTimersByTime(3100);
        expect(toast.successToastMessage).toBe('Second');

        vi.advanceTimersByTime(100);
        expect(toast.successToastMessage).toBeUndefined();
    });

    it('tracks the success and error toasts independently', () => {
        toast.showSuccessToast('Saved.');
        toast.showErrorToast('Failed.');

        expect(toast.successToastMessage).toBe('Saved.');
        expect(toast.errorToastMessage).toBe('Failed.');

        toast.dismissSuccessToast();

        expect(toast.successToastMessage).toBeUndefined();
        expect(toast.errorToastMessage).toBe('Failed.');

        vi.advanceTimersByTime(3200);
        expect(toast.errorToastMessage).toBeUndefined();
    });

    it('dismisses an error toast immediately', () => {
        toast.showErrorToast('Failed.');
        toast.dismissErrorToast();

        expect(toast.errorToastMessage).toBeUndefined();
    });
});
