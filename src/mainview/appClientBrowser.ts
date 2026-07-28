/**
 * Browser-only dev mode adapter that replaces the Electrobun RPC bridge
 * with fetch() calls to the backend HTTP server.
 *
 * Activated when VITE_DEV2=true.
 */

import { createBrowserOnlyAppClientPpc } from '../electronUtils/mainviewHelpers';

const server = createBrowserOnlyAppClientPpc('5176');

export const resolveDev2ApiBase = server.resolveDev2ApiBase;
export const invoke = server.invoke;
export const installDev2GitClientBridge = server.installDev2GitClientBridge;
