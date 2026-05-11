<script setup lang="ts">
import type * as MonacoEditorModule from 'monaco-editor';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useSettings } from '../composables/useSettings';
import { configureMonaco, configureMonacoEnvironment, createMonacoOptions, getMonacoLanguage, getMonacoModule as loadMonacoModule } from '../lib/monaco';
import { useDiffActionZones } from '../lib/monacoDiffActionZones';
import { useCosmeticDiffMasking } from '../lib/monacoDiffMasking';
import MonacoEditorSettingsButton from './MonacoEditorSettingsButton.vue';
import type { MonacoEditorActionZone } from './monacoEditorTypes';

type MonacoModule = typeof MonacoEditorModule;
configureMonacoEnvironment();

const modelValue = defineModel<string>();
const emit = defineEmits<{
    visibleDiffChange: [hasVisibleChanges: boolean | undefined];
}>();
const props = defineProps<{
    title?: string;
    noHead?: boolean;
    readonly?: boolean;
    class?: string;
    language?: string;
    pathForLanguage?: string;
    original?: string;
    modified?: string;
    diffViewMode?: 'changes' | 'full-file';
    diffIgnoredChars?: string;
    showWhitespaceChanges?: boolean;
    revealLine?: number;
    actionZones?: MonacoEditorActionZone[];
    actionZoneVisibility?: 'always' | 'hover';
}>();
const settings = useSettings();

const editorContainerRef = ref<HTMLDivElement>();
const diffContainerRef = ref<HTMLDivElement>();
const monacoModuleRef = shallowRef<MonacoModule>();
const editorRef = shallowRef<MonacoEditorModule.editor.IStandaloneCodeEditor>();
const modelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
const diffEditorRef = shallowRef<MonacoEditorModule.editor.IStandaloneDiffEditor>();
const originalModelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
const modifiedModelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
const diffEditorListenersRef = shallowRef<MonacoEditorModule.IDisposable[]>([]);
const diffComputationListenersRef = shallowRef<MonacoEditorModule.IDisposable[]>([]);
const originalCosmeticDiffMutationObserverRef = shallowRef<MutationObserver>();
const modifiedCosmeticDiffMutationObserverRef = shallowRef<MutationObserver>();
let applyingExternalValue = false;
let syncDiffRequestId = 0;

const cosmeticMasking = useCosmeticDiffMasking({
    diffEditorRef,
    originalModelRef,
    modifiedModelRef,
    diffContainerRef,
    monacoModuleRef,
    originalMutationObserverRef: originalCosmeticDiffMutationObserverRef,
    modifiedMutationObserverRef: modifiedCosmeticDiffMutationObserverRef,
    diffIgnoredChars: () => props.diffIgnoredChars ?? '',
    showWhitespaceChanges: () => props.showWhitespaceChanges ?? false,
    onVisibleDiffChange: (hasVisible) => emit('visibleDiffChange', hasVisible),
});

const diffActions = useDiffActionZones({
    diffEditorRef,
    diffContainerRef,
    monacoModuleRef,
    actionZones: () => props.actionZones,
    actionZoneVisibility: () => props.actionZoneVisibility,
    getRenderedDiffBlocks: cosmeticMasking.getRenderedDiffBlocks,
    hasVisibleDiffChanges: cosmeticMasking.hasVisibleDiffChanges,
});

const {
    centeredActionZoneLayouts,
    hoveredActionZoneId,
    hoveringActionZone,
    getActionZoneVisibility,
    syncCenteredActionZoneLayouts,
    setHoveredActionZone,
    scheduleHoveredActionZoneClear,
    dispose: disposeActionZones,
} = diffActions;

const isDiffEditor = computed(() => props.original !== undefined && props.modified !== undefined);

async function getMonacoModule() {
    if (!monacoModuleRef.value) {
        monacoModuleRef.value = await loadMonacoModule();
    }
    return monacoModuleRef.value;
}

function createDiffModels() {
    const monaco = monacoModuleRef.value!;
    originalModelRef.value = monaco.editor.createModel(props.original ?? '', finalLanguage.value);
    modifiedModelRef.value = monaco.editor.createModel(props.modified ?? '', finalLanguage.value);
}

function disconnectCosmeticDiffMutationObservers() {
    originalCosmeticDiffMutationObserverRef.value?.disconnect();
    originalCosmeticDiffMutationObserverRef.value = undefined;
    modifiedCosmeticDiffMutationObserverRef.value?.disconnect();
    modifiedCosmeticDiffMutationObserverRef.value = undefined;
}

