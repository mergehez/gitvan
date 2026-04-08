import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import type { FileDiffData } from '../../shared/gitClient.ts';
import { formatBytes } from '../lib/utils.ts';

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
    metaItems: DiffViewerMetaItem[];
    originalSrc: string | undefined;
    modifiedSrc: string | undefined;
};

export function useDiffViewer(diff: MaybeRefOrGetter<FileDiffData | undefined>) {
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

        return {
            title: currentDiff.path,
            original: currentDiff.entry.original,
            modified: currentDiff.entry.modified,
            pathForLanguage: currentDiff.path,
            previewMessage: currentDiff.entry.previewMessage,
            metaItems: metaItems,
            originalSrc: nonCodePreview?.originalSrc,
            modifiedSrc: nonCodePreview?.modifiedSrc,
        };
    });
}
