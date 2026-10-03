<script setup lang="ts">
import {
    FileDiff,
    UnresolvedFile,
    parseDiffFromFile,
    type ChangeContent,
    type FileContents,
    type FileDiffMetadata,
    type FileDiffOptions,
    type UnresolvedFileOptions,
} from '@pierre/diffs';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useSettings } from '../composables/useSettings';
import { isJavaScriptTypeScriptPath } from '../../shared/diffIgnoredChars';
import { normalizeComparableDiffText } from '../lib/diffIgnoredChars';
type HunkActionTone = 'default' | 'danger';

export type HunkActionButton = {
    id: string;
    label: string;
    title?: string;
    busy?: boolean;
    disabled?: boolean;
    tone?: HunkActionTone;
    onClick: () => void;
};

export type HunkActionZone = {
    id: string;
    startLineNumber: number;
    originalStartLineNumber: number;
    hunkSpecs?: string;
    actions: HunkActionButton[];
};

const emit = defineEmits<{
    visibleDiffChange: [hasVisibleChanges: boolean | undefined];
}>();

export type HunkActionsConfig = {
    kind: 'staged' | 'unstaged';
    oldSizeBytes: number;
    newSizeBytes: number;
    patch: string;
    onStage?: (patch: string) => void;
    onUnstage?: (patch: string) => void;
    onDiscard?: (patch: string) => void;
};

const props = defineProps<{
    readonly?: boolean;
    class?: string;
    pathForLanguage?: string;
    original?: string;
    modified?: string;
    conflictFile?: string;
    diffViewMode?: 'changes' | 'full-file';
    diffIgnoredChars?: string;
    showWhitespaceChanges?: boolean;
    revealLine?: number;
    hunkActionsConfig?: HunkActionsConfig;
}>();

const settings = useSettings();

const renderHostRef = ref<HTMLDivElement>();
const fileDiffRef = shallowRef<FileDiff | UnresolvedFile>();
const renderedNodeRef = shallowRef<HTMLElement>();
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

function createRenderedDiff(name: string, original: string, modified: string, ignoredChars: string, showWhitespaceChanges: boolean) {
    const ignoreOptions = { sortModuleImports: isJavaScriptTypeScriptPath(name) };
    const normalizedOriginal = normalizeComparableDiffText(original, ignoredChars, !showWhitespaceChanges, ignoreOptions);
    const normalizedModified = normalizeComparableDiffText(modified, ignoredChars, !showWhitespaceChanges, ignoreOptions);

    const hasVisibleChanges = normalizedOriginal !== normalizedModified;
    const hideDecorations = original !== modified && !hasVisibleChanges;

    if (!hasVisibleChanges) {
        return { renderedDiff: null, hasVisibleChanges: false, hideDecorations };
    }

    const rawDiff = parseDiffFromFile(createFile(name, original), createFile(name, modified), {
        // callback(patch) {
        // console.log('patch', patch);
        // },

    });
    console.log('hunk count', rawDiff.hunks.length);
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

    return createRenderedDiff(name, original, modified, props.diffIgnoredChars ?? '', props.showWhitespaceChanges ?? false);
});

type DiffOptions = UnresolvedFileOptions<undefined> & Pick<FileDiffOptions<undefined>, 'diffStyle'>;
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
    fullPatch: string,
    rawHunk: { deletions: number; deletionLineIndex: number; additions: number; additionLineIndex: number },
    rendered: { deletionLines: string[]; additionLines: string[] }
): string {
    if (!fullPatch) return '';
    if (!rendered) return '';

    const parts = fullPatch.split(/^@@ /m);
    const header = parts[0];
    if (!header) return '';

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
    console.log('hover', { btnRect, actionsRect: hunkActionsWrapper.getBoundingClientRect() });
}

function addHunkElsToDom(label: string, addLine: HTMLElement, i: number) {
    const rendered = diffState.value.renderedDiff;
    if (!rendered) return;
    const rawHunk = rendered.rawHunks[i];
    if (!rawHunk) return;
    const fullPatch = props.hunkActionsConfig?.patch ?? '';
    const hunkPatch = buildChangeBlockPatch(fullPatch, rawHunk, rendered);
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
function setHunkAnchors() {
    const sr = renderedNodeRef.value?.shadowRoot;
    const host = sr?.querySelector<HTMLElement>('pre[data-diff]');
    const cfg = props.hunkActionsConfig;
    if (!sr || !host || !cfg || cfg.oldSizeBytes <= 0 || cfg.newSizeBytes <= 0) return;

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

    const gutter = sr.querySelector<HTMLElement>('[data-additions] > [data-gutter]');
    const adds = gutter?.querySelectorAll<HTMLElement>(':scope > div');
    if (!gutter || !adds?.length) return;

    const hunks = diffState.value.renderedDiff?.rawHunks ?? [];
    for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i];
        const selector = hunk.additionLineIndex == 0 ? `:scope > div` : `:scope > div[data-column-number="${hunk.additionLineIndex}"] + div`;
        const addLine = gutter.querySelector<HTMLElement>(selector);
        if (!addLine) {
            console.warn('addLine not found for hunk', { i, hunk, hunks });
            continue;
        }
        addHunkElsToDom(`#${i + 1} (${hunk.hunkSpecs})`, addLine, i);
    }
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

function ensureDiffInstance() {
    if (!fileDiffRef.value) {
        const opts = diffOptions.value;
        fileDiffRef.value = props.conflictFile ? new UnresolvedFile(opts) : new FileDiff(opts);
    }

    return fileDiffRef.value;
}

function renderDiff() {
    const host = renderHostRef.value;
    if (!host) {
        return;
    }

    const instance = ensureDiffInstance();
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

    const renderedDiff = diffState.value.renderedDiff;
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
});

watch(
    () => [
        props.original,
        props.modified,
        props.pathForLanguage,
        props.diffViewMode,
        props.diffIgnoredChars,
        props.showWhitespaceChanges,
        settings.state.diffFontSize,
        settings.state.diffViewWrap,
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

const hostStyle = computed(() => ({
    '--diffs-font-size': `${settings.state.diffFontSize}px`,
    '--diffs-font-family': 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    '--diffs-header-font-family': 'ui-sans-serif, system-ui, sans-serif',
    '--diffs-line-height': '1.5',
}));
</script>

<template>
    <div data-testid="diffs-diff-editor-root" class="relative w-full min-h-40 flex-1 overflow-y-auto" :class="props.class" :style="hostStyle">
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
