<script setup lang="ts">
import { type MonacoEditor, VueMonacoEditor } from '@guolao/vue-monaco-editor';
import type * as MonacoEditorModule from 'monaco-editor';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { configureMonaco, configureMonacoEnvironment, createMonacoOptions, getMonacoLanguage, getMonacoModule as loadMonacoModule } from '../lib/monaco';
import { useSettings } from '../composables/useSettings';
import IconButton from './IconButton.vue';

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
const diffFontSize = computed(() => settings.state.diffFontSize);

const diffContainerRef = ref<HTMLDivElement>();
const monacoModuleRef = shallowRef<MonacoModule>();
const diffEditorRef = shallowRef<MonacoEditorModule.editor.IStandaloneDiffEditor>();
const originalModelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
const modifiedModelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
let syncDiffRequestId = 0;

const isDiffEditor = computed(() => props.original !== undefined && props.modified !== undefined);

async function getMonacoModule() {
    if (!monacoModuleRef.value) {
        monacoModuleRef.value = await loadMonacoModule();
    }

    return monacoModuleRef.value;
}

function beforeMount(monaco: MonacoEditor) {
    configureMonaco(monaco);
}

function onMount(_editor: unknown, _monaco: MonacoEditor) {}

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

const finalLanguage = computed(() => {
    return getMonacoLanguage(props.language, props.pathForLanguage);
});

const options = computed(() => {
    return createMonacoOptions({
        readonly: props.readonly,
        fontSize: diffFontSize.value,
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
        props.original,
        props.modified,
        props.language,
        props.pathForLanguage,
        isDiffEditor.value,
        props.readonly,
        diffFontSize.value,
        props.diffViewMode,
        props.showWhitespaceChanges,
    ],
    () => {
        void syncDiffEditor();
    },
);

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
    void syncDiffEditor();
});

onUnmounted(() => {
    disposeDiffEditor();
    document.removeEventListener('keydown', onDocumentKeyDown);
    document.removeEventListener('mousedown', onDocumentPointerDown);
});
</script>

<template>
    <div class="h-full flex flex-col relative">
        <div v-if="!props.noHead" class="flex items-center border-b border-x5 px-2 py-1.5 text-xs font-medium gap-1">
            <div class="line-clamp-1 flex-1 text-white">{{ title || pathForLanguage }}</div>

            <slot name="before-settings-button"></slot>

            <div ref="diffSettingsRef" class="relative flex items-center gap-1">
                <IconButton icon="icon-[mdi--tune-variant]" smaller aria-haspopup="dialog" v-tooltip="'Diff settings'" @click.stop="toggleDiffSettings">
                    <span class="icon icon-[mdi--tune-variant]"></span>
                </IconButton>
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
                                <!-- <span class="rounded border border-white/10 px-1.5 py-0.5 text-xs text-white/70">{{ diffFontSize }}</span> -->
                            </div>
                            <div class="flex items-center gap-2">
                                <input
                                    :value="diffFontSize"
                                    type="range"
                                    min="10"
                                    max="24"
                                    step="1"
                                    class="w-full accent-white"
                                    @input="settings.setDiffFontSize(Number(($event.target as HTMLInputElement).value))"
                                />
                                <input
                                    :value="diffFontSize"
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
                                    :checked="diffViewMode === 'changes'"
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
                                    :checked="!showWhitespaceChanges"
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
        </div>

        <div v-if="isDiffEditor" ref="diffContainerRef" class="w-full min-h-40 flex-1" :class="props.class" />
        <VueMonacoEditor
            v-else
            v-model:value="modelValue"
            theme="vs-dark"
            :language="finalLanguage"
            :options="options"
            @beforeMount="beforeMount"
            @mount="onMount"
            class="w-full min-h-40 flex-1"
            :class="props.class"
        />
    </div>
</template>
