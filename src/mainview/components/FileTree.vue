<script setup lang="ts" generic="TData, TRoot = {}">
import { twMerge } from 'tailwind-merge';
import { computed, reactive, ref } from 'vue';
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
    count?: number;
    children: (FileTreeChild<TData> & TData)[];
} & TRoot;

type Item = FileTreeChild<TData> & TData;
type FlattenedItem = {
    item: Item;
    depth: number;
    isGroup: boolean;
    isCollapsed: boolean;
};

const props = defineProps<{
    item: FileTreeItem<TData, TRoot>;
    selection?: any | any[];
    outlineSelection?: any | any[];
    headerOutlined?: boolean;
    emptyText?: string;
    itemClass?: string;
    noActions?: boolean;
    selectGroups?: boolean;
    leftIcon?: (item: Item) => `icon-\[${string}`;
    rightIcon?: (item: Item) => `icon-\[${string}` | '' | undefined;
    onSelect: (item: Item, event?: MouseEvent) => void;
    onContextMenu?: (item: Item, event?: MouseEvent) => void;
    onHeaderContextMenu?: (item: FileTreeItem<TData, TRoot>, event?: MouseEvent) => void;
}>();

function onHeaderContextMenu(event: MouseEvent) {
    if (!props.onHeaderContextMenu) {
        return;
    }

    event.preventDefault();
    props.onHeaderContextMenu(props.item, event);
}

function onContextMenu(event: MouseEvent, item: Item) {
    if (!props.onContextMenu) {
        return;
    }
    event.preventDefault();
    props.onContextMenu(item, event);
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

function flattenEntries(entries: Item[], depth = 0): FlattenedItem[] {
    return entries.flatMap((entry) => {
        const isGroup = hasChildren(entry);
        const isCollapsed = isGroup ? isCollapsedGroup(entry) : false;
        const currentEntry: FlattenedItem = {
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

const visibleChildren = computed(() => flattenEntries(props.item.children as Item[]));

function onEntryClick(event: MouseEvent, entry: Item) {
    if (hasChildren(entry) && !props.selectGroups) {
        toggleGroup(entry);
        return;
    }

    props.onSelect(entry, event);
}
</script>

<template>
    <section class="min-h-0 overflow-auto scrollbar-thin">
        <div
            v-if="item.title"
            class="flex items-center justify-between px-1 py-1 text-xs font-semibold tracking-[0.02em] text-default"
            :class="props.headerOutlined ? 'outline-1 -outline-offset-1 outline-white/35 bg-white/6' : undefined"
            @contextmenu="onHeaderContextMenu"
        >
            <div class="flex items-center uppercase gap-1 flex-1">
                <IconButton severity="raised" smaller @click="collapsed = !collapsed" class="opacity-70" :icon="collapsed ? 'icon-[mdi--plus]' : 'icon-[mdi--minus]'" />
                <p class="cursor-pointer flex-1" @click="collapsed = !collapsed">{{ item.title }}</p>
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
            <div
                v-for="entryState in visibleChildren"
                :key="`${entryState.item.id}`"
                class="group flex min-h-6 items-center gap-1 px-2 py-0.5 text-left transition relative"
                :class="[
                    isSelected(entryState.item) ? 'bg-white/10' : 'hover:bg-white/6',
                    isOutlined(entryState.item) ? 'outline-1 -outline-offset-1 outline-white/35' : undefined,
                    itemClass,
                ]"
            >
                <button
                    type="button"
                    :data-testid="`file-tree-item-${entryState.item.id}`"
                    :aria-label="entryState.item.title"
                    :aria-expanded="entryState.isGroup ? !entryState.isCollapsed : undefined"
                    class="flex min-w-0 w-full flex-1 items-center gap-1.5 text-left overflow-hidden"
                    :style="{ paddingLeft: `${entryState.depth * 0.875}rem` }"
                    @click="(event) => onEntryClick(event as MouseEvent, entryState.item)"
                    @contextmenu="(e) => onContextMenu(e, entryState.item)"
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
                        <slot name="item-title" :item="entryState.item" :depth="entryState.depth" :is-group="entryState.isGroup" :is-collapsed="entryState.isCollapsed">
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
        </div>
    </section>
</template>
