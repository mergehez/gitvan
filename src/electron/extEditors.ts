import { BrowserWindow, dialog, app as electronApp } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { app } from '../backend/services/app.js';
import type { TerminalApp } from '../shared/gitClient.js';

type OpenInEditorMode = 'default-or-pick' | 'pick' | 'default';

async function pickApplication(
    window: BrowserWindow | undefined,
    options: { title: string; buttonLabel: string; defaultPath: string; filters?: Array<{ name: string; extensions: string[] }> },
): Promise<{ path: string; label: string } | undefined> {
    if (!window) {
        return undefined;
    }

    const result = await dialog.showOpenDialog(window, {
        title: options.title,
        buttonLabel: options.buttonLabel,
        defaultPath: options.defaultPath,
        properties: ['openFile'],
        filters: options.filters,
    });

    const path = result.canceled ? undefined : (result.filePaths[0] ?? undefined);

    if (!path) {
        return undefined;
    }

    let label = path.split('/').pop() || path;
    if (label.endsWith('.app') || label.endsWith('.exe')) {
        label = label.slice(0, -4);
    }

    return { path, label };
}

export async function pickEditorApplication(window: BrowserWindow | undefined) {
    return await pickApplication(window, {
        title: 'Open in Editor',
        buttonLabel: 'Open with Selected App',
        defaultPath: process.platform === 'darwin' ? '/Applications' : electronApp.getPath('home'),
        filters:
            process.platform === 'darwin'
                ? [{ name: 'Applications', extensions: ['app'] }]
                : process.platform === 'win32'
                  ? [{ name: 'Applications', extensions: ['exe'] }]
                  : undefined,
    });
}

export async function pickTerminalApplication(window: BrowserWindow | undefined) {
    const selection = await pickApplication(window, {
        title: 'Select Terminal Executable',
        buttonLabel: 'Use Selected Terminal',
        defaultPath: process.platform === 'darwin' ? '/bin' : process.platform === 'win32' ? `${process.env.SystemRoot || 'C:\\Windows'}\\System32` : electronApp.getPath('home'),
        filters: process.platform === 'win32' ? [{ name: 'Executables', extensions: ['exe', 'cmd', 'bat'] }] : undefined,
    });

    return selection ? ({ ...selection, locked: false } satisfies TerminalApp) : undefined;
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
