/// <reference types="vite/client" />

import type { GitClientRequestMap } from './src/electron/rpc';
import type { NativeCommand } from './src/shared/gitClient';

type GitClientBridge = {
    invoke<K extends keyof GitClientRequestMap>(name: K, params: GitClientRequestMap[K]['params']): Promise<GitClientRequestMap[K]['response']>;
    onNativeCommand(listener: (command: NativeCommand) => void): () => void;
};

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<object, object, unknown>;
    export default component;
}

declare global {
    interface Window {
        gitClient: GitClientBridge;
    }
}

export {};
