<script setup lang="ts">
import {
    FileDiff,
    UnresolvedFile,
    VirtualizedFileDiff,
    Virtualizer,
    parseDiffFromFile,
    type ChangeContent,
    type FileContents,
    type FileDiffMetadata,
    type FileDiffOptions,
    type UnresolvedFileOptions,
} from '@pierre/diffs';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { isJavaScriptTypeScriptPath, normalizeComparableDiffText } from '../../shared/diffIgnoredChars';
import { useSettings } from '../composables/useSettings';
import type { HunkActionsConfig } from '../lib/hunkActions';

const emit = defineEmits<{
    visibleDiffChange: [hasVisibleChanges: boolean | undefined];
}>();

const props = defineProps<{
    readonly?: boolean;
    class?: string;
    pathForLanguage?: string;
    original?: string;
    modified?: string;
    /** Comparable view of both sides, supplied by the owner so they are normalized only once. */
    normalizedOriginal?: string;
    normalizedModified?: string;
    conflictFile?: string;
    diffViewMode?: 'changes' | 'full-file';
    diffIgnoredChars?: string;
    showWhitespaceChanges?: boolean;
    revealLine?: number;
    hunkActionsConfig?: HunkActionsConfig;
}>();

const settings = useSettings();

const scrollRootRef = ref<HTMLDivElement>();
const renderHostRef = ref<HTMLDivElement>();
const fileDiffRef = shallowRef<FileDiff | UnresolvedFile>();
const renderedNodeRef = shallowRef<HTMLElement>();
/** Bumped on every post-render, so anchors are rebuilt when the renderer replaces the node. */
let renderedNodeEpoch = 0;
/**
 * Rows the diff renderer mounts around the viewport. Without it a large diff (a 790 KB JSON is
 * ~14k lines) renders every line and token, which blocks the renderer for seconds and keeps the
 * whole app slow afterwards.
 */
const diffVirtualizer = shallowRef<Virtualizer>();
/** Change blocks beyond this are not anchored: a button per changed line of a 14k-line file is unusable. */
const maxHunkAnchors = 500;
/** Diffs larger than this render through the windowed renderer; smaller ones render whole. */
const virtualizationLineThreshold = 2_000;
const hoveredActionZoneId = ref<string>();
const hoveringActionZone = ref(false);
let pendingHoveredActionZoneClearTimeout: ReturnType<typeof setTimeout> | undefined;

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

function createFile(name: string, contents: string): FileContents {
    return { name, contents };
}

function createRenderedDiff(
    name: string,
    original: string,
    modified: string,
    ignoredChars: string,
    showWhitespaceChanges: boolean,
    normalizedPair?: { original: string; modified: string }
) {
    const hideWhitespace = !showWhitespaceChanges;
    const ignoreOptions = { sortModuleImports: isJavaScriptTypeScriptPath(name) };
    const normalizedOriginal = normalizedPair?.original ?? normalizeComparableDiffText(original, ignoredChars, hideWhitespace, ignoreOptions);
    const normalizedModified = normalizedPair?.modified ?? normalizeComparableDiffText(modified, ignoredChars, hideWhitespace, ignoreOptions);

    const hasVisibleChanges = normalizedOriginal !== normalizedModified;
    const hideDecorations = original !== modified && !hasVisibleChanges;

    if (!hasVisibleChanges) {
        return { renderedDiff: null, hasVisibleChanges: false, hideDecorations };
    }

    const rawDiff = parseDiffFromFile(createFile(name, original), createFile(name, modified));
    const rawHunks: (ChangeContent & { hunkSpecs: string; diffsHunkIdx: number })[] = [];

    for (let hunkIdx = 0; hunkIdx < rawDiff.hunks.length; hunkIdx++) {
        const hunk = rawDiff.hunks[hunkIdx];

        for (const line of hunk.hunkContent) {
            if (line.type === 'context') continue;

            const change = line as ChangeContent;
            const entry = {
                ...change,
                hunkSpecs: `${change.deletions > 0 ? '-' : ''}${change.deletionLineIndex + 1},${change.deletions} ${change.additions > 0 ? '+' : ''}${change.additionLineIndex + 1},${change.additions}`,
                diffsHunkIdx: hunkIdx,
            };
            rawHunks.push(entry);
        }
    }

    const renderedDiff: FileDiffMetadata & { rawHunks: typeof rawHunks } = {
        ...rawDiff,
        rawHunks,
        additionLines: rawDiff.additionLines,
        deletionLines: rawDiff.deletionLines,
    };

    return { renderedDiff, hasVisibleChanges: true, hideDecorations: false };
}

