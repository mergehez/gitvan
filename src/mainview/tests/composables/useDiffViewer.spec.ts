import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, reactive } from 'vue';
import type { EditorSettings, FileDiffData } from '../../../shared/types';
import { useDiffViewer } from '../../composables/useDiffViewer';
import type { useSettings } from '../../composables/useSettings';

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
            diffViewWrap: false,
            diffViewMode: 'full-file',
            diffIgnoredChars: '',
            diffIgnoredCharsEnabled: true,
            showWhitespaceChanges: false,
            activeView: 'changes',
            showBranches: false,
        } satisfies EditorSettings,
    } satisfies DiffViewerSettingsMock);
}

function createDiff(original: string, modified: string, path = 'README.md'): FileDiffData {
    return {
        path,
        entry: {
            label: path,
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
            // hunks and partial support removed
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

    it('marks reordered imports of a script file as no actual change', () => {
        const state = useDiffViewer(
            computed(() => createDiff("import { b } from './b';\nimport { a } from './a';\n", "import { a } from './a';\nimport { b } from './b';\n", 'src/values.ts'))
        );

        expect(state.value?.noActualChange).toBe(true);
    });

    it('keeps reordered imports of a non-script file as an actual change', () => {
        const state = useDiffViewer(
            computed(() => createDiff("import { b } from './b';\nimport { a } from './a';\n", "import { a } from './a';\nimport { b } from './b';\n", 'notes.txt'))
        );

        expect(state.value?.noActualChange).toBe(false);
    });
});
