<script setup lang="ts">
import type * as MonacoEditorModule from 'monaco-editor';
import type * as MonacoModuleType from 'monaco-editor';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { MergeConflictBlock } from '../lib/mergeConflicts';
import { parseMergeConflictBlocks, resolveMergeConflictBlock } from '../lib/mergeConflicts';
import { configureMonaco, configureMonacoEnvironment, createMonacoOptions, getMonacoLanguage, getMonacoModule } from '../lib/monaco';
import Button from './Button.vue';
import DiffsDiffEditor from './DiffsDiffEditor.vue';
type MonacoModule = typeof MonacoModuleType;

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
    /** The conflict text the zone was built for; an edited conflict gets a fresh zone. */
    signature: string;
    /** The block this zone's buttons act on, updated when an earlier conflict is resolved. */
    blockIndex: number;
    afterLineNumber: number;
    zoneId: string | undefined;
    viewZone: MonacoModuleType.editor.IViewZone | undefined;
    domNode: HTMLDivElement;
    dispose: () => void;
};

const conflictActions: Array<{ label: string; action: 'current' | 'incoming' | 'both' | 'compare' }> = [
    { label: 'Accept Mine', action: 'current' },
    { label: 'Accept Incoming', action: 'incoming' },
    { label: 'Accept Both', action: 'both' },
    { label: 'Compare Changes', action: 'compare' },
];

configureMonacoEnvironment();

const editorContainerRef = ref<HTMLDivElement>();
const editorRef = shallowRef<MonacoEditorModule.editor.IStandaloneCodeEditor>();
const modelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
const monacoModuleRef = shallowRef<MonacoModule>();
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
    scheduleEditorChromeSync();
    editor.focus();
}

function createZone(block: MergeConflictBlock): ConflictActionZone {
    const actionsNode = document.createElement('div');
    actionsNode.className = 'merge-conflict-actions';
    actionsNode.style.pointerEvents = 'auto';

    const wrapper = document.createElement('div');
    wrapper.classList.add('merge-conflict-actions-container');
    wrapper.appendChild(actionsNode);

    const listeners: Array<() => void> = [];
    const zone: ConflictActionZone = {
        signature: block.fullMatch,
        blockIndex: block.index,
        afterLineNumber: Math.max(0, block.startLine - 1),
        zoneId: undefined,
        viewZone: undefined,
        domNode: wrapper,
        dispose() {
            listeners.forEach((cleanup) => cleanup());
            wrapper.remove();
        },
    };

    for (const { label, action } of conflictActions) {
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
                comparedBlockIndex.value = zone.blockIndex;
                return;
            }

            // The block is re-read from the model, so a stale index would still be wrong; the
            // zone keeps its target index current across edits above it.
            applyConflictResolution(zone.blockIndex, action);
        });
        actionsNode.appendChild(button);

        listeners.push(() => button.remove());
    }

    return zone;
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

    // Zones are matched to conflicts by their content, so an unchanged conflict keeps its
    // buttons and their listeners; only its anchor line has to move.
    const reusableBySignature = new Map<string, ConflictActionZone[]>();
    for (const zone of zoneRefs.value) {
        const queue = reusableBySignature.get(zone.signature);

        if (queue) {
            queue.push(zone);
        } else {
            reusableBySignature.set(zone.signature, [zone]);
        }
    }

    const nextZones: ConflictActionZone[] = [];
    const removedZones: ConflictActionZone[] = [];

    editor.changeViewZones((accessor) => {
        for (const block of blocks) {
            const afterLineNumber = Math.max(0, block.startLine - 1);
            const reused = reusableBySignature.get(block.fullMatch)?.shift();

            if (reused) {
                reused.blockIndex = block.index;

                if (reused.afterLineNumber !== afterLineNumber && reused.viewZone && reused.zoneId) {
                    reused.afterLineNumber = afterLineNumber;
                    reused.viewZone.afterLineNumber = afterLineNumber;
                    accessor.layoutZone(reused.zoneId);
                }

                nextZones.push(reused);
                continue;
            }

            const zone = createZone(block);
            zone.viewZone = {
                afterLineNumber,
                heightInPx: 32,
                suppressMouseDown: true,
                domNode: zone.domNode,
            };
            zone.zoneId = accessor.addZone(zone.viewZone);
            nextZones.push(zone);
        }

        // Whatever is left belongs to a conflict that is gone.
        for (const queue of reusableBySignature.values()) {
            for (const zone of queue) {
                if (zone.zoneId) {
                    accessor.removeZone(zone.zoneId);
                }

                removedZones.push(zone);
            }
        }
    });

    removedZones.forEach((zone) => zone.dispose());
    zoneRefs.value = nextZones;
    applyEditorDecorations(blocks);
    emit('conflict-count-change', blocks.length);

    if (comparedBlockIndex.value !== undefined && !blocks.some((block) => block.index === comparedBlockIndex.value)) {
        comparedBlockIndex.value = undefined;
    }
}

let chromeFrameHandle: number | undefined;

/** One chrome sync per frame, so typing does not re-parse and re-zone per keystroke. */
function scheduleEditorChromeSync() {
    if (chromeFrameHandle !== undefined) {
        return;
    }

    chromeFrameHandle = requestAnimationFrame(() => {
        chromeFrameHandle = undefined;
        syncEditorChrome();
    });
}

function cancelScheduledEditorChromeSync() {
    if (chromeFrameHandle !== undefined) {
        cancelAnimationFrame(chromeFrameHandle);
        chromeFrameHandle = undefined;
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
        scheduleEditorChromeSync();
    });

    syncEditorChrome();
}

function disposeEditor() {
    cancelScheduledEditorChromeSync();
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
        scheduleEditorChromeSync();
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
        <div v-if="comparedBlock" class="min-h-40 overflow-hidden rounded-sm border border-x7 bg-x2">
            <div class="flex items-center gap-2 border-b border-x7 px-2 py-1.5 text-xs font-medium">
                <div class="flex-1 text-white">Compare my and incoming changes for this conflict</div>
                <Button severity="light" smaller @click="comparedBlockIndex = undefined"> Close Compare </Button>
            </div>
            <DiffsDiffEditor
                :original="comparedBlock.current"
                :modified="comparedBlock.incoming"
                :path-for-language="props.pathForLanguage"
                diff-view-mode="full-file"
                diff-ignored-chars=""
                :show-whitespace-changes="true"
                readonly
                class="min-h-40"
            />
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
