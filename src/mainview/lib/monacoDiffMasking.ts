import type * as MonacoEditorModule from 'monaco-editor';
import { ref, type Ref, type ShallowRef } from 'vue';
import { areEquivalentIgnoringDiffChars as areEquivalentIgnoringDiffCharsShared } from '../../shared/diffIgnoredChars';
import { areEquivalentIgnoringDiffChars, normalizeDiffIgnoredChars } from './diffIgnoredChars';

type MonacoModule = typeof import('monaco-editor');
const SIDES = ['original', 'modified'] as const;
type Side = (typeof SIDES)[number];

export type EditorLineRange = {
    startLineNumber: number;
    endLineNumber: number;
};

export type RenderedDiffBlock = {
    original: EditorLineRange | undefined;
    modified: EditorLineRange | undefined;
    isCosmetic: boolean;
};

export const MASKED_MONACO_DIFF_CLASSES = ['line-insert', 'line-delete', 'char-insert', 'char-delete', 'diff-range-empty', 'diagonal-fill'] as const;

export function normalizeEditorLineRange(startLineNumber: number | undefined, endLineNumber: number | undefined) {
    if ((startLineNumber ?? 0) <= 0 && (endLineNumber ?? 0) <= 0) {
        return undefined;
    }

    const normalizedStart = Math.max(1, startLineNumber ?? endLineNumber ?? 1);
    const normalizedEnd = Math.max(normalizedStart, endLineNumber ?? startLineNumber ?? normalizedStart);

    return {
        startLineNumber: normalizedStart,
        endLineNumber: normalizedEnd,
    } satisfies EditorLineRange;
}

export function getModelTextForRange(model: MonacoEditorModule.editor.ITextModel, range: EditorLineRange | undefined) {
    if (!range) {
        return '';
    }

    const endLineNumber = Math.min(range.endLineNumber, model.getLineCount());
    const startLineNumber = Math.min(range.startLineNumber, endLineNumber);

    if (startLineNumber <= 0 || endLineNumber <= 0) {
        return '';
    }

    return model.getValueInRange({
        startLineNumber,
        startColumn: 1,
        endLineNumber,
        endColumn: model.getLineMaxColumn(endLineNumber),
    });
}

export function getEditorViewportVerticalBounds(monacoModule: MonacoModule | undefined, editor: MonacoEditorModule.editor.ICodeEditor, range: EditorLineRange | undefined) {
    if (!monacoModule || !range) {
        return undefined;
    }

    const lineHeight = editor.getOption(monacoModule.editor.EditorOption.lineHeight);
    const top = editor.getTopForLineNumber(range.startLineNumber) - editor.getScrollTop();
    const bottom = editor.getTopForLineNumber(range.endLineNumber) - editor.getScrollTop() + lineHeight;

    return { top, bottom };
}

export interface CosmeticDiffMaskingDeps {
    diffEditorRef: Readonly<ShallowRef<MonacoEditorModule.editor.IStandaloneDiffEditor | undefined>>;
    originalModelRef: Readonly<ShallowRef<MonacoEditorModule.editor.ITextModel | undefined>>;
    modifiedModelRef: Readonly<ShallowRef<MonacoEditorModule.editor.ITextModel | undefined>>;
    diffContainerRef: Readonly<Ref<HTMLDivElement | undefined>>;
    monacoModuleRef: Readonly<ShallowRef<MonacoModule | undefined>>;
    originalMutationObserverRef: Readonly<ShallowRef<MutationObserver | undefined>>;
    modifiedMutationObserverRef: Readonly<ShallowRef<MutationObserver | undefined>>;
    diffIgnoredChars: () => string;
    showWhitespaceChanges: () => boolean;
    onVisibleDiffChange: (hasVisible: boolean | undefined) => void;
}

