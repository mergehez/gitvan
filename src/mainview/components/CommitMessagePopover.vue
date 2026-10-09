<script setup lang="ts">
import { nextTick, onBeforeUnmount, useTemplateRef, ref, watch } from 'vue';
import type { CommitMessageAnchorPoint } from '../composables/useCommitMessageEditor';
import { useOverlaysState } from '../directives/useOverlaysState';
import Button from './Button.vue';

const MARGIN = 8;
const GAP = 6;

const open = defineModel<boolean>('open', { required: true });
const value = defineModel<string>('value', { required: true });

const props = defineProps<{
    title: string;
    targetLabel: string;
    multiline: boolean;
    canSubmit: boolean;
    isLoading: boolean;
    anchorPoint: CommitMessageAnchorPoint | undefined;
    submit: () => void;
    close: () => void;
}>();

const overlayState = useOverlaysState();
const panelRef = useTemplateRef('panelRef');
const fieldRef = useTemplateRef<HTMLInputElement | HTMLTextAreaElement>('fieldRef');
const zIndex = ref(0);
const position = ref({ left: 0, top: 0 });

function updatePosition() {
    const panel = panelRef.value;
    const anchor = props.anchorPoint;

    if (!panel || !anchor) {
        return;
    }

    const { width, height } = panel.getBoundingClientRect();
    let left = anchor.x + GAP;
    let top = anchor.y + GAP;

    // Flip back over the row instead of running off screen, like a context menu.
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

function onFieldKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') {
        return;
    }

    // The summary must stay a single line, so plain Enter saves; a description keeps
    // its newlines and saves on the usual modifier shortcut.
    if (props.multiline && !event.metaKey && !event.ctrlKey) {
        return;
    }

    event.preventDefault();

    if (props.canSubmit) {
        props.submit();
    }
}

function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        props.close();
    }
}

watch(
    open,
    async (isOpen) => {
        if (!isOpen) {
            window.removeEventListener('keydown', onWindowKeydown);
            zIndex.value = overlayState.releaseZIndex(zIndex.value);
            return;
        }

        zIndex.value = overlayState.claimZIndex();
        window.addEventListener('keydown', onWindowKeydown);

        await nextTick();
        updatePosition();
        fieldRef.value?.focus();
        fieldRef.value?.select();
    },
    { immediate: true }
);

watch(
    () => props.anchorPoint,
    () => {
        if (open.value) {
            void nextTick(updatePosition);
        }
    }
);

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onWindowKeydown);
    zIndex.value = overlayState.releaseZIndex(zIndex.value);
});
</script>

<template>
    <Teleport to="body">
        <div v-if="open" class="fixed inset-0" :style="{ zIndex }" @mousedown="props.close" @contextmenu.prevent>
            <div
                ref="panelRef"
                data-testid="commit-message-popover"
                class="absolute w-80 max-w-[calc(100vw-16px)] rounded-md border border-x5 bg-x1 px-2.5 py-2 text-xs shadow-xl shadow-black/40"
                :style="{ left: `${position.left}px`, top: `${position.top}px` }"
                @mousedown.stop
            >
                <p class="font-medium text-white">{{ props.title }}</p>
                <p v-if="props.targetLabel" class="mt-0.5 truncate text-2xs text-white/50" :title="props.targetLabel">{{ props.targetLabel }}</p>

                <input
                    v-if="!props.multiline"
                    ref="fieldRef"
                    v-model="value"
                    type="text"
                    data-testid="commit-message-input"
                    class="mt-2 w-full rounded border border-white/10 bg-x0 px-2 py-1.5 text-xs text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                    @keydown="onFieldKeydown"
                />
                <textarea
                    v-else
                    ref="fieldRef"
                    v-model="value"
                    rows="4"
                    data-testid="commit-description-input"
                    class="mt-2 w-full resize-none rounded border border-white/10 bg-x0 px-2 py-1.5 text-xs text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                    @keydown="onFieldKeydown"
                ></textarea>

                <p v-if="props.multiline" class="mt-1 text-2xs text-white/40">⌘Enter to save</p>

                <div class="mt-2 flex items-center justify-end gap-1">
                    <Button data-testid="commit-message-cancel" severity="light" smaller @click="props.close"> Cancel </Button>
                    <Button data-testid="commit-message-save" severity="primary" smaller :disabled="!props.canSubmit" v-loading="props.isLoading" @click="props.submit">
                        Save
                    </Button>
                </div>
            </div>
        </div>
    </Teleport>
</template>
