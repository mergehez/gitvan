import { readFileSync } from 'node:fs';
import { createBrowserOnlyDevServer } from '../electronUtils/browserOnlyHelpers.ts';
import { runWithRequestAbortSignal } from '../electronUtils/requestContext.ts';
import { apiMethods } from '../shared/apiMethods';
import { isRepositoryNotFoundError } from '../shared/repositoryErrors.ts';
import { app } from './services/app';
import { useDb } from './services/database';

type NativePickerStub = {
    directory?: string;
    editor?: { path: string; label?: string };
    terminal?: { path: string; label?: string; locked?: boolean };
};

/**
 * What the browser run asks a picker to answer with. There is no native host to open a dialog, so
 * a spec writes this file and the stand-ins below read it; see `playwright/support/nativeStub.ts`.
 */
function readNativePickerStub(): NativePickerStub {
    const stubPath = process.env.GITVAN_NATIVE_STUB_FILE;
    if (!stubPath) {
        return {};
    }

    try {
        return JSON.parse(readFileSync(stubPath, 'utf8')) as NativePickerStub;
    } catch {
        return {};
    }
}

/** The label the native pickers derive from a chosen application path. */
function applicationLabelFromPath(path: string) {
    const label = path.split('/').pop() || path;

    return label.endsWith('.app') || label.endsWith('.exe') ? label.slice(0, -4) : label;
}

/**
 * The native methods browser dev mode answers instead of reporting the boundary. Opening the
 * provider's sign-in page and choosing a file or application have no native host to run them, but
 * the flows that call them have to be able to finish there.
 */
const nativeStandins: Record<string, (params: any) => Promise<unknown>> = {
    openExternalUrl: async (params: { url: string }) => {
        console.log(`[devServer] openExternalUrl: ${params?.url ?? ''}`);

        return { opened: true };
    },
    pickDirectory: async () => readNativePickerStub().directory,
    pickEditorApplication: async () => {
        const editor = readNativePickerStub().editor;

        return editor ? { path: editor.path, label: editor.label ?? applicationLabelFromPath(editor.path) } : undefined;
    },
    pickTerminalApplication: async () => {
        const terminal = readNativePickerStub().terminal;

        return terminal ? { path: terminal.path, label: terminal.label ?? applicationLabelFromPath(terminal.path), locked: terminal.locked ?? false } : undefined;
    },
};

export const ready = createBrowserOnlyDevServer(app, apiMethods, useDb(), {
    runInRequestScope: (signal, task) => runWithRequestAbortSignal(signal, task),
    nativeStandins,
    // A repository removed mid-request is a race the client handles, not an internal fault.
    classifyError: (_error, message) => (isRepositoryNotFoundError(message) ? 'repository-not-found' : undefined),
});
