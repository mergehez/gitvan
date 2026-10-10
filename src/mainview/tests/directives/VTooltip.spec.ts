import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { vTooltip } from '../../directives/VTooltip';

const plainHost = defineComponent({
    props: { value: { type: String, required: true } },
    template: '<button class="host" v-tooltip="value">target</button>',
});

const htmlHost = defineComponent({
    props: { value: { type: String, required: true } },
    template: '<button class="host" v-tooltip.xs.nowrap.html="value">target</button>',
});

const alwaysHost = defineComponent({
    template: '<button class="host" v-tooltip.always="\'Always visible\'">target</button>',
});

const delayHost = defineComponent({
    template: '<button class="host" v-tooltip.delay="\'Delayed\'">target</button>',
});

function mountHost(component: typeof plainHost, value = 'A tooltip') {
    return mount(component, {
        props: { value },
        global: { directives: { tooltip: vTooltip } },
    });
}

function tooltipElement() {
    return document.body.querySelector('.tooltip') as HTMLElement | null;
}

async function nextFrame() {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function settledTooltip() {
    // The position pass waits for two animation frames before it reveals the tooltip.
    await nextFrame();
    await nextFrame();
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('v-tooltip', () => {
    it('mounts the tooltip on the body with the bound text and removes it on unmount', async () => {
        const wrapper = mountHost(plainHost);

        const tooltip = tooltipElement();
        expect(tooltip).not.toBeNull();
        expect(tooltip?.textContent).toBe('A tooltip');
        expect(tooltip?.className).toContain('tooltip');

        wrapper.unmount();

        expect(tooltipElement()).toBeNull();
    });

    it('shows the tooltip on mouseenter and hides it on mouseleave', async () => {
        const wrapper = mountHost(plainHost);
        const host = wrapper.get('.host');

        await host.trigger('mouseenter');
        await settledTooltip();

        expect(tooltipElement()?.style.visibility).toBe('visible');
        expect(tooltipElement()?.style.position).toBe('fixed');

        await host.trigger('mouseleave');

        expect(tooltipElement()?.style.display).toBe('none');

        wrapper.unmount();
    });

    it('hides on a document click and stays visible when bound with the always modifier', async () => {
        const wrapper = mountHost(plainHost);

        await wrapper.get('.host').trigger('mouseenter');
        await settledTooltip();
        document.dispatchEvent(new MouseEvent('click'));

        expect(tooltipElement()?.style.display).toBe('none');

        wrapper.unmount();

        const alwaysWrapper = mount(alwaysHost, { global: { directives: { tooltip: vTooltip } } });

        await alwaysWrapper.get('.host').trigger('mouseenter');
        await settledTooltip();
        document.dispatchEvent(new MouseEvent('click'));
        await alwaysWrapper.get('.host').trigger('mouseleave');

        expect(tooltipElement()?.style.visibility).toBe('visible');

        alwaysWrapper.unmount();
    });

    it('applies the size, nowrap and html modifiers and rewrites them when the value changes', async () => {
        const wrapper = mountHost(htmlHost, '<b>Bold</b>');

        const tooltip = tooltipElement();
        expect(tooltip?.className).toContain('tooltip-xs');
        expect(tooltip?.className).toContain('tooltip-nowrap');
        expect(tooltip?.className).toContain('tooltip-html');
        expect(tooltip?.innerHTML).toContain('<b>Bold</b>');

        await wrapper.setProps({ value: '<i>Italic</i>' });

        expect(tooltipElement()?.innerHTML).toContain('<i>Italic</i>');

        wrapper.unmount();
    });

    it('waits for the delay before it reveals the tooltip', async () => {
        vi.useFakeTimers();

        const wrapper = mount(delayHost, { global: { directives: { tooltip: vTooltip } } });
        await wrapper.get('.host').trigger('mouseenter');

        vi.advanceTimersByTime(499);
        expect(tooltipElement()?.style.visibility).toBe('');

        vi.advanceTimersByTime(1_000);
        expect(tooltipElement()?.style.visibility).toBe('visible');

        wrapper.unmount();
    });

    it('cancels a pending delayed tooltip when the pointer leaves', async () => {
        vi.useFakeTimers();

        const wrapper = mount(delayHost, { global: { directives: { tooltip: vTooltip } } });
        const host = wrapper.get('.host');

        await host.trigger('mouseenter');
        vi.advanceTimersByTime(250);
        await host.trigger('mouseleave');
        vi.advanceTimersByTime(1_000);

        expect(tooltipElement()?.style.visibility).toBe('');

        wrapper.unmount();
    });
});
