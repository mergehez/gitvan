<script setup lang="ts">
import { FileDiff, parseDiffFromFile, type FileContents, type FileDiffMetadata } from '@pierre/diffs';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useSettings } from '../composables/useSettings';
import { normalizeComparableDiffText } from '../lib/diffIgnoredChars';
import type { MonacoEditorActionZone } from './monacoEditorTypes';

type ActionZoneVisibility = 'always' | 'hover';

type CenteredActionZoneLayout = {
    id: string;
    left: number;
    top: number;
    zone: MonacoEditorActionZone;
};

const emit = defineEmits<{
    visibleDiffChange: [hasVisibleChanges: boolean | undefined];
}>();

const props = defineProps<{
    readonly?: boolean;
    class?: string;
    pathForLanguage?: string;
    original?: string;
    modified?: string;
    diffViewMode?: 'changes' | 'full-file';
    diffIgnoredChars?: string;
    showWhitespaceChanges?: boolean;
    revealLine?: number;
    actionZones?: MonacoEditorActionZone[];
    actionZoneVisibility?: ActionZoneVisibility;
}>();

const settings = useSettings();

const rootRef = ref<HTMLDivElement>();
const renderHostRef = ref<HTMLDivElement>();
const fileDiffRef = shallowRef<FileDiff>();
const renderedNodeRef = shallowRef<HTMLElement>();
const resizeObserverRef = shallowRef<ResizeObserver>();
const shadowMutationObserverRef = shallowRef<MutationObserver>();
const shadowScrollCleanupRef = shallowRef<Array<() => void>>([]);
const centeredActionZoneLayouts = ref<CenteredActionZoneLayout[]>([]);
const hoveredActionZoneId = ref<string>();
const hoveringActionZone = ref(false);
let pendingHoveredActionZoneClearTimeout: ReturnType<typeof setTimeout> | undefined;
let pendingLayoutSyncFrame = 0;
let pendingLayoutRetryTimeout: ReturnType<typeof setTimeout> | undefined;

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

function setHoveredActionZone(nextZoneId: string | undefined) {
    if (nextZoneId !== undefined) {
        clearPendingHoveredActionZoneClear();
    }

    if (hoveredActionZoneId.value === nextZoneId) {
        return;
    }

    hoveredActionZoneId.value = nextZoneId;
}

function getActionZoneVisibility(): ActionZoneVisibility {
    return props.actionZoneVisibility ?? 'always';
}

function createFile(name: string, contents: string): FileContents {
    return { name, contents };
}

function createRenderedDiff(name: string, original: string, modified: string, ignoredChars: string, showWhitespaceChanges: boolean) {
    const rawDiff = parseDiffFromFile(createFile(name, original), createFile(name, modified));
    const normalizedOriginal = normalizeComparableDiffText(original, ignoredChars, !showWhitespaceChanges);
    const normalizedModified = normalizeComparableDiffText(modified, ignoredChars, !showWhitespaceChanges);
    const visibleDiff = parseDiffFromFile(createFile(name, normalizedOriginal), createFile(name, normalizedModified));

    if (visibleDiff.hunks.length === 0) {
        return {
            renderedDiff: rawDiff,
            hasVisibleChanges: false,
            hideDecorations: original !== modified,
        };
    }

    const renderedDiff: FileDiffMetadata = {
        ...visibleDiff,
        name: rawDiff.name,
        prevName: rawDiff.prevName,
        lang: rawDiff.lang,
        newObjectId: rawDiff.newObjectId,
        prevObjectId: rawDiff.prevObjectId,
        mode: rawDiff.mode,
        prevMode: rawDiff.prevMode,
        type: rawDiff.type,
        additionLines: rawDiff.additionLines,
        deletionLines: rawDiff.deletionLines,
        cacheKey: rawDiff.cacheKey,
    };

    return {
        renderedDiff,
        hasVisibleChanges: true,
        hideDecorations: false,
    };
}

