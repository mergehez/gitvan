import { contextBridge, ipcRenderer } from 'electron';
import type { GitClientRequestMap } from './rpc.js';
import type { NativeCommand } from '../shared/gitClient.js';

const nativeCommandChannel = 'gitvan:native-command';

type GitClientBridge = {
    invoke<K extends keyof GitClientRequestMap>(name: K, params: GitClientRequestMap[K]['params']): Promise<GitClientRequestMap[K]['response']>;
    onNativeCommand(listener: (command: NativeCommand) => void): () => void;
};

const gitClient: GitClientBridge = {
    invoke(name, params) {
        return ipcRenderer.invoke(`gitvan:${String(name)}`, params);
    },
    onNativeCommand(listener) {
        const handleNativeCommand = (_event: Electron.IpcRendererEvent, command: NativeCommand) => {
            listener(command);
        };

        ipcRenderer.on(nativeCommandChannel, handleNativeCommand);

        return () => {
            ipcRenderer.removeListener(nativeCommandChannel, handleNativeCommand);
        };
    },
};

contextBridge.exposeInMainWorld('gitClient', gitClient);
