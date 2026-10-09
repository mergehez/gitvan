<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { twMerge } from 'tailwind-merge';

const props = withDefaults(
    defineProps<{
        localStorageKey?: string;
        defaultWidth?: string;
        baseSide: 'left' | 'right';
        class?: string;
        leftClass?: string;
        rightClass?: string;
        draggerClass?: string;
        draggerInvisible?: boolean;
        leftHidden?: boolean;
        rightHidden?: boolean;
        minWidth?: string;
        maxWidth?: string;
    }>(),
    {
        defaultWidth: '50%',
        minWidth: '10%',
        maxWidth: '90%',
    }
);

// Initialize width from localStorage if key is provided
const getInitialWidth = () => {
    if (props.localStorageKey) {
        const saved = localStorage.getItem(props.localStorageKey);
        return saved ? `${saved}px` : props.defaultWidth;
    }
    return props.defaultWidth;
};

const currentWidth = ref(getInitialWidth());
const isDragging = ref<boolean>(false);
const splitterContainer = ref<HTMLElement>();

// The container box is read once per drag and every move is coalesced into one frame, so a
// drag no longer reads layout and re-renders the slotted panels on every `mousemove`.
let containerRect: DOMRect | undefined;
let pendingClientX: number | undefined;
let pendingWidth: number | undefined;
let frameHandle: number | undefined;

const widths = computed(() => {
    if (props.rightHidden) return { left: '100%', right: '0' };
    if (props.leftHidden) return { left: '0', right: '100%' };

    // Use CSS clamp for visual consistency and boundary handling
    const clampedWidth = `clamp(${props.minWidth}, ${currentWidth.value}, ${props.maxWidth})`;

    return {
        left: props.baseSide === 'left' ? clampedWidth : `calc(100% - ${clampedWidth})`,
        right: props.baseSide === 'right' ? clampedWidth : `calc(100% - ${clampedWidth})`,
    };
});

function applyPendingWidth() {
    if (pendingClientX === undefined || !containerRect) return;

    pendingWidth = props.baseSide === 'left' ? pendingClientX - containerRect.left : containerRect.right - pendingClientX;
    currentWidth.value = `${pendingWidth}px`;
}

const startResize = (event: MouseEvent) => {
    event.preventDefault();
    isDragging.value = true;
    containerRect = splitterContainer.value?.getBoundingClientRect();
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', stopResize);
    document.body.classList.add('select-none');
};

const onResize = (event: MouseEvent) => {
    if (!isDragging.value) return;

    pendingClientX = event.clientX;

    if (frameHandle === undefined) {
        frameHandle = requestAnimationFrame(() => {
            frameHandle = undefined;
            applyPendingWidth();
        });
    }
};

const stopResize = () => {
    if (!isDragging.value) return;

    isDragging.value = false;
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.classList.remove('select-none');

    if (frameHandle !== undefined) {
        cancelAnimationFrame(frameHandle);
        frameHandle = undefined;
    }

    applyPendingWidth();

    if (props.localStorageKey && pendingWidth !== undefined) {
        localStorage.setItem(props.localStorageKey, pendingWidth.toString());
    }

    containerRect = undefined;
    pendingClientX = undefined;
    pendingWidth = undefined;
};

onUnmounted(() => {
    stopResize();
});
</script>

<template>
    <div :class="twMerge('flex w-full h-full overflow-hidden relative items-stretch', props.class)" ref="splitterContainer">
        <div v-if="isDragging" class="absolute inset-0 z-50 cursor-col-resize"></div>

        <div v-if="!leftHidden" :class="twMerge('min-h-full overflow-auto flex flex-col relative gap-1 scrollbar-thin', props.leftClass)" :style="{ width: widths.left }">
            <slot name="left">
                <div class="p-4">Left Panel Content</div>
            </slot>
        </div>

        <div
            v-if="!leftHidden && !rightHidden"
            :class="
                twMerge(
                    'w-1! z-60 min-h-full bg-surface-200 dark:bg-surface-900 hover:bg-primary-500 cursor-col-resize transition-colors',
                    props.draggerClass,
                    props.draggerInvisible ? 'opacity-0 hover:opacity-100' : ''
                )
            "
            @mousedown="startResize"
            title="Drag to resize"
        ></div>

        <div v-if="!rightHidden" :class="twMerge('min-h-full overflow-auto flex flex-col relative gap-1 scrollbar-thin', props.rightClass)" :style="{ width: widths.right }">
            <slot name="right">
                <div class="p-4">Right Panel Content</div>
            </slot>
        </div>
    </div>
</template>