const diffState = computed(() => {
    const name = props.pathForLanguage || 'diff.txt';
    const original = props.original ?? '';
    const modified = props.modified ?? '';
    const normalizedPair =
        props.normalizedOriginal !== undefined && props.normalizedModified !== undefined ? { original: props.normalizedOriginal, modified: props.normalizedModified } : undefined;

    return createRenderedDiff(name, original, modified, props.diffIgnoredChars ?? '', props.showWhitespaceChanges ?? false, normalizedPair);
});

type DiffOptions = UnresolvedFileOptions<undefined> & Pick<FileDiffOptions<undefined, undefined>, 'diffStyle'>;
const diffOptions = computed<DiffOptions>(() => {
    const shouldHideDecorations = diffState.value.hideDecorations;
    const isConflict = Boolean(props.conflictFile);

    const base: DiffOptions = {
        theme: 'pierre-dark' as const,
        themeType: 'dark' as const,
        diffStyle: 'split' as const,
        disableFileHeader: true,
        overflow: settings.state.diffViewWrap ? 'wrap' : 'scroll',
        expandUnchanged: props.diffViewMode === 'full-file',
        collapsedContextThreshold: 1,
        hunkSeparators: 'line-info-basic' as const,
        lineDiffType: shouldHideDecorations ? ('none' as const) : ('word-alt' as const),
        diffIndicators: shouldHideDecorations ? ('none' as const) : ('bars' as const),
        disableBackground: shouldHideDecorations,
        useTokenTransformer: true,
        onPostRender(node: HTMLElement, _instance?: unknown) {
            renderedNodeEpoch += 1;
            renderedNodeRef.value = node;
            void revealTargetLine();
        },
        renderAnnotation: undefined,
    };

    if (isConflict) {
        return {
            ...base,
            mergeConflictActionsType: 'none' as const,
            maxContextLines: 3,
        };
    }

    return base;
});

let hunkActionsWrapper: HTMLElement;

/** Bumped on every render, so anchors from a reused node are never taken for the current ones. */
let renderEpoch = 0;

// `setHunkAnchors` runs for the same diff more than once, so the patch is split once and kept
// for the next request instead of re-scanning the whole patch per hunk.
let cachedPatchText = '';
let cachedPatchParts: string[] = [];

function splitPatchOnce(fullPatch: string) {
    if (fullPatch !== cachedPatchText) {
        cachedPatchText = fullPatch;
        cachedPatchParts = fullPatch.split(/^@@ /m);
    }

    return cachedPatchParts;
}

/**
 * Build a unified-diff patch covering only a single change block
 * (one @pierre/diffs ChangeContent), using the original git patch header.
 *
 * The @@-header uses deletionLineIndex for the old-file side and
 * additionLineIndex for the new-file side.  These can differ when prior
 * partial operations have shifted the file content (e.g. after staging
 * one change, the index has different line numbers than HEAD).
 *
 * With --recount and --unidiff-zero flags in the backend, git tolerates
 * approximate positions and recalculates counts from the patch content.
 */
