import type { ContextMenuEntry } from '../components/contextMenuTypes';

type OpenWithEditor = {
    path: string;
    label: string;
};

export function buildOpenWithEntries(params: {
    keyPrefix: string;
    editors: OpenWithEditor[];
    onPickProgram: () => Promise<void>;
    onOpenWithEditor: (editorPath: string) => Promise<void>;
}) {
    const { keyPrefix, editors, onPickProgram, onOpenWithEditor } = params;

    return [
        ...editors.map((editor) => ({
            id: `${keyPrefix}:editor:${editor.path}`,
            label: editor.label,
            action: async () => {
                await onOpenWithEditor(editor.path);
            },
        })),
        ...(editors.length > 0 ? ([{ type: 'separator' as const, id: `${keyPrefix}:separator` }] as ContextMenuEntry[]) : []),
        {
            id: `${keyPrefix}:pick-program`,
            label: 'Pick Program',
            action: async () => {
                await onPickProgram();
            },
        },
    ] satisfies ContextMenuEntry[];
}