const diffState = computed(() => {
    const name = props.pathForLanguage || 'diff.txt';
    const original = props.original ?? '';
    const modified = props.modified ?? '';

    return createRenderedDiff(name, original, modified, props.diffIgnoredChars ?? '', props.showWhitespaceChanges ?? false);
});

const diffOptions = computed(() => {
    const shouldHideDecorations = diffState.value.hideDecorations;

    return {
        theme: 'pierre-dark' as const,
        themeType: 'dark' as const,
        diffStyle: 'split' as const,
        disableFileHeader: true,
        overflow: 'scroll' as const,
        expandUnchanged: props.diffViewMode === 'full-file',
        collapsedContextThreshold: 1,
        hunkSeparators: 'line-info-basic' as const,
        lineDiffType: shouldHideDecorations ? ('none' as const) : ('word-alt' as const),
        diffIndicators: shouldHideDecorations ? ('none' as const) : ('bars' as const),
        disableBackground: shouldHideDecorations,
        useTokenTransformer: true,
        onPostRender(node: HTMLElement) {
            renderedNodeRef.value = node;
            attachShadowObserver(node);
            scheduleActionZoneLayoutSync();
            void revealTargetLine();
        },
    };
});

function scheduleRetrySync() {
    if (pendingLayoutRetryTimeout !== undefined) {
        clearTimeout(pendingLayoutRetryTimeout);
    }

    pendingLayoutRetryTimeout = setTimeout(() => {
        pendingLayoutRetryTimeout = undefined;
        scheduleActionZoneLayoutSync();
    }, 120);
}

const hostStyle = computed(() => ({
    '--diffs-font-size': `${settings.state.diffFontSize}px`,
    '--diffs-font-family': 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    '--diffs-header-font-family': 'ui-sans-serif, system-ui, sans-serif',
    '--diffs-line-height': '1.5',
}));

function getCodeColumn(side: 'original' | 'modified') {
    const shadowRoot = renderedNodeRef.value?.shadowRoot;
    if (!shadowRoot) {
        return undefined;
    }

    return shadowRoot.querySelector<HTMLElement>(side === 'original' ? '[data-deletions]' : '[data-additions]') ?? undefined;
}

function getLineElementsWithinRange(side: 'original' | 'modified', startLineNumber: number, endLineNumber: number) {
    const codeColumn = getCodeColumn(side);
    if (!codeColumn) {
        return [];
    }

    const lineElements: HTMLElement[] = [];
    for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber += 1) {
        const lineElement = codeColumn.querySelector<HTMLElement>(`[data-line="${lineNumber}"]`);
        if (lineElement) {
            lineElements.push(lineElement);
        }
    }

    return lineElements;
}

function getViewportCenterForRange(side: 'original' | 'modified', startLineNumber: number, endLineNumber: number) {
    const root = rootRef.value;
    const lineElements = getLineElementsWithinRange(side, startLineNumber, endLineNumber);

    if (!root || lineElements.length === 0) {
        return undefined;
    }

    const rootRect = root.getBoundingClientRect();
    const firstRect = lineElements[0]!.getBoundingClientRect();
    const lastRect = lineElements[lineElements.length - 1]!.getBoundingClientRect();

    const top = firstRect.top - rootRect.top;
    const bottom = lastRect.bottom - rootRect.top;

    return top + (bottom - top) / 2;
}

