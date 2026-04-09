<script setup lang="ts">
import type * as MonacoEditorModule from 'monaco-editor';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useSettings } from '../composables/useSettings';
import { configureMonaco, configureMonacoEnvironment, createMonacoOptions, getMonacoLanguage, getMonacoModule as loadMonacoModule } from '../lib/monaco';
import MonacoEditorSettingsButton from './MonacoEditorSettingsButton.vue';

type MonacoModule = typeof import('monaco-editor');

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

function disposeDiffEditor() {
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

    diffEditorRef.value?.updateOptions(diffOptions.value);
    diffEditorRef.value?.layout();
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
