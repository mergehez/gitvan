import type { ContextMenuEntry } from '../directives';

export type FileSortMode = 'default' | 'a-z' | 'z-a' | 'type-a-z' | 'type-z-a';

export const FILE_SORT_MODE_VALUES = ['default', 'a-z', 'z-a', 'type-a-z', 'type-z-a'] as const satisfies readonly FileSortMode[];

export const FILE_SORT_OPTIONS: ReadonlyArray<{ value: FileSortMode; label: string }> = [
    { value: 'default', label: 'Default' },
    { value: 'a-z', label: 'A-Z' },
    { value: 'z-a', label: 'Z-A' },
    { value: 'type-a-z', label: 'File Type A-Z' },
    { value: 'type-z-a', label: 'File Type Z-A' },
];

function fileExtension(path: string | undefined) {
    if (!path) {
        return '';
    }

    const fileName = path.split('/').filter(Boolean).at(-1) ?? '';
    const dotIndex = fileName.lastIndexOf('.');

    return dotIndex > 0 && dotIndex < fileName.length - 1 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

export function sortFilesByMode<T extends { path?: string; title?: string }>(items: T[], mode: FileSortMode): T[] {
    if (mode === 'default') {
        return items;
    }

    // const basenameOf = (item: T) => item.path ?? item.title ?? '';
    const basenameOf = (item: T) => (item.path ?? item.title ?? '').toLowerCase().split('/').filter(Boolean).at(-1) ?? '';

    return [...items].sort((left, right) => {
        const leftKey = basenameOf(left);
        const rightKey = basenameOf(right);

        if (mode === 'a-z' || mode === 'z-a') {
            const comparison = leftKey.localeCompare(rightKey);
            return mode === 'a-z' ? comparison : -comparison;
        }

        const extensionComparison = fileExtension(leftKey).localeCompare(fileExtension(rightKey));
        if (extensionComparison !== 0) {
            return mode === 'type-a-z' ? extensionComparison : -extensionComparison;
        }

        const nameComparison = leftKey.localeCompare(rightKey);
        return mode === 'type-a-z' ? nameComparison : -nameComparison;
    });
}

export function buildFileSortMenuEntries(mode: FileSortMode, onSelect: (mode: FileSortMode) => void, keyPrefix: string): ContextMenuEntry[] {
    return [
        {
            id: `${keyPrefix}-sort-by`,
            label: 'Sort by',
            children: FILE_SORT_OPTIONS.map((option) => ({
                id: `${keyPrefix}-sort-by:${option.value}`,
                label: option.label,
                checked: mode === option.value,
                action: async () => {
                    onSelect(option.value);
                },
            })),
        },
    ];
}
