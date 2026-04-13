<script setup lang="ts">
import type * as MonacoEditorModule from 'monaco-editor';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { MergeConflictBlock } from '../lib/mergeConflicts';
import { parseMergeConflictBlocks, resolveMergeConflictBlock } from '../lib/mergeConflicts';
import { configureMonaco, configureMonacoEnvironment, createMonacoOptions, getMonacoLanguage, getMonacoModule } from '../lib/monaco';
import Button from './Button.vue';
import MonacoEditor from './MonacoEditor.vue';

const modelValue = defineModel<string>({ required: true });

const props = defineProps<{
    readonly?: boolean;
    pathForLanguage?: string;
    language?: string;
    fontSize?: number;
}>();

const emit = defineEmits<{
    'conflict-count-change': [count: number];
}>();

type ConflictActionZone = {
    domNode: HTMLDivElement;
    zoneId: string | undefined;
    afterLineNumber: number;
    dispose: () => void;
};

configureMonacoEnvironment();

const editorContainerRef = ref<HTMLDivElement>();
const editorRef = shallowRef<MonacoEditorModule.editor.IStandaloneCodeEditor>();
const modelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
const monacoModuleRef = shallowRef<typeof import('monaco-editor')>();
const decorationIdsRef = ref<string[]>([]);
const zoneRefs = ref<ConflictActionZone[]>([]);
const applyingExternalValue = ref(false);
const comparedBlockIndex = ref<number>();

const finalLanguage = computed(() => getMonacoLanguage(props.language, props.pathForLanguage));
const editorOptions = computed(() =>
    createMonacoOptions({
        readonly: props.readonly,
        fontSize: props.fontSize,
    })
);
const conflictBlocks = computed(() => getConflictBlocks());
const comparedBlock = computed(() => {
    if (comparedBlockIndex.value === undefined) {
        return undefined;
    }

    return conflictBlocks.value.find((block) => block.index === comparedBlockIndex.value) ?? undefined;
});

function getEditorContent() {
    return modelRef.value?.getValue() ?? modelValue.value;
}

function getConflictBlocks() {
    return parseMergeConflictBlocks(getEditorContent());
}

function emitConflictCount() {
    emit('conflict-count-change', getConflictBlocks().length);
}

function clearZones() {
    const editor = editorRef.value;
    if (editor && zoneRefs.value.length > 0) {
        editor.changeViewZones((accessor) => {
            zoneRefs.value.forEach((zone) => {
                if (zone.zoneId) {
                    accessor.removeZone(zone.zoneId);
                }
                zone.dispose();
            });
        });
    } else {
        zoneRefs.value.forEach((zone) => {
            zone.dispose();
        });
    }

    zoneRefs.value = [];
}

function applyConflictResolution(blockIndex: number, resolution: 'current' | 'incoming' | 'both') {
    const editor = editorRef.value;
    const model = modelRef.value;

    if (!editor || !model) {
        return;
    }

    const block = parseMergeConflictBlocks(model.getValue()).find((entry) => entry.index === blockIndex);
    if (!block) {
        return;
    }

    const nextValue = resolveMergeConflictBlock(model.getValue(), block, resolution);
    model.pushEditOperations(
        [],
        [
            {
                range: model.getFullModelRange(),
                text: nextValue,
            },
        ],
        () => null
    );

    comparedBlockIndex.value = undefined;
    modelValue.value = nextValue;
    syncEditorChrome();
    editor.focus();
}

function createZone(block: MergeConflictBlock): ConflictActionZone {
    const domNode = document.createElement('div');
    domNode.className = 'merge-conflict-actions';
    domNode.style.pointerEvents = 'auto';

    const actions: Array<{
        label: string;
        action: 'current' | 'incoming' | 'both' | 'compare';
    }> = [
        { label: 'Accept Mine', action: 'current' },
        { label: 'Accept Incoming', action: 'incoming' },
        { label: 'Accept Both', action: 'both' },
        { label: 'Compare Changes', action: 'compare' },
    ];

    const listeners = actions.map(({ label, action }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'merge-conflict-actions__button';
        button.textContent = label;
        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (action === 'compare') {
                comparedBlockIndex.value = block.index;
                return;
            }

            applyConflictResolution(block.index, action);
        });
        domNode.appendChild(button);

        return () => button.remove();
    });

    const domNode2 = document.createElement('div');
    domNode2.classList.add('merge-conflict-actions-container');
    domNode2.appendChild(domNode);
    return {
        domNode: domNode2,
        zoneId: undefined,
        afterLineNumber: Math.max(0, block.startLine - 1),
        dispose() {
            listeners.forEach((cleanup) => cleanup());
            domNode2.remove();
        },
    };
}

