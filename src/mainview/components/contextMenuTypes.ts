export type ContextMenuSeparator = {
    type: 'separator';
    id?: string;
};

export type ContextMenuItem = {
    id: string;
    label: string;
    icon?: string;
    checked?: boolean;
    disabled?: boolean;
    danger?: boolean;
    children?: ContextMenuEntry[];
    action?: () => void | Promise<void>;
};

export type ContextMenuEntry = ContextMenuSeparator | ContextMenuItem;
