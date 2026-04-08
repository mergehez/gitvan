<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { twMerge } from 'tailwind-merge';
import IconButton from './IconButton.vue';

const open = defineModel<boolean>('open', { required: true });
const props = defineProps<{
    title: string;
    contentClass?: string;
}>();

const modalSurface = ref<HTMLElement | null>(null);
const dragOffset = reactive({ x: 0, y: 0 });
const activeDrag = reactive({
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    isDragging: false,
});

const modalStyle = computed(() => ({
    transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
}));

function clampOffset(nextX: number, nextY: number) {
    const surface = modalSurface.value;

    if (!surface) {
        return { x: nextX, y: nextY };
    }

    const bounds = surface.getBoundingClientRect();
    const margin = 16;
    const horizontalLimit = Math.max((window.innerWidth - bounds.width) / 2 - margin, 0);
    const verticalLimit = Math.max((window.innerHeight - bounds.height) / 2 - margin, 0);

    return {
        x: Math.min(Math.max(nextX, -horizontalLimit), horizontalLimit),
        y: Math.min(Math.max(nextY, -verticalLimit), verticalLimit),
    };
}

function resetDragPosition() {
    dragOffset.x = 0;
    dragOffset.y = 0;
}

function stopDragging() {
    activeDrag.pointerId = -1;
    activeDrag.isDragging = false;
}

function onWindowPointerMove(event: PointerEvent) {
    if (!activeDrag.isDragging || event.pointerId !== activeDrag.pointerId) {
        return;
    }

    const nextOffset = clampOffset(activeDrag.originX + (event.clientX - activeDrag.startX), activeDrag.originY + (event.clientY - activeDrag.startY));
    dragOffset.x = nextOffset.x;
    dragOffset.y = nextOffset.y;
}

function onWindowPointerUp(event: PointerEvent) {
    if (event.pointerId !== activeDrag.pointerId) {
        return;
    }

    stopDragging();
}

function onHeaderPointerDown(event: PointerEvent) {
    if (event.button !== 0) {
        return;
    }

    const target = event.target instanceof Element ? event.target : null;

    if (target?.closest('button, a, input, textarea, select, summary, [role="button"]')) {
        return;
    }

    activeDrag.pointerId = event.pointerId;
    activeDrag.startX = event.clientX;
    activeDrag.startY = event.clientY;
    activeDrag.originX = dragOffset.x;
    activeDrag.originY = dragOffset.y;
    activeDrag.isDragging = true;
}

watch(open, (isOpen) => {
    if (!isOpen) {
        stopDragging();
        resetDragPosition();
    }
});

window.addEventListener('pointermove', onWindowPointerMove);
window.addEventListener('pointerup', onWindowPointerUp);
window.addEventListener('pointercancel', onWindowPointerUp);

onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onWindowPointerUp);
});
</script>

<template>
    <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
    >
        <div v-if="open" class="fixed inset-0 z-70 flex items-center justify-center overflow-y-auto bg-x0/70 px-6 py-10 backdrop-blur dark" @click.self="open = false">
            <div
                ref="modalSurface"
                data-testid="centered-modal-surface"
                :style="modalStyle"
                :class="twMerge('w-full overflow-y-auto flex flex-col rounded-lg border border-x4 bg-x1 shadow-[0_30px_80px_rgba(0,0,0,0.45)]', props.contentClass ?? 'max-w-4xl')"
            >
                <div
                    data-testid="centered-modal-header"
                    class="flex cursor-move select-none items-center justify-between border-b border-x3 px-3 py-3"
                    @pointerdown="onHeaderPointerDown"
                >
                    <div>
                        <p class="text-xl font-semibold text-white">{{ props.title }}</p>
                    </div>
                    <IconButton severity="raised" v-tooltip.bottom="'Close dialog'" @click="open = false" icon="icon-[mdi--close] text-xl" />
                </div>

                <div class="flex-1 flex flex-col overflow-y-auto">
                    <slot />
                </div>
            </div>
        </div>
    </Transition>
</template>
