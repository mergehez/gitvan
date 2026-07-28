import { contextBridge, ipcRenderer } from 'electron';
import { createPreloadApi } from '../electronUtils/helpers';
import type { NativeCommand } from '../shared/types';

const api = createPreloadApi<NativeCommand>(ipcRenderer, contextBridge);
export type ElectronAPI = typeof api;
