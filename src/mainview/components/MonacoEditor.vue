<script setup lang="ts">
import type * as MonacoEditorModule from 'monaco-editor';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useSettings } from '../composables/useSettings';
import { configureMonaco, configureMonacoEnvironment, createMonacoOptions, getMonacoLanguage, getMonacoModule as loadMonacoModule } from '../lib/monaco';
import MonacoEditorSettingsButton from './MonacoEditorSettingsButton.vue';
import type { MonacoEditorActionZone } from './monacoEditorTypes';

type MonacoModule = typeof import('monaco-editor');
type AppliedMonacoActionZone = {
    domNode: HTMLDivElement;
    zoneId: string | undefined;
    dispose: () => void;
};

type ActionZoneVisibility = 'always' | 'hover';
type DiffEditorSide = 'original' | 'modified';

configureMonacoEnvironment();

const modelValue = defineModel<string>();
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
    showWhitespaceChanges?: boolean;
    revealLine?: number;
    actionZones?: MonacoEditorActionZone[];
    actionZoneVisibility?: ActionZoneVisibility;
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
const diffActionZoneRefs = shallowRef<AppliedMonacoActionZone[]>([]);
const diffEditorListenersRef = shallowRef<MonacoEditorModule.IDisposable[]>([]);
const diffComputationListenersRef = shallowRef<MonacoEditorModule.IDisposable[]>([]);
const hoveredActionZoneId = ref<string>();
const hoveringActionZone = ref(false);
let pendingHoveredActionZoneClearTimeout: ReturnType<typeof setTimeout> | undefined;
let applyingExternalValue = false;
let syncDiffRequestId = 0;

const isDiffEditor = computed(() => props.original !== undefined && props.modified !== undefined);

async function getMonacoModule() {
    if (!monacoModuleRef.value) {
        monacoModuleRef.value = await loadMonacoModule();
    }

    return monacoModuleRef.value;
}

async function ensureEditor() {
    if (isDiffEditor.value || !editorContainerRef.value || editorRef.value) {
        return;
    }

    const monaco = await getMonacoModule();

    configureMonaco(monaco);
    monaco.editor.setTheme('vs-dark');

    modelRef.value = monaco.editor.createModel(modelValue.value ?? '', finalLanguage.value);
    editorRef.value = monaco.editor.create(editorContainerRef.value, options.value);
    editorRef.value.setModel(modelRef.value);

    modelRef.value.onDidChangeContent(() => {
        if (applyingExternalValue) {
            return;
        }

        modelValue.value = modelRef.value?.getValue() ?? '';
    });
}

function disposeEditor() {
    editorRef.value?.dispose();
    modelRef.value?.dispose();
    editorRef.value = undefined;
    modelRef.value = undefined;
}

function createDiffModels() {
    const monaco = monacoModuleRef.value!;

    originalModelRef.value = monaco.editor.createModel(props.original ?? '', finalLanguage.value);
    modifiedModelRef.value = monaco.editor.createModel(props.modified ?? '', finalLanguage.value);
}

function clearDiffActionZones(editor = diffEditorRef.value?.getModifiedEditor()) {
    if (editor && diffActionZoneRefs.value.length > 0) {
        editor.changeViewZones((accessor) => {
            diffActionZoneRefs.value.forEach((zone) => {
                if (zone.zoneId) {
                    accessor.removeZone(zone.zoneId);
                }
                zone.dispose();
            });
        });
    } else {
        diffActionZoneRefs.value.forEach((zone) => {
            zone.dispose();
        });
    }

    diffActionZoneRefs.value = [];
}

function clearDiffEditorListeners() {
    diffEditorListenersRef.value.forEach((listener) => listener.dispose());
    diffEditorListenersRef.value = [];
}

function clearDiffComputationListeners() {
    diffComputationListenersRef.value.forEach((listener) => listener.dispose());
    diffComputationListenersRef.value = [];
}

