import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CenteredInputModal from '../../components/CenteredInputModal.vue';

let wrapper: ReturnType<typeof mount> | undefined;

function mountModal(overrides: Record<string, unknown> = {}) {
    wrapper = mount(CenteredInputModal, {
        attachTo: document.body,
        props: {
            open: true,
            value: '',
            title: 'Rename Repository',
            inputLabel: 'Repository name',
            canSubmit: true,
            isLoading: false,
            submit: vi.fn(),
            ...overrides,
        },
        global: {
            directives: {
                tooltip: {},
                loading: {},
            },
        },
    });

    return wrapper;
}

function findButton(modal: ReturnType<typeof mount>, label: string) {
    const button = modal.findAll('button').find((entry) => entry.text().trim() === label);

    if (!button) {
        throw new Error(`Expected a "${label}" button.`);
    }

    return button;
}

describe('CenteredInputModal', () => {
    afterEach(() => {
        wrapper?.unmount();
        wrapper = undefined;
    });

    it('renders the title, labelled field and the custom submit label', () => {
        const modal = mountModal({ inputLabel: 'Branch name', submitLabel: 'Create' });

        expect(modal.text()).toContain('Rename Repository');
        expect(modal.get('label').attributes('for')).toBe('rename-repository-name');
        expect(modal.get('label').text()).toBe('Branch name');
        expect(modal.get('input#rename-repository-name').attributes('placeholder')).toBe('Branch name');
        expect(findButton(modal, 'Create').exists()).toBe(true);
        expect(findButton(modal, 'Cancel').exists()).toBe(true);
    });

    it('shows the current value and emits typed input', async () => {
        const modal = mountModal({ value: 'old-name' });
        const input = modal.get('input#rename-repository-name');

        expect((input.element as HTMLInputElement).value).toBe('old-name');

        await input.setValue('new-name');

        expect(modal.emitted('update:value')?.at(-1)).toEqual(['new-name']);
    });

    it('submits from the footer button and from the field', async () => {
        const submit = vi.fn();
        const modal = mountModal({ submit });

        await findButton(modal, 'Submit').trigger('click');
        await modal.get('input#rename-repository-name').trigger('keydown.enter');

        expect(submit).toHaveBeenCalledTimes(2);
    });

    it('keeps the submit button disabled until the value can be submitted', async () => {
        const submit = vi.fn();
        const modal = mountModal({ canSubmit: false, submit });

        expect(findButton(modal, 'Submit').attributes('disabled')).toBeDefined();

        await modal.setProps({ canSubmit: true });

        const submitButton = findButton(modal, 'Submit');
        expect(submitButton.attributes('disabled')).toBeUndefined();

        await submitButton.trigger('click');
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it('closes the model from cancel when no close handler is supplied', async () => {
        const modal = mountModal();

        await findButton(modal, 'Cancel').trigger('click');
        await flushPromises();

        expect(modal.emitted('update:open')?.at(-1)).toEqual([false]);
        expect(modal.find('input#rename-repository-name').exists()).toBe(false);
    });

    it('delegates cancel to the close handler when one is supplied', async () => {
        const close = vi.fn();
        const modal = mountModal({ close });

        await findButton(modal, 'Cancel').trigger('click');
        await flushPromises();

        expect(close).toHaveBeenCalledTimes(1);
        expect(modal.emitted('update:open')).toBeUndefined();
        expect(modal.find('input#rename-repository-name').exists()).toBe(true);
    });

    it('focuses and selects the field when it opens', async () => {
        const modal = mountModal({ open: false, value: 'my-repo' });

        expect(modal.find('input#rename-repository-name').exists()).toBe(false);

        await modal.setProps({ open: true });
        await flushPromises();

        const input = modal.get('input#rename-repository-name').element as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe('my-repo'.length);
    });
});
