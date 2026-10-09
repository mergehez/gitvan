import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuEntry, ContextMenuItem } from '../../directives/contextMenuTypes';
import { buildOpenWithEntries } from '../../lib/buildOpenWithEntries';

function build(editors: Array<{ path: string; label: string }>, onOpenWithEditor = vi.fn(async () => undefined), onPickProgram = vi.fn(async () => undefined)) {
    return {
        entries: buildOpenWithEntries({ keyPrefix: 'repo-open-with:1', editors, onOpenWithEditor, onPickProgram }),
        onOpenWithEditor,
        onPickProgram,
    };
}

function labelOf(entry: ContextMenuEntry) {
    return 'label' in entry ? entry.label : 'separator';
}

describe('buildOpenWithEntries', () => {
    it('lists every editor, a separator and the picker', async () => {
        const editors = [
            { path: '/Applications/A.app', label: 'A' },
            { path: '/Applications/B.app', label: 'B' },
        ];
        const { entries, onOpenWithEditor, onPickProgram } = build(editors);

        expect(entries.map(labelOf)).toEqual(['A', 'B', 'separator', 'Pick Program']);
        expect(entries[0]!.id).toBe('repo-open-with:1:editor:/Applications/A.app');
        expect(entries[3]!.id).toBe('repo-open-with:1:pick-program');

        await (entries[0] as ContextMenuItem).action?.();
        expect(onOpenWithEditor).toHaveBeenCalledWith('/Applications/A.app');

        await (entries[3] as ContextMenuItem).action?.();
        expect(onPickProgram).toHaveBeenCalledTimes(1);
    });

    it('offers only the picker when no editor is configured', () => {
        const { entries } = build([]);

        expect(entries.map(labelOf)).toEqual(['Pick Program']);
    });
});
