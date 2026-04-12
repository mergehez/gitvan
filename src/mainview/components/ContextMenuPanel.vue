<script setup lang="ts">
import Icon from './Icon.vue';
import type { ContextMenuEntry, ContextMenuItem, ContextMenuSeparator } from './contextMenuTypes';

const props = defineProps<{
    items: ContextMenuEntry[];
}>();

const emit = defineEmits<{
    close: [];
}>();

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
    return 'type' in entry && entry.type === 'separator';
}

function hasChildren(entry: ContextMenuEntry): entry is ContextMenuItem {
    return !isSeparator(entry) && Array.isArray(entry.children) && entry.children.length > 0;
}

function entryKey(entry: ContextMenuEntry) {
    return isSeparator(entry) ? (entry.id ?? 'separator') : entry.id;
}

function childEntries(entry: ContextMenuItem) {
    return entry.children ?? [];
}

function entryIcon(entry: ContextMenuItem) {
    return entry.icon as `icon-[${string}]` | undefined;
}

async function onSelect(entry: ContextMenuEntry) {
    if (isSeparator(entry)) {
        return;
    }

    const item = entry;

    if (item.disabled || (item.children?.length ?? 0) > 0) {
        return;
    }

    await item.action?.();
    emit('close');
}

const hasAnyIcon = props.items.some((entry) => !isSeparator(entry) && entry.icon);
</script>

<template>
    <div class="min-w-56 overflow-visible rounded-md border border-white/12 bg-x2/97 py-1 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <template v-for="entry in props.items" :key="entryKey(entry)">
            <div v-if="isSeparator(entry)" class="my-1 border-t border-white/10"></div>
            <div v-else class="group relative">
                <button
                    type="button"
                    class="flex w-full items-center gap-1.5 pr-2 py-0.5 text-left text-xs transition min-w-20"
                    :class="[
                        entry.disabled
                            ? 'cursor-not-allowed opacity-40'
                            : entry.danger
                              ? 'text-red-200 hover:bg-red-500/12 hover:text-red-100'
                              : 'text-white/90 hover:bg-white/8 hover:text-white',
                        hasAnyIcon ? 'pl-2' : 'pl-3',
                    ]"
                    :disabled="entry.disabled"
                    @click.stop="onSelect(entry)"
                >
                    <span class="flex w-4 items-center justify-center" v-if="hasAnyIcon">
                        <Icon v-if="entry.icon" :icon="entryIcon(entry)" class="text-xs opacity-80" />
                        <span v-else-if="entry.checked" class="text-xs font-semibold">✓</span>
                    </span>
                    <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
                    <span v-if="hasChildren(entry)" class="icon icon-[mdi--chevron-right] text-sm"></span>
                </button>

                <div
                    v-if="hasChildren(entry)"
                    class="pointer-events-none absolute left-full top-0 z-10 pl-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                >
                    <ContextMenuPanel :items="childEntries(entry)" @close="emit('close')" />
                </div>
            </div>
        </template>
    </div>
</template>
