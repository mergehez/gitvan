import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import CreateTagModal from '../../components/CreateTagModal.vue';

function mountModal(overrides: Record<string, unknown> = {}) {
    return mount(CreateTagModal, {
        props: {
            open: true,
            name: '',
            message: '',
            targetLabel: 'HEAD · main',
            canSubmit: true,
            isLoading: false,
            submit: vi.fn(),
            close: vi.fn(),
            ...overrides,
        },
        global: { directives: { loading: {} } },
    });
}

describe('CreateTagModal', () => {
    it('renders the name and message fields with the target and annotated hint', () => {
        const wrapper = mountModal();

        expect(wrapper.get('#create-tag-name').attributes('placeholder')).toBe('v1.0.0');
        expect(wrapper.find('#create-tag-message').exists()).toBe(true);
        expect(wrapper.text()).toContain('HEAD · main');
        expect(wrapper.text()).toContain('A message creates an annotated tag');
    });

    it('emits the typed name and message', async () => {
        const wrapper = mountModal();

        await wrapper.get('#create-tag-name').setValue('v1.2.3');
        await wrapper.get('#create-tag-message').setValue('Release notes');

        expect(wrapper.emitted('update:name')?.at(-1)).toEqual(['v1.2.3']);
        expect(wrapper.emitted('update:message')?.at(-1)).toEqual(['Release notes']);
    });

    it('submits from the footer button and from the name field', async () => {
        const submit = vi.fn();
        const wrapper = mountModal({ submit });

        const createButton = wrapper.findAll('button').find((button) => button.text().includes('Create Tag'))!;
        await createButton.trigger('click');
        await wrapper.get('#create-tag-name').trigger('keydown.enter');

        expect(submit).toHaveBeenCalledTimes(2);
    });

    it('closes from the cancel button', async () => {
        const close = vi.fn();
        const wrapper = mountModal({ close });

        const cancelButton = wrapper.findAll('button').find((button) => button.text().includes('Cancel'))!;
        await cancelButton.trigger('click');

        expect(close).toHaveBeenCalledTimes(1);
    });

    it('renders nothing while closed', () => {
        const wrapper = mountModal({ open: false });

        expect(wrapper.find('#create-tag-name').exists()).toBe(false);
    });
});
