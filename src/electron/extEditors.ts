import { spawn } from 'node:child_process';
import { app as electronApp, BrowserWindow, dialog } from 'electron';
import { existsSync } from 'node:fs';
import type { EditorApp } from '../shared/gitClient.js';
import { app } from '../backend/services/app.js';

type OpenInEditorMode = 'default-or-pick' | 'pick' | 'default';

export async function pickEditorApplication(window: BrowserWindow | undefined) {
    if (!window) {
        return undefined;
    }

    const result = await dialog.showOpenDialog(window, {
        title: 'Open in Editor',
        buttonLabel: 'Open with Selected App',
        defaultPath: process.platform === 'darwin' ? '/Applications' : electronApp.getPath('home'),
        properties: ['openFile'],
        filters:
            process.platform === 'darwin'
                ? [{ name: 'Applications', extensions: ['app'] }]
                : process.platform === 'win32'
                  ? [{ name: 'Applications', extensions: ['exe'] }]
                  : undefined,
    });

    const path = result.canceled ? undefined : (result.filePaths[0] ?? undefined);

    if (!path) {
        return undefined;
    }

    let label = path.split('/').pop() || path;
    if (label.endsWith('.app') || label.endsWith('.exe')) {
        label = label.slice(0, -4);
    }

    return { path, label } satisfies EditorApp;
}

export async function openFileInEditor(window: BrowserWindow | undefined, ps: { repoId: number; path: string; mode?: OpenInEditorMode; editorPath?: string }) {
    const filePath = app.resolveRepoFilePath({ repoId: ps.repoId, path: ps.path });
    const editorSettings = app.getEditorSettings();
    const mode = ps.mode ?? 'default-or-pick';

    if (!existsSync(filePath)) {
        throw new Error('The selected file no longer exists in the working tree.');
    }

    const resolvedDefaultEditorPath = editorSettings.defaultEditorPath && existsSync(editorSettings.defaultEditorPath) ? editorSettings.defaultEditorPath : undefined;
    const resolvedExplicitEditorPath = ps.editorPath && existsSync(ps.editorPath) ? ps.editorPath : undefined;
    let applicationPath = resolvedExplicitEditorPath ?? (mode === 'pick' ? undefined : resolvedDefaultEditorPath);

    if (!applicationPath && ps.editorPath) {
        throw new Error('The selected editor no longer exists on disk.');
    }

    if (!applicationPath && mode !== 'default') {
        const selectedEditor = await pickEditorApplication(window);
        applicationPath = selectedEditor?.path ?? undefined;
    }

    if (!applicationPath) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const command = process.platform === 'darwin' ? 'open' : applicationPath;
        const args = process.platform === 'darwin' ? ['-a', applicationPath, filePath] : [filePath];

        const child = spawn(command, args, {
            stdio: 'ignore',
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if ((code ?? 1) !== 0) {
                reject(new Error('Failed to open the file in the selected application.'));
                return;
            }

            resolve();
        });
    });
}