function buildChangeBlockPatch(
    patchParts: string[],
    rawHunk: { deletions: number; deletionLineIndex: number; additions: number; additionLineIndex: number },
    rendered: { deletionLines: string[]; additionLines: string[] }
): string {
    if (!rendered) return '';

    const header = patchParts[0];
    if (header === undefined) return '';

    const oldLine = rawHunk.deletionLineIndex + 1;
    const newLine = rawHunk.additionLineIndex + 1;

    // Build the hunk content: context lines, then deletions, then additions.
    const ctxBefore: string[] = [];
    const ctxAfter: string[] = [];

    // 1–2 context lines before the change so git can anchor the hunk
    // when applying in reverse (unstage / discard).
    if (rawHunk.deletionLineIndex > 1) {
        const ctx = rendered.deletionLines[rawHunk.deletionLineIndex - 2];
        if (ctx !== undefined) ctxBefore.push(` ${ctx.replace(/\n$/, '')}`);
    }
    if (rawHunk.deletionLineIndex > 0) {
        const ctx = rendered.deletionLines[rawHunk.deletionLineIndex - 1];
        if (ctx !== undefined) ctxBefore.push(` ${ctx.replace(/\n$/, '')}`);
    }

    const deletions: string[] = [];
    for (let d = 0; d < rawHunk.deletions; d++) {
        const content = rendered.deletionLines[rawHunk.deletionLineIndex + d];
        deletions.push(`-${(content ?? '').replace(/\n$/, '')}`);
    }

    const additions: string[] = [];
    for (let a = 0; a < rawHunk.additions; a++) {
        const content = rendered.additionLines[rawHunk.additionLineIndex + a];
        additions.push(`+${(content ?? '').replace(/\n$/, '')}`);
    }

    // 1 context line after the change
    if (rawHunk.deletionLineIndex + rawHunk.deletions < rendered.deletionLines.length) {
        const ctx = rendered.deletionLines[rawHunk.deletionLineIndex + rawHunk.deletions];
        if (ctx !== undefined) ctxAfter.push(` ${ctx.replace(/\n$/, '')}`);
    }

    const ctxLen = ctxBefore.length + ctxAfter.length;
    const oldCount = ctxLen + rawHunk.deletions;
    const newCount = ctxLen + rawHunk.additions;
    const hunkHeader = `@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`;

    return header + hunkHeader + '\n' + [...ctxBefore, ...deletions, ...additions, ...ctxAfter].join('\n') + '\n';
}

function onHunkButtonHover(e: MouseEvent) {
    const btn = e.currentTarget as HTMLElement;
    const i = parseInt(btn.getAttribute('data-hunk-index') ?? '0');
    hoveringActionZone.value = true;
    setHoveredActionZone(`${i}`);

    hunkActionsWrapper.innerHTML = '';

    const lbl = document.createElement('span');
    lbl.textContent = btn.getAttribute('data-hunk-label') ?? `#${i}`;
    lbl.style.cssText = `
        font-size:12px;
        font-weight:700;
        padding:0 5px;
        width:100%;
        text-align:center;
    `;
    hunkActionsWrapper.appendChild(lbl);

    const mkBtn = (label: string, danger: boolean, onClick: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = `
            border:0;
            border-radius:5px;
            background:${danger ? '#9f0712' : '#016630'};
            cursor:pointer;
            font-size:11px;
            line-height:1;
            flex:1;
            padding:5px 8px;`;
        b.addEventListener('mouseenter', () => {
            b.style.background = danger ? '#82181a' : '#0d542b';
        });
        b.addEventListener('mouseleave', () => {
            b.style.background = danger ? '#9f0712' : '#016630';
        });
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return b;
    };

    const cfg = props.hunkActionsConfig!;
    const canStage = cfg.kind === 'unstaged';
    const canUnstage = cfg.kind === 'staged';
    const canDiscard = cfg.kind === 'unstaged';
    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = `
        display:flex;
        gap:2px;
        width:100%;
    `;
    const hunkPatch = btn.getAttribute('data-hunk-patch') ?? '';
    if (canStage && cfg.onStage) btnWrapper.appendChild(mkBtn('Stage Change', false, () => cfg.onStage!(hunkPatch)));
    if (canUnstage && cfg.onUnstage) btnWrapper.appendChild(mkBtn('Unstage Change', false, () => cfg.onUnstage!(hunkPatch)));
    if (canDiscard && cfg.onDiscard) btnWrapper.appendChild(mkBtn('Discard Change', true, () => cfg.onDiscard!(hunkPatch)));

    hunkActionsWrapper.appendChild(btnWrapper);

    hunkActionsWrapper.style.display = 'flex';
    const btnRect = btn.getBoundingClientRect();
    hunkActionsWrapper.style.top = `${btnRect.top}px`;
    hunkActionsWrapper.style.left = `${btnRect.left + btnRect.width / 2}px`;
}

