import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import CommitMessagePopover from '../../components/CommitMessagePopover.vue';

function panel() {
    return document.querySelector<HTMLElement>('[data-testid="commit-message-popover"]');
}

function field(testId: string) {
    return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.click();
    await nextTick();
}

async function type(testId: string, value: string) {
    const input = field(testId);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await nextTick();
}

async function pressKey(testId: string, init: KeyboardEventInit = { key: 'Enter' }) {
    field(testId).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    await nextTick();
}

function mountPopover(overrides: Record<string, unknown> = {}) {
    return mount(CommitMessagePopover, {
        attachTo: document.body,
        props: {
            open: true,
            value: 'Add release tag',
            title: 'Edit Commit Message',
            targetLabel: 'abc1234 · Add release tag',
            multiline: false,
            canSubmit: true,
            isLoading: false,
            anchorPoint: { x: 250, y: 40 },
            submit: vi.fn(),
            close: vi.fn(),
            ...overrides,
        },
        global: { directives: { loading: {} } },
    });
}

/** jsdom does not lay out, so the panel's own size has to be faked for the flip maths. */
const PANEL_SIZE = { width: 320, height: 180 };
const originalRectDescriptor =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect') ?? Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;

function stubPanelSize() {
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (this.getAttribute('data-testid') === 'commit-message-popover') {
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
}

describe('CommitMessagePopover', () => {
    let wrapper: ReturnType<typeof mount> | undefined;

    afterEach(() => {
        wrapper?.unmount();
        wrapper = undefined;
        delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    });

    it('shows the current value next to the row it was opened on', async () => {
        wrapper = mountPopover();
        await nextTick();

        expect(panel()?.textContent).toContain('Edit Commit Message');
        expect(panel()?.textContent).toContain('abc1234 · Add release tag');
        expect(document.querySelector<HTMLInputElement>('[data-testid="commit-message-input"]')?.value).toBe('Add release tag');
        expect(document.activeElement).toBe(document.querySelector('[data-testid="commit-message-input"]'));
        // 6px past the row's right edge, aligned with the row's top.
        expect(panel()?.style.left).toBe('256px');
        expect(panel()?.style.top).toBe('46px');
    });

    it('flips back over the row near the screen edge', async () => {
        stubPanelSize();
        wrapper = mountPopover({ anchorPoint: { x: 1000, y: 700 } });
        await nextTick();

        expect(panel()?.style.left).toBe(`${1000 - PANEL_SIZE.width - 6}px`);
        expect(panel()?.style.top).toBe(`${700 - PANEL_SIZE.height - 6}px`);
    });

    it('edits the value through the input', async () => {
        wrapper = mountPopover();
        await nextTick();

        await type('commit-message-input', 'Reworded subject');

        expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['Reworded subject']);
    });

    it('saves from the button and from Enter', async () => {
        const submit = vi.fn();
        wrapper = mountPopover({ submit });
        await nextTick();

        await click('commit-message-save');
        await pressKey('commit-message-input');

        expect(submit).toHaveBeenCalledTimes(2);
    });

    it('keeps the save button and Enter inert until the value is usable', async () => {
        const submit = vi.fn();
        wrapper = mountPopover({ submit, canSubmit: false });
        await nextTick();

        expect(document.querySelector<HTMLButtonElement>('[data-testid="commit-message-save"]')?.disabled).toBe(true);

        await click('commit-message-save');
        await pressKey('commit-message-input');

        expect(submit).not.toHaveBeenCalled();
    });

    it('uses a textarea for descriptions and saves on the modifier shortcut', async () => {
        const submit = vi.fn();
        wrapper = mountPopover({ submit, multiline: true, title: 'Edit Commit Description', value: 'Explains the tag.' });
        await nextTick();

        expect(document.querySelector('[data-testid="commit-description-input"]')?.tagName).toBe('TEXTAREA');

        await pressKey('commit-description-input');
        expect(submit).not.toHaveBeenCalled();

        await pressKey('commit-description-input', { key: 'Enter', metaKey: true });
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it('closes on escape, on cancel and on a click outside', async () => {
        const close = vi.fn();
        wrapper = mountPopover({ close });
        await nextTick();

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await nextTick();
        expect(close).toHaveBeenCalledTimes(1);

        await click('commit-message-cancel');
        expect(close).toHaveBeenCalledTimes(2);

        panel()?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(close).toHaveBeenCalledTimes(3);
    });

    it('stays closed until it is opened', async () => {
        wrapper = mountPopover({ open: false });
        await nextTick();

        expect(panel()).toBeNull();
    });
});
