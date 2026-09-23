import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AppConfirmationPopover from '../../components/AppConfirmationPopover.vue';
import { confirmation } from '../../composables/useConfirmation';

/** The row actions live in a hover-only container, so the trigger is only measured at click time. */
function createTrigger(rect: { left: number; top: number; width?: number; height?: number }) {
    const width = rect.width ?? 20;
    const height = rect.height ?? 20;
    const trigger = document.createElement('button');
    trigger.textContent = 'Discard change';
    trigger.getBoundingClientRect = () =>
        ({ left: rect.left, top: rect.top, right: rect.left + width, bottom: rect.top + height, width, height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(trigger);

    return trigger;
}

function panel() {
    return document.querySelector<HTMLElement>('[data-testid="confirmation-popover"]');
}

/** jsdom does not lay out, so the panel's own size has to be faked for the flip/clamp maths. */
const PANEL_SIZE = { width: 256, height: 120 };
const originalRectDescriptor =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect') ?? Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;
let restoreRect: (() => void) | undefined;

function stubPanelSize() {
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (this.getAttribute('data-testid') === 'confirmation-popover') {
            return {
                left: 0,
                top: 0,
                right: PANEL_SIZE.width,
                bottom: PANEL_SIZE.height,
                width: PANEL_SIZE.width,
                height: PANEL_SIZE.height,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            } as DOMRect;
        }

        return originalRectDescriptor.value.call(this) as DOMRect;
    };

    restoreRect = () => {
        delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    };
}

function clickAt(element: HTMLElement, point?: { x: number; y: number }) {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: point?.x ?? 0, clientY: point?.y ?? 0 }));
}

function requestDiscard(title = 'Discard file changes') {
    return confirmation.request({
        title,
        message: "Discard changes in 'second.txt'?",
        detail: 'This permanently removes the current uncommitted changes.',
        confirmLabel: 'Discard',
    });
}

async function click(testId: string) {
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
    await flushPromises();
}

describe('AppConfirmationPopover', () => {
    let wrapper: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        if (confirmation.state.isOpen) {
            confirmation.cancel();
        }

        stubPanelSize();
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = undefined;
        restoreRect?.();
        restoreRect = undefined;
        document.querySelectorAll('button').forEach((button) => {
            if (button.textContent === 'Discard change') {
                button.remove();
            }
        });
    });

    it('opens next to the point that was clicked', async () => {
        wrapper = mount(AppConfirmationPopover, { attachTo: document.body });
        clickAt(createTrigger({ left: 170, top: 294 }), { x: 186, y: 300 });

        const pendingConfirmation = requestDiscard();
        await flushPromises();

        expect(panel()?.textContent).toContain('Discard file changes');
        expect(panel()?.textContent).toContain("Discard changes in 'second.txt'?");
        expect(panel()?.textContent).toContain('This permanently removes the current uncommitted changes.');
        // 6px down-right of the pointer, not of the trigger's box.
        expect(panel()?.style.left).toBe('192px');
        expect(panel()?.style.top).toBe('306px');

        await click('confirmation-popover-cancel');
        await expect(pendingConfirmation).resolves.toBe(false);
    });

    it('falls back to the trigger edge when the click carries no pointer position', async () => {
        wrapper = mount(AppConfirmationPopover, { attachTo: document.body });
        const trigger = createTrigger({ left: 190, top: 300 });
        // Keyboard activation reports 0/0, so the trigger's own corner is the anchor.
        trigger.click();

        const pendingConfirmation = requestDiscard();
        await flushPromises();

        // 6px past the trigger's right edge (190 + 20), aligned with its top.
        expect(panel()?.style.left).toBe('216px');
        expect(panel()?.style.top).toBe('306px');

        confirmation.cancel();
        await expect(pendingConfirmation).resolves.toBe(false);
    });

    it('flips back over the pointer near the screen edge', async () => {
        wrapper = mount(AppConfirmationPopover, { attachTo: document.body });
        clickAt(createTrigger({ left: 990, top: 690 }), { x: 1000, y: 700 });

        const pendingConfirmation = requestDiscard();
        await flushPromises();

        expect(panel()?.style.left).toBe(`${1000 - PANEL_SIZE.width - 6}px`);
        expect(panel()?.style.top).toBe(`${700 - PANEL_SIZE.height - 6}px`);

        confirmation.cancel();
        await expect(pendingConfirmation).resolves.toBe(false);
    });

    it('resolves true when the confirm button is pressed', async () => {
        wrapper = mount(AppConfirmationPopover, { attachTo: document.body });
        const pendingConfirmation = confirmation.request({
            title: 'Discard all changes',
            message: 'Discard all unstaged changes in this repository?',
            anchor: createTrigger({ left: 40, top: 80 }),
        });

        await flushPromises();
        await click('confirmation-popover-confirm');

        await expect(pendingConfirmation).resolves.toBe(true);
        expect(panel()).toBeNull();
    });

    it('cancels on escape', async () => {
        wrapper = mount(AppConfirmationPopover, { attachTo: document.body });
        const pendingConfirmation = confirmation.request({
            title: 'Discard stash',
            message: 'Discard stash stash@{0}?',
            anchor: createTrigger({ left: 40, top: 80 }),
        });

        await flushPromises();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flushPromises();

        await expect(pendingConfirmation).resolves.toBe(false);
    });

    it('cancels when clicking outside the panel', async () => {
        wrapper = mount(AppConfirmationPopover, { attachTo: document.body });
        const pendingConfirmation = confirmation.request({
            title: 'Delete tag',
            message: "Delete tag 'v1'?",
            anchor: createTrigger({ left: 40, top: 80 }),
        });

        await flushPromises();
        panel()?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await flushPromises();

        await expect(pendingConfirmation).resolves.toBe(false);
    });

    it('stays out of the way when the last click has nothing to hug', async () => {
        wrapper = mount(AppConfirmationPopover, { attachTo: document.body });
        const hiddenTrigger = document.createElement('button');
        hiddenTrigger.click();

        const pendingConfirmation = confirmation.request({
            title: 'Undo latest commit',
            message: 'Undo the latest commit and keep its changes staged?',
        });

        await flushPromises();

        expect(confirmation.state.anchorPoint).toBeUndefined();
        expect(panel()).toBeNull();

        confirmation.cancel();
        await expect(pendingConfirmation).resolves.toBe(false);
    });
});