function clearDiffEditorListeners() {
    diffEditorListenersRef.value.forEach((listener) => listener.dispose());
    diffEditorListenersRef.value = [];
}

function clearDiffComputationListeners() {
    diffComputationListenersRef.value.forEach((listener) => listener.dispose());
    diffComputationListenersRef.value = [];
}

async function ensureEditor() {
    if (isDiffEditor.value || !editorContainerRef.value || editorRef.value) return;
    const monaco = await getMonacoModule();
    configureMonaco(monaco);
    monaco.editor.setTheme('vs-dark');
    modelRef.value = monaco.editor.createModel(modelValue.value ?? '', finalLanguage.value);
    editorRef.value = monaco.editor.create(editorContainerRef.value, options.value);
    editorRef.value.setModel(modelRef.value);
    modelRef.value.onDidChangeContent(() => {
        if (applyingExternalValue) return;
        modelValue.value = modelRef.value?.getValue() ?? '';
    });
}

function disposeEditor() {
    editorRef.value?.dispose();
    modelRef.value?.dispose();
    editorRef.value = undefined;
    modelRef.value = undefined;
}

async function ensureDiffEditor() {
    if (!isDiffEditor.value || !diffContainerRef.value || diffEditorRef.value) return;
    const monaco = await getMonacoModule();
    configureMonaco(monaco);
    monaco.editor.setTheme('vs-dark');
    diffEditorRef.value = monaco.editor.createDiffEditor(diffContainerRef.value, { ...diffOptions.value });
    createDiffModels();
    diffEditorRef.value.setModel({ original: originalModelRef.value!, modified: modifiedModelRef.value! });
    const originalEditor = diffEditorRef.value.getOriginalEditor();
    const modifiedEditor = diffEditorRef.value.getModifiedEditor();
    diffEditorListenersRef.value = [
        originalEditor.onDidScrollChange(() => {
            cosmeticMasking.scheduleCosmeticDiffMaskSync('original', 'onDidScrollChange');
            syncCenteredActionZoneLayouts();
        }),
        modifiedEditor.onDidScrollChange(() => {
            cosmeticMasking.scheduleCosmeticDiffMaskSync('modified', 'onDidScrollChange');
            syncCenteredActionZoneLayouts();
        }),
        originalEditor.onDidLayoutChange(() => {
            cosmeticMasking.scheduleCosmeticDiffMaskSync('original', 'onDidLayoutChange');
            syncCenteredActionZoneLayouts();
        }),
        modifiedEditor.onDidLayoutChange(() => {
            cosmeticMasking.scheduleCosmeticDiffMaskSync('modified', 'onDidLayoutChange');
            syncCenteredActionZoneLayouts();
        }),
    ];
    originalCosmeticDiffMutationObserverRef.value = new MutationObserver(() => cosmeticMasking.scheduleCosmeticDiffMaskSync('original', 'mutationObserver', 50));
    modifiedCosmeticDiffMutationObserverRef.value = new MutationObserver(() => cosmeticMasking.scheduleCosmeticDiffMaskSync('modified', 'mutationObserver', 50));
    diffComputationListenersRef.value = [diffEditorRef.value.onDidUpdateDiff(() => applyStableDiffOptions())];
}

function disposeDiffEditor() {
    disposeActionZones();
    cosmeticMasking.dispose();
    clearDiffEditorListeners();
    clearDiffComputationListeners();
    disconnectCosmeticDiffMutationObservers();
    const diffEditor = diffEditorRef.value;
    if (diffEditor) {
        diffEditor.dispose();
        diffEditorRef.value = undefined;
    }
    originalModelRef.value?.dispose();
    modifiedModelRef.value?.dispose();
    originalModelRef.value = undefined;
    modifiedModelRef.value = undefined;
}

let applyingStableOptions = false;

function applyStableDiffOptions() {
    if (applyingStableOptions) return;
    applyingStableOptions = true;
    try {
        const diffEditor = diffEditorRef.value;
        if (!diffEditor) return;
        diffEditor.updateOptions(diffOptions.value);
        diffEditor.getOriginalEditor().updateOptions({ wordWrap: 'off', hover: { enabled: false } });
        diffEditor.getModifiedEditor().updateOptions({ wordWrap: 'off', hover: { enabled: false } });
        cosmeticMasking.syncCosmeticDiffMasks(undefined, 'applyStableDiffOptions');
        syncCenteredActionZoneLayouts();
        cosmeticMasking.emitVisibleDiffChange();
        if (props.revealLine && props.revealLine > 0) diffEditor.getModifiedEditor().revealLineInCenter(props.revealLine);
        diffEditor.layout();
    } finally {
        applyingStableOptions = false;
    }
}

