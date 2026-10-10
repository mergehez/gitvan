import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import AppSuccessToast from '../../components/AppSuccessToast.vue';
import { toast } from '../../composables/useToast';

beforeEach(() => {
    toast.dismissSuccessToast();
    toast.dismissErrorToast();
});

describe('AppSuccessToast', () => {
    it('renders nothing while no toast is showing', () => {
        const wrapper = mount(AppSuccessToast);

        expect(wrapper.find('.alert').exists()).toBe(false);
    });

    it('shows the success message and dismisses it from the close button', async () => {
        toast.showSuccessToast('Saved successfully');

        const wrapper = mount(AppSuccessToast);

        expect(wrapper.text()).toContain('Saved successfully');
        expect(wrapper.get('.alert').classes()).toContain('alert-success');

        await wrapper.get('button').trigger('click');

        expect(toast.successToastMessage).toBeUndefined();
        expect(wrapper.find('.alert').exists()).toBe(false);
    });

    it('shows the error message when only that one is set', async () => {
        toast.showErrorToast('Something broke');

        const wrapper = mount(AppSuccessToast);

        expect(wrapper.text()).toContain('Something broke');
        expect(wrapper.get('.alert').classes()).toContain('alert-danger');

        await wrapper.get('button').trigger('click');

        expect(toast.errorToastMessage).toBeUndefined();
        expect(wrapper.find('.alert').exists()).toBe(false);
    });

    it('prefers the success message when both are set', () => {
        toast.showSuccessToast('Saved successfully');
        toast.showErrorToast('Something broke');

        const wrapper = mount(AppSuccessToast);

        expect(wrapper.text()).toContain('Saved successfully');
        expect(wrapper.text()).not.toContain('Something broke');
    });
});