function getActionZoneVisibility(): ActionZoneVisibility {
    return props.actionZoneVisibility ?? 'always';
}

function clearPendingHoveredActionZoneClear() {
    if (pendingHoveredActionZoneClearTimeout !== undefined) {
        clearTimeout(pendingHoveredActionZoneClearTimeout);
        pendingHoveredActionZoneClearTimeout = undefined;
    }
}

function scheduleHoveredActionZoneClear() {
    clearPendingHoveredActionZoneClear();
    pendingHoveredActionZoneClearTimeout = setTimeout(() => {
        pendingHoveredActionZoneClearTimeout = undefined;

        if (!hoveringActionZone.value) {
            setHoveredActionZone(undefined);
        }
    }, 220);
}

function findActionZoneForLine(lineNumber: number, side: DiffEditorSide) {
    return (props.actionZones ?? []).find((zone) => {
        const startLineNumber = Math.max(
            1,
            side === 'original' ? (zone.originalStartLineNumber ?? zone.startLineNumber ?? zone.afterLineNumber + 1) : (zone.startLineNumber ?? zone.afterLineNumber + 1),
        );
        const endLineNumber = Math.max(
            startLineNumber,
            side === 'original' ? (zone.originalEndLineNumber ?? zone.endLineNumber ?? startLineNumber) : (zone.endLineNumber ?? startLineNumber),
        );

        return lineNumber >= startLineNumber && lineNumber <= endLineNumber;
    });
}

function getMouseTargetLineNumber(target: MonacoEditorModule.editor.IMouseTarget) {
    return target.position?.lineNumber ?? target.range?.startLineNumber;
}

function createDiffHoverListener(editor: MonacoEditorModule.editor.ICodeEditor, side: DiffEditorSide) {
    return [
        editor.onMouseMove((event) => {
            if (getActionZoneVisibility() !== 'hover') {
                return;
            }

            const lineNumber = getMouseTargetLineNumber(event.target);

            if (!lineNumber) {
                if (!hoveringActionZone.value) {
                    scheduleHoveredActionZoneClear();
                }
                return;
            }

            const nextZone = findActionZoneForLine(lineNumber, side);

            if (nextZone) {
                setHoveredActionZone(nextZone.id);
                return;
            }

            if (!hoveringActionZone.value) {
                scheduleHoveredActionZoneClear();
            }
        }),
        editor.onMouseLeave(() => {
            if (getActionZoneVisibility() !== 'hover' || hoveringActionZone.value) {
                return;
            }

            scheduleHoveredActionZoneClear();
        }),
    ];
}

function setHoveredActionZone(nextZoneId: string | undefined) {
    if (nextZoneId !== undefined) {
        clearPendingHoveredActionZoneClear();
    }

    if (hoveredActionZoneId.value === nextZoneId) {
        return;
    }

    hoveredActionZoneId.value = nextZoneId;
    syncDiffActionZones();
}

function createDiffActionZone(zone: MonacoEditorActionZone): AppliedMonacoActionZone {
    const panelNode = document.createElement('div');
    panelNode.className = 'monaco-diff-actions';
    panelNode.style.pointerEvents = 'auto';

    if (zone.label) {
        const labelNode = document.createElement('span');
        labelNode.className = 'monaco-diff-actions__label';
        labelNode.textContent = zone.label;
        panelNode.appendChild(labelNode);
    }

    if (zone.meta) {
        const metaNode = document.createElement('span');
        metaNode.className = 'monaco-diff-actions__meta';
        metaNode.textContent = zone.meta;
        panelNode.appendChild(metaNode);
    }

    const listeners = zone.actions.map((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = ['monaco-diff-actions__button', action.tone === 'danger' ? 'monaco-diff-actions__button--danger' : ''].filter(Boolean).join(' ');
        button.textContent = action.label;
        button.title = action.title ?? action.label;
        button.disabled = Boolean(action.disabled);
        button.toggleAttribute('data-busy', Boolean(action.busy));
        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (button.disabled) {
                return;
            }

            action.onClick();
        });
        panelNode.appendChild(button);

        return () => button.remove();
    });

    const containerNode = document.createElement('div');
    containerNode.className = 'monaco-diff-actions-container';
    containerNode.addEventListener('mouseenter', () => {
        hoveringActionZone.value = true;
        setHoveredActionZone(zone.id);
    });
    containerNode.addEventListener('mouseleave', () => {
        hoveringActionZone.value = false;

        if (getActionZoneVisibility() === 'hover') {
            scheduleHoveredActionZoneClear();
        }
    });
    containerNode.appendChild(panelNode);

    return {
        domNode: containerNode,
        zoneId: undefined,
        dispose() {
            listeners.forEach((cleanup) => cleanup());
            containerNode.remove();
        },
    };
}

