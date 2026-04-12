import { reactive } from 'vue';
import type { EditorApp, EditorSettings, OAuthProviderSettings, SettingsPanel, TerminalApp } from '../../shared/gitClient';
import { confirmAction } from '../lib/utils';
import { tasks } from './useTasks';
import { toast } from './useToast';

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
        async pickEditorApplication() {
            return await tasks.pickEditorApplication.run(undefined);
        },
        async pickTerminalApplication() {
            return await tasks.pickTerminalApplication.run(undefined);
        },
        async updateEditorSettings(nextSettings: EditorSettings) {
            const plainSettings = ((): EditorSettings => {
                const settings: EditorSettings = nextSettings;
                return {
                    editors: settings.editors.map((editor) => ({
                        path: editor.path,
                        label: editor.label.replace(/\.app$|\.exe$/i, ''),
                    })),
                    defaultEditorPath: settings.defaultEditorPath,
                    terminals: settings.terminals.map((terminal) => ({
                        path: terminal.path,
                        label: terminal.label.replace(/\.app$|\.exe$/i, ''),
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
                    label: editor.label,
                },
            ].sort((left, right) => left.label.localeCompare(right.label));

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
                    label: terminal.label,
                    locked: terminal.locked === true,
                },
            ].sort((left, right) => left.label.localeCompare(right.label));

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
