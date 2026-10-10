import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Button from '../../components/Button.vue';

const severityClasses = [
    ['primary', 'btn-primary'],
    ['raised', 'btn-raised'],
    ['secondary', 'btn-secondary'],
    ['light', 'btn-light'],
    ['success', 'btn-success'],
    ['info', 'btn-info'],
    ['warning', 'btn-warning'],
    ['danger', 'btn-danger'],
] as const;

describe('Button', () => {
    it('renders a button with the slot and forwards the remaining attributes', () => {
        const wrapper = mount(Button, {
            props: { class: 'custom-class' },
            attrs: { type: 'submit' },
            slots: { default: 'Save' },
        });

        expect(wrapper.element.tagName).toBe('BUTTON');
        expect(wrapper.text()).toBe('Save');
        expect(wrapper.attributes('type')).toBe('submit');
        expect(wrapper.classes()).toContain('btn');
        expect(wrapper.classes()).toContain('custom-class');
    });

    it.each(severityClasses)('maps the %s severity to %s', (severity, className) => {
        const wrapper = mount(Button, { props: { severity } });

        expect(wrapper.classes()).toContain(className);
    });

    it('adds no severity class when none is asked for', () => {
        const wrapper = mount(Button);

        expect(wrapper.classes().filter((className) => className.startsWith('btn-'))).toEqual([]);
    });

    it('scales with the small and smaller flags', () => {
        const small = mount(Button, { props: { small: true } });
        expect(small.classes()).toEqual(expect.arrayContaining(['btn-sm', 'rounded-sm']));

        const smaller = mount(Button, { props: { smaller: true } });
        expect(smaller.classes()).toEqual(expect.arrayContaining(['btn-xs', 'rounded-sm']));
    });

    it('renders the tag the as prop asks for', () => {
        const wrapper = mount(Button, { props: { as: 'a' } });

        expect(wrapper.element.tagName).toBe('A');
    });

    it('disables the rendered control when disabled', () => {
        const wrapper = mount(Button, { props: { disabled: true } });

        expect(wrapper.attributes('disabled')).toBeDefined();
    });
});
