import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import IconButton from '../../components/IconButton.vue';

const closeIcon = 'icon-[mdi--close]' as const;

describe('IconButton', () => {
    it('renders the icon inside a light button by default', () => {
        const wrapper = mount(IconButton, { props: { icon: closeIcon } });

        expect(wrapper.element.tagName).toBe('BUTTON');
        expect(wrapper.classes()).toContain('btn-light');
        expect(wrapper.get('i').classes()).toEqual(expect.arrayContaining(['icon', closeIcon]));
    });

    it('scales the padding with the smaller flag', () => {
        const regular = mount(IconButton, { props: { icon: closeIcon } });
        expect(regular.classes()).toEqual(expect.arrayContaining(['p-1', 'text-sm']));

        const smaller = mount(IconButton, { props: { icon: closeIcon, smaller: true } });
        expect(smaller.classes()).toEqual(expect.arrayContaining(['p-0.5', 'text-2xs']));
    });

    it('forwards the severity, the extra class and the disabled state', () => {
        const wrapper = mount(IconButton, { props: { icon: closeIcon, severity: 'danger', class: 'extra', disabled: true } });

        expect(wrapper.classes()).toEqual(expect.arrayContaining(['btn-danger', 'extra']));
        expect(wrapper.attributes('disabled')).toBeDefined();
    });

    it('passes a click listener through to the rendered button', async () => {
        const onClick = vi.fn();
        const wrapper = mount(IconButton, { props: { icon: closeIcon }, attrs: { onClick } });

        await wrapper.trigger('click');

        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
