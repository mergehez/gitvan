import { reactive } from 'vue';

type ConfirmationParams = {
    title: string;
    message: string;
    detail?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Element to open the compact popover next to; defaults to where the pointer last clicked. */
    anchor?: HTMLElement;
};

type PendingConfirmation = {
    params: ConfirmationParams;
    resolve: (value: boolean) => void;
};

/** Where the compact popover should open: a viewport point, not an element, so a click in a long row still lands next to the pointer. */
export type ConfirmationAnchorPoint = {
    x: number;
    y: number;
};

type ClickAnchor = {
    element: HTMLElement | undefined;
    x: number;
    y: number;
};

function elementAnchorPoint(element: HTMLElement | undefined): ConfirmationAnchorPoint | undefined {
    if (!element?.isConnected) {
        return undefined;
    }

    const rect = element.getBoundingClientRect();
    // Hidden triggers (keyboard activation of a hover-only button) have nothing to point at.
    if (rect.width === 0 || rect.height === 0) {
        return undefined;
    }

    return { x: Math.round(rect.right), y: Math.round(rect.top) };
}

function _useConfirmation() {
    const queue: PendingConfirmation[] = [];
    let activeConfirmation: PendingConfirmation | undefined;

    const state = reactive({
        isOpen: false,
        title: '',
        message: '',
        detail: undefined as string | undefined,
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
        anchorPoint: undefined as ConfirmationAnchorPoint | undefined,
    });

    let lastClick: ClickAnchor | undefined;

    function rememberClick(event: MouseEvent) {
        lastClick = {
            element: event.target instanceof HTMLElement ? (event.target.closest<HTMLElement>('button, a, [role="menuitem"]') ?? event.target) : undefined,
            // Keyboard activation reports 0/0; there is no pointer to sit next to.
            x: event.clientX,
            y: event.clientY,
        };
    }

    document.addEventListener('click', rememberClick, true);

    function resolveAnchorPoint(params: ConfirmationParams) {
        const click = lastClick;
        lastClick = undefined;

        if (params.anchor) {
            return elementAnchorPoint(params.anchor);
        }

        if (click && (click.x > 0 || click.y > 0)) {
            return { x: click.x, y: click.y };
        }

        return elementAnchorPoint(click?.element);
    }

    function applyParams(params: ConfirmationParams) {
        state.title = params.title;
        state.message = params.message;
        state.detail = params.detail;
        state.confirmLabel = params.confirmLabel ?? 'Continue';
        state.cancelLabel = params.cancelLabel ?? 'Cancel';
        state.anchorPoint = resolveAnchorPoint(params);
        state.isOpen = true;
    }

    function clearState() {
        state.isOpen = false;
        state.title = '';
        state.message = '';
        state.detail = undefined;
        state.confirmLabel = 'Continue';
        state.cancelLabel = 'Cancel';
        state.anchorPoint = undefined;
    }

    function showNextConfirmation() {
        if (activeConfirmation || queue.length === 0) {
            return;
        }

        activeConfirmation = queue.shift();
        if (!activeConfirmation) {
            return;
        }

        applyParams(activeConfirmation.params);
    }

    function resolveActiveConfirmation(value: boolean) {
        const currentConfirmation = activeConfirmation;

        activeConfirmation = undefined;
        clearState();
        currentConfirmation?.resolve(value);
        showNextConfirmation();
    }

    return reactive({
        state,
        async request(params: ConfirmationParams) {
            return await new Promise<boolean>((resolve) => {
                queue.push({ params, resolve });
                showNextConfirmation();
            });
        },
        confirm() {
            resolveActiveConfirmation(true);
        },
        cancel() {
            resolveActiveConfirmation(false);
        },
    });
}

export const confirmation = _useConfirmation();