function addHunkElsToDom(label: string, addLine: HTMLElement, i: number) {
    const rendered = diffState.value.renderedDiff;
    if (!rendered) return;
    const rawHunk = rendered.rawHunks[i];
    if (!rawHunk) return;
    const fullPatch = props.hunkActionsConfig?.patch ?? '';
    const hunkPatch = buildChangeBlockPatch(splitPatchOnce(fullPatch), rawHunk, rendered);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '⋯';
    btn.className = 'gitvan-hunk-button';
    btn.setAttribute('data-hunk-index', `${i}`);
    btn.setAttribute('data-hunk-label', label);
    btn.setAttribute('data-hunk-patch', hunkPatch);
    btn.style.cssText = `
        position:absolute;
        z-index:55;
        top:0;
        bottom:0;
        border:1px solid #00fff4;
        border-radius:999px;
        background:#00fff4;
        color:black;
        cursor:pointer;
        width:18px;
        height:18px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:11px;
        box-shadow:0 8px 24px rgba(0,0,0,0.28);
    `;

    btn.addEventListener('mouseenter', (e) => {
        onHunkButtonHover(e);
    });
    btn.addEventListener('mouseleave', (e) => {
        hoveringActionZone.value = false;
        scheduleHoveredActionZoneClear();
        // if mouse is not moved up, hide the actions wrapper directly
        const movedUp = e.clientY < (e.currentTarget as HTMLElement).getBoundingClientRect().top;

        setTimeout(
            () => {
                if (!hunkActionsWrapper.matches(':hover')) hunkActionsWrapper.style.display = 'none';
            },
            movedUp ? 200 : 0
        );
    });

    addLine.querySelectorAll('.gitvan-hunk-button').forEach((el) => el.remove());
    addLine.appendChild(btn);
}
let anchoredSignature = '';

/**
 * Identifies the anchors a rendered node carries. The render epoch covers nodes the renderer
 * reuses across renders, so a rewritten diff is rebuilt even when its patch text is unchanged; the
 * first and last rendered row cover a windowed renderer, whose rows change as the view scrolls.
 */
function anchorSignature(patch: string, firstRenderedLine: string | null, lastRenderedLine: string | null, renderedCount: number, hunkCount: number) {
    return [renderEpoch, renderedNodeEpoch, props.original ?? '', props.modified ?? '', patch, firstRenderedLine, lastRenderedLine, renderedCount, hunkCount].join('\u0000');
}