function syncDiffActionZones() {
    const modifiedEditor = diffEditorRef.value?.getModifiedEditor();

    if (!modifiedEditor) {
        clearDiffActionZones(undefined);
        return;
    }

    clearDiffActionZones(modifiedEditor);

    const visibleActionZones =
        // getActionZoneVisibility() === 'hover' ? (props.actionZones ?? []) : (props.actionZones ?? []);
        getActionZoneVisibility() === 'hover' ? (props.actionZones ?? []).filter((zone) => zone.id === hoveredActionZoneId.value) : (props.actionZones ?? []);

    const nextZones = visibleActionZones
        .filter((zone) => zone.actions.length > 0)
        .map((zone) => ({
            zone: createDiffActionZone(zone),
            afterLineNumber: Math.max(0, zone.afterLineNumber),
        }));

    if (!nextZones.length) {
        return;
    }

    modifiedEditor.changeViewZones((accessor) => {
        nextZones.forEach(({ zone, afterLineNumber }) => {
            zone.zoneId = accessor.addZone({
                afterLineNumber,
                heightInPx: 0,
                suppressMouseDown: true,
                domNode: zone.domNode,
            });
        });
    });

    diffActionZoneRefs.value = nextZones.map(({ zone }) => zone);
}

function applyStableDiffOptions() {
    const diffEditor = diffEditorRef.value;

    if (!diffEditor) {
        return;
    }

    diffEditor.updateOptions(diffOptions.value);
    diffEditor.getOriginalEditor().updateOptions({
        hover: {
            enabled: false,
        },
    });
    diffEditor.getModifiedEditor().updateOptions({
        hover: {
            enabled: false,
        },
    });
    syncDiffActionZones();

    if (props.revealLine && props.revealLine > 0) {
        diffEditor.getModifiedEditor().revealLineInCenter(props.revealLine);
    }

    diffEditor.layout();
}

