<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DiffViewerState } from '../composables/useDiffViewer';
import { useSettings } from '../composables/useSettings';
import Alert from './Alert.vue';
import IconButton from './IconButton.vue';
import MonacoEditor from './MonacoEditor.vue';
import MonacoEditorSettingsButton from './MonacoEditorSettingsButton.vue';
import type { MonacoEditorActionZone } from './monacoEditorTypes';

const props = defineProps<{
    state?: DiffViewerState;
    focusLine?: number;
    actionZones?: MonacoEditorActionZone[];
    actionZoneVisibility?: 'always' | 'hover';
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
const showsWhitespaceOnlyIndicator = computed(() => !settings.state.showWhitespaceChanges && rendersTextDiff.value && props.state?.onlyWhitespaceChanges);
const horizontalImages = ref(false);
</script>

<template>
    <div class="relative flex h-full flex-col">
        <div class="flex items-center gap-1 border-b border-x5 px-2 py-1.5 text-xs font-medium">
            <div class="truncate flex-1 text-white">{{ state?.title }}</div>
            <slot name="before-header-actions"></slot>
            <Alert v-if="showsWhitespaceOnlyIndicator" severity="secondary" class="rounded px-2 py-px tracking-tight text-white/75"> space-only-diff </Alert>
            <div v-if="state?.metaItems?.length" class="flex flex-wrap items-center gap-1 text-xs text-white/65">
                <Alert severity="secondary" v-for="item in state.metaItems" :key="item.id" class="rounded px-2 py-px tracking-tight" v-html="item.text"> </Alert>
            </div>
            <MonacoEditorSettingsButton v-if="rendersTextDiff" :hide-diff-options="false" />
            <IconButton
                v-else-if="hasPreviewImages"
                :icon="horizontalImages ? 'icon-[fluent--split-vertical-12-filled]' : 'icon-[fluent--split-horizontal-12-filled]'"
                :title="horizontalImages ? 'Switch to vertical layout' : 'Switch to horizontal layout'"
                :disabled="!hasPreviewImages"
                smaller
                @click="horizontalImages = !horizontalImages"
            />
        </div>

        <slot name="after-header"></slot>

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
            :reveal-line="props.focusLine"
            :action-zones="props.actionZones"
            :action-zone-visibility="props.actionZoneVisibility"
            :readonly="true"
            class="overflow-y-auto text-xs leading-6 text-white/85"
        />
    </div>
</template>
