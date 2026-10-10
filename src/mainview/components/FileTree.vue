<script setup lang="ts" generic="TData, TRoot = {}">
import { twMerge } from 'tailwind-merge';
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, reactive, ref, shallowRef } from 'vue';
import type { ContextMenuEntry } from '../directives/contextMenuTypes';
import IconButton from './IconButton.vue';

export type FileTreeChild<TData = any> = {
    id: any;
    title: string;
    path?: string;
    subtitle?: string;
    children?: (FileTreeChild<TData> & TData)[];
};

export type FileTreeItem<TData = any, TRoot = {}> = {
    id?: any;
    title: string;
    subtitle?: string;
    count?: number | string;
    children: (FileTreeChild<TData> & TData)[];
} & TRoot;

type Item = FileTreeChild<TData> & TData;
type FlattenedItem = {
    item: Item;
    index: number;
    depth: number;
    isGroup: boolean;
    isCollapsed: boolean;
};

/** Below this many rows a tree is cheap enough to render whole. */
const virtualizationMinimumRows = 60;
/** Rows kept mounted beyond the viewport so a fast scroll does not show a blank strip. */
const rowOverscan = 8;
/** Row height before the first measurement; matches the default `min-h-6` row plus padding. */
const fallbackRowHeight = 28;

const props = defineProps<{
    item: FileTreeItem<TData, TRoot>;
    selection?: any | any[];
    outlineSelection?: any | any[];
    headerOutlined?: boolean;
    emptyText?: string;
    itemClass?: string;
    noActions?: boolean;
    selectGroups?: boolean;
    virtualize?: boolean;
    leftIcon?: (item: Item) => `icon-\[${string}`;
    rightIcon?: (item: Item) => `icon-\[${string}` | '' | undefined;
    onSelect: (item: Item, event?: MouseEvent) => void;
    getContextMenuItems?: (item: Item) => ContextMenuEntry[];
    getHeaderContextMenuItems?: (item: FileTreeItem<TData, TRoot>) => ContextMenuEntry[];
}>();

function clearTextSelection() {
    window.getSelection()?.removeAllRanges();
}

function onMouseDown(event: MouseEvent) {
    if (event.button !== 2) {
        return;
    }

    event.preventDefault();
    clearTextSelection();
}

function isSelected(entry: Item) {
    return Array.isArray(props.selection) ? props.selection.includes(entry.id) : props.selection === entry.id;
}

function isOutlined(entry: Item) {
    return Array.isArray(props.outlineSelection) ? props.outlineSelection.includes(entry.id) : props.outlineSelection === entry.id;
}

const collapsed = ref(false);
const collapsedGroups = reactive<Record<string, boolean>>({});

function hasChildren(entry: Item) {
    return Array.isArray(entry.children) && entry.children.length > 0;
}

function collapseKey(entry: Item) {
    return String(entry.path ?? entry.id ?? entry.title);
}

function isCollapsedGroup(entry: Item) {
    return collapsedGroups[collapseKey(entry)] ?? false;
}

function toggleGroup(entry: Item) {
    if (!hasChildren(entry)) {
        return;
    }

    const key = collapseKey(entry);
    collapsedGroups[key] = !isCollapsedGroup(entry);
}

function flattenEntries(entries: Item[], depth = 0): Omit<FlattenedItem, 'index'>[] {
    return entries.flatMap((entry) => {
        const isGroup = hasChildren(entry);
        const isCollapsed = isGroup ? isCollapsedGroup(entry) : false;
        const currentEntry = {
            item: entry,
            depth,
            isGroup,
            isCollapsed,
        };

        if (!isGroup || isCollapsed) {
            return [currentEntry];
        }

        return [currentEntry, ...flattenEntries(entry.children as Item[], depth + 1)];
    });
}

// The index is assigned once here so the `item-title` slot keeps seeing the absolute row index
// even when only a window of the list is mounted.
const visibleChildren = computed<FlattenedItem[]>(() => flattenEntries(props.item.children as Item[]).map((entry, index) => ({ ...entry, index })));

const sectionRef = ref<HTMLElement>();
const rowsTopRef = ref<HTMLElement>();
const scrollParent = shallowRef<HTMLElement>();
const scrollParentResolved = ref(false);
const scrollTop = ref(0);
const viewportHeight = ref(typeof window === 'undefined' ? 0 : window.innerHeight);
const rowHeight = ref(fallbackRowHeight);
const rowsAreUniform = ref(true);
const listOffsetTop = ref(0);
let parentResizeObserver: ResizeObserver | undefined;