function disposeDiffEditor() {
    clearDiffActionZones();
    clearDiffEditorListeners();
    clearDiffComputationListeners();
    clearPendingHoveredActionZoneClear();
    hoveredActionZoneId.value = undefined;
    hoveringActionZone.value = false;

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

async function ensureDiffEditor() {
    if (!isDiffEditor.value || !diffContainerRef.value || diffEditorRef.value) {
        return;
    }

    const monaco = await getMonacoModule();

    configureMonaco(monaco);
    monaco.editor.setTheme('vs-dark');

    diffEditorRef.value = monaco.editor.createDiffEditor(diffContainerRef.value, {
        ...diffOptions.value,
    });

    createDiffModels();
    diffEditorRef.value.setModel({
        original: originalModelRef.value!,
        modified: modifiedModelRef.value!,
    });

    const originalEditor = diffEditorRef.value.getOriginalEditor();
    const modifiedEditor = diffEditorRef.value.getModifiedEditor();
    diffEditorListenersRef.value = [...createDiffHoverListener(originalEditor, 'original'), ...createDiffHoverListener(modifiedEditor, 'modified')];
    diffComputationListenersRef.value = [
        diffEditorRef.value.onDidUpdateDiff(() => {
            applyStableDiffOptions();
        }),
    ];
}

async function syncDiffEditor() {
    const requestId = ++syncDiffRequestId;

    if (!isDiffEditor.value) {
        disposeDiffEditor();
        return;
    }

    await ensureDiffEditor();

    if (requestId !== syncDiffRequestId || !originalModelRef.value || !modifiedModelRef.value) {
        return;
    }

    const nextLanguage = finalLanguage.value;
    const nextOriginal = props.original ?? '';
    const nextModified = props.modified ?? '';

    if (originalModelRef.value.getLanguageId() !== nextLanguage) {
        monacoModuleRef.value?.editor.setModelLanguage(originalModelRef.value, nextLanguage);
    }

    if (modifiedModelRef.value.getLanguageId() !== nextLanguage) {
        monacoModuleRef.value?.editor.setModelLanguage(modifiedModelRef.value, nextLanguage);
    }

    if (originalModelRef.value.getValue() !== nextOriginal) {
        originalModelRef.value.setValue(nextOriginal);
    }

    if (modifiedModelRef.value.getValue() !== nextModified) {
        modifiedModelRef.value.setValue(nextModified);
    }

    if (requestId !== syncDiffRequestId) {
        return;
    }

    applyStableDiffOptions();
}

async function syncEditor() {
    if (isDiffEditor.value) {
        disposeEditor();
        return;
    }

    await ensureEditor();

    if (!modelRef.value || !editorRef.value) {
        return;
    }

    const nextValue = modelValue.value ?? '';
    const nextLanguage = finalLanguage.value;

    if (modelRef.value.getLanguageId() !== nextLanguage) {
        monacoModuleRef.value?.editor.setModelLanguage(modelRef.value, nextLanguage);
    }

    if (modelRef.value.getValue() !== nextValue) {
        applyingExternalValue = true;
        modelRef.value.setValue(nextValue);
        applyingExternalValue = false;
    }

    editorRef.value.updateOptions(options.value);
    editorRef.value.layout();
}

const finalLanguage = computed(() => {
    return getMonacoLanguage(props.language, props.pathForLanguage);
});

const options = computed(() => {
    return createMonacoOptions({
        readonly: props.readonly,
        fontSize: settings.state.diffFontSize,
    }) as MonacoEditorModule.editor.IStandaloneEditorConstructionOptions;
});

const diffOptions = computed(() => {
    return {
        ...options.value,
        hideUnchangedRegions: {
            enabled: props.diffViewMode === 'changes',
        },
        hover: {
            enabled: false,
        },
        ignoreTrimWhitespace: !props.showWhitespaceChanges,
    } satisfies MonacoEditorModule.editor.IDiffEditorConstructionOptions;
});

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
        props.showWhitespaceChanges,
        props.revealLine,
        props.actionZones,
    ],
    () => {
        void syncEditor();
        void syncDiffEditor();
    },
);

onMounted(() => {
    void syncEditor();
    void syncDiffEditor();
});

onUnmounted(() => {
    clearPendingHoveredActionZoneClear();
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

        <div v-if="isDiffEditor" ref="diffContainerRef" class="w-full min-h-40 flex-1" :class="props.class" />
        <div v-else ref="editorContainerRef" class="w-full min-h-40 flex-1" :class="props.class" />
    </div>
</template>

<style>
.monaco-diff-actions-container {
    display: block !important;
    height: 0 !important;
    overflow: visible !important;
    pointer-events: auto;
    position: relative;
    z-index: 55;
}

.monaco-diff-actions {
    display: inline-flex !important;
    align-items: center;
    gap: 0.2rem;
    flex-wrap: wrap;
    background: #0b4983;
    border: 1px solid #1274cf;
    border-radius: 0.35rem;
    pointer-events: auto;
    position: relative;
    z-index: 55;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    width: fit-content !important;
    transform: translateY(calc(-100% - 1px));
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
</style>
