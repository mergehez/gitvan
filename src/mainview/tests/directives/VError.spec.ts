import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { vError } from '../../directives/VError';

const messageHost = defineComponent({
    props: { message: { type: String, default: '' } },
    template: '<button class="host" v-error="message">target</button>',
});

const optionsHost = defineComponent({
    props: { message: { type: String, default: '' } },
    template: '<button class="host" v-error="{ message: message, html: true, class: \'custom\' }">target</button>',
});

const valueHost = defineComponent({
    props: { message: { type: String, default: '' } },
    template: '<button class="host" v-error="{ value: message }">target</button>',
});

const topHost = defineComponent({
    template: '<button class="host" v-error.top="\'Above\'">target</button>',
});

const childTarget = defineComponent({
    name: 'ChildTarget',
    template: '<span class="child">child</span>',
});

const componentHost = defineComponent({
    components: { ChildTarget: childTarget },
    template: '<div class="wrapper"><ChildTarget v-error="\'Child error\'" /></div>',
});

function mountWithError(component: typeof messageHost, props: Record<string, unknown> = {}) {
    return mount(component, {
        props,
        global: { directives: { error: vError } },
    });
}

function errorTooltip() {
    return document.body.querySelector('.v-error') as HTMLElement | null;
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('v-error', () => {
    it('attaches the message as a bottom tooltip and removes it on unmount', () => {
        const wrapper = mountWithError(messageHost, { message: 'Something failed' });

        const tooltip = errorTooltip();
        expect(tooltip?.textContent).toBe('Something failed');
        expect(tooltip?.className).toContain('tooltip');
        expect(tooltip?.querySelector('.tooltip-arrow')?.className).toContain('tooltip-arrow-bottom');

        wrapper.unmount();

        expect(errorTooltip()).toBeNull();
    });

    it('attaches the tooltip to a component target and removes it on unmount', () => {
        const wrapper = mount(componentHost, { global: { directives: { error: vError } } });

        expect(wrapper.find('.child').exists()).toBe(true);
        expect(errorTooltip()?.textContent).toBe('Child error');

        wrapper.unmount();

        expect(errorTooltip()).toBeNull();
    });

    it('reads the message option, keeps the custom class and renders html', () => {
        const wrapper = mountWithError(optionsHost, { message: '<b>Boom</b>' });

        const tooltip = errorTooltip();
        expect(tooltip?.className).toContain('v-error');
        expect(tooltip?.className).toContain('custom');
        expect(tooltip?.className).toContain('tooltip-html');
        expect(tooltip?.innerHTML).toContain('<b>Boom</b>');

        wrapper.unmount();
    });

    it('falls back to the value option when the options carry no message', () => {
        const wrapper = mountWithError(valueHost, { message: 'Fallback message' });

        expect(errorTooltip()?.textContent).toBe('Fallback message');

        wrapper.unmount();
    });

    it('places the tooltip on the side a modifier asks for', () => {
        const wrapper = mount(topHost, { global: { directives: { error: vError } } });

        expect(errorTooltip()?.querySelector('.tooltip-arrow')?.className).toContain('tooltip-arrow-top');

        wrapper.unmount();
    });

    it('removes the tooltip when the message goes away and adds it back', async () => {
        const wrapper = mountWithError(messageHost, { message: 'Boom' });
        expect(errorTooltip()).not.toBeNull();

        await wrapper.setProps({ message: '' });
        expect(errorTooltip()).toBeNull();

        await wrapper.setProps({ message: 'Again' });
        expect(errorTooltip()?.textContent).toBe('Again');

        wrapper.unmount();
    });
});
