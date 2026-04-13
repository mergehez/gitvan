import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import CenteredModal from '../../components/CenteredModal.vue';

const iconButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
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

function mountModal(open = true) {
    return mount(CenteredModal, {
        attachTo: document.body,
        props: {
            open,
            title: 'Settings',
        },
        slots: {
            default: '<div>Body</div>',
        },
        global: {
            stubs: {
                IconButton: iconButtonStub,
            },
            directives: {
                tooltip: {},
            },
        },
    });
}

describe('CenteredModal', () => {
    it('drags the modal surface from the header', async () => {
        const wrapper = mountModal();
        const header = wrapper.get('[data-testid="centered-modal-header"]');
        const surface = wrapper.get('[data-testid="centered-modal-surface"]');

        dispatchPointerEvent(header.element, 'pointerdown', { clientX: 100, clientY: 120 });
        dispatchPointerEvent(window, 'pointermove', { clientX: 160, clientY: 180 });
        dispatchPointerEvent(window, 'pointerup', { clientX: 160, clientY: 180 });
        await wrapper.vm.$nextTick();

        expect((surface.element as HTMLElement).style.transform).toBe('translate(60px, 60px)');
        wrapper.unmount();
    });

    it('resets the drag offset when the modal closes', async () => {
        const wrapper = mountModal();
        const header = wrapper.get('[data-testid="centered-modal-header"]');
        const surface = wrapper.get('[data-testid="centered-modal-surface"]');

        dispatchPointerEvent(header.element, 'pointerdown', { clientX: 40, clientY: 40 });
        dispatchPointerEvent(window, 'pointermove', { clientX: 90, clientY: 100 });
        dispatchPointerEvent(window, 'pointerup', { clientX: 90, clientY: 100 });
        await wrapper.vm.$nextTick();

        expect((surface.element as HTMLElement).style.transform).toBe('translate(50px, 60px)');

        await wrapper.setProps({ open: false });
        await wrapper.setProps({ open: true });
        await wrapper.vm.$nextTick();

        expect((wrapper.get('[data-testid="centered-modal-surface"]').element as HTMLElement).style.transform).toBe('translate(0px, 0px)');
        wrapper.unmount();
    });
});
