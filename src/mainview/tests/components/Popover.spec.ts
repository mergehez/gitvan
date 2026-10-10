import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import Popover from '../../components/Popover.vue';

/** Only the props this spec drives; the component does not export its prop type. */
type PopoverTestProps = {
    open?: boolean;
    title?: string;
    backdrop?: boolean;
    closable?: boolean;
    resizable?: boolean;
    center?: boolean;
    localStorageKey?: string;
    closeTooltip?: string;
    headerDataTestid?: string;
    onUpdateOpen?: (open: boolean) => void;
    onUpdatePosition?: (position: { left: number; top: number }) => void;
    onUpdateSize?: (size: { width: number; height: number }) => void;
};

const closeButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    template: '<button type="button" data-testid="popover-close" @click="$emit(\'click\')">Close</button>',
});

const PointerEventCtor = window.PointerEvent ?? MouseEvent;

function dispatchPointerEvent(target: EventTarget, type: string, options: { clientX: number; clientY: number; button?: number; pointerId?: number }) {
    const event = new PointerEventCtor(type, {
        bubbles: true,
        clientX: options.clientX,
        clientY: options.clientY,
        button: options.button ?? 0,
        pointerId: options.pointerId ?? 1,
    });

    target.dispatchEvent(event);
}

let wrapper: ReturnType<typeof mount> | undefined;

function mountPopover(props: PopoverTestProps = {}, slots: Record<string, string> = {}) {
    wrapper = mount(Popover, {
        attachTo: document.body,
        props: {
            open: true,
            onUpdateOpen: vi.fn(),
            onUpdatePosition: vi.fn(),
            onUpdateSize: vi.fn(),
            ...props,
        },
        slots: {
            default: '<div data-testid="popover-body">Body</div>',
            ...slots,
        },
        global: {
            stubs: {
                IconButton: closeButtonStub,
            },
            directives: {
                tooltip: {},
            },
        },
    });

    return wrapper;
}

function surface() {
    return wrapper!.get('[role="dialog"]');
}

/** The surface's parent is the fixed wrapper that carries the backdrop/center classes. */
function wrapperElement() {
    return surface().element.parentElement as HTMLElement;
}

describe('Popover', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = undefined;
    });

    it('renders the title and body while open and removes the surface when closed', async () => {
        const popover = mountPopover({ title: 'Diff settings' }, { footer: '<span data-testid="popover-footer">Footer</span>' });

        expect(popover.get('[role="dialog"]').text()).toContain('Diff settings');
        expect(popover.get('[data-testid="popover-body"]').text()).toBe('Body');
        expect(popover.get('[data-testid="popover-footer"]').text()).toBe('Footer');

        await popover.setProps({ open: false });

        expect(popover.find('[role="dialog"]').exists()).toBe(false);
    });

    it('closes from the header button and reports the new open state', async () => {
        const onUpdateOpen = vi.fn();
        const popover = mountPopover({ onUpdateOpen, closeTooltip: 'Close popover' });

        await popover.get('[data-testid="popover-close"]').trigger('click');

        expect(onUpdateOpen).toHaveBeenCalledWith(false);
        expect(popover.find('[role="dialog"]').exists()).toBe(false);
    });

    it('closes on a backdrop click when a backdrop is shown', async () => {
        const onUpdateOpen = vi.fn();
        const popover = mountPopover({ backdrop: true, onUpdateOpen });

        expect(wrapperElement().className).toContain('backdrop-blur');
        wrapperElement().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await popover.vm.$nextTick();

        expect(onUpdateOpen).toHaveBeenCalledWith(false);
        expect(popover.find('[role="dialog"]').exists()).toBe(false);
    });

    it('stays open on a backdrop click when no backdrop is shown', async () => {
        const onUpdateOpen = vi.fn();
        const popover = mountPopover({ onUpdateOpen });

        expect(wrapperElement().className).toContain('pointer-events-none');
        wrapperElement().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await popover.vm.$nextTick();

        expect(onUpdateOpen).not.toHaveBeenCalled();
        expect(popover.find('[role="dialog"]').exists()).toBe(true);
    });

    it('hides the close button and the resize handles when they are disabled', () => {
        const popover = mountPopover({ closable: false, resizable: false });

        expect(popover.find('[data-testid="popover-close"]').exists()).toBe(false);
        expect(popover.find('[data-testid="floating-surface-handle-right"]').exists()).toBe(false);
        expect(popover.find('[data-testid="floating-surface-handle-left"]').exists()).toBe(false);
    });

    it('drags the surface from the header and reports the committed position', async () => {
        const onUpdatePosition = vi.fn();
        const popover = mountPopover({ headerDataTestid: 'popover-header', onUpdatePosition });

        dispatchPointerEvent(popover.get('[data-testid="popover-header"]').element, 'pointerdown', { clientX: 100, clientY: 120 });
        dispatchPointerEvent(window, 'pointermove', { clientX: 160, clientY: 180 });
        dispatchPointerEvent(window, 'pointerup', { clientX: 160, clientY: 180 });
        await popover.vm.$nextTick();

        // The surface starts at the default 24/24 offset, so the 60/60 pointer delta moves it to 84/84.
        expect((surface().element as HTMLElement).style.transform).toBe('translate3d(84px, 84px, 0)');
        expect(onUpdatePosition).toHaveBeenCalledWith({ left: 84, top: 84 });
    });

    it('ignores header drags that start on a control', async () => {
        const onUpdatePosition = vi.fn();
        const popover = mountPopover({ headerDataTestid: 'popover-header', onUpdatePosition }, { actions: '<button data-testid="popover-action">Action</button>' });

        dispatchPointerEvent(popover.get('[data-testid="popover-action"]').element, 'pointerdown', { clientX: 100, clientY: 120 });
        dispatchPointerEvent(window, 'pointermove', { clientX: 200, clientY: 220 });
        dispatchPointerEvent(window, 'pointerup', { clientX: 200, clientY: 220 });
        await popover.vm.$nextTick();

        expect(onUpdatePosition).not.toHaveBeenCalled();
        expect((surface().element as HTMLElement).style.transform).toBe('translate3d(24px, 24px, 0)');
    });

    it('resizes from a side handle, reports the size and stores the width', async () => {
        const onUpdateSize = vi.fn();
        const popover = mountPopover({ localStorageKey: 'popover-size', onUpdateSize });

        dispatchPointerEvent(popover.get('[data-testid="floating-surface-handle-right"]').element, 'pointerdown', { clientX: 500, clientY: 300 });
        dispatchPointerEvent(window, 'pointermove', { clientX: 540, clientY: 300 });
        dispatchPointerEvent(window, 'pointerup', { clientX: 540, clientY: 300 });
        await popover.vm.$nextTick();

        expect((surface().element as HTMLElement).style.width).toBe('520px');
        expect(onUpdateSize).toHaveBeenCalledWith({ width: 520, height: 180 });
        expect(JSON.parse(window.localStorage.getItem('popover-size') ?? 'null')).toEqual({ width: 520 });
    });

    it('restores a stored width for a centered surface', async () => {
        window.localStorage.setItem('popover-size', JSON.stringify({ width: 600 }));
        mountPopover({ center: true, backdrop: true, localStorageKey: 'popover-size' });
        await flushPromises();

        expect(wrapperElement().className).toContain('flex items-center justify-center');
        expect((surface().element as HTMLElement).style.width).toBe('600px');
        expect((surface().element as HTMLElement).style.transform).toBe('translate(0px, 0px)');
    });
});
