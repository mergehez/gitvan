import type * as MonacoEditorModule from 'monaco-editor';
import { ref, type Ref, type ShallowRef } from 'vue';
import type { MonacoEditorActionZone } from '../components/monacoEditorTypes';
import type { EditorLineRange, RenderedDiffBlock } from './monacoDiffMasking';

type MonacoModule = typeof import('monaco-editor');

type ActionZoneVisibility = 'always' | 'hover';
type DiffEditorSide = 'original' | 'modified';

export type CenteredActionZoneLayout = {
    id: string;
    left: number;
    top: number;
    zone: MonacoEditorActionZone;
};

function rangesOverlap(first: EditorLineRange | undefined, second: EditorLineRange | undefined) {
    if (!first || !second) {
        return false;
    }

    return first.startLineNumber <= second.endLineNumber && second.startLineNumber <= first.endLineNumber;
}

function getActionZoneLineRange(zone: MonacoEditorActionZone, side: DiffEditorSide) {
    const startLineNumber = Math.max(
        1,
        side === 'original' ? (zone.originalStartLineNumber ?? zone.startLineNumber ?? zone.afterLineNumber + 1) : (zone.startLineNumber ?? zone.afterLineNumber + 1)
    );
    const endLineNumber = Math.max(
        startLineNumber,
        side === 'original'
            ? (zone.originalEndLineNumber ?? zone.originalStartLineNumber ?? zone.endLineNumber ?? startLineNumber)
            : (zone.endLineNumber ?? zone.startLineNumber ?? startLineNumber)
    );

    return { startLineNumber, endLineNumber };
}

function getEditorViewportCenterForRange(
    monacoModule: MonacoModule | undefined,
    editor: MonacoEditorModule.editor.ICodeEditor,
    range: { startLineNumber: number; endLineNumber: number }
) {
    if (!monacoModule) {
        return 0;
    }

    const lineHeight = editor.getOption(monacoModule.editor.EditorOption.lineHeight);
    const startTop = editor.getTopForLineNumber(range.startLineNumber) - editor.getScrollTop();
    const endTop = editor.getTopForLineNumber(range.endLineNumber) - editor.getScrollTop() + lineHeight;

    return startTop + Math.max(lineHeight, endTop - startTop) / 2;
}

export interface DiffActionZonesDeps {
    diffEditorRef: Readonly<ShallowRef<MonacoEditorModule.editor.IStandaloneDiffEditor | undefined>>;
    diffContainerRef: Readonly<Ref<HTMLDivElement | undefined>>;
    monacoModuleRef: Readonly<ShallowRef<MonacoModule | undefined>>;
    actionZones: () => MonacoEditorActionZone[] | undefined;
    actionZoneVisibility: () => ActionZoneVisibility | undefined;
    getRenderedDiffBlocks: () => RenderedDiffBlock[] | undefined;
    hasVisibleDiffChanges: Readonly<Ref<boolean | undefined>>;
}

