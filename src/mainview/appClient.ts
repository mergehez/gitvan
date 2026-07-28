import type { GitClientRequestApi } from '../electron/main.ts';
import { createAppClientPpc } from '../electronUtils/mainviewHelpers.ts';

export const appClientRpc = createAppClientPpc<GitClientRequestApi>(window.electronAPI);
