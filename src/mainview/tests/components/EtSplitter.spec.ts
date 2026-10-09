import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import EtSplitter from '../../components/EtSplitter.vue';

const containerRect = { left: 0, right: 1000, top: 0, bottom: 100, width: 1000, height: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

function nextFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function mountSplitter(props: Record<string, unknown> = {}) {
    const wrapper = mount(EtSplitter, {
        props: { baseSide: 'left', ...props },
        slots: { left: '<p>left</p>', right: '<p>right</p>' },
    });
    const rectSpy = vi.spyOn(wrapper.element as HTMLElement, 'getBoundingClientRect').mockReturnValue(containerRect);

    return {
        wrapper,
        rectSpy,
        divider: wrapper.get('[title="Drag to resize"]'),
    };
}

/** The divider also carries `min-h-full`, so the panels are picked by their slot content. */
function panel(wrapper: ReturnType<typeof mount>, side: 'left' | 'right') {
    const found = wrapper.findAll('div.min-h-full').find((candidate) => candidate.text() === side);

    if (!found) {
        throw new Error(`Expected a ${side} panel.`);
    }

    return found;
}

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('EtSplitter', () => {
    it('splits at the default width', () => {
        const { wrapper } = mountSplitter();

        expect(panel(wrapper, 'left').attributes('style')).toContain('50%');
        expect(panel(wrapper, 'right').attributes('style')).toContain('50%');
    });

    it('restores a persisted width', () => {
        localStorage.setItem('split-width', '420');

        const { wrapper } = mountSplitter({ localStorageKey: 'split-width' });

        expect(panel(wrapper, 'left').attributes('style')).toContain('420px');
    });

    it('measures the container once per drag and persists only on mouseup', async () => {
        const { wrapper, rectSpy, divider } = mountSplitter({ localStorageKey: 'split-width' });

        await divider.trigger('mousedown', { clientX: 0 });
        expect(document.body.classList.contains('select-none')).toBe(true);

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));

        await nextFrame();
        await nextTick();

        expect(panel(wrapper, 'left').attributes('style')).toContain('300px');
        expect(rectSpy).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('split-width')).toBeNull();

        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 300 }));
        await nextTick();

        expect(localStorage.getItem('split-width')).toBe('300');
        expect(document.body.classList.contains('select-none')).toBe(false);
    });

    it('leaves the width alone when the drag never moved', async () => {
        const { wrapper, divider } = mountSplitter({ localStorageKey: 'split-width' });

        await divider.trigger('mousedown', { clientX: 0 });
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 0 }));
        await nextTick();

        expect(localStorage.getItem('split-width')).toBeNull();
        expect(panel(wrapper, 'left').attributes('style')).toContain('50%');
    });

    it('measures from the right edge for a right-based split', async () => {
        const { wrapper, divider } = mountSplitter({ baseSide: 'right' });

        await divider.trigger('mousedown', { clientX: 0 });
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }));
        await nextFrame();
        await nextTick();

        expect(panel(wrapper, 'right').attributes('style')).toContain('800px');

        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200 }));
        await nextTick();
    });
});
