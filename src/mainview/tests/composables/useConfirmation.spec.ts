import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmation } from '../../composables/useConfirmation';

function anchorElement(rect: { right: number; top: number; width: number; height: number }) {
    const element = document.createElement('button');

    document.body.appendChild(element);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);

    return element;
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('useConfirmation', () => {
    it('resolves true when confirmed and false when canceled', async () => {
        const confirmed = confirmation.request({ title: 'Delete repository', message: 'Delete this repository?' });

        expect(confirmation.state.isOpen).toBe(true);
        expect(confirmation.state.title).toBe('Delete repository');
        expect(confirmation.state.message).toBe('Delete this repository?');

        confirmation.confirm();

        await expect(confirmed).resolves.toBe(true);
        expect(confirmation.state.isOpen).toBe(false);
        expect(confirmation.state.title).toBe('');

        const canceled = confirmation.request({ title: 'Discard', message: 'Discard it?', confirmLabel: 'Discard', cancelLabel: 'Keep' });

        expect(confirmation.state.confirmLabel).toBe('Discard');
        expect(confirmation.state.cancelLabel).toBe('Keep');

        confirmation.cancel();

        await expect(canceled).resolves.toBe(false);
    });

    it('defaults the labels and the detail when they are omitted', async () => {
        const pending = confirmation.request({ title: 'Title', message: 'Message' });

        expect(confirmation.state.confirmLabel).toBe('Continue');
        expect(confirmation.state.cancelLabel).toBe('Cancel');
        expect(confirmation.state.detail).toBeUndefined();

        confirmation.cancel();
        await pending;
    });

    it('queues a second request until the first one is answered', async () => {
        const first = confirmation.request({ title: 'First', message: 'one' });
        const second = confirmation.request({ title: 'Second', message: 'two' });

        expect(confirmation.state.title).toBe('First');

        confirmation.confirm();
        await expect(first).resolves.toBe(true);

        // The queue only opens the next one after the previous promise settled.
        expect(confirmation.state.isOpen).toBe(true);
        expect(confirmation.state.title).toBe('Second');

        confirmation.cancel();
        await expect(second).resolves.toBe(false);
        expect(confirmation.state.isOpen).toBe(false);
    });

    it('opens next to the element passed as the anchor', async () => {
        const anchor = anchorElement({ right: 120, top: 40, width: 80, height: 20 });
        const pending = confirmation.request({ title: 'Title', message: 'Message', anchor });

        expect(confirmation.state.anchorPoint).toEqual({ x: 120, y: 40 });

        confirmation.cancel();
        await pending;
    });

    it('has no anchor point for an element that is not attached or has no box', async () => {
        const detached = document.createElement('button');
        const detachedPending = confirmation.request({ title: 'Title', message: 'Message', anchor: detached });
        expect(confirmation.state.anchorPoint).toBeUndefined();
        confirmation.cancel();
        await detachedPending;

        const hidden = anchorElement({ right: 10, top: 10, width: 0, height: 0 });
        const hiddenPending = confirmation.request({ title: 'Title', message: 'Message', anchor: hidden });
        expect(confirmation.state.anchorPoint).toBeUndefined();
        confirmation.cancel();
        await hiddenPending;
    });

    it('falls back to where the pointer clicked', async () => {
        document.body.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 20, bubbles: true }));

        const pending = confirmation.request({ title: 'Title', message: 'Message' });

        expect(confirmation.state.anchorPoint).toEqual({ x: 10, y: 20 });

        confirmation.cancel();
        await pending;
    });

    it('falls back to the clicked control when a keyboard activated it', async () => {
        const button = anchorElement({ right: 60, top: 30, width: 60, height: 24 });
        button.dispatchEvent(new MouseEvent('click', { clientX: 0, clientY: 0, bubbles: true }));

        const pending = confirmation.request({ title: 'Title', message: 'Message' });

        expect(confirmation.state.anchorPoint).toEqual({ x: 60, y: 30 });

        confirmation.cancel();
        await pending;
    });
});
