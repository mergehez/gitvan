import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { isJavaScriptTypeScriptPath, normalizeComparableDiffPair } from '../../shared/diffIgnoredChars.ts';
import type { FileDiffData } from '../../shared/types.ts';
import { formatBytes } from '../lib/utils.ts';
import { useSettings } from './useSettings.ts';

export type DiffViewerMetaItem = {
    id: string;
    text: string;
};

export type DiffViewerState = {
    title: string;
    original: string;
    modified: string;
    pathForLanguage: string;
    previewMessage: string | undefined;
    onlyWhitespaceChanges: boolean;
    noActualChange: boolean;
    conflictMarkerCount: number;
    /** The comparable view of both sides, so the diff renderer does not normalize them again. */
    normalizedOriginal: string;
    normalizedModified: string;
    metaItems: DiffViewerMetaItem[];
    originalSrc: string | undefined;
    modifiedSrc: string | undefined;
};

function hasOnlyWhitespaceChanges(original: string, modified: string) {
    if (original === modified) {
        return false;
    }

    return original.replace(/\s+/g, '') === modified.replace(/\s+/g, '');
}

export function hasNoActualDiffChanges(diff: FileDiffData, ignoredChars: string, showWhitespaceChanges: boolean) {
    const nonCodePreview = diff.entry.nonCodePreview?.kind === 'image' ? diff.entry.nonCodePreview : undefined;

    if (diff.entry.previewMessage || nonCodePreview || diff.entry.original === diff.entry.modified) {
        return false;
    }

    return !normalizeComparableDiffPair(diff.entry.original, diff.entry.modified, !showWhitespaceChanges, {
        ignoredChars,
        sortModuleImports: isJavaScriptTypeScriptPath(diff.path),
    }).hasVisibleChanges;
}

export function useDiffViewer(diff: MaybeRefOrGetter<FileDiffData | undefined>) {
    const settings = useSettings();

    return computed<DiffViewerState | undefined>(() => {
        const currentDiff = toValue(diff);
        if (!currentDiff) {
            return undefined;
        }

        const stats = currentDiff.entry.stats;
        const nonCodePreview = currentDiff.entry.nonCodePreview?.kind === 'image' ? currentDiff.entry.nonCodePreview : undefined;

        const metaItems: DiffViewerMetaItem[] = [
            {
                id: 'size',
                text: `
                    <span class="text-red-300">${formatBytes(stats.oldSizeBytes)}</span>
                    <span class="text-emerald-300 pl-1.5">${formatBytes(stats.newSizeBytes)}</span>
                `,
            },
        ];

        if (stats.addedLines + stats.removedLines > 0) {
            metaItems.push({
                id: 'lineChanges',
                text: `
                <span class="text-red-300">-${stats.removedLines}</span>
                <span class="text-emerald-300 pl-1.5">+${stats.addedLines}</span>
                `,
            });
        }

        const effectiveIgnored = settings.state.diffIgnoredCharsEnabled ? settings.state.diffIgnoredChars : '';

        // One pass over both sides feeds the renderer, the "no actual change" badge and the
        // conflict-marker count, instead of each of them normalizing the full pair again.
        const diffPair = normalizeComparableDiffPair(currentDiff.entry.original, currentDiff.entry.modified, !settings.state.showWhitespaceChanges, {
            ignoredChars: effectiveIgnored,
            sortModuleImports: isJavaScriptTypeScriptPath(currentDiff.path),
        });

        const isComparable = !currentDiff.entry.previewMessage && !nonCodePreview && currentDiff.entry.original !== currentDiff.entry.modified;

        return {
            title: currentDiff.path,
            original: currentDiff.entry.original,
            modified: currentDiff.entry.modified,
            pathForLanguage: currentDiff.path,
            previewMessage: currentDiff.entry.previewMessage,
            onlyWhitespaceChanges: isComparable && hasOnlyWhitespaceChanges(currentDiff.entry.original, currentDiff.entry.modified),
            noActualChange: isComparable && !diffPair.hasVisibleChanges,
            conflictMarkerCount: diffPair.conflictMarkerCount,
            normalizedOriginal: diffPair.original,
            normalizedModified: diffPair.modified,
            metaItems: metaItems,
            originalSrc: nonCodePreview?.originalSrc,
            modifiedSrc: nonCodePreview?.modifiedSrc,
        };
    });
}
