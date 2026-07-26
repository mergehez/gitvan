import { contextBridge, ipcRenderer } from 'electron';
import type { IntegratedTerminalEvent } from '../shared/gitClient';

const api = {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    onNativeCommand: (listener: (command: unknown) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, command: unknown) => {
            listener(command);
        };
        ipcRenderer.on('native-command', handler);
        return () => {
            ipcRenderer.removeListener('native-command', handler);
        };
    },
    onIntegratedTerminalEvent: (listener: (event: IntegratedTerminalEvent) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, event: IntegratedTerminalEvent) => {
            listener(event);
        };
        ipcRenderer.on('integrated-terminal-event', handler);
        return () => {
            ipcRenderer.removeListener('integrated-terminal-event', handler);
        };
    },
    sendDiagnostic: (payload: unknown) => ipcRenderer.send('renderer-diagnostic', payload),
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld('electronAPI', api);
