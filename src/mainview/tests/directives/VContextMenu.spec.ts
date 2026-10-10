import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { vContextMenu } from '../../directives/VContextMenu';
import { useContextMenu } from '../../directives/useContextMenu';
import type { ContextMenuEntry } from '../../directives/contextMenuTypes';

const listHost = defineComponent({
    props: { items: { type: Array, required: true } },
    template: '<button class="host" v-contextmenu="items">target</button>',
});

const buttonHost = defineComponent({
    props: { items: { type: Array, required: true } },
    template: '<button class="host" v-contextmenu.button="items">target</button>',
});

const disabledHost = defineComponent({
    props: { items: { type: Array, required: true } },
    template: '<button class="host" v-contextmenu="{ items, disabled: true }">target</button>',
});

function entries(): ContextMenuEntry[] {
    return [
        { id: 'open', label: 'Open' },
        { id: 'copy', label: 'Copy' },
    ];
}

function mountList(component: typeof listHost, items: ContextMenuEntry[], attachTo?: HTMLElement) {
    return mount(component, {
        props: { items },
        ...(attachTo ? { attachTo } : {}),
        global: { directives: { contextmenu: vContextMenu } },
    });
}

function dispatchContextMenu(element: Element, options: MouseEventInit = {}) {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);

    return event;
}

const menu = useContextMenu();

beforeEach(() => {
    menu.closeMenu();
});

afterEach(() => {
    menu.closeMenu();
    document.body.innerHTML = '';
});

describe('v-context-menu', () => {
    it('opens at the pointer position and prevents the native menu', () => {
        const wrapper = mountList(listHost, entries());

        const event = dispatchContextMenu(wrapper.get('.host').element, { clientX: 12, clientY: 34 });

        expect(menu.open).toBe(true);
        expect(menu.items.map((entry) => entry.id)).toEqual(['open', 'copy']);
        expect(menu.x).toBe(12);
        expect(menu.y).toBe(34);
        expect(event.defaultPrevented).toBe(true);

        wrapper.unmount();
    });

    it('stays closed for an empty list and for a disabled binding', () => {
        const emptyWrapper = mountList(listHost, []);
        dispatchContextMenu(emptyWrapper.get('.host').element);
        expect(menu.open).toBe(false);
        emptyWrapper.unmount();

        const disabledWrapper = mountList(disabledHost, entries());
        dispatchContextMenu(disabledWrapper.get('.host').element);
        expect(menu.open).toBe(false);
        disabledWrapper.unmount();
    });

    it('opens on a plain click only with the button modifier', () => {
        const clickWrapper = mountList(listHost, entries());
        clickWrapper.get('.host').trigger('click');
        expect(menu.open).toBe(false);
        clickWrapper.unmount();

        const buttonWrapper = mountList(buttonHost, entries());
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        buttonWrapper.get('.host').element.dispatchEvent(clickEvent);

        expect(menu.open).toBe(true);
        expect(menu.element).toBe(buttonWrapper.get('.host').element);
        expect(clickEvent.defaultPrevented).toBe(true);

        buttonWrapper.unmount();
    });

    it('opens on the context-menu key and shift+F10, and ignores every other key', () => {
        const wrapper = mountList(listHost, entries());
        const host = wrapper.get('.host').element;

        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(menu.open).toBe(false);

        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));
        expect(menu.open).toBe(true);

        menu.closeMenu();
        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
        expect(menu.open).toBe(true);

        wrapper.unmount();
    });

    it('focuses the host and exposes openContextMenu with an item override', () => {
        const wrapper = mountList(listHost, entries(), document.body);
        const host = wrapper.get('.host').element as HTMLElement & { openContextMenu: (options?: { items?: ContextMenuEntry[] }) => void };

        dispatchContextMenu(host);
        expect(document.activeElement).toBe(host);

        menu.closeMenu();
        host.openContextMenu({ items: [{ id: 'only', label: 'Only' }] });

        expect(menu.open).toBe(true);
        expect(menu.items.map((entry) => entry.id)).toEqual(['only']);

        wrapper.unmount();
    });

    it('rewrites the open menu when the bound list changes', async () => {
        const wrapper = mountList(listHost, entries());
        dispatchContextMenu(wrapper.get('.host').element);

        await wrapper.setProps({ items: [{ id: 'close', label: 'Close' }] });

        expect(menu.items.map((entry) => entry.id)).toEqual(['close']);

        wrapper.unmount();
    });

    it('stops opening once the host is unmounted', () => {
        const wrapper = mountList(listHost, entries());
        const host = wrapper.get('.host').element;

        wrapper.unmount();
        dispatchContextMenu(host);

        expect(menu.open).toBe(false);
    });
});
