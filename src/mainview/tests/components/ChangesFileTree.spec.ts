import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import type { ChangeStatus } from '../../../shared/types.ts';
import ChangesFileTree from '../../components/ChangesFileTree.vue';
import type { ContextMenuEntry } from '../../directives';

type Entry = {
    id: string;
    title: string;
    path?: string;
    status?: ChangeStatus;
    hasConflictMarkers?: boolean;
};

const iconButtonStub = defineComponent({
    name: 'IconButton',
    props: { icon: { type: String, required: false } },
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

const children: Entry[] = [
    { id: 'a', title: 'src/app.ts', path: 'src/app.ts', status: 'modified' },
    { id: 'b', title: 'src/old.ts', path: 'src/old.ts', status: 'deleted' },
    { id: 'c', title: 'README.md', path: 'README.md', status: 'added' },
    { id: 'd', title: 'src/conflict.ts', path: 'src/conflict.ts', status: 'unmerged', hasConflictMarkers: true },
];

type MountOptions = {
    children?: Entry[];
    count?: number;
    selection?: unknown;
    emptyText?: string;
    noActions?: boolean;
    showPathTooltip?: boolean;
    onSelect?: (item: Entry, event?: MouseEvent) => void;
    getContextMenuItems?: (item: Entry) => ContextMenuEntry[];
    getHeaderContextMenuItems?: (item: unknown) => ContextMenuEntry[];
};

function mountTrees(options: MountOptions = {}) {
    const tooltipValues: unknown[] = [];
    const tooltipModifiers: Array<Partial<Record<string, boolean>> | undefined> = [];
    const menuBuilders: Array<() => ContextMenuEntry[]> = [];

    const wrapper = mount(ChangesFileTree, {
        props: {
            item: { id: 'changes', title: 'Changes', count: options.count, children: options.children ?? children },
            selection: options.selection,
            emptyText: options.emptyText,
            noActions: options.noActions,
            showPathTooltip: options.showPathTooltip,
            onSelect: options.onSelect ?? (() => undefined),
            getContextMenuItems: options.getContextMenuItems,
            getHeaderContextMenuItems: options.getHeaderContextMenuItems,
        } as never,
        global: {
            stubs: { IconButton: iconButtonStub },
            directives: {
                tooltip: {
                    mounted(_element: HTMLElement, binding: { value?: unknown; modifiers?: Partial<Record<string, boolean>> }) {
                        tooltipValues.push(binding.value);
                        tooltipModifiers.push(binding.modifiers);
                    },
                },
                menu: {
                    mounted(_element: HTMLElement, binding: { value?: () => ContextMenuEntry[] }) {
                        if (binding.value) {
                            menuBuilders.push(binding.value);
                        }
                    },
                },
            },
        },
    });

    return { wrapper, tooltipValues, tooltipModifiers, menuBuilders };
}

function statusSpans(wrapper: ReturnType<typeof mountTrees>['wrapper']) {
    return wrapper.findAll('span.w-4');
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('ChangesFileTree', () => {
    it('renders each changed file with its directory and status letter', () => {
        const { wrapper } = mountTrees();

        expect(wrapper.findAll('[data-file-tree-row]')).toHaveLength(4);
        expect(
            wrapper
                .get('[data-testid="file-tree-item-a"]')
                .findAll('p')
                .map((line) => line.text())
        ).toEqual(['app.ts', 'src']);
        expect(
            wrapper
                .get('[data-testid="file-tree-item-c"]')
                .findAll('p')
                .map((line) => line.text())
        ).toEqual(['README.md']);

        const spans = statusSpans(wrapper);
        expect(spans.map((span) => span.text())).toEqual(['M', 'D', 'A', '!']);
        expect(spans[0]!.classes()).toContain('text-amber-400');
        expect(spans[1]!.classes()).toContain('text-red-400');
        expect(spans[2]!.classes()).toContain('text-emerald-400');
        expect(spans[3]!.classes()).toContain('text-red-400');
    });

    it('renders the section header with the passed count', () => {
        const { wrapper } = mountTrees({ count: 12 });

        expect(wrapper.get('[data-testid="file-tree-header-changes"]').text()).toContain('Changes');
        expect(wrapper.get('[data-testid="file-tree-header-changes"]').text()).toContain('12');
    });

    it('reports the selected file to the select handler', async () => {
        const onSelect = vi.fn();
        const { wrapper } = mountTrees({ onSelect });

        await wrapper.get('[data-testid="file-tree-item-b"]').trigger('click');

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0]![0]).toEqual(children[1]);
        expect(onSelect.mock.calls[0]![1]).toBeInstanceOf(MouseEvent);
    });

    it('hands the item to the header, row action and status slots', () => {
        const withSlots = mount(ChangesFileTree, {
            props: {
                item: { id: 'changes', title: 'Changes', children },
                onSelect: () => undefined,
            } as never,
            slots: {
                'header-actions': '<button class="header-action">{{ params.item.title }}</button>',
                'item-actions': '<span class="row-action">{{ params.item.path }}</span>',
                'before-status': '<i class="before-status">{{ params.item.id }}</i>',
            },
            global: {
                stubs: { IconButton: iconButtonStub },
                directives: { tooltip: {}, menu: {} },
            },
        });

        expect(withSlots.get('.header-action').text()).toBe('Changes');
        expect(withSlots.findAll('.row-action').map((slot) => slot.text())).toEqual(['src/app.ts', 'src/old.ts', 'README.md', 'src/conflict.ts']);
        expect(withSlots.findAll('.before-status').map((slot) => slot.text())).toEqual(['a', 'b', 'c', 'd']);
    });

    it('only asks for a path tooltip when showPathTooltip is set', () => {
        const requested = mountTrees({ showPathTooltip: true });

        expect(requested.tooltipValues).toEqual(['src/app.ts', 'src/old.ts', 'README.md', 'src/conflict.ts']);
        expect(requested.tooltipModifiers[0]).toEqual({ delay: true, nowrap: true, xs: true });

        const suppressed = mountTrees();

        expect(suppressed.tooltipValues).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('forwards the header and row context menu builders', () => {
        const getHeaderContextMenuItems = vi.fn(() => [{ id: 'header', label: 'Changes' }]);
        const { wrapper, menuBuilders } = mountTrees({
            getContextMenuItems: (item) => [{ id: 'row', label: item.path! }],
            getHeaderContextMenuItems,
        });

        expect(wrapper.exists()).toBe(true);
        // One builder for the section header, one per rendered row.
        expect(menuBuilders).toHaveLength(5);
        expect(menuBuilders[0]!()).toEqual([{ id: 'header', label: 'Changes' }]);
        expect(getHeaderContextMenuItems).toHaveBeenCalledWith(expect.objectContaining({ id: 'changes' }));
        expect(menuBuilders.slice(1).map((build) => build())).toEqual([
            [{ id: 'row', label: 'src/app.ts' }],
            [{ id: 'row', label: 'src/old.ts' }],
            [{ id: 'row', label: 'README.md' }],
            [{ id: 'row', label: 'src/conflict.ts' }],
        ]);
    });

    it('renders the empty text when there are no changes', () => {
        const { wrapper } = mountTrees({ children: [], emptyText: 'Working tree clean' });

        expect(wrapper.text()).toContain('Working tree clean');
        expect(wrapper.findAll('[data-file-tree-row]')).toHaveLength(0);
        expect(wrapper.get('[data-testid="file-tree-header-changes"]').text()).toContain('0');
    });
});