function setHunkAnchors() {
    const sr = renderedNodeRef.value?.shadowRoot;
    const host = sr?.querySelector<HTMLElement>('pre[data-diff]');
    const cfg = props.hunkActionsConfig;
    if (!sr || !host || !cfg || cfg.oldSizeBytes <= 0 || cfg.newSizeBytes <= 0) return;

    const gutter = sr.querySelector<HTMLElement>('[data-additions] > [data-gutter]');
    const adds = gutter?.querySelectorAll<HTMLElement>(':scope > div');
    if (!gutter || !adds?.length) return;

    const renderedAdditionLines = new Set<string>();

    for (const row of adds) {
        const columnNumber = row.getAttribute('data-column-number');

        if (columnNumber !== null) {
            renderedAdditionLines.add(columnNumber);
        }
    }

    const allHunks = diffState.value.renderedDiff?.rawHunks ?? [];

    // The post-render callback and the reveal path both land here, so the pass is keyed on what is
    // rendered and only runs again when that changes.
    const signature = anchorSignature(
        cfg.patch,
        adds[0]?.getAttribute('data-column-number') ?? null,
        adds[adds.length - 1]?.getAttribute('data-column-number') ?? null,
        adds.length,
        allHunks.length
    );
    if (signature === anchoredSignature) return;

    // we add actions wrapper only once, and populate its content on button hover, so that we don't have 100+ action wrappers in the DOM for large diffs
    let actions = host.querySelector<HTMLElement>('.gitvan-hunk-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'gitvan-hunk-actions';
        actions.style.cssText = `
            display: none;
            align-items: center;
            flex-wrap: wrap;
            gap: 2px;
            background: #03A9F4;
            color: black;
            border: 1px solid #4cc7ff;
            border-radius: 5px;
            position: fixed;
            z-index: 5006;
            box-shadow: rgba(0, 0, 0, 0.25) 0px 10px 30px;
            width: min-content;
            transform: translate(-50%, calc(-100% - 8px));
            padding: 3px 5px;
            top: 642px;
            left: 1008.53px;
        `;

        actions.onmouseenter = (e) => ((e.target as HTMLElement)!.style.display = 'flex');
        actions.onmouseleave = (e) => ((e.target as HTMLElement)!.style.display = 'none');

        host.appendChild(actions);
    }
    hunkActionsWrapper = actions;

    // A windowed renderer reuses rows, so a change block that is gone (or scrolled away) would
    // otherwise leave its button behind: clear the set and replay the ones still rendered.
    for (const button of sr.querySelectorAll<HTMLElement>('.gitvan-hunk-button')) {
        button.remove();
    }

    let anchored = 0;
    const firstRenderedColumn = adds[0]?.getAttribute('data-column-number') ?? null;
    // The first change block anchors to the list's first row, which is only the file's first row
    // while the window starts there (the renderers number that row 0 or 1).
    const startsAtTop = firstRenderedColumn === '0' || firstRenderedColumn === '1';

    for (let i = 0; i < allHunks.length && anchored < maxHunkAnchors; i++) {
        const hunk = allHunks[i];
        const isWholeFileStart = hunk.additionLineIndex == 0;

        // Only a change block whose row is mounted can anchor, so a large diff never queries the
        // DOM per off-screen hunk. The original index is kept: the patch is built from it.
        if (isWholeFileStart ? !startsAtTop : !renderedAdditionLines.has(String(hunk.additionLineIndex))) {
            continue;
        }

        const selector = isWholeFileStart ? `:scope > div` : `:scope > div[data-column-number="${hunk.additionLineIndex}"] + div`;
        const addLine = gutter.querySelector<HTMLElement>(selector);

        if (!addLine) {
            continue;
        }

        addHunkElsToDom(`#${i + 1} (${hunk.hunkSpecs})`, addLine, i);
        anchored += 1;
    }

    anchoredSignature = signature;
}

