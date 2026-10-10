import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenuPanel from '../../directives/ContextMenuPanel.vue';
import type { ContextMenuCheckbox, ContextMenuEntry } from '../../directives/contextMenuTypes';

function mountPanel(items: ContextMenuEntry[], options: { leadingFocusTarget?: boolean; zIndex?: number; onClose?: () => void } = {}) {
    return mount(ContextMenuPanel, {
        attachTo: document.body,
        props: {
            items,
            leadingFocusTarget: options.leadingFocusTarget ?? false,
            zIndex: options.zIndex,
            onClose: options.onClose,
        },
    });
}

function activeText() {
    return document.activeElement instanceof HTMLElement ? document.activeElement.textContent?.trim() : undefined;
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('ContextMenuPanel', () => {
    it('renders separators, titles, icons, danger and disabled items', () => {
        const wrapper = mountPanel([
            { type: 'separator', id: 'sep' },
            { type: 'title', id: 'title', title: 'Actions' },
            { id: 'open', label: 'Open', iconClass: 'icon-open' },
            { id: 'close', label: 'Close', disabled: true, danger: true },
        ]);

        expect(wrapper.findAll('.v-menu-separator')).toHaveLength(1);
        expect(wrapper.get('.v-menu-title').text()).toBe('Actions');

        const buttons = wrapper.findAll('button.v-menu-item');
        expect(buttons.map((button) => button.text())).toEqual(['Open', 'Close']);
        expect(wrapper.find('.v-menu-item-icon').exists()).toBe(true);
        expect(buttons[1]!.classes()).toContain('v-menu-item--danger');
        expect(buttons[1]!.attributes('disabled')).toBeDefined();

        wrapper.unmount();
    });

    it('runs the action and closes on a plain item click', async () => {
        const action = vi.fn();
        const onClose = vi.fn();
        const wrapper = mountPanel([{ id: 'open', label: 'Open', action }], { onClose });

        await wrapper.get('button.v-menu-item').trigger('click');

        expect(action).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);

        wrapper.unmount();
    });

    it('ignores a click on a disabled item or on one that opens a submenu', async () => {
        const disabledAction = vi.fn();
        const parentAction = vi.fn();
        const onClose = vi.fn();
        const wrapper = mountPanel(
            [
                { id: 'disabled', label: 'Disabled', disabled: true, action: disabledAction },
                { id: 'parent', label: 'Parent', action: parentAction, children: [{ id: 'child', label: 'Child' }] },
            ],
            { onClose }
        );

        const buttons = wrapper.findAll('button.v-menu-item');
        await buttons[0]!.trigger('click');
        await buttons[1]!.trigger('click');

        expect(disabledAction).not.toHaveBeenCalled();
        expect(parentAction).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();

        wrapper.unmount();
    });

    it('toggles a checkbox and runs its action without closing the menu', async () => {
        const entry: ContextMenuCheckbox = { type: 'checkbox', id: 'check', label: 'Check me', checked: true, action: vi.fn() };
        const onClose = vi.fn();
        const wrapper = mountPanel([entry], { onClose });

        expect(wrapper.get('.v-menu-item-check').text()).toBe('✓');

        await wrapper.get('button.v-menu-item').trigger('click');

        expect(entry.checked).toBe(false);
        expect(entry.action).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();

        wrapper.unmount();
    });

    it('renders a submenu and focuses its first item on ArrowRight', async () => {
        const wrapper = mountPanel([{ id: 'parent', label: 'Parent', children: [{ id: 'child', label: 'Child' }] }], { zIndex: 123 });

        expect(wrapper.find('.v-menu-children .v-menu-panel').exists()).toBe(true);
        expect((wrapper.get('.v-menu-children').element as HTMLElement).style.zIndex).toBe('123');

        await wrapper.get('button.v-menu-item').trigger('keydown', { key: 'ArrowRight' });

        expect(activeText()).toBe('Child');
        // With zero-sized rects in jsdom the child panel opens to the right of its trigger.
        expect((wrapper.get('.v-menu-children').element as HTMLElement).style.left).toBe('100%');

        wrapper.unmount();
    });

    it('moves focus with ArrowDown, ArrowUp, Home and End', async () => {
        const wrapper = mountPanel([
            { id: 'one', label: 'One' },
            { id: 'two', label: 'Two' },
            { id: 'three', label: 'Three' },
        ]);
        const buttons = wrapper.findAll('button.v-menu-item');
        (buttons[0]!.element as HTMLElement).focus();

        await buttons[0]!.trigger('keydown', { key: 'ArrowDown' });
        expect(activeText()).toBe('Two');

        await buttons[1]!.trigger('keydown', { key: 'ArrowUp' });
        expect(activeText()).toBe('One');

        await buttons[0]!.trigger('keydown', { key: 'End' });
        expect(activeText()).toBe('Three');

        await buttons[2]!.trigger('keydown', { key: 'Home' });
        expect(activeText()).toBe('One');

        wrapper.unmount();
    });

    it('moves focus from a submenu back to its trigger on ArrowLeft', async () => {
        const wrapper = mountPanel([{ id: 'parent', label: 'Parent', children: [{ id: 'child', label: 'Child' }] }]);
        const buttons = wrapper.findAll('button.v-menu-item');

        await buttons[0]!.trigger('keydown', { key: 'ArrowRight' });
        await wrapper.findAll('button.v-menu-item')[1]!.trigger('keydown', { key: 'ArrowLeft' });

        expect(activeText()).toBe('Parent');

        wrapper.unmount();
    });

    it('focuses the first and last item from the leading focus target', async () => {
        const wrapper = mountPanel(
            [
                { id: 'one', label: 'One' },
                { id: 'two', label: 'Two' },
            ],
            { leadingFocusTarget: true }
        );
        const leading = wrapper.get('.v-menu-leading-focus');

        await leading.trigger('keydown', { key: 'ArrowDown' });
        expect(activeText()).toBe('One');

        await leading.trigger('keydown', { key: 'End' });
        expect(activeText()).toBe('Two');

        wrapper.unmount();
    });
});
