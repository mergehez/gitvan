import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, reactive } from 'vue';
import type { EditorSettings, FileDiffData } from '../../../shared/gitClient';
import { useDiffViewer } from '../../composables/useDiffViewer';
import { useSettings } from '../../composables/useSettings';

type SettingsState = ReturnType<typeof useSettings>;
type DiffViewerSettingsMock = Pick<SettingsState, 'state'>;

let mockSettings: DiffViewerSettingsMock;

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

function createMockSettings() {
    return reactive({
        state: {
            editors: [],
            defaultEditorPath: undefined,
            terminals: [],
            defaultTerminalPath: undefined,
            diffFontSize: 12,
            diffViewMode: 'full-file',
            diffIgnoredChars: '',
            showWhitespaceChanges: false,
            activeView: 'changes',
            showBranches: false,
        } satisfies EditorSettings,
    } satisfies DiffViewerSettingsMock);
}

function createDiff(original: string, modified: string): FileDiffData {
    return {
        path: 'README.md',
        entry: {
            label: 'README.md',
            kind: 'unstaged',
            patch: '',
            original,
            modified,
            stats: {
                oldSizeBytes: original.length,
                newSizeBytes: modified.length,
                addedLines: 0,
                removedLines: 0,
            },
            hunks: [],
            supportsPartialStage: false,
            supportsPartialUnstage: false,
            supportsPartialDiscard: false,
        },
    };
}

describe('useDiffViewer', () => {
    beforeEach(() => {
        mockSettings = createMockSettings();
    });

    it('marks whitespace-only diffs as no actual change when whitespace is hidden', () => {
        const state = useDiffViewer(computed(() => createDiff('one\nline\n', 'one\nline  \n')));

        expect(state.value?.onlyWhitespaceChanges).toBe(true);
        expect(state.value?.noActualChange).toBe(true);
    });

    it('keeps ignored-character-only diffs out of the whitespace-only state', () => {
        mockSettings.state.diffIgnoredChars = ',';

        const state = useDiffViewer(computed(() => createDiff('const value = [1, 2];\n', 'const value = [1 2];\n')));

        expect(state.value?.onlyWhitespaceChanges).toBe(false);
        expect(state.value?.noActualChange).toBe(true);
    });
});
