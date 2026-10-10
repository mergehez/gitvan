import type { BrowserWindow } from 'electron';
import type { app as AppService } from '../backend/services/app.ts';
import { createElectronHelpers, type CreateAppClientRequestApi } from '../electronUtils/mainProloadHelpers.ts';
import { apiMethods } from '../shared/apiMethods.ts';
import { createApplicationMenu, createNativeMethods } from './nativeMethods.ts';

const helpers = createElectronHelpers({
    apiMethods: apiMethods as unknown as typeof AppService,
    getNativeMethods: (mainWindow, apiPost) => createNativeMethods({ mainWindow, apiPost }),
    getMenu: (mainWindow: BrowserWindow) => createApplicationMenu(mainWindow),
});

export type HandlersMap = ReturnType<typeof helpers.generateHandlers>;
export type AppClientRequestApi = CreateAppClientRequestApi<HandlersMap>;

helpers.start();
