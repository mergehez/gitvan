<script setup lang="ts" generic="TData, TRoot = {}">
import { ref } from 'vue';
import IconButton from './IconButton.vue';
import { twMerge } from 'tailwind-merge';

export type FileTreeChild = {
    id: any;
    title: string;
    path?: string;
    subtitle?: string;
};

export type FileTreeItem<TData = any, TRoot = {}> = {
    id?: any;
    title: string;
    subtitle?: string;
    children: (FileTreeChild & TData)[];
} & TRoot;

type Item = FileTreeChild & TData;
const props = defineProps<{
    item: FileTreeItem<TData, TRoot>;
    selection?: any | any[];
    emptyText?: string;
    itemClass?: string;
    noActions?: boolean;
    leftIcon?: (item: Item) => `icon-\[${string}`;
    rightIcon?: (item: Item) => `icon-\[${string}` | '' | undefined;
    onSelect: (item: Item, event?: MouseEvent) => void;
    onContextMenu?: (item: Item, event?: MouseEvent) => void;
}>();

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

const collapsed = ref(false);
</script>

<template>
    <section class="min-h-0 overflow-auto scrollbar-thin">
        <div v-if="item.title" class="flex items-center justify-between px-1 py-1 text-xs font-semibold tracking-[0.02em] text-default">
            <div class="flex items-center uppercase gap-1 flex-1">
                <IconButton severity="raised" smaller @click="collapsed = !collapsed" class="opacity-70" :icon="collapsed ? 'icon-[mdi--plus]' : 'icon-[mdi--minus]'" />
                <p class="cursor-pointer flex-1" @click="collapsed = !collapsed">{{ item.title }}</p>
            </div>
            <div class="flex items-center gap-1">
                <slot name="header-actions" :item="item"></slot>
                <span class="rounded-full bg-white/8 px-1.5 py-px">{{ item.children.length ?? '' }}</span>
            </div>
        </div>

        <div v-if="!item.children.length" class="px-5 py-2 text-xs opacity-50">
            {{ emptyText }}
        </div>

        <div v-else-if="!collapsed" class="min-h-0 overflow-auto">
            <div
                v-for="entry in item.children"
                :key="`${entry.id}`"
                class="group flex min-h-6 items-center gap-1 px-2 py-0.5 text-left transition relative"
                :class="[isSelected(entry) ? 'bg-white/10 outline-1 -outline-offset-1 outline-white/8' : 'hover:bg-white/6', itemClass]"
            >
                <button
                    type="button"
                    :data-testid="`file-tree-item-${entry.id}`"
                    :aria-label="entry.title"
                    class="flex min-w-0 w-full flex-1 items-center gap-1.5 text-left overflow-hidden"
                    @click="(event) => props.onSelect(entry, event as MouseEvent)"
                    @contextmenu="(e) => onContextMenu(e, entry)"
                >
                    <slot name="item-leftIcon" :item="entry">
                        <span v-if="props.leftIcon && props.leftIcon(entry)" :class="twMerge('icon text-sm', props.leftIcon(entry))"></span>
                    </slot>
                    <div class="flex min-w-0 flex-1 items-center text-xs py-px overflow-hidden">
                        <slot name="item-title" :item="entry">
                            <p class="text-xs tracking-tight leading-tight">{{ entry.title }}</p>
                        </slot>
                    </div>
                    <p v-if="entry.subtitle" class="hidden truncate text-xs opacity-70 xl:block xl:max-w-44">
                        {{ entry.subtitle }}
                    </p>
                </button>
                <div v-if="!props.noActions" class="min-w-0 items-center justify-end gap-1 hidden group-hover:flex">
                    <slot name="item-actions" :item="entry"></slot>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <slot name="item-rightIcon" :item="entry">
                        <span v-if="props.rightIcon && props.rightIcon(entry)" :class="twMerge('icon text-sm', props.rightIcon(entry))"></span>
                    </slot>
                </div>
            </div>
        </div>
    </section>
</template>