export function useCosmeticDiffMasking(deps: CosmeticDiffMaskingDeps) {
    const {
        diffEditorRef,
        originalModelRef,
        modifiedModelRef,
        diffContainerRef,
        originalMutationObserverRef,
        modifiedMutationObserverRef,
        diffIgnoredChars,
        showWhitespaceChanges,
        onVisibleDiffChange,
    } = deps;

    const wholeDocumentCosmeticMaskActive = ref(false);
    const hasVisibleDiffChanges = ref<boolean>();
    let pendingCosmeticMaskSyncTimeout: ReturnType<typeof setTimeout> | undefined;

    function getRenderedDiffBlocks(): RenderedDiffBlock[] | undefined {
        const diffEditor = diffEditorRef.value;
        const originalModel = originalModelRef.value;
        const modifiedModel = modifiedModelRef.value;
        const lineChanges = diffEditor?.getLineChanges();

        if (!diffEditor || !originalModel || !modifiedModel || !lineChanges) {
            return undefined;
        }

        return lineChanges.map((lineChange) => {
            const original = normalizeEditorLineRange(lineChange.originalStartLineNumber, lineChange.originalEndLineNumber);
            const modified = normalizeEditorLineRange(lineChange.modifiedStartLineNumber, lineChange.modifiedEndLineNumber);
            const originalText = getModelTextForRange(originalModel, original);
            const modifiedText = getModelTextForRange(modifiedModel, modified);

            const isMultiLine = (original && original.startLineNumber !== original.endLineNumber) || (modified && modified.startLineNumber !== modified.endLineNumber);
            const equivalent = isMultiLine
                ? areEquivalentIgnoringDiffCharsShared(originalText, modifiedText, diffIgnoredChars(), !showWhitespaceChanges())
                : areEquivalentIgnoringDiffChars(originalText, modifiedText, diffIgnoredChars(), !showWhitespaceChanges());

            return { original, modified, isCosmetic: equivalent };
        });
    }

    function isWholeDocumentCosmeticDiff() {
        const originalModel = originalModelRef.value;
        const modifiedModel = modifiedModelRef.value;

        if (!originalModel || !modifiedModel) {
            return false;
        }

        const originalText = originalModel.getValue();
        const modifiedText = modifiedModel.getValue();

        return originalText !== modifiedText && areEquivalentIgnoringDiffCharsShared(originalText, modifiedText, diffIgnoredChars(), !showWhitespaceChanges());
    }

    function emitVisibleDiffChange() {
        if (!diffEditorRef.value) {
            if (hasVisibleDiffChanges.value !== undefined) {
                hasVisibleDiffChanges.value = undefined;
                onVisibleDiffChange(undefined);
            }
            return;
        }

        const blocks = getRenderedDiffBlocks();
        const nextHasVisibleChanges = blocks ? blocks.some((block) => !block.isCosmetic) : undefined;

        if (hasVisibleDiffChanges.value === nextHasVisibleChanges) {
            return;
        }

        hasVisibleDiffChanges.value = nextHasVisibleChanges;
        onVisibleDiffChange(nextHasVisibleChanges);
    }

    function restoreMaskedMonacoDiffClasses() {
        const diffContainer = diffContainerRef.value;

        wholeDocumentCosmeticMaskActive.value = false;

        if (!diffContainer) {
            return;
        }

        // Restore old-style masked classes (char-delete/char-insert removed by earlier codegen)
        diffContainer.querySelectorAll<HTMLElement>('[data-gitvan-masked-classes]').forEach((element) => {
            const maskedClasses = element.dataset.gitvanMaskedClasses?.split(' ').filter(Boolean) ?? [];
            maskedClasses.forEach((className) => element.classList.add(className));
            delete element.dataset.gitvanMaskedClasses;
            element.classList.remove('gitvan-cosmetic-diff-mask');
        });

        // Clean up new-style custom masking utility classes added by syncCosmeticDiffMasks
        // Use attribute-contains selectors to avoid CSS escaping issues with ! and / in class names
        diffContainer.querySelectorAll<HTMLElement>('[class*="bg-transparent"]').forEach((el) => el.classList.remove('bg-transparent!'));
        diffContainer.querySelectorAll<HTMLElement>('[class*="bg-red-950"]').forEach((el) => el.classList.remove('bg-red-950/15!'));

        // Clean up dataset.content set on char elements during masking
        diffContainer.querySelectorAll<HTMLElement>('[data-content]').forEach((el) => delete el.dataset.content);
    }

    function shouldMaskLineText(text: string, ignoredCharSet: Set<string>, hideWhitespace: boolean): boolean {
        if (hideWhitespace && text.trim().length === 0) return true;
        if (ignoredCharSet.size === 0) return false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i]!;
            if (!ignoredCharSet.has(c) && !(hideWhitespace && /\s/u.test(c))) {
                return false;
            }
        }
        return true;
    }

    function syncCosmeticDiffMasks(side: Side | undefined, from: string) {
        const diffEditor = diffEditorRef.value;
        const diffContainer = diffContainerRef.value;

        if (!diffEditor || !diffContainer) {
            return;
        }

        const sides = side ? [side] : SIDES;

        // Disconnect only the observer(s) for the side(s) being processed
        if (side === 'original' || side === undefined) originalMutationObserverRef.value?.disconnect();
        if (side === 'modified' || side === undefined) modifiedMutationObserverRef.value?.disconnect();

        try {
            restoreMaskedMonacoDiffClasses();

            if (isWholeDocumentCosmeticDiff()) {
                wholeDocumentCosmeticMaskActive.value = true;
                return;
            }
            const lineChanges = diffEditor.getLineChanges();
            if (!lineChanges) return;

            const ignoredChars = normalizeDiffIgnoredChars(diffIgnoredChars());
            const hideWhitespace = !showWhitespaceChanges();
            const ignoredCharSet = new Set(ignoredChars);

            const models = {
                original: originalModelRef.value!,
                modified: modifiedModelRef.value!,
            };
            const editors = {
                original: diffEditor.getOriginalEditor(),
                modified: diffEditor.getModifiedEditor(),
            };

            const visibleRanges = {
                original: editors.original.getVisibleRanges(),
                modified: editors.modified.getVisibleRanges(),
            };
            const firstVisibleLine = {
                original: visibleRanges.original[0].startLineNumber,
                modified: visibleRanges.modified[0].startLineNumber,
            };
            const lastVisibleLine = {
                original: visibleRanges.original[visibleRanges.original.length - 1].endLineNumber,
                modified: visibleRanges.modified[visibleRanges.modified.length - 1].endLineNumber,
            };
            function isLineVisible(side: Side, lineNumber: number) {
                return lineNumber >= firstVisibleLine[side] && lineNumber <= lastVisibleLine[side];
            }

            console.log('Syncing cosmetic diff masks', side, from);
            const overlays = {
                original: diffContainer.querySelector<HTMLElement>('.editor.original .view-overlays') as HTMLElement,
                modified: diffContainer.querySelector<HTMLElement>('.editor.modified .view-overlays') as HTMLElement,
            };

            function safeModelCharText(side: Side, lineNumber: number, startColumn: number, endColumn: number): string {
                const model = models[side];
                if (lineNumber < 1 || lineNumber > model.getLineCount()) return '';
                const maxCol = model.getLineMaxColumn(lineNumber);
                if (startColumn < 1 || startColumn > maxCol || endColumn < startColumn) return '';
                const safeEnd = Math.min(endColumn, maxCol);
                return model.getValueInRange({
                    startLineNumber: lineNumber,
                    startColumn,
                    endLineNumber: lineNumber,
                    endColumn: safeEnd,
                });
            }

            // Cache overlay row lookups to avoid repeated DOM queries for the same line.
            // findOverlayRow uses querySelector with a style-based selector which is expensive;
            // caching reduces it to 1 DOM query per unique (side, lineNumber) pair per sync cycle.
            const overlayRowCache = new Map<string, HTMLElement | null>();

            function findOverlayRow(side: Side, lineNumber: number): HTMLElement | null {
                if (lineNumber <= 0 || !isLineVisible(side, lineNumber)) return null;
                const cacheKey = `${side}:${lineNumber}`;
                const cached = overlayRowCache.get(cacheKey);
                if (cached !== undefined) return cached;
                // Monaco uses CSS transform on the parent container for scroll, so child top values
                // remain content-absolute. getTopForLineNumber returns the content-absolute position.
                const top = Math.round(editors[side].getTopForLineNumber(lineNumber));
                return overlays[side].querySelector<HTMLElement>(`:scope > div[style*="top:${top}px;"]`);
            }

            const panelLines = { original: {}, modified: {} } as {
                original: Record<number, Record<string, string>>;
                modified: Record<number, Record<string, string>>;
            };
            const allCharChanges = lineChanges
                .flatMap((lc) => lc.charChanges ?? [])
                .filter((cc) => {
                    return isLineVisible('original', cc.originalStartLineNumber) || isLineVisible('modified', cc.modifiedStartLineNumber);
                })
                .map((cc) => ({
                    original: {
                        startLine: cc.originalStartLineNumber,
                        startColumn: cc.originalStartColumn,
                        endLine: cc.originalEndLineNumber,
                        endColumn: cc.originalEndColumn,
                    },
                    modified: {
                        startLine: cc.modifiedStartLineNumber,
                        startColumn: cc.modifiedStartColumn,
                        endLine: cc.modifiedEndLineNumber,
                        endColumn: cc.modifiedEndColumn,
                    },
                }));

            allCharChanges.forEach((cc) => {
                sides.forEach((side) => {
                    const ccSide = cc[side];
                    panelLines[side][ccSide.startLine] ??= {
                        full: safeModelCharText(side, ccSide.startLine, 1, models[side].getLineMaxColumn(ccSide.startLine)),
                    };
                    panelLines[side][ccSide.startLine][`${ccSide.startColumn}-${ccSide.endColumn}`] = safeModelCharText(
                        side,
                        ccSide.startLine,
                        ccSide.startColumn,
                        ccSide.endColumn
                    );
                });
            });
            allCharChanges.forEach((cc) => {
                sides.forEach((side) => {
                    const ccSide = cc[side];
                    if (!(ccSide.endLine in panelLines[side])) {
                        panelLines[side][ccSide.endLine] = {
                            full: safeModelCharText(side, ccSide.endLine, 1, models[side].getLineMaxColumn(ccSide.endLine)),
                            [`1-${ccSide.endColumn}`]: safeModelCharText(side, ccSide.endLine, 1, ccSide.endColumn),
                        };
                    }
                });
            });
            sides.forEach((side) => {
                Object.keys(panelLines[side]).forEach((lineNumStr) => {
                    const lineNum = Number(lineNumStr);
                    if (!isLineVisible(side, lineNum)) {
                        return [];
                    }
                    const { full, ...charChanges } = panelLines[side][lineNum];
                    const hasAnyRealChange = Object.values(charChanges).some((text) => !shouldMaskLineText(text, ignoredCharSet, hideWhitespace));
                    if (!hasAnyRealChange) {
                        const row = findOverlayRow(side, lineNum);
                        row?.querySelectorAll(':scope > div').forEach((t) => t.classList.add('hidden!'));
                        row?.classList.add('bg-red-950/15!');
                        return [];
                    }
                    return Object.entries(charChanges).map(([key, text], i) => {
                        const row = findOverlayRow(side, lineNum);
                        const cls = side === 'original' ? 'char-delete' : 'char-insert';
                        const left = editors[side].getOffsetForColumn(lineNum, Number(key.split('-')[0]));
                        const el = row?.querySelector<HTMLElement>(`:scope > .${cls}[style*="left:${left}px;"]`);
                        if (el) el.dataset.content = text;
                        if (el && shouldMaskLineText(text, ignoredCharSet, hideWhitespace)) {
                            el?.classList.add('hidden!');
                            return { i, key, lineNum, text, masked: true };
                        }
                        return { i, key, lineNum, text, masked: false, hasEl: !!el, hasRow: !!row };
                    });
                });
                // console.log(`Processed ${side} side line changes:`, a);
            });
            // console.log('Original panel line changes:', panelLines.original);
            // console.log('Modified panel line changes:', panelLines.modified);
        } finally {
            if (diffContainer) {
                scheduleObserverReconnect(side, diffContainer);
            }
        }
    }

    let pendingObserverReconnectTimeout: ReturnType<typeof setTimeout> | undefined;

    function scheduleObserverReconnect(side: Side | undefined, diffContainer: HTMLElement) {
        if (pendingObserverReconnectTimeout !== undefined) {
            clearTimeout(pendingObserverReconnectTimeout);
        }
        pendingObserverReconnectTimeout = setTimeout(() => {
            pendingObserverReconnectTimeout = undefined;
            // Reconnect observer(s) — re-query overlay elements since Monaco may replace them.
            // Delayed to avoid feedback loops: Monaco sometimes reacts to our class changes with
            // its own DOM mutations, which would immediately re-trigger the observer otherwise.
            if (side === 'original' || side === undefined) {
                const el = diffContainer.querySelector<HTMLElement>('.editor.original .view-overlays');
                if (el)
                    originalMutationObserverRef.value?.observe(el, {
                        subtree: true,
                        childList: true,
                        attributes: true,
                        attributeFilter: ['class', 'style'],
                    });
            }
            if (side === 'modified' || side === undefined) {
                const el = diffContainer.querySelector<HTMLElement>('.editor.modified .view-overlays');
                if (el)
                    modifiedMutationObserverRef.value?.observe(el, {
                        subtree: true,
                        childList: true,
                        attributes: true,
                        attributeFilter: ['class', 'style'],
                    });
            }
        }, 200);
    }

    function clearPendingCosmeticMaskSync() {
        if (pendingCosmeticMaskSyncTimeout !== undefined) {
            clearTimeout(pendingCosmeticMaskSyncTimeout);
            pendingCosmeticMaskSyncTimeout = undefined;
        }
        if (pendingObserverReconnectTimeout !== undefined) {
            clearTimeout(pendingObserverReconnectTimeout);
            pendingObserverReconnectTimeout = undefined;
        }
    }

    function scheduleCosmeticDiffMaskSync(side: Side | undefined, from: string, delay = 0) {
        clearPendingCosmeticMaskSync();
        pendingCosmeticMaskSyncTimeout = setTimeout(() => {
            pendingCosmeticMaskSyncTimeout = undefined;
            syncCosmeticDiffMasks(side, from);
        }, delay);
    }

    function dispose() {
        clearPendingCosmeticMaskSync();
        restoreMaskedMonacoDiffClasses();
        hasVisibleDiffChanges.value = undefined;
        onVisibleDiffChange(undefined);
        originalMutationObserverRef.value?.disconnect();
        modifiedMutationObserverRef.value?.disconnect();
    }

    return {
        wholeDocumentCosmeticMaskActive: wholeDocumentCosmeticMaskActive,
        hasVisibleDiffChanges: hasVisibleDiffChanges,
        getRenderedDiffBlocks: getRenderedDiffBlocks,
        syncCosmeticDiffMasks: syncCosmeticDiffMasks,
        scheduleCosmeticDiffMaskSync: scheduleCosmeticDiffMaskSync,
        emitVisibleDiffChange: emitVisibleDiffChange,
        dispose: dispose,
    };
}