function syncActionZoneLayouts() {
    pendingLayoutSyncFrame = 0;

    const root = rootRef.value;
    const originalColumn = getCodeColumn('original');
    const modifiedColumn = getCodeColumn('modified');

    if (!root || !originalColumn || !modifiedColumn || diffState.value.hasVisibleChanges === false) {
        centeredActionZoneLayouts.value = [];
        return;
    }

    const rootRect = root.getBoundingClientRect();
    const scrollTop = root.scrollTop;
    const originalRect = originalColumn.getBoundingClientRect();
    const modifiedRect = modifiedColumn.getBoundingClientRect();
    const seamCenterLeft = Math.round((originalRect.right - rootRect.left + (modifiedRect.left - rootRect.left)) / 2);
    let hasMissingNodes = false;
    const nextLayouts = (props.actionZones ?? [])
        .filter((zone) => zone.actions.length > 0)
        .map((zone) => {
            const modifiedStart = Math.max(1, zone.startLineNumber ?? zone.afterLineNumber + 1);
            const modifiedEnd = Math.max(modifiedStart, zone.endLineNumber ?? modifiedStart);
            const originalStart = Math.max(1, zone.originalStartLineNumber ?? zone.startLineNumber ?? zone.afterLineNumber + 1);
            const originalEnd = Math.max(originalStart, zone.originalEndLineNumber ?? zone.originalStartLineNumber ?? zone.endLineNumber ?? originalStart);
            const originalCenter = getViewportCenterForRange('original', originalStart, originalEnd);
            const modifiedCenter = getViewportCenterForRange('modified', modifiedStart, modifiedEnd);
            if (originalCenter === undefined || modifiedCenter === undefined) {
                hasMissingNodes = true;
            }
            const visibleTop =
                originalCenter !== undefined && modifiedCenter !== undefined
                    ? Math.round((originalCenter + modifiedCenter) / 2)
                    : Math.round(originalCenter ?? modifiedCenter ?? -9999);
            const top = visibleTop + scrollTop;

            return {
                id: zone.id,
                left: seamCenterLeft,
                top,
                zone,
            } satisfies CenteredActionZoneLayout;
        })
        .filter((layout) => layout.top - scrollTop >= -24 && layout.top - scrollTop <= root.clientHeight + 24);

    centeredActionZoneLayouts.value = nextLayouts;

    if (hasMissingNodes) {
        scheduleRetrySync();
    }

    if (hoveredActionZoneId.value && !nextLayouts.some((layout) => layout.id === hoveredActionZoneId.value)) {
        hoveredActionZoneId.value = undefined;
    }
}

function scheduleActionZoneLayoutSync() {
    if (pendingLayoutSyncFrame !== 0) {
        cancelAnimationFrame(pendingLayoutSyncFrame);
    }

    pendingLayoutSyncFrame = requestAnimationFrame(() => syncActionZoneLayouts());
}

function onShadowScroll() {
    scheduleActionZoneLayoutSync();
}

function clearShadowScrollListeners() {
    shadowScrollCleanupRef.value.forEach((cleanup) => {
        cleanup();
    });
    shadowScrollCleanupRef.value = [];
}

function attachShadowScrollListeners(node: HTMLElement) {
    clearShadowScrollListeners();

    const shadowRoot = node.shadowRoot;
    const cleanup: Array<() => void> = [];

    const addScrollListener = (target: EventTarget | undefined, options?: AddEventListenerOptions) => {
        if (!target) {
            return;
        }

        target.addEventListener('scroll', onShadowScroll, options);
        cleanup.push(() => target.removeEventListener('scroll', onShadowScroll, options));
    };

    addScrollListener(node, { passive: true, capture: true });
    addScrollListener(rootRef.value, { passive: true, capture: true });

    if (shadowRoot) {
        addScrollListener(shadowRoot, { passive: true, capture: true });

        const scrollTargets = [
            ...shadowRoot.querySelectorAll<HTMLElement>('[data-deletions], [data-additions], [data-unified]'),
            ...shadowRoot.querySelectorAll<HTMLElement>('pre'),
        ].filter((target, index, targets) => targets.indexOf(target) === index);

        scrollTargets.forEach((target) => {
            addScrollListener(target, { passive: true, capture: true });
        });
    }

    shadowScrollCleanupRef.value = cleanup;
}

function disconnectShadowObserver() {
    shadowMutationObserverRef.value?.disconnect();
    shadowMutationObserverRef.value = undefined;
}