function applyEditorDecorations(blocks: MergeConflictBlock[]) {
    const editor = editorRef.value;
    const model = modelRef.value;
    const monaco = monacoModuleRef.value;

    if (!editor || !model || !monaco) {
        return;
    }

    const getContentEndLineNumber = (endOffsetExclusive: number, fallbackLineNumber: number) => {
        if (endOffsetExclusive <= 0) {
            return fallbackLineNumber;
        }

        return model.getPositionAt(endOffsetExclusive - 1).lineNumber;
    };

    const nextDecorations = blocks.flatMap((block) => {
        const currentHeaderLineNumber = block.startLine;
        const currentStart = model.getPositionAt(block.currentStartOffset);
        const currentEndLineNumber = getContentEndLineNumber(block.currentEndOffset, currentStart.lineNumber);
        const incomingStart = model.getPositionAt(block.incomingStartOffset);
        const incomingEndLineNumber = getContentEndLineNumber(block.incomingEndOffset, incomingStart.lineNumber);
        const incomingHeaderLineNumber = model.getPositionAt(block.incomingHeaderStartOffset).lineNumber;

        return [
            {
                range: new monaco.Range(block.startLine, 1, block.endLine, 1),
                options: {
                    isWholeLine: true,
                    linesDecorationsClassName: 'merge-conflict-gutter',
                    overviewRuler: {
                        color: 'rgba(255, 196, 88, 0.95)',
                        position: monaco.editor.OverviewRulerLane.Full,
                    },
                },
            },
            {
                range: new monaco.Range(
                    currentHeaderLineNumber,
                    model.getLineMaxColumn(currentHeaderLineNumber),
                    currentHeaderLineNumber,
                    model.getLineMaxColumn(currentHeaderLineNumber)
                ),
                options: {
                    afterContentClassName: 'merge-conflict-inline-hint merge-conflict-inline-hint--mine',
                },
            },
            {
                range: new monaco.Range(currentStart.lineNumber, 1, currentEndLineNumber, model.getLineMaxColumn(currentEndLineNumber)),
                options: {
                    isWholeLine: true,
                    className: 'merge-conflict-current-block',
                    overviewRuler: {
                        color: 'rgba(46, 160, 67, 0.75)',
                        position: monaco.editor.OverviewRulerLane.Left,
                    },
                },
            },
            {
                range: new monaco.Range(incomingStart.lineNumber, 1, incomingEndLineNumber, model.getLineMaxColumn(incomingEndLineNumber)),
                options: {
                    isWholeLine: true,
                    className: 'merge-conflict-incoming-block',
                    overviewRuler: {
                        color: 'rgba(56, 139, 253, 0.78)',
                        position: monaco.editor.OverviewRulerLane.Right,
                    },
                },
            },
            {
                range: new monaco.Range(
                    incomingHeaderLineNumber,
                    model.getLineMaxColumn(incomingHeaderLineNumber),
                    incomingHeaderLineNumber,
                    model.getLineMaxColumn(incomingHeaderLineNumber)
                ),
                options: {
                    afterContentClassName: 'merge-conflict-inline-hint merge-conflict-inline-hint--incoming',
                },
            },
        ];
    });

    decorationIdsRef.value = editor.deltaDecorations(decorationIdsRef.value, nextDecorations);
}

function syncEditorChrome() {
    const editor = editorRef.value;
    const blocks = getConflictBlocks();

    if (!editor) {
        emit('conflict-count-change', blocks.length);
        return;
    }

    clearZones();
    const nextZones = blocks.map((block) => createZone(block));
    editor.changeViewZones((accessor) => {
        nextZones.forEach((zone) => {
            zone.zoneId = accessor.addZone({
                afterLineNumber: zone.afterLineNumber,
                heightInPx: 32,
                suppressMouseDown: true,
                domNode: zone.domNode,
            });
        });
    });
    zoneRefs.value = nextZones;
    applyEditorDecorations(blocks);
    emit('conflict-count-change', blocks.length);

    if (comparedBlockIndex.value !== undefined && !blocks.some((block) => block.index === comparedBlockIndex.value)) {
        comparedBlockIndex.value = undefined;
    }
}

