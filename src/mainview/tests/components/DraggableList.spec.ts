import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import DraggableList from '../../components/DraggableList.vue';

type Entry = {
    id: number;
    title: string;
    subtitle?: string;
};

const iconStub = defineComponent({
    name: 'Icon',
    props: { icon: { type: String, required: false } },
    template: '<i />',
});

const entries: Entry[] = [
    { id: 1, title: 'Alpha' },
    { id: 2, title: 'Beta' },
    { id: 3, title: 'Gamma' },
    { id: 4, title: 'Delta' },
];

type MountOptions = {
    items?: Entry[];
    selection?: unknown;
    emptyText?: string;
    disabled?: boolean;
    itemClass?: string;
    onSelect?: (item: Entry, event?: MouseEvent) => void;
    onContextMenu?: (item: Entry, event?: MouseEvent) => void;
    onReorder?: (payload: { item: Entry; fromIndex: number; toIndex: number }) => void | Promise<void>;
};

function mountList(options: MountOptions = {}) {
    return mount(DraggableList, {
        props: {
            items: options.items ?? entries,
            selection: options.selection,
            emptyText: options.emptyText,
            disabled: options.disabled,
            itemClass: options.itemClass,
            onSelect: options.onSelect,
            onContextMenu: options.onContextMenu,
            onReorder: options.onReorder,
        } as never,
        global: {
            stubs: { Icon: iconStub },
        },
    });
}

function rows(wrapper: ReturnType<typeof mountList>) {
    return wrapper.findAll('.group');
}

function rowOf(wrapper: ReturnType<typeof mountList>, id: number) {
    return wrapper.get(`[data-testid="draggable-list-item-${id}"]`).element.parentElement as HTMLElement;
}

function itemButton(wrapper: ReturnType<typeof mountList>, id: number) {
    return wrapper.get(`[data-testid="draggable-list-item-${id}"]`);
}

function dragHandle(wrapper: ReturnType<typeof mountList>, title: string) {
    return wrapper.get(`[aria-label="Reorder ${title}"]`);
}

function createDataTransfer() {
    return {
        setData: vi.fn(),
        effectAllowed: 'none',
        dropEffect: 'none',
    } as unknown as DataTransfer & { setData: ReturnType<typeof vi.fn> };
}

/**
 * jsdom has no DragEvent and no DataTransfer, so the drag events the component listens for are
 * built from MouseEvent (which carries clientY) with a hand-made dataTransfer attached.
 */
function dispatchDrag(target: Element, type: string, options: { clientY?: number; dataTransfer?: DataTransfer } = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: options.clientY ?? 0 });

    if (options.dataTransfer) {
        Object.defineProperty(event, 'dataTransfer', { value: options.dataTransfer });
    }

    target.dispatchEvent(event);

    return event;
}

/** jsdom reports every box as zero, so the row midpoint is answered by hand. */
function stubRowRect(row: HTMLElement, top = 100, height = 40) {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
        top,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
    } as DOMRect);
}

/** Sets the drag state up the way a real drag does: pick a handle up, then hover a row. */
async function startDrag(wrapper: ReturnType<typeof mountList>, title: string) {
    const dataTransfer = createDataTransfer();

    dispatchDrag(dragHandle(wrapper, title).element, 'dragstart', { dataTransfer });
    await nextTick();

    return dataTransfer;
}

async function hoverRow(wrapper: ReturnType<typeof mountList>, id: number, clientY: number) {
    const row = rowOf(wrapper, id);

    stubRowRect(row);
    dispatchDrag(row, 'dragover', { clientY });
    await nextTick();

    return row;
}

