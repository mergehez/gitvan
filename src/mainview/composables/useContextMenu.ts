import { reactive } from 'vue';
import type { ContextMenuEntry } from '../components/contextMenuTypes';

type ContextMenuPosition = {
    x: number;
    y: number;
};

const state = reactive({
    open: false,
    x: 0,
    y: 0,
    items: [] as ContextMenuEntry[],
});

function closeMenu() {
    state.open = false;
    state.items = [];
}

function openAtPosition(position: ContextMenuPosition, items: ContextMenuEntry[]) {
    closeMenu();
    state.x = position.x;
    state.y = position.y;
    state.items = items;
    state.open = items.length > 0;
}

function openAtEvent(event: MouseEvent | undefined, items: ContextMenuEntry[]) {
    if (!event) {
        return;
    }

    openAtPosition(
        {
            x: event.clientX,
            y: event.clientY,
        },
        items,
    );
}

function openAtViewportCenter(items: ContextMenuEntry[]) {
    openAtPosition(
        {
            x: Math.round(window.innerWidth / 2),
            y: Math.round(window.innerHeight / 2),
        },
        items,
    );
}

export function useContextMenu() {
    return {
        get open() {
            return state.open;
        },
        get x() {
            return state.x;
        },
        get y() {
            return state.y;
        },
        get items() {
            return state.items;
        },
        closeMenu,
        openAtEvent,
        openAtPosition,
        openAtViewportCenter,
    };
}
