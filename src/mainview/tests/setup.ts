if (typeof document !== 'undefined' && typeof (document as { queryCommandSupported?: unknown }).queryCommandSupported !== 'function') {
    (document as { queryCommandSupported: (command: string) => boolean }).queryCommandSupported = () => false;
}

// jsdom has no layout engine, so components that observe their own size (Popover, CenteredModal)
// need a no-op observer to mount.
if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

// The diff viewer's windowing sets up an IntersectionObserver when it mounts.
if (typeof globalThis.IntersectionObserver !== 'function') {
    globalThis.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
            return [];
        }
    } as unknown as typeof IntersectionObserver;
}
