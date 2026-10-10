import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Alert from '../../components/Alert.vue';

const severityClasses = [
    ['primary', 'alert-primary'],
    ['secondary', 'alert-secondary'],
    ['success', 'alert-success'],
    ['info', 'alert-info'],
    ['warning', 'alert-warning'],
    ['danger', 'alert-danger'],
] as const;

describe('Alert', () => {
    it('renders the slot with the severity class', () => {
        const wrapper = mount(Alert, { props: { severity: 'warning' }, slots: { default: 'Careful' } });

        expect(wrapper.text()).toBe('Careful');
        expect(wrapper.get('.alert').classes()).toEqual(expect.arrayContaining(['alert', 'alert-warning']));
    });

    it.each(severityClasses)('maps the %s severity to %s', (severity, className) => {
        const wrapper = mount(Alert, { props: { severity } });

        expect(wrapper.get('.alert').classes()).toContain(className);
    });

    it('scales with the small flag and keeps the extra class', () => {
        const wrapper = mount(Alert, { props: { severity: 'info', small: true, class: 'extra' } });

        expect(wrapper.get('.alert').classes()).toEqual(expect.arrayContaining(['alert-sm', 'extra']));
    });

    it('has no close button unless it is closable', () => {
        const wrapper = mount(Alert, { slots: { default: 'Body' } });

        expect(wrapper.find('button').exists()).toBe(false);
    });

    it('hides itself when the close button is pressed', async () => {
        const wrapper = mount(Alert, { props: { closable: true }, slots: { default: 'Body' } });

        expect(wrapper.find('button').exists()).toBe(true);

        await wrapper.get('button').trigger('click');

        expect(wrapper.find('.alert').exists()).toBe(false);
    });
});
