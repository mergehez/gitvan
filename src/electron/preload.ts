import { contextBridge, ipcRenderer } from 'electron';
import type { IntegratedTerminalEvent, NativeCommand } from '../shared/gitClient.js';
import type { GitClientRequestMap } from './rpc.js';

const nativeCommandChannel = 'gitvan:native-command';
const integratedTerminalEventChannel = 'gitvan:integrated-terminal-event';

type GitClientBridge = {
    invoke<K extends keyof GitClientRequestMap>(name: K, params: GitClientRequestMap[K]['params']): Promise<GitClientRequestMap[K]['response']>;
    onNativeCommand(listener: (command: NativeCommand) => void): () => void;
    onIntegratedTerminalEvent(listener: (event: IntegratedTerminalEvent) => void): () => void;
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
    onIntegratedTerminalEvent(listener) {
        const handleIntegratedTerminalEvent = (_event: Electron.IpcRendererEvent, event: IntegratedTerminalEvent) => {
            listener(event);
        };

        ipcRenderer.on(integratedTerminalEventChannel, handleIntegratedTerminalEvent);

        return () => {
            ipcRenderer.removeListener(integratedTerminalEventChannel, handleIntegratedTerminalEvent);
        };
    },
};

contextBridge.exposeInMainWorld('gitClient', gitClient);
