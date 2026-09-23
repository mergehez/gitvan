<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { confirmation } from '../composables/useConfirmation';
import { useOverlaysState } from '../directives/useOverlaysState';
import Button from './Button.vue';

const MARGIN = 8;
const GAP = 6;

const overlayState = useOverlaysState();
const panelRef = ref<HTMLElement>();
const zIndex = ref(0);
const position = ref({ left: 0, top: 0 });

// Only confirmations triggered from something on screen sit next to it; the rest stay centered.
const isOpen = computed(() => confirmation.state.isOpen && confirmation.state.anchorPoint !== undefined);

function updatePosition() {
    const panel = panelRef.value;
    const anchor = confirmation.state.anchorPoint;

    if (!panel || !anchor) {
        return;
    }

    const { width, height } = panel.getBoundingClientRect();
    let left = anchor.x + GAP;
    let top = anchor.y + GAP;

    // Flip back over the pointer instead of running off screen, like a context menu.
    if (left + width > window.innerWidth - MARGIN) {
        left = anchor.x - width - GAP;
    }

    if (top + height > window.innerHeight - MARGIN) {
        top = anchor.y - height - GAP;
    }

    position.value = {
        left: Math.round(Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN))),
        top: Math.round(Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN))),
    };
}

function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        confirmation.cancel();
    }
}

watch(
    isOpen,
    async (open) => {
        if (!open) {
            window.removeEventListener('keydown', onWindowKeydown);
            zIndex.value = overlayState.releaseZIndex(zIndex.value);
            return;
        }

        const anchor = confirmation.state.anchorPoint!;
        zIndex.value = overlayState.claimZIndex();
        position.value = { left: Math.round(anchor.x + GAP), top: Math.round(anchor.y + GAP) };
        window.addEventListener('keydown', onWindowKeydown);

        await nextTick();
        updatePosition();
        // Land on Cancel so a stray Enter/Space cannot re-fire the trigger behind the popover.
        panelRef.value?.querySelector<HTMLElement>('[data-testid="confirmation-popover-cancel"]')?.focus();
    },
    { immediate: true }
);

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
    <Teleport to="body">
        <div v-if="isOpen" class="fixed inset-0" :style="{ zIndex }" @mousedown="confirmation.cancel()" @contextmenu.prevent>
            <div
                ref="panelRef"
                data-testid="confirmation-popover"
                class="absolute w-64 max-w-[calc(100vw-16px)] rounded-md border border-x5 bg-x1 px-2.5 py-2 text-xs shadow-xl shadow-black/40"
                :style="{ left: `${position.left}px`, top: `${position.top}px` }"
                @mousedown.stop
            >
                <p class="font-medium text-white">{{ confirmation.state.title }}</p>
                <p class="mt-1 leading-4 text-white/75">{{ confirmation.state.message }}</p>
                <p v-if="confirmation.state.detail" class="mt-1 text-2xs leading-4 text-white/50">{{ confirmation.state.detail }}</p>

                <div class="mt-2 flex items-center justify-end gap-1">
                    <Button data-testid="confirmation-popover-cancel" severity="light" smaller @click="confirmation.cancel()">
                        {{ confirmation.state.cancelLabel }}
                    </Button>
                    <Button data-testid="confirmation-popover-confirm" severity="warning" smaller @click="confirmation.confirm()">
                        {{ confirmation.state.confirmLabel }}
                    </Button>
                </div>
            </div>
        </div>
    </Teleport>
</template>