async function dropOnRow(wrapper: ReturnType<typeof mountList>, id: number) {
    dispatchDrag(rowOf(wrapper, id), 'drop');
    await flushPromises();
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('DraggableList', () => {
    it('renders the empty text when there is nothing to list', () => {
        const fallback = mountList({ items: [] });
        expect(fallback.text()).toContain('No items available.');

        const custom = mountList({ items: [], emptyText: 'No accounts yet.' });
        expect(custom.text()).toContain('No accounts yet.');
        expect(custom.findAll('.group')).toHaveLength(0);
    });

    it('renders one row per item with its title and a labelled reorder handle', () => {
        const wrapper = mountList();

        expect(rows(wrapper)).toHaveLength(4);
        expect(itemButton(wrapper, 3).text()).toBe('Gamma');
        expect(itemButton(wrapper, 3).attributes('aria-label')).toBe('Gamma');
        expect(dragHandle(wrapper, 'Gamma').attributes('draggable')).toBe('true');
        expect(dragHandle(wrapper, 'Gamma').classes()).toContain('cursor-grab');
    });

    it('highlights the selected entries and no others', () => {
        const multiple = mountList({ selection: [2, 4] });

        expect(rowOf(multiple, 1).className).toContain('hover:bg-white/6');
        expect(rowOf(multiple, 2).className).toContain('bg-white/10');
        expect(rowOf(multiple, 4).className).toContain('bg-white/10');

        const single = mountList({ selection: 3 });

        expect(rowOf(single, 3).className).toContain('bg-white/10');
        expect(rowOf(single, 1).className).toContain('hover:bg-white/6');
    });

    it('reports the clicked item to the select handler', async () => {
        const onSelect = vi.fn();
        const wrapper = mountList({ onSelect });

        await itemButton(wrapper, 2).trigger('click');

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0]![0]).toEqual(entries[1]);
        expect(onSelect.mock.calls[0]![1]).toBeInstanceOf(MouseEvent);
    });

    it('opens the context menu when a handler is given and leaves the event alone otherwise', () => {
        const onContextMenu = vi.fn();
        const handled = mountList({ onContextMenu });
        const handledEvent = dispatchDrag(itemButton(handled, 1).element, 'contextmenu');

        expect(handledEvent.defaultPrevented).toBe(true);
        expect(onContextMenu).toHaveBeenCalledWith(entries[0], handledEvent);

        const unhandled = mountList();
        const unhandledEvent = dispatchDrag(itemButton(unhandled, 1).element, 'contextmenu');

        expect(unhandledEvent.defaultPrevented).toBe(false);
    });

    it('reorders an item to the position after the hovered row', async () => {
        const onReorder = vi.fn((_payload: { item: Entry; fromIndex: number; toIndex: number }) => Promise.resolve());
        const wrapper = mountList({ onReorder });

        const dataTransfer = await startDrag(wrapper, 'Alpha');
        expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '1');
        expect(dataTransfer.effectAllowed).toBe('move');
        expect(rowOf(wrapper, 1).className).toContain('opacity-55');

        const hovered = await hoverRow(wrapper, 3, 130);
        expect(hovered.querySelectorAll('.bg-green-500')).toHaveLength(1);
        expect(hovered.querySelector('.bg-green-500')!.className).toContain('bottom-0');

        await dropOnRow(wrapper, 3);

        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(onReorder.mock.calls[0]![0]).toEqual({ item: entries[0], fromIndex: 0, toIndex: 2 });
        // The drag state is cleared once the reorder settles.
        expect(rowOf(wrapper, 1).className).not.toContain('opacity-55');
        expect(wrapper.findAll('.bg-green-500')).toHaveLength(0);
    });

    it('inserts before the hovered row when the pointer is above its midpoint', async () => {
        const onReorder = vi.fn(() => Promise.resolve());
        const wrapper = mountList({ onReorder });

        await startDrag(wrapper, 'Delta');

        const hovered = await hoverRow(wrapper, 1, 110);
        expect(hovered.querySelector('.bg-green-500')!.className).toContain('top-0');

        await dropOnRow(wrapper, 1);

        expect(onReorder).toHaveBeenCalledWith({ item: entries[3], fromIndex: 3, toIndex: 0 });
    });

    it('does not reorder when the item is dropped back onto itself', async () => {
        const onReorder = vi.fn(() => Promise.resolve());
        const wrapper = mountList({ onReorder });

        await startDrag(wrapper, 'Alpha');
        await hoverRow(wrapper, 1, 130);
        await dropOnRow(wrapper, 1);

        expect(onReorder).not.toHaveBeenCalled();
        expect(rowOf(wrapper, 1).className).not.toContain('opacity-55');
    });

    it('clears the drag state when the drag ends without a drop', async () => {
        const wrapper = mountList();

        await startDrag(wrapper, 'Beta');
        expect(rowOf(wrapper, 2).className).toContain('opacity-55');

        dispatchDrag(dragHandle(wrapper, 'Beta').element, 'dragend');
        await nextTick();

        expect(rowOf(wrapper, 2).className).not.toContain('opacity-55');
    });

    it('refuses to drag or reorder while disabled', async () => {
        const onReorder = vi.fn(() => Promise.resolve());
        const wrapper = mountList({ disabled: true, onReorder });
        const handle = dragHandle(wrapper, 'Alpha');

        expect(handle.attributes('draggable')).toBe('false');
        expect((handle.element as HTMLButtonElement).disabled).toBe(true);

        const event = dispatchDrag(handle.element, 'dragstart', { dataTransfer: createDataTransfer() });
        await nextTick();

        expect(event.defaultPrevented).toBe(true);
        expect(rowOf(wrapper, 1).className).not.toContain('opacity-55');

        dispatchDrag(rowOf(wrapper, 1), 'drop');
        await flushPromises();

        expect(onReorder).not.toHaveBeenCalled();
    });
});