export function useDiffActionZones(deps: DiffActionZonesDeps) {
    const { diffEditorRef, diffContainerRef, monacoModuleRef, actionZones, actionZoneVisibility, getRenderedDiffBlocks, hasVisibleDiffChanges } = deps;

    const centeredActionZoneLayouts = ref<CenteredActionZoneLayout[]>([]);
    const hoveredActionZoneId = ref<string>();
    const hoveringActionZone = ref(false);
    let pendingHoveredActionZoneClearTimeout: ReturnType<typeof setTimeout> | undefined;

    function clearCenteredActionZoneLayouts() {
        centeredActionZoneLayouts.value = [];
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

    function setHoveredActionZone(nextZoneId: string | undefined) {
        if (nextZoneId !== undefined) {
            clearPendingHoveredActionZoneClear();
        }

        if (hoveredActionZoneId.value === nextZoneId) {
            return;
        }

        hoveredActionZoneId.value = nextZoneId;
    }

    function syncCenteredActionZoneLayouts() {
        const diffEditor = diffEditorRef.value;
        const diffContainer = diffContainerRef.value;

        if (!diffEditor || !diffContainer || hasVisibleDiffChanges.value === false) {
            clearCenteredActionZoneLayouts();
            return;
        }

        const originalEditor = diffEditor.getOriginalEditor();
        const modifiedEditor = diffEditor.getModifiedEditor();
        const originalDomNode = originalEditor.getDomNode();
        const modifiedDomNode = modifiedEditor.getDomNode();

        if (!originalDomNode || !modifiedDomNode) {
            clearCenteredActionZoneLayouts();
            return;
        }

        const containerRect = diffContainer.getBoundingClientRect();
        const originalRect = originalDomNode.getBoundingClientRect();
        const modifiedRect = modifiedDomNode.getBoundingClientRect();
        const originalLayoutInfo = originalEditor.getLayoutInfo();
        const modifiedLayoutInfo = modifiedEditor.getLayoutInfo();
        const visibleRenderedChanges = (getRenderedDiffBlocks() ?? []).filter((block) => !block.isCosmetic);
        const originalContentRight = originalRect.left - containerRect.left + originalLayoutInfo.contentLeft + originalLayoutInfo.contentWidth;
        const modifiedContentLeft = modifiedRect.left - containerRect.left + modifiedLayoutInfo.contentLeft;
        const seamCenterLeft = Math.round((originalContentRight + modifiedContentLeft) / 2);
        const nextLayouts = (actionZones() ?? [])
            .filter((zone) => zone.actions.length > 0)
            .flatMap((zone) => {
                const originalRange = getActionZoneLineRange(zone, 'original');
                const modifiedRange = getActionZoneLineRange(zone, 'modified');
                const matchingLineChanges = visibleRenderedChanges.filter((lineChange) => {
                    const renderedRanges = {
                        original: lineChange.original,
                        modified: lineChange.modified,
                    };

                    return rangesOverlap(renderedRanges.original, originalRange) || rangesOverlap(renderedRanges.modified, modifiedRange);
                });

                if (matchingLineChanges.length === 0) {
                    const originalCenter = getEditorViewportCenterForRange(monacoModuleRef.value, originalEditor, originalRange);
                    const modifiedCenter = getEditorViewportCenterForRange(monacoModuleRef.value, modifiedEditor, modifiedRange);

                    return [
                        {
                            id: zone.id,
                            left: seamCenterLeft,
                            top: Math.round((originalCenter + modifiedCenter) / 2),
                            zone,
                        } satisfies CenteredActionZoneLayout,
                    ];
                }

                return matchingLineChanges.map((lineChange, index) => {
                    const renderedRanges = {
                        original: lineChange.original,
                        modified: lineChange.modified,
                    };
                    const originalCenter = renderedRanges.original ? getEditorViewportCenterForRange(monacoModuleRef.value, originalEditor, renderedRanges.original) : undefined;
                    const modifiedCenter = renderedRanges.modified ? getEditorViewportCenterForRange(monacoModuleRef.value, modifiedEditor, renderedRanges.modified) : undefined;
                    const top =
                        originalCenter !== undefined && modifiedCenter !== undefined
                            ? Math.round((originalCenter + modifiedCenter) / 2)
                            : Math.round(originalCenter ?? modifiedCenter ?? 0);

                    return {
                        id: `${zone.id}:${index}`,
                        left: seamCenterLeft,
                        top,
                        zone,
                    } satisfies CenteredActionZoneLayout;
                });
            })
            .filter((layout) => layout.top >= -24 && layout.top <= diffContainer.clientHeight + 24);

        centeredActionZoneLayouts.value = nextLayouts;

        if (hoveredActionZoneId.value && !nextLayouts.some((layout) => layout.id === hoveredActionZoneId.value)) {
            hoveredActionZoneId.value = undefined;
        }
    }

    function getActionZoneVisibility(): ActionZoneVisibility {
        return actionZoneVisibility() ?? 'always';
    }

    function dispose() {
        clearCenteredActionZoneLayouts();
        clearPendingHoveredActionZoneClear();
        hoveredActionZoneId.value = undefined;
        hoveringActionZone.value = false;
    }

    return {
        centeredActionZoneLayouts,
        hoveredActionZoneId,
        hoveringActionZone,
        getActionZoneVisibility,
        syncCenteredActionZoneLayouts,
        setHoveredActionZone,
        scheduleHoveredActionZoneClear,
        dispose,
    };
}