const wantsVirtualization = computed(() => props.virtualize === true && !collapsed.value && visibleChildren.value.length >= virtualizationMinimumRows);
// Before the scroller is found the viewport estimate is used, so a long list is windowed from
// its first render. If there turns out to be no scroller at all, everything renders instead of
// hiding rows behind a spacer nothing can scroll.
const isWindowed = computed(
    () => wantsVirtualization.value && rowsAreUniform.value && viewportHeight.value > 0 && (!scrollParentResolved.value || scrollParent.value !== undefined)
);

/**
 * The mounted slice of the flattened list. The spacers keep the list's full height, so the
 * surrounding scroll container's geometry — and every other tree sharing it — is unchanged.
 */
const windowRange = computed(() => {
    const total = visibleChildren.value.length;
    if (!isWindowed.value) {
        return { start: 0, end: total, top: 0, bottom: 0 };
    }

    const height = rowHeight.value;
    const relativeTop = scrollTop.value - listOffsetTop.value;
    const start = Math.max(0, Math.floor(relativeTop / height) - rowOverscan);
    const end = Math.min(total, Math.ceil((relativeTop + viewportHeight.value) / height) + rowOverscan);
    const resolvedEnd = Math.max(start, end);

    return { start, end: resolvedEnd, top: start * height, bottom: (total - resolvedEnd) * height };
});

const renderedRows = computed(() => visibleChildren.value.slice(windowRange.value.start, windowRange.value.end));

/** The nearest ancestor that actually scrolls; a tree without one renders whole. */
function findScrollParent(element: HTMLElement | undefined) {
    for (let current = element?.parentElement ?? null; current; current = current.parentElement) {
        const overflowY = window.getComputedStyle(current).overflowY;

        if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && current.scrollHeight > current.clientHeight + 1) {
            return current;
        }
    }

    return undefined;
}

function resolveScrollParent() {
    if (!props.virtualize) {
        return undefined;
    }

    const next = findScrollParent(sectionRef.value);
    scrollParentResolved.value = true;

    if (next !== scrollParent.value) {
        parentResizeObserver?.disconnect();
        scrollParent.value = next;

        if (next) {
            parentResizeObserver = new ResizeObserver(() => measureWindow());
            parentResizeObserver.observe(next);
        }
    }

    return next;
}

function measureWindow() {
    const parent = scrollParent.value ?? resolveScrollParent();
    const listTop = rowsTopRef.value;

    if (!parent || !listTop) {
        return;
    }

    const parentRect = parent.getBoundingClientRect();
    const listRect = listTop.getBoundingClientRect();
    const nextListOffset = listRect.top - parentRect.top + parent.scrollTop;

    listOffsetTop.value = nextListOffset;
    scrollTop.value = parent.scrollTop;
    viewportHeight.value = parent.clientHeight;
}

function measureRowHeight() {
    if (!props.virtualize) {
        return;
    }

    const rows = sectionRef.value?.querySelectorAll<HTMLElement>('[data-file-tree-row]');
    if (!rows || rows.length === 0) {
        return;
    }

    // Sampling a handful of rows keeps this cheap; a tree whose rows really differ does not
    // opt in, and one that unexpectedly does falls back to rendering everything.
    const sample = Array.from(rows).slice(0, 12);
    const firstHeight = sample[0]!.getBoundingClientRect().height;
    if (firstHeight <= 0) {
        return;
    }

    const uniform = sample.every((row) => Math.abs(row.getBoundingClientRect().height - firstHeight) <= 1);
    rowsAreUniform.value = uniform;

    if (uniform && rowHeight.value !== firstHeight) {
        rowHeight.value = firstHeight;
    }
}

function onScroll(event: Event) {
    resolveScrollParent();

    if (scrollParent.value && event.target === scrollParent.value) {
        measureWindow();
    }
}

onMounted(async () => {
    if (!props.virtualize) {
        return;
    }

    // Capture phase so a scroll inside any pane reaches the tree that lives in it.
    window.addEventListener('scroll', onScroll, true);
    await nextTick();
    resolveScrollParent();
    measureWindow();
    measureRowHeight();
});

onUpdated(async () => {
    if (!props.virtualize) {
        return;
    }

    await nextTick();
    resolveScrollParent();
    measureWindow();
    measureRowHeight();
});

onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll, true);
    parentResizeObserver?.disconnect();
});

function onEntryClick(event: MouseEvent, entry: Item) {
    if (hasChildren(entry) && !props.selectGroups) {
        toggleGroup(entry);
        return;
    }

    props.onSelect(entry, event);
}
</script>