function attachShadowObserver(node: HTMLElement) {
    disconnectShadowObserver();
    attachShadowScrollListeners(node);

    if (!node.shadowRoot) {
        return;
    }

    shadowMutationObserverRef.value = new MutationObserver(() => {
        attachShadowScrollListeners(node);
        scheduleActionZoneLayoutSync();
    });
    shadowMutationObserverRef.value.observe(node.shadowRoot, {
        subtree: true,
        childList: true,
        attributes: true,
    });
}

async function revealTargetLine() {
    await nextTick();

    const revealLine = props.revealLine;
    if (!revealLine || revealLine <= 0) {
        return;
    }

    const lineElement = getCodeColumn('modified')?.querySelector<HTMLElement>(`[data-line="${revealLine}"]`);
    lineElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function ensureDiffInstance() {
    if (!fileDiffRef.value) {
        fileDiffRef.value = new FileDiff(diffOptions.value);
    }

    return fileDiffRef.value;
}

function renderDiff() {
    const host = renderHostRef.value;
    if (!host) {
        return;
    }

    const instance = ensureDiffInstance();
    instance.setOptions(diffOptions.value);
    instance.render({
        fileDiff: diffState.value.renderedDiff,
        containerWrapper: host,
        forceRender: true,
    });
    emit('visibleDiffChange', diffState.value.hasVisibleChanges);
    scheduleActionZoneLayoutSync();
    void revealTargetLine();
}

function cleanUpInstance() {
    fileDiffRef.value?.cleanUp();
    fileDiffRef.value = undefined;
    renderedNodeRef.value = undefined;
}

function handleRootScroll() {
    scheduleActionZoneLayoutSync();
}

onMounted(() => {
    resizeObserverRef.value = new ResizeObserver(() => {
        scheduleActionZoneLayoutSync();
    });
    if (rootRef.value) {
        resizeObserverRef.value.observe(rootRef.value);
        rootRef.value.addEventListener('scroll', handleRootScroll, { passive: true });
    }
    renderDiff();
});

onUnmounted(() => {
    if (pendingLayoutSyncFrame !== 0) {
        cancelAnimationFrame(pendingLayoutSyncFrame);
    }
    if (pendingLayoutRetryTimeout !== undefined) {
        clearTimeout(pendingLayoutRetryTimeout);
        pendingLayoutRetryTimeout = undefined;
    }
    clearPendingHoveredActionZoneClear();
    rootRef.value?.removeEventListener('scroll', handleRootScroll);
    resizeObserverRef.value?.disconnect();
    resizeObserverRef.value = undefined;
    clearShadowScrollListeners();
    disconnectShadowObserver();
    cleanUpInstance();
});

watch(
    () => [props.original, props.modified, props.pathForLanguage, props.diffViewMode, props.diffIgnoredChars, props.showWhitespaceChanges, settings.state.diffFontSize],
    () => {
        renderDiff();
    }
);

watch(
    () => props.revealLine,
    () => {
        void revealTargetLine();
    }
);

watch(
    () => [props.actionZones, props.actionZoneVisibility],
    () => {
        scheduleActionZoneLayoutSync();
    }
);
</script>

<template>
    <div ref="rootRef" data-testid="diffs-diff-editor-root" class="relative w-full min-h-40 flex-1 overflow-y-auto" :class="props.class" :style="hostStyle">
        <div ref="renderHostRef" class="min-h-full gitvan-diffs-host" />
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
                <button
                    type="button"
                    data-testid="diff-hunk-action-trigger"
                    class="monaco-diff-actions-trigger"
                    :title="layout.zone.label ?? 'Change actions'"
                    @mousedown.prevent.stop
                >
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
</template>

<style>
.monaco-diff-actions-overlay {
    position: absolute;
    inset: 0;
    /* overflow: hidden; */
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

.gitvan-diffs-host {
    min-height: 100%;
}
</style>