async function syncDiffEditor() {
    const requestId = ++syncDiffRequestId;
    if (!isDiffEditor.value) {
        disposeDiffEditor();
        return;
    }
    await ensureDiffEditor();
    if (cosmeticMasking.hasVisibleDiffChanges.value !== undefined) {
        cosmeticMasking.hasVisibleDiffChanges.value = undefined;
        emit('visibleDiffChange', undefined);
    }
    if (requestId !== syncDiffRequestId || !originalModelRef.value || !modifiedModelRef.value) return;
    const nextLanguage = finalLanguage.value;
    const nextOriginal = props.original ?? '';
    const nextModified = props.modified ?? '';
    if (originalModelRef.value.getLanguageId() !== nextLanguage) monacoModuleRef.value?.editor.setModelLanguage(originalModelRef.value, nextLanguage);
    if (modifiedModelRef.value.getLanguageId() !== nextLanguage) monacoModuleRef.value?.editor.setModelLanguage(modifiedModelRef.value, nextLanguage);
    if (originalModelRef.value.getValue() !== nextOriginal) originalModelRef.value.setValue(nextOriginal);
    if (modifiedModelRef.value.getValue() !== nextModified) modifiedModelRef.value.setValue(nextModified);
    if (requestId !== syncDiffRequestId) return;
    applyStableDiffOptions();
}

async function syncEditor() {
    if (isDiffEditor.value) {
        disposeEditor();
        return;
    }
    await ensureEditor();
    if (!modelRef.value || !editorRef.value) return;
    const nextValue = modelValue.value ?? '';
    const nextLanguage = finalLanguage.value;
    if (modelRef.value.getLanguageId() !== nextLanguage) monacoModuleRef.value?.editor.setModelLanguage(modelRef.value, nextLanguage);
    if (modelRef.value.getValue() !== nextValue) {
        applyingExternalValue = true;
        modelRef.value.setValue(nextValue);
        applyingExternalValue = false;
    }
    editorRef.value.updateOptions(options.value);
    editorRef.value.layout();
}

const finalLanguage = computed(() => getMonacoLanguage(props.language, props.pathForLanguage));

const options = computed(
    () =>
        createMonacoOptions({
            readonly: props.readonly,
            fontSize: settings.state.diffFontSize,
        }) as MonacoEditorModule.editor.IStandaloneEditorConstructionOptions
);

const diffOptions = computed(
    () =>
        ({
            ...options.value,
            renderSideBySide: true,
            compactMode: false,
            renderSideBySideInlineBreakpoint: 0,
            useInlineViewWhenSpaceIsLimited: false,
            diffWordWrap: 'off',
            hideUnchangedRegions: { enabled: props.diffViewMode === 'changes', contextLineCount: 4 },
            hover: { enabled: false },
            ignoreTrimWhitespace: !props.showWhitespaceChanges,
        }) as MonacoEditorModule.editor.IDiffEditorConstructionOptions
);

watch(
    () => [
        modelValue.value,
        props.original,
        props.modified,
        props.language,
        props.pathForLanguage,
        isDiffEditor.value,
        props.readonly,
        settings.state.diffFontSize,
        props.diffViewMode,
        props.diffIgnoredChars,
        props.showWhitespaceChanges,
        props.revealLine,
    ],
    () => {
        void syncEditor();
        void syncDiffEditor();
    }
);

watch(
    () => [props.actionZones, props.actionZoneVisibility],
    () => syncCenteredActionZoneLayouts()
);

onMounted(() => {
    void syncEditor();
    void syncDiffEditor();
});
onUnmounted(() => {
    disposeEditor();
    disposeDiffEditor();
});
</script>

