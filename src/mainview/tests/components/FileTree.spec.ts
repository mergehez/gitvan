import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import FileTree from '../../components/FileTree.vue';

const rowHeight = 28;
const viewportHeight = 280;

/** jsdom has no layout, so every box the tree reads is answered by hand. */
function installLayoutMock(scroller: HTMLElement, options: { rowHeight?: (row: Element) => number } = {}) {
    function fakeRect(top: number, height = 0) {
        return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    }

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this === scroller) {
            return fakeRect(0);
        }

        if (this.hasAttribute('data-file-tree-list-top')) {
            return fakeRect(-scroller.scrollTop);
        }

        if (this.hasAttribute('data-file-tree-row')) {
            return fakeRect(0, options.rowHeight?.(this) ?? rowHeight);
        }

        return fakeRect(0);
    });
}

function createChildren(count: number) {
    return Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, title: `Row ${index}` }));
}

function createScroller(scrollHeight: number, clientHeight = viewportHeight) {
    const scroller = document.createElement('div');

    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight, configurable: true });
    scroller.scrollTop = 0;
    document.body.appendChild(scroller);

    return scroller;
}

function mountTree(options: { rows: number; virtualize?: boolean; titleSlot?: boolean; rowHeight?: (row: Element) => number }) {
    const scroller = createScroller(options.rows * rowHeight + 100);
    installLayoutMock(scroller, { rowHeight: options.rowHeight });

    const titleSlot = defineComponent({
        props: { index: { type: Number, required: false }, item: { type: Object, required: true } },
        template: '<span class="title" :data-row-index="index">{{ item.title }}</span>',
    });

    const wrapper = mount(FileTree, {
        attachTo: scroller,
        props: {
            item: { id: 'tree', title: 'Tree', children: createChildren(options.rows) },
            virtualize: options.virtualize,
            onSelect: () => undefined,
        },
        global: {
            directives: { menu: { mounted() {}, updated() {} } },
            ...(options.titleSlot ? { components: { TitleSlot: titleSlot } } : {}),
        },
        ...(options.titleSlot ? { slots: { 'item-title': '<TitleSlot v-bind="params" />' } } : {}),
    });

    return { wrapper, scroller };
}

function renderedRowIds(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('[data-file-tree-row]').map((row) => row.find('button').attributes('data-testid'));
}

function spacerHeight(wrapper: ReturnType<typeof mount>, side: 'top' | 'bottom') {
    const spacer = wrapper.find(`[data-file-tree-spacer="${side}"]`);

    return spacer.exists() ? spacer.attributes('style') : undefined;
}

async function scrollTo(scroller: HTMLElement, scrollTop: number) {
    scroller.scrollTop = scrollTop;
    scroller.dispatchEvent(new Event('scroll'));
    await flushPromises();
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('FileTree windowing', () => {
    it('renders every row when virtualization is not requested', async () => {
        const { wrapper } = mountTree({ rows: 200 });
        await flushPromises();

        expect(renderedRowIds(wrapper)).toHaveLength(200);
    });

    it('renders every row when the list is shorter than the threshold', async () => {
        const { wrapper } = mountTree({ rows: 40, virtualize: true });
        await flushPromises();

        expect(renderedRowIds(wrapper)).toHaveLength(40);
    });

    it('mounts only the visible window and keeps the list height with spacers', async () => {
        const { wrapper } = mountTree({ rows: 200, virtualize: true });
        await flushPromises();

        const rows = renderedRowIds(wrapper);
        // 280px viewport over 28px rows is 10 rows, plus the overscan on both sides.
        expect(rows).toHaveLength(18);
        expect(rows[0]).toBe('file-tree-item-row-0');
        expect(rows.at(-1)).toBe('file-tree-item-row-17');

        expect(spacerHeight(wrapper, 'top')).toBeUndefined();
        expect(spacerHeight(wrapper, 'bottom')).toContain(`${(200 - 18) * rowHeight}px`);
    });

    it('moves the window with the scroll offset', async () => {
        const { wrapper, scroller } = mountTree({ rows: 200, virtualize: true });
        await flushPromises();

        const maxScroll = 200 * rowHeight - viewportHeight;
        const firstVisibleRow = Math.floor(maxScroll / rowHeight);
        const expectedStart = firstVisibleRow - 8;

        await scrollTo(scroller, maxScroll);

        const rows = renderedRowIds(wrapper);
        expect(rows).toHaveLength(18);
        expect(rows.at(-1)).toBe('file-tree-item-row-199');

        expect(spacerHeight(wrapper, 'top')).toContain(`${expectedStart * rowHeight}px`);
        expect(spacerHeight(wrapper, 'bottom')).toBeUndefined();
    });

    it('keeps the absolute row index for the title slot', async () => {
        const { wrapper, scroller } = mountTree({ rows: 200, virtualize: true, titleSlot: true });
        await flushPromises();

        expect(wrapper.findAll('[data-row-index]')[0]!.attributes('data-row-index')).toBe('0');

        await scrollTo(scroller, 200 * rowHeight - viewportHeight);

        expect(wrapper.findAll('[data-row-index]')[0]!.attributes('data-row-index')).toBe('182');
    });

    it('falls back to every row when the mounted rows differ in height', async () => {
        const { wrapper } = mountTree({
            rows: 200,
            virtualize: true,
            rowHeight: (row) => 20 + Number((row.querySelector('button')?.getAttribute('data-testid') ?? '').replace(/\D/g, '')) * 2,
        });
        await flushPromises();

        // The windowed sample already differs, so the tree renders everything instead.
        expect(renderedRowIds(wrapper)).toHaveLength(200);
    });
});
