import { reactive } from 'vue';
import type { EditorApp, EditorSettings, OAuthProviderSettings, SettingsPanel, TerminalApp } from '../../shared/gitClient';
import { confirmAction } from '../lib/utils';
import { tasks } from './useTasks';
import { toast } from './useToast';

type OpenInEditorMode = 'default-or-pick' | 'pick' | 'default';

function normalizeApplicationLabel(path: string, label?: string) {
    const fallbackLabel = path.split(/[/\\]/).pop() || path;
    return (label?.trim() || fallbackLabel).replace(/\.app$|\.exe$/i, '');
}

function compareApplications(left: { path: string; label: string }, right: { path: string; label: string }, defaultPath: string | undefined) {
    if (left.path === defaultPath) {
        return -1;
    }

    if (right.path === defaultPath) {
        return 1;
    }

    return left.label.localeCompare(right.label, undefined, { sensitivity: 'accent' });
}

export function _useSettings() {
    return reactive({
        state: {
            editors: [],
            defaultEditorPath: undefined,
            terminals: [],
            defaultTerminalPath: undefined,
            diffFontSize: 12,
            diffViewMode: 'full-file',
            showWhitespaceChanges: false,
            activeView: 'changes',
            showBranches: false,
        } as EditorSettings,
        isSettingsModalOpen: false,
        selectedSettingsPanel: 'editors' as SettingsPanel,
        oauthProviderSettings: {
            githubClientId: '',
            gitlabClientId: '',
            gitlabHost: 'gitlab.com',
        } as OAuthProviderSettings,
        async _patchEditorSettings(nextSettings: Partial<EditorSettings>) {
            await this.updateEditorSettings({
                ...this.state,
                ...nextSettings,
            });
        },

        async openSettingsWindow(panel?: SettingsPanel) {
            this.selectedSettingsPanel = panel ?? 'editors';
            this.isSettingsModalOpen = true;
        },
        closeSettingsWindow() {
            this.isSettingsModalOpen = false;
        },
        getOpenWithEditors() {
            return this.state.editors
                .map((editor) => ({
                    path: editor.path,
                    label: normalizeApplicationLabel(editor.path, editor.label),
                }))
                .toSorted((left, right) => compareApplications(left, right, this.state.defaultEditorPath));
        },
        async pickEditorApplication() {
            const editor = await tasks.pickEditorApplication.run(undefined);

            return editor
                ? {
                      path: editor.path,
                      label: normalizeApplicationLabel(editor.path, editor.label),
                  }
                : undefined;
        },
        async pickTerminalApplication() {
            const terminal = await tasks.pickTerminalApplication.run(undefined);

            return terminal
                ? {
                      path: terminal.path,
                      label: normalizeApplicationLabel(terminal.path, terminal.label),
                      locked: terminal.locked,
                  }
                : undefined;
        },
        async openRepoPathInEditor(params: { repoId: number; path: string; mode?: OpenInEditorMode; editorPath?: string }, identifier?: string) {
            const mode = params.mode ?? 'default-or-pick';

            const pickEditorPath = async () => {
                const selectedEditor = await this.pickEditorApplication();
                return selectedEditor?.path;
            };

            const openWithEditor = async (editorPath: string) => {
                await tasks.openFileInEditor.run({ repoId: params.repoId, path: params.path, editorPath }, identifier);
            };

            if (params.editorPath) {
                await openWithEditor(params.editorPath);
                return;
            }

            if (mode === 'pick') {
                const pickedEditorPath = await pickEditorPath();
                if (!pickedEditorPath) {
                    return;
                }

                await openWithEditor(pickedEditorPath);
                return;
            }

            const defaultEditorPath = this.state.defaultEditorPath;
            if (!defaultEditorPath) {
                if (mode === 'default') {
                    return;
                }

                const pickedEditorPath = await pickEditorPath();
                if (!pickedEditorPath) {
                    return;
                }

                await openWithEditor(pickedEditorPath);
                return;
            }

            try {
                await openWithEditor(defaultEditorPath);
            } catch (error) {
                const shouldRetryWithPicker = mode === 'default-or-pick' && error instanceof Error && error.message === 'The selected editor no longer exists on disk.';

                if (!shouldRetryWithPicker) {
                    throw error;
                }

                const pickedEditorPath = await pickEditorPath();
                if (!pickedEditorPath) {
                    return;
                }

                await openWithEditor(pickedEditorPath);
            }
        },
        async updateEditorSettings(nextSettings: EditorSettings) {
            const plainSettings = ((): EditorSettings => {
                const settings: EditorSettings = nextSettings;
                return {
                    editors: settings.editors.map((editor) => ({
                        path: editor.path,
                        label: normalizeApplicationLabel(editor.path, editor.label),
                    })),
                    defaultEditorPath: settings.defaultEditorPath,
                    terminals: settings.terminals.map((terminal) => ({
                        path: terminal.path,
                        label: normalizeApplicationLabel(terminal.path, terminal.label),
                        locked: terminal.locked === true,
                    })),
                    defaultTerminalPath: settings.defaultTerminalPath,
                    diffFontSize: settings.diffFontSize,
                    diffViewMode: settings.diffViewMode,
                    showWhitespaceChanges: settings.showWhitespaceChanges,
                    activeView: settings.activeView,
                    showBranches: settings.showBranches,
                };
            })();

            this.state = await tasks.updateEditorSettings.run({ settings: plainSettings });
        },
        async setActiveView(nextView: EditorSettings['activeView']) {
            this.state.showBranches = false;
            if (this.state.activeView === nextView) {
                return;
            }

            this.state.activeView = nextView;
            await this._patchEditorSettings({ activeView: nextView });
        },
        async addEditor(editor: EditorApp) {
            const nextEditors = [
                ...this.state.editors.filter((existing) => existing.path !== editor.path),
                {
                    path: editor.path,
                    label: normalizeApplicationLabel(editor.path, editor.label),
                },
            ].sort((left, right) => compareApplications(left, right, this.state.defaultEditorPath));

            await this._patchEditorSettings({
                editors: nextEditors,
                defaultEditorPath:
                    this.state.defaultEditorPath && nextEditors.some((existing) => existing.path === this.state.defaultEditorPath) ? this.state.defaultEditorPath : editor.path,
            });
        },
        async addTerminal(terminal: TerminalApp) {
            const nextTerminals = [
                ...this.state.terminals.filter((existing) => existing.path !== terminal.path),
                {
                    path: terminal.path,
                    label: normalizeApplicationLabel(terminal.path, terminal.label),
                    locked: terminal.locked === true,
                },
            ].sort((left, right) => compareApplications(left, right, this.state.defaultTerminalPath));

            await this._patchEditorSettings({
                terminals: nextTerminals,
                defaultTerminalPath:
                    this.state.defaultTerminalPath && nextTerminals.some((existing) => existing.path === this.state.defaultTerminalPath)
                        ? this.state.defaultTerminalPath
                        : terminal.path,
            });
        },
        async removeEditor(path: string) {
            const editor = this.state.editors.find((entry) => entry.path === path);
            const confirmed = await confirmAction({
                title: 'Remove editor',
                message: `Remove ${editor?.label ?? 'this editor'}?`,
                detail: 'This removes the saved editor entry from Gitvan settings.',
                confirmLabel: 'Remove editor',
            });

            if (!confirmed) {
                return;
            }

            const nextEditors = this.state.editors.filter((editor) => editor.path !== path);

            await this._patchEditorSettings({
                editors: nextEditors,
                defaultEditorPath: this.state.defaultEditorPath === path ? nextEditors[0]?.path : this.state.defaultEditorPath,
            });
        },
        async removeTerminal(path: string) {
            const terminal = this.state.terminals.find((entry) => entry.path === path);
            if (terminal?.locked) {
                return;
            }

            const confirmed = await confirmAction({
                title: 'Remove terminal',
                message: `Remove ${terminal?.label ?? 'this terminal'}?`,
                detail: 'This removes the saved terminal entry from Gitvan settings.',
                confirmLabel: 'Remove terminal',
            });

            if (!confirmed) {
                return;
            }

            const nextTerminals = this.state.terminals.filter((terminalEntry) => terminalEntry.path !== path);

            await this._patchEditorSettings({
                terminals: nextTerminals,
                defaultTerminalPath: this.state.defaultTerminalPath === path ? nextTerminals[0]?.path : this.state.defaultTerminalPath,
            });
        },
        async setDefaultEditor(path: string | undefined) {
            await this._patchEditorSettings({ defaultEditorPath: path });
        },
        async setDefaultTerminal(path: string | undefined) {
            await this._patchEditorSettings({ defaultTerminalPath: path });
        },
        async setDiffFontSize(fontSize: number) {
            await this._patchEditorSettings({ diffFontSize: fontSize });
        },
        async setDiffViewMode(diffViewMode: EditorSettings['diffViewMode']) {
            await this._patchEditorSettings({ diffViewMode });
        },
        async setShowWhitespaceChanges(showWhitespaceChanges: boolean) {
            await this._patchEditorSettings({ showWhitespaceChanges });
        },
        async saveOAuthProviderSettings(nextSettings: OAuthProviderSettings) {
            this.oauthProviderSettings = await tasks.updateOAuthProviderSettings.run({ settings: nextSettings });

            toast.showSuccessToast('OAuth settings saved.');
        },
    });
}

let settingsSingleton: ReturnType<typeof _useSettings> | undefined = undefined;

export function useSettings() {
    settingsSingleton ??= _useSettings();
    return settingsSingleton!;
}