<template>
    <div class="h-full flex flex-col relative">
        <div v-if="!props.noHead" class="flex items-center border-b border-x5 px-2 py-1.5 text-xs font-medium gap-1">
            <div class="line-clamp-1 flex-1 text-white">{{ title || pathForLanguage }}</div>

            <slot name="before-settings-button"></slot>

            <MonacoEditorSettingsButton :hide-diff-options="!isDiffEditor" />
        </div>

        <div
            v-if="isDiffEditor"
            class="relative w-full min-h-40 flex-1"
            :class="[props.class, cosmeticMasking.wholeDocumentCosmeticMaskActive.value ? 'gitvan-hide-all-diff-decorations' : '']"
        >
            <div ref="diffContainerRef" class="absolute inset-0" />
            <div class="monaco-diff-actions-overlay">
                <div
                    v-for="layout in centeredActionZoneLayouts"
                    :key="layout.id"
                    class="monaco-diff-actions-anchor"
                    :style="{ left: `${layout.left}px`, top: `${layout.top}px` }"
                    @mouseenter="
                        hoveringActionZone = true;
                        setHoveredActionZone(layout.id);
                    "
                    @mouseleave="
                        hoveringActionZone = false;
                        scheduleHoveredActionZoneClear();
                    "
                >
                    <button type="button" class="monaco-diff-actions-trigger" :title="layout.zone.label ?? 'Change actions'" @mousedown.prevent.stop>
                        <span class="icon icon-[mdi--dots-horizontal] text-[11px]"></span>
                    </button>

                    <div v-if="getActionZoneVisibility() === 'always' || hoveredActionZoneId === layout.id" class="monaco-diff-actions-popover" @mousedown.prevent.stop>
                        <div v-if="layout.zone.label" class="monaco-diff-actions__label">{{ layout.zone.label }}</div>
                        <div v-if="layout.zone.meta" class="monaco-diff-actions__meta">{{ layout.zone.meta }}</div>
                        <button
                            v-for="action in layout.zone.actions"
                            :key="action.id"
                            type="button"
                            :class="['monaco-diff-actions__button', action.tone === 'danger' ? 'monaco-diff-actions__button--danger' : '']"
                            :title="action.title ?? action.label"
                            :disabled="Boolean(action.disabled)"
                            :data-busy="Boolean(action.busy)"
                            @mousedown.prevent.stop
                            @click.prevent.stop="action.disabled ? undefined : action.onClick()"
                        >
                            {{ action.label }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div v-else ref="editorContainerRef" class="w-full min-h-40 flex-1" :class="props.class" />
    </div>
</template>

<style>
.monaco-diff-actions-overlay {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 55;
}

.monaco-diff-actions-anchor {
    position: absolute;
    pointer-events: auto;
    transform: translate(-50%, -50%);
}

.monaco-diff-actions-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: 1px solid #1274cf;
    border-radius: 999px;
    background: #0b4983;
    color: rgba(255, 255, 255, 0.88);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    cursor: pointer;
}

.monaco-diff-actions-trigger:hover {
    background: #0f5ca7;
}

.monaco-diff-actions-popover {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex-wrap: wrap;
    background: #0b4983;
    border: 1px solid #1274cf;
    border-radius: 0.35rem;
    pointer-events: auto;
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 56;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    width: max-content;
    transform: translate(-50%, calc(-100% - 8px));
    padding: 1px;
}

.monaco-diff-actions__label {
    color: rgba(255, 255, 255, 0.88);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 0 0.35rem;
    text-transform: uppercase;
}

.monaco-diff-actions__meta {
    color: rgba(255, 255, 255, 0.62);
    font-size: 10px;
    line-height: 1;
    padding-right: 0.25rem;
    white-space: nowrap;
}

.monaco-diff-actions__button {
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: rgba(255, 255, 255, 0.82);
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 0.35rem 0.55rem !important;
    pointer-events: auto;
}

.monaco-diff-actions__button:hover {
    background: #008cff;
    color: #fff4e6;
}

.monaco-diff-actions__button--danger:hover {
    background: #cf5a35;
    color: #fff4e6;
}

.monaco-diff-actions__button:disabled,
.monaco-diff-actions__button[data-busy='true'] {
    cursor: default;
    opacity: 0.45;
}

.monaco-diff-actions__button:disabled:hover,
.monaco-diff-actions__button[data-busy='true']:hover {
    background: transparent;
}

.gitvan-cosmetic-diff-mask {
    background: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
    outline: none !important;
}

.gitvan-cosmetic-diff-mask::before,
.gitvan-cosmetic-diff-mask::after {
    opacity: 0 !important;
}

.gitvan-hide-all-diff-decorations .line-insert,
.gitvan-hide-all-diff-decorations .line-delete,
.gitvan-hide-all-diff-decorations .char-insert,
.gitvan-hide-all-diff-decorations .char-delete,
.gitvan-hide-all-diff-decorations .diff-range-empty,
.gitvan-hide-all-diff-decorations .diagonal-fill {
    background: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
    outline: none !important;
    opacity: 0 !important;
}
</style>
