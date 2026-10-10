<script setup lang="ts">
import type * as MonacoEditorModule from 'monaco-editor';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useSettings } from '../composables/useSettings';
import { configureMonaco, configureMonacoEnvironment, createMonacoOptions, getMonacoLanguage, getMonacoModule as loadMonacoModule } from '../lib/monaco';
import MonacoEditorSettingsButton from './MonacoEditorSettingsButton.vue';

type MonacoModule = typeof MonacoEditorModule;
configureMonacoEnvironment();

const modelValue = defineModel<string>();
const props = defineProps<{
    title?: string;
    noHead?: boolean;
    readonly?: boolean;
    class?: string;
    language?: string;
    pathForLanguage?: string;
}>();
const settings = useSettings();

const editorContainerRef = ref<HTMLDivElement>();
const monacoModuleRef = shallowRef<MonacoModule>();
const editorRef = shallowRef<MonacoEditorModule.editor.IStandaloneCodeEditor>();
const modelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
let applyingExternalValue = false;
let isCreatingEditor = false;
// Set while the editor's own `onDidChangeContent` is the reason `modelValue` changed, so the
// watcher can skip the full-model comparison and copy it would otherwise do per keystroke.
let valueWrittenByEditor = false;

async function getMonacoModule() {
    if (!monacoModuleRef.value) {
        monacoModuleRef.value = await loadMonacoModule();
    }
    return monacoModuleRef.value;
}

async function ensureEditor() {
    // The module loads asynchronously, and Vue can fire both the mount and the sync watcher before
    // it resolves. Without this guard each of them creates an editor and the extra one is orphaned.
    if (!editorContainerRef.value || editorRef.value || isCreatingEditor) return;

    isCreatingEditor = true;

    try {
        const monaco = await getMonacoModule();
        configureMonaco(monaco);
        monaco.editor.setTheme('vs-dark');
        modelRef.value = monaco.editor.createModel(modelValue.value ?? '', finalLanguage.value);
        editorRef.value = monaco.editor.create(editorContainerRef.value, options.value);
        editorRef.value.setModel(modelRef.value);
        modelRef.value.onDidChangeContent(() => {
            if (applyingExternalValue) return;
            valueWrittenByEditor = true;
            modelValue.value = modelRef.value?.getValue() ?? '';
        });
    } finally {
        isCreatingEditor = false;
    }
}

function disposeEditor() {
    editorRef.value?.dispose();
    modelRef.value?.dispose();
    editorRef.value = undefined;
    modelRef.value = undefined;
}

async function syncEditor() {
    await ensureEditor();
    if (!modelRef.value || !editorRef.value) return;
    const nextValue = modelValue.value ?? '';
    const nextLanguage = finalLanguage.value;
    if (modelRef.value.getLanguageId() !== nextLanguage) monacoModuleRef.value?.editor.setModelLanguage(modelRef.value, nextLanguage);

    const editorOwnsValue = valueWrittenByEditor;
    valueWrittenByEditor = false;

    if (!editorOwnsValue && modelRef.value.getValue() !== nextValue) {
        applyingExternalValue = true;
        modelRef.value.setValue(nextValue);
        applyingExternalValue = false;
    }
}

const finalLanguage = computed(() => getMonacoLanguage(props.language, props.pathForLanguage));

const options = computed(
    () =>
        createMonacoOptions({
            readonly: props.readonly,
            fontSize: settings.state.diffFontSize,
        }) as MonacoEditorModule.editor.IStandaloneEditorConstructionOptions
);

// Getter sources, not one getter returning an array: a fresh array would re-run the sync for any
// dependency change, including a settings object the parent replaced with the same values. The
// font size is handled by the options watcher, which is the only thing `updateOptions` needs.
watch([() => modelValue.value, () => props.language, () => props.pathForLanguage, () => props.readonly], () => {
    void syncEditor();
});

// `automaticLayout` keeps the editor sized, so no explicit `layout()` is needed here.
watch(options, (nextOptions) => {
    editorRef.value?.updateOptions(nextOptions);
});

onMounted(() => {
    void syncEditor();
});
onUnmounted(() => {
    disposeEditor();
});
</script>

<template>
    <div class="h-full flex flex-col relative">
        <div v-if="!props.noHead" class="flex items-center border-b border-x5 px-2 py-1.5 text-xs font-medium gap-1">
            <div class="line-clamp-1 flex-1 text-white">{{ title || pathForLanguage }}</div>

            <slot name="before-settings-button"></slot>

            <MonacoEditorSettingsButton hide-diff-options />
        </div>

        <div ref="editorContainerRef" class="w-full min-h-40 flex-1" :class="props.class" />
    </div>
</template>
