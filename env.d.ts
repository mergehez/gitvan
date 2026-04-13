/// <reference types="vite/client" />

import type { GitClientBridge, GitClientRequestMap } from './src/electrobun';

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<object, object, unknown>;
    export default component;
}

declare global {
    interface Window {
        gitClient: GitClientBridge<GitClientRequestMap>;
        __electrobunWindowId?: number;
        __electrobunWebviewId?: number;
    }
}

export {};
