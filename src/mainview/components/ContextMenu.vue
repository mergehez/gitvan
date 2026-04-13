<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import ContextMenuPanel from './ContextMenuPanel.vue';
import type { ContextMenuEntry } from './contextMenuTypes';

const props = defineProps<{
    open: boolean;
    items: ContextMenuEntry[];
    x: number;
    y: number;
}>();

const emit = defineEmits<{
    close: [];
}>();

const menuRef = ref<HTMLElement>();
const adjustedPosition = ref({ x: props.x, y: props.y });

function closeMenu() {
    emit('close');
}

function updatePosition() {
    const menu = menuRef.value;
    if (!menu) {
        adjustedPosition.value = { x: props.x, y: props.y };
        return;
    }

    const margin = 8;
    const bounds = menu.getBoundingClientRect();
    adjustedPosition.value = {
        x: Math.max(margin, Math.min(props.x, window.innerWidth - bounds.width - margin)),
        y: Math.max(margin, Math.min(props.y, window.innerHeight - bounds.height - margin)),
    };
}

function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        closeMenu();
    }
}

watch(
    () => [props.open, props.x, props.y, props.items.length],
    async ([isOpen]) => {
        if (!isOpen) {
            return;
        }

        adjustedPosition.value = { x: props.x, y: props.y };
        await nextTick();
        updatePosition();
    },
    { immediate: true }
);

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) {
            window.addEventListener('keydown', onWindowKeydown);
            return;
        }

        window.removeEventListener('keydown', onWindowKeydown);
    },
    { immediate: true }
);

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
    <Teleport to="body">
        <div v-if="props.open" class="fixed inset-0 z-90" @mousedown="closeMenu">
            <div
                ref="menuRef"
                class="fixed"
                :style="{
                    top: `${adjustedPosition.y}px`,
                    left: `${adjustedPosition.x}px`,
                }"
                @mousedown.stop
            >
                <ContextMenuPanel :items="props.items" @close="closeMenu" />
            </div>
        </div>
    </Teleport>
</template>