<template>
    <section ref="sectionRef" class="min-h-0 overflow-auto scrollbar-thin">
        <div
            v-if="item.title"
            :data-testid="item.id !== undefined ? `file-tree-header-${item.id}` : undefined"
            class="flex items-center justify-between px-1 py-1 text-xs font-semibold tracking-[0.02em] text-default"
            :class="props.headerOutlined ? 'outline-1 -outline-offset-1 outline-white/35 bg-white/6' : undefined"
            @mousedown.capture="onMouseDown"
            v-menu="getHeaderContextMenuItems ? () => getHeaderContextMenuItems!(props.item) : undefined"
        >
            <div class="flex items-center uppercase gap-1 flex-1">
                <IconButton severity="raised" smaller @click="collapsed = !collapsed" class="opacity-70" :icon="collapsed ? 'icon-[mdi--plus]' : 'icon-[mdi--minus]'" />
                <p class="cursor-pointer flex-1 line-clamp-1 break-all" @click="collapsed = !collapsed">{{ item.title }}</p>
            </div>
            <div class="flex items-center gap-1">
                <slot name="header-actions" :item="item"></slot>
                <span class="rounded-full bg-white/8 px-1.5 py-px">{{ item.count ?? item.children.length ?? '' }}</span>
            </div>
        </div>

        <div v-if="!item.children.length" class="px-5 py-2 text-xs opacity-50">
            {{ emptyText }}
        </div>

        <div v-else-if="!collapsed" class="min-h-0 overflow-auto">
            <div ref="rowsTopRef" data-file-tree-list-top class="h-0" aria-hidden="true"></div>
            <div v-if="windowRange.top > 0" data-file-tree-spacer="top" :style="{ height: `${windowRange.top}px` }" aria-hidden="true"></div>

            <div
                v-for="entryState in renderedRows"
                :key="`${entryState.item.id}`"
                data-file-tree-row
                class="group flex min-h-6 items-center gap-1 px-2 py-0.5 text-left transition relative"
                :class="[
                    isSelected(entryState.item) ? 'bg-white/10' : 'hover:bg-white/6',
                    isOutlined(entryState.item) ? 'outline-1 -outline-offset-1 outline-white/35' : undefined,
                    itemClass,
                ]"
                @mousedown.capture="onMouseDown"
                v-menu="getContextMenuItems ? () => getContextMenuItems!(entryState.item) : undefined"
            >
                <button
                    type="button"
                    :data-testid="`file-tree-item-${entryState.item.id}`"
                    :aria-label="entryState.item.title"
                    :aria-expanded="entryState.isGroup ? !entryState.isCollapsed : undefined"
                    class="flex min-w-0 w-full flex-1 items-center gap-1.5 text-left overflow-hidden"
                    :style="{ paddingLeft: `${entryState.depth * 0.875}rem` }"
                    @click="(event) => onEntryClick(event as MouseEvent, entryState.item)"
                >
                    <span
                        v-if="entryState.isGroup"
                        class="icon shrink-0 text-sm opacity-60"
                        :class="entryState.isCollapsed ? 'icon-[mdi--chevron-right]' : 'icon-[mdi--chevron-down]'"
                    ></span>
                    <span v-else class="block w-3 shrink-0"></span>
                    <slot name="item-leftIcon" :item="entryState.item" :depth="entryState.depth" :is-group="entryState.isGroup" :is-collapsed="entryState.isCollapsed">
                        <span v-if="props.leftIcon && props.leftIcon(entryState.item)" :class="twMerge('icon text-sm', props.leftIcon(entryState.item))"></span>
                    </slot>
                    <div class="flex min-w-0 flex-1 items-center text-xs py-px overflow-hidden">
                        <slot
                            name="item-title"
                            :index="entryState.index"
                            :item="entryState.item"
                            :depth="entryState.depth"
                            :is-group="entryState.isGroup"
                            :is-collapsed="entryState.isCollapsed"
                        >
                            <p class="text-xs tracking-tight leading-tight">{{ entryState.item.title }}</p>
                        </slot>
                    </div>
                    <p v-if="entryState.item.subtitle" class="hidden truncate text-xs opacity-70 xl:block xl:max-w-44">
                        {{ entryState.item.subtitle }}
                    </p>
                </button>
                <div v-if="!props.noActions" class="min-w-0 items-center justify-end gap-1 hidden group-hover:flex">
                    <slot name="item-actions" :item="entryState.item" :depth="entryState.depth" :is-group="entryState.isGroup" :is-collapsed="entryState.isCollapsed"></slot>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <slot name="item-rightIcon" :item="entryState.item" :depth="entryState.depth" :is-group="entryState.isGroup" :is-collapsed="entryState.isCollapsed">
                        <span v-if="props.rightIcon && props.rightIcon(entryState.item)" :class="twMerge('icon text-sm', props.rightIcon(entryState.item))"></span>
                    </slot>
                </div>
            </div>

            <div v-if="windowRange.bottom > 0" data-file-tree-spacer="bottom" :style="{ height: `${windowRange.bottom}px` }" aria-hidden="true"></div>
        </div>

        <slot name="footer"></slot>
    </section>
</template>
