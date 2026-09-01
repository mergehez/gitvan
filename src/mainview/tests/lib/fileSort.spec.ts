import { describe, expect, it } from 'vitest';
import type { ContextMenuItem } from '../../directives/contextMenuTypes';
import { buildFileSortMenuEntries, sortFilesByMode } from '../../lib/fileSort';

const files = [
    { path: 'src/components/App.vue', title: 'src/components/App.vue' },
    { path: 'src/lib/utils.ts', title: 'src/lib/utils.ts' },
    { path: 'README.md', title: 'README.md' },
    { path: 'src/index.ts', title: 'src/index.ts' },
    { path: 'src/main.ts', title: 'src/main.ts' },
];

describe('sortFilesByMode', () => {
    it('keeps the original order for default mode', () => {
        const sorted = sortFilesByMode(files, 'default');
        expect(sorted).toEqual(files);
    });

    it('sorts A-Z by path', () => {
        const sorted = sortFilesByMode(files, 'a-z').map((file) => file.path);
        expect(sorted).toEqual(['README.md', 'src/components/App.vue', 'src/index.ts', 'src/lib/utils.ts', 'src/main.ts']);
    });

    it('sorts Z-A by path', () => {
        const sorted = sortFilesByMode(files, 'z-a').map((file) => file.path);
        expect(sorted).toEqual(['src/main.ts', 'src/lib/utils.ts', 'src/index.ts', 'src/components/App.vue', 'README.md']);
    });

    it('sorts by file type A-Z, then by name A-Z', () => {
        const sorted = sortFilesByMode(files, 'type-a-z').map((file) => file.path);
        expect(sorted).toEqual(['README.md', 'src/index.ts', 'src/lib/utils.ts', 'src/main.ts', 'src/components/App.vue']);
    });

    it('sorts by file type Z-A, then by name Z-A', () => {
        const sorted = sortFilesByMode(files, 'type-z-a').map((file) => file.path);
        expect(sorted).toEqual(['src/components/App.vue', 'src/main.ts', 'src/lib/utils.ts', 'src/index.ts', 'README.md']);
    });

    it('sorts by extension before name for file type modes', () => {
        const mixed = [
            { path: 'b.js', title: 'b.js' },
            { path: 'a.css', title: 'a.css' },
            { path: 'a.js', title: 'a.js' },
        ];

        expect(sortFilesByMode(mixed, 'type-a-z').map((file) => file.path)).toEqual(['a.css', 'a.js', 'b.js']);
        expect(sortFilesByMode(mixed, 'type-z-a').map((file) => file.path)).toEqual(['b.js', 'a.js', 'a.css']);
    });

    it('does not mutate the input array', () => {
        const input = [...files];
        sortFilesByMode(input, 'z-a');
        expect(input).toEqual(files);
    });
});

describe('buildFileSortMenuEntries', () => {
    it('builds a Sort by submenu with all five options', () => {
        const entries = buildFileSortMenuEntries('default', () => {}, 'test-sort');
        expect(entries).toHaveLength(1);

        const sortEntry = entries[0] as ContextMenuItem;
        expect(sortEntry.label).toBe('Sort by');
        expect(sortEntry.children?.map((child) => (child as ContextMenuItem).label)).toEqual(['Default', 'A-Z', 'Z-A', 'File Type A-Z', 'File Type Z-A']);
    });

    it('checks the currently active mode', () => {
        const entries = buildFileSortMenuEntries('type-z-a', () => {}, 'test-sort');
        const sortEntry = entries[0] as ContextMenuItem;
        const checkedLabels = (sortEntry.children ?? []).filter((child) => (child as ContextMenuItem).checked).map((child) => (child as ContextMenuItem).label);
        expect(checkedLabels).toEqual(['File Type Z-A']);
    });
});
