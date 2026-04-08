<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { DiffViewerState } from '../composables/useDiffViewer';
import { useSettings } from '../composables/useSettings';
import MonacoEditor from './MonacoEditor.vue';
import IconButton from './IconButton.vue';
import Alert from './Alert.vue';

const props = defineProps<{
    state?: DiffViewerState;
}>();

type PreviewPane = {
    key: 'original' | 'modified';
    label: string;
    src: string | undefined;
    emptyLabel: string;
};

const settings = useSettings();
const panes = computed<PreviewPane[]>(() => {
    return [
        {
            key: 'original',
            label: 'Old',
            src: props.state?.originalSrc,
            emptyLabel: 'No previous image',
        },
        {
            key: 'modified',
            label: 'New',
            src: props.state?.modifiedSrc,
            emptyLabel: 'No new image',
        },
    ];
});
const hasPreviewImages = computed(() => Boolean(props.state?.originalSrc || props.state?.modifiedSrc));
const rendersTextDiff = computed(() => !props.state?.previewMessage && !hasPreviewImages.value);
const horizontalImages = ref(false);

const diffSettingsRef = ref<HTMLElement>();
const isDiffSettingsOpen = ref(false);

function toggleDiffSettings() {
    isDiffSettingsOpen.value = !isDiffSettingsOpen.value;
}

function closeDiffSettings() {
    isDiffSettingsOpen.value = false;
}

function onDocumentPointerDown(event: MouseEvent) {
    const target = event.target;

    if (!(target instanceof Node) || !diffSettingsRef.value?.contains(target)) {
        closeDiffSettings();
    }
}

function onDocumentKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        closeDiffSettings();
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onDocumentPointerDown);
    document.addEventListener('keydown', onDocumentKeyDown);
});

onUnmounted(() => {
    document.removeEventListener('keydown', onDocumentKeyDown);
    document.removeEventListener('mousedown', onDocumentPointerDown);
});
</script>

<template>
    <div class="relative flex h-full flex-col">
        <div class="flex items-center gap-1 border-b border-x5 px-2 py-1.5 text-xs font-medium">
            <div class="truncate flex-1 text-white">{{ state?.title }}</div>
            <slot name="before-header-actions"></slot>
            <div v-if="state?.metaItems?.length" class="flex flex-wrap items-center gap-1 text-xs text-white/65">
                <Alert severity="secondary" v-for="item in state.metaItems" :key="item.id" class="rounded px-2 py-px tracking-tight" v-html="item.text"> </Alert>
            </div>
            <div v-if="rendersTextDiff" ref="diffSettingsRef" class="relative flex items-center">
                <IconButton severity="secondary" icon="icon-[lucide--settings-2]" smaller v-tooltip="'Diff settings'" @click.stop="toggleDiffSettings"> </IconButton>
                <div
                    v-if="isDiffSettingsOpen"
                    class="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-max rounded-md border border-white/10 bg-[#101114] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.45)]"
                    role="dialog"
                    aria-label="Diff settings"
                    @click.stop
                >
                    <div class="space-y-3 text-xs text-white/80">
                        <div>
                            <div class="mb-1.5 flex items-center justify-between">
                                <span class="font-semibold uppercase tracking-tight opacity-50">Font Size</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <input
                                    :value="settings.state.diffFontSize"
                                    type="range"
                                    min="10"
                                    max="24"
                                    step="1"
                                    class="w-full accent-white"
                                    @input="settings.setDiffFontSize(Number(($event.target as HTMLInputElement).value))"
                                />
                                <input
                                    :value="settings.state.diffFontSize"
                                    type="number"
                                    min="10"
                                    max="24"
                                    class="w-14 rounded border border-white/10 bg-black/20 px-2 py-1 text-center text-xs text-white outline-none focus:border-white/30"
                                    @change="settings.setDiffFontSize(Number(($event.target as HTMLInputElement).value))"
                                />
                            </div>
                        </div>

                        <div class="pt-3">
                            <label class="flex cursor-pointer items-center gap-2 text-white/80 transition hover:border-white/20 hover:text-white">
                                <input
                                    :checked="settings.state.diffViewMode === 'changes'"
                                    type="checkbox"
                                    class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                                    @change="settings.setDiffViewMode(($event.target as HTMLInputElement).checked ? 'changes' : 'full-file')"
                                />
                                <span>Show changes only</span>
                            </label>
                        </div>

                        <div>
                            <label class="flex cursor-pointer items-center gap-2 text-white/80 transition hover:border-white/20 hover:text-white">
                                <input
                                    :checked="!settings.state.showWhitespaceChanges"
                                    type="checkbox"
                                    class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                                    @change="settings.setShowWhitespaceChanges(!($event.target as HTMLInputElement).checked)"
                                />
                                <span>Hide whitespace changes</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            <IconButton
                v-else-if="hasPreviewImages"
                :icon="horizontalImages ? 'icon-[fluent--split-vertical-12-filled]' : 'icon-[fluent--split-horizontal-12-filled]'"
                :title="horizontalImages ? 'Switch to vertical layout' : 'Switch to horizontal layout'"
                :disabled="!hasPreviewImages"
                smaller
                @click="horizontalImages = !horizontalImages"
            />
        </div>

        <div v-if="state?.previewMessage" class="grid min-h-0 flex-1 place-items-center bg-x1 px-6 text-sm text-white/50">
            {{ state.previewMessage }}
        </div>
        <div v-else-if="hasPreviewImages" :class="['grid min-h-0 flex-1 gap-px bg-white/10', horizontalImages ? 'md:grid-cols-2' : 'md:grid-rows-2']">
            <section v-for="pane in panes" :key="pane.key" class="flex min-h-0 flex-col bg-[#111317]">
                <div class="border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                    {{ pane.label }}
                </div>
                <div
                    class="grid min-h-0 flex-1 place-items-center overflow-auto bg-[linear-gradient(45deg,rgba(255,255,255,0.03)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.03)_75%,rgba(255,255,255,0.03)),linear-gradient(45deg,rgba(255,255,255,0.03)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.03)_75%,rgba(255,255,255,0.03))] bg-size-[24px_24px] bg-position-[0_0,12px_12px] p-5"
                >
                    <img
                        v-if="pane.src"
                        :src="pane.src"
                        :alt="`${pane.label} image preview`"
                        class="max-h-full max-w-full rounded-lg border border-white/10 bg-black/20 object-contain shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
                    />
                    <div v-else class="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-3 text-sm text-white/45">
                        {{ pane.emptyLabel }}
                    </div>
                </div>
            </section>
        </div>
        <MonacoEditor
            v-else
            no-head
            :original="state?.original"
            :modified="state?.modified"
            :path-for-language="state?.pathForLanguage"
            :diff-view-mode="settings.state.diffViewMode"
            :show-whitespace-changes="settings.state.showWhitespaceChanges"
            :readonly="true"
            class="overflow-y-auto text-xs leading-6 text-white/85"
        />
    </div>
</template>