async function revealTargetLine() {
    await nextTick();
    setHunkAnchors();

    const revealLine = props.revealLine;
    if (!revealLine || revealLine <= 0) return;

    const shadowRoot = renderedNodeRef.value?.shadowRoot;
    const lineElement =
        shadowRoot?.querySelector<HTMLElement>(`[data-additions] [data-line="${revealLine}"]`) ?? shadowRoot?.querySelector<HTMLElement>(`[data-line="${revealLine}"]`);
    lineElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

/** Tracks which renderer the current instance is, so crossing the threshold rebuilds it. */
let diffInstanceVirtualized = false;

/**
 * The virtualizer installs observers and a shared render queue, so it exists only while a diff is
 * actually large: every normal diff keeps the plain renderer and its previous timing exactly.
 */
function ensureDiffVirtualizer() {
    if (diffVirtualizer.value || props.conflictFile) {
        return diffVirtualizer.value;
    }

    const scrollRoot = scrollRootRef.value;
    const content = renderHostRef.value;

    if (!scrollRoot || !content) {
        return undefined;
    }

    const virtualizer = new Virtualizer();
    virtualizer.setup(scrollRoot, content);
    diffVirtualizer.value = virtualizer;

    return virtualizer;
}

function dropDiffVirtualizer() {
    diffVirtualizer.value?.cleanUp();
    diffVirtualizer.value = undefined;
}

function ensureDiffInstance(useVirtualization: boolean) {
    if (fileDiffRef.value && !props.conflictFile && diffInstanceVirtualized !== useVirtualization) {
        cleanUpInstance();
    }

    if (fileDiffRef.value) {
        return fileDiffRef.value;
    }

    const opts = diffOptions.value;

    if (props.conflictFile) {
        fileDiffRef.value = new UnresolvedFile(opts);
        diffInstanceVirtualized = false;

        return fileDiffRef.value;
    }

    const virtualizer = useVirtualization ? ensureDiffVirtualizer() : undefined;

    if (virtualizer) {
        fileDiffRef.value = new VirtualizedFileDiff(opts, virtualizer);
        diffInstanceVirtualized = true;
    } else {
        dropDiffVirtualizer();
        fileDiffRef.value = new FileDiff(opts);
        diffInstanceVirtualized = false;
    }

    return fileDiffRef.value;
}

function renderDiff() {
    const host = renderHostRef.value;
    if (!host) {
        return;
    }

    renderEpoch += 1;

    const renderedDiff = props.conflictFile ? undefined : diffState.value.renderedDiff;
    const renderedLineCount = renderedDiff ? renderedDiff.deletionLines.length + renderedDiff.additionLines.length : 0;
    const instance = ensureDiffInstance(renderedLineCount > virtualizationLineThreshold);
    const opts = diffOptions.value;
    instance.setOptions(opts);

    if (props.conflictFile) {
        const name = props.pathForLanguage || 'conflict.txt';
        (instance as UnresolvedFile).render({
            file: { name, contents: props.conflictFile },
            containerWrapper: host,
            forceRender: true,
        });
        emit('visibleDiffChange', true);
        void revealTargetLine();
        return;
    }

    if (!renderedDiff) return;

    (instance as FileDiff).render({
        fileDiff: renderedDiff,
        containerWrapper: host,
        forceRender: true,
    });

    emit('visibleDiffChange', diffState.value.hasVisibleChanges);
    void revealTargetLine();
}

function cleanUpInstance() {
    fileDiffRef.value?.cleanUp();
    fileDiffRef.value = undefined;
    renderedNodeRef.value = undefined;
}

onMounted(() => {
    renderDiff();
});

onUnmounted(() => {
    clearPendingHoveredActionZoneClear();
    cleanUpInstance();
    dropDiffVirtualizer();
});

// An array of getters, not one getter returning an array: the latter produces a new array on
// every re-evaluation, so it re-renders even when the replaced settings object holds the same
// values. Everything listed here changes the diff itself or how it lays out. The font size is
// deliberately absent because `hostStyle` applies it through the `--diffs-font-size` property.
watch(
    [
        () => props.original,
        () => props.modified,
        () => props.pathForLanguage,
        () => props.diffViewMode,
        () => props.diffIgnoredChars,
        () => props.showWhitespaceChanges,
        () => settings.state.diffViewWrap,
    ],
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

// The hunk actions arrive from the selected change, which can resolve after the diff's first
// render; anchor the already-rendered rows instead of waiting for the next diff.
watch(
    () => props.hunkActionsConfig,
    () => {
        void revealTargetLine();
    }
);

const hostStyle = computed(() => ({
    '--diffs-font-size': `${settings.state.diffFontSize}px`,
    '--diffs-font-family': 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    '--diffs-header-font-family': 'ui-sans-serif, system-ui, sans-serif',
    '--diffs-line-height': '1.5',
}));
</script>

<template>
    <div ref="scrollRootRef" data-testid="diffs-diff-editor-root" class="relative w-full min-h-40 flex-1 overflow-y-auto" :class="props.class" :style="hostStyle">
        <div ref="renderHostRef" class="min-h-full gitvan-diffs-host" />
    </div>
</template>

<style>
.gitvan-diffs-host {
    min-height: 100%;
}
/* .gitvan-hunk-button {
    position: absolute;
    z-index: 55;
    top: 0;
    bottom: 0;
    border: 1px solid #00fff4;
    border-radius: 999px;
    background: #00fff4;
    color: black;
    cursor: pointer;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}
.gitvan-hunk-actions {
    align-items: center;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    flex-wrap: wrap;
    background: #0b4983;
    border: 1px solid #1274cf;
    border-radius: 5px;
    position: fixed;
    z-index: 5006;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    width: max-content;
    transform: translate(-50%, calc(-100% - 8px));
    padding: 1px;
}
.gitvan-hunk-label {
    color: rgba(255, 255, 255, 0.88);
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 0 5px;
    text-transform: uppercase;
    grid-column: span 2;
}
.gitvan-hunk-action-button {
    border: 0;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 5px 8px;
} */
</style>