async function ensureEditor() {
    if (!editorContainerRef.value || editorRef.value) {
        return;
    }

    const monaco = await getMonacoModule();
    monacoModuleRef.value = monaco;
    configureMonaco(monaco);
    monaco.editor.setTheme('vs-dark');

    modelRef.value = monaco.editor.createModel(modelValue.value, finalLanguage.value);
    editorRef.value = monaco.editor.create(editorContainerRef.value, editorOptions.value);
    editorRef.value.setModel(modelRef.value);

    modelRef.value.onDidChangeContent(() => {
        if (applyingExternalValue.value) {
            return;
        }

        modelValue.value = modelRef.value?.getValue() ?? '';
        syncEditorChrome();
    });

    syncEditorChrome();
}

function disposeEditor() {
    decorationIdsRef.value = [];
    clearZones();
    editorRef.value?.dispose();
    modelRef.value?.dispose();
    editorRef.value = undefined;
    modelRef.value = undefined;
}

watch(
    () => modelValue.value,
    (nextValue) => {
        if (!modelRef.value || modelRef.value.getValue() === nextValue) {
            emitConflictCount();
            return;
        }

        applyingExternalValue.value = true;
        modelRef.value.setValue(nextValue);
        applyingExternalValue.value = false;
        syncEditorChrome();
    }
);

watch(
    () => [props.fontSize, props.readonly],
    () => {
        editorRef.value?.updateOptions(editorOptions.value);
    }
);

watch(finalLanguage, (nextLanguage) => {
    if (!modelRef.value || !monacoModuleRef.value) {
        return;
    }

    monacoModuleRef.value.editor.setModelLanguage(modelRef.value, nextLanguage);
});

onMounted(() => {
    void ensureEditor();
});

onUnmounted(() => {
    disposeEditor();
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2">
        <div ref="editorContainerRef" class="min-h-0 flex-1 border border-x7 rounded-sm" />
        <div v-if="comparedBlock" class="border border-x7 bg-x2 rounded-sm min-h-40">
            <MonacoEditor
                title="Compare my and incoming changes for this conflict"
                :original="comparedBlock.current"
                :modified="comparedBlock.incoming"
                :path-for-language="props.pathForLanguage"
                :font-size="props.fontSize"
                readonly
            >
                <template #before-settings-button>
                    <Button severity="light" smaller @click="comparedBlockIndex = undefined"> Close Compare </Button>
                </template>
            </MonacoEditor>
        </div>
    </div>
</template>

<style>
.merge-conflict-actions-container {
    display: flex !important;
    place-items: end;
}

.merge-conflict-actions {
    display: inline-flex !important;
    align-items: center;
    background: #0b4983;
    border: 1px solid #1274cf;
    border-radius: 0.35rem;
    pointer-events: auto;
    position: relative;
    z-index: 2;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    width: fit-content !important;
}

.merge-conflict-actions__button {
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

.merge-conflict-actions__button:hover {
    background: #008cff;
    color: #fff4e6;
}

.merge-conflict-current-block {
    background: rgba(46, 160, 67, 0.15);
}

.merge-conflict-incoming-block {
    background: rgba(56, 139, 253, 0.16);
}

.merge-conflict-gutter {
    border-left: 3px solid rgba(255, 196, 88, 0.8);
    margin-left: 4px;
}

.merge-conflict-inline-hint {
    opacity: 0.58;
    font-style: italic;
}

.merge-conflict-inline-hint::after {
    content: '';
    margin-left: 0.35rem;
}

.merge-conflict-inline-hint--mine {
    color: rgba(166, 227, 184, 0.8);
}

.merge-conflict-inline-hint--mine::after {
    content: '(My Change)';
}

.merge-conflict-inline-hint--incoming {
    color: rgba(157, 197, 255, 0.8);
}

.merge-conflict-inline-hint--incoming::after {
    content: '(Incoming Change)';
}
</style>
