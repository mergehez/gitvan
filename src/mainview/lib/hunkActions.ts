/** Hunk action shapes shared by the diff renderer and the views that configure it. */

export type HunkActionTone = 'default' | 'danger';

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

export type HunkActionsConfig = {
    kind: 'staged' | 'unstaged';
    oldSizeBytes: number;
    newSizeBytes: number;
    patch: string;
    onStage?: (patch: string) => void;
    onUnstage?: (patch: string) => void;
    onDiscard?: (patch: string) => void;
};
