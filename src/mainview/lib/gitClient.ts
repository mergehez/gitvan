import type { GitClientRequestApi } from '../../electron/bridge.ts';
import { createAppClientPpc } from '../../electronUtils/mainviewHelpers.ts';

export const appClientRpc = createAppClientPpc<GitClientRequestApi>(window.electronAPI);
