<script setup lang="ts" generic="T extends { status?: ChangeStatus }">
import type { ChangeStatus } from '../../shared/gitClient';
import type { ContextMenuEntry } from '../directives/contextMenuTypes';
import { fileIconAndLanguageByPath, fileName, parentPath, statusClass, statusLetter } from '../lib/utils';
import type { FileTreeChild, FileTreeItem } from './FileTree.vue';
import FileTree from './FileTree.vue';

type ChangesFileTreeEntry = FileTreeChild & T;

const props = withDefaults(
    defineProps<{
        item: FileTreeItem<ChangesFileTreeEntry, any>;
        selection?: any | any[];
        emptyText?: string;
        itemClass?: string;
        noActions?: boolean;
        showPathTooltip?: boolean;
        onSelect: (item: ChangesFileTreeEntry, event?: MouseEvent) => void;
        getContextMenuItems?: (item: ChangesFileTreeEntry) => ContextMenuEntry[];
        getHeaderContextMenuItems?: (item: FileTreeItem<ChangesFileTreeEntry, any>) => ContextMenuEntry[];
    }>(),
    {
        showPathTooltip: false,
    }
);
</script>

<template>
    <FileTree
        :item="props.item"
        :selection="props.selection"
        :empty-text="props.emptyText"
        :item-class="props.itemClass"
        :no-actions="props.noActions"
        :onSelect="props.onSelect"
        :getContextMenuItems="props.getContextMenuItems"
        :getHeaderContextMenuItems="props.getHeaderContextMenuItems"
    >
        <template #header-actions="slotProps">
            <slot name="header-actions" :item="slotProps.item"></slot>
        </template>

        <template #item-leftIcon="slotProps">
            <span class="icon shrink-0 text-xs" :class="fileIconAndLanguageByPath(slotProps.item.path || slotProps.item.title).icon"></span>
        </template>

        <template #item-title="slotProps">
            <div
                class="flex min-w-0 w-full flex-1 items-center overflow-hidden"
                v-tooltip.delay.nowrap.xs="props.showPathTooltip ? slotProps.item.path || slotProps.item.title : undefined"
            >
                <p class="shrink-0 text-xs tracking-tight">{{ fileName(slotProps.item.path || slotProps.item.title) }}</p>
                <p v-if="parentPath(slotProps.item.path || slotProps.item.title)" class="truncate pl-1 text-xs tracking-tighter opacity-30">
                    {{ parentPath(slotProps.item.path || slotProps.item.title) }}
                </p>
            </div>
        </template>

        <template #item-actions="slotProps">
            <slot name="item-actions" :item="slotProps.item"></slot>
        </template>

        <template #item-rightIcon="slotProps">
            <div class="flex items-center gap-1">
                <slot name="before-status" :item="slotProps.item"></slot>
                <span v-if="slotProps.item.status" class="w-4 text-center text-xs font-semibold tracking-wide" :class="statusClass(slotProps.item)">
                    {{ statusLetter(slotProps.item) }}
                </span>
            </div>
        </template>
    </FileTree>
</template>
