import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import type { EditorSettings } from '../../../shared/gitClient';
import DiffViewer from '../../components/DiffViewer.vue';
import type { MonacoEditorActionZone } from '../../components/monacoEditorTypes';
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
            diffFontSize: 12,
            diffViewMode: 'full-file',
            showWhitespaceChanges: false,
            activeView: 'changes',
            showBranches: false,
        } satisfies EditorSettings,
    } satisfies DiffViewerSettingsMock);
}

const alertStub = {
    name: 'Alert',
    template: '<div><slot /></div>',
};

const iconButtonStub = {
    name: 'IconButton',
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
};

const monacoEditorStub = {
    name: 'MonacoEditor',
    props: ['actionZones'],
    template: '<div data-testid="monaco-editor" :data-action-zone-count="actionZones?.length ?? 0">Monaco</div>',
};

const monacoEditorSettingsButtonStub = {
    name: 'MonacoEditorSettingsButton',
    template: '<button type="button" data-testid="monaco-editor-settings">Settings</button>',
};

function mountDiffViewer(onlyWhitespaceChanges: boolean, actionZones?: MonacoEditorActionZone[]) {
    return mount(DiffViewer, {
        props: {
            state: {
                title: 'README.md',
                original: 'one\nline\n',
                modified: onlyWhitespaceChanges ? 'one\nline  \n' : 'one\nchanged\n',
                pathForLanguage: 'README.md',
                previewMessage: undefined,
                onlyWhitespaceChanges,
                metaItems: [],
                originalSrc: undefined,
                modifiedSrc: undefined,
            },
            actionZones,
        },
        global: {
            stubs: {
                Alert: alertStub,
                IconButton: iconButtonStub,
                MonacoEditor: monacoEditorStub,
                MonacoEditorSettingsButton: monacoEditorSettingsButtonStub,
            },
        },
    });
}

describe('DiffViewer', () => {
    beforeEach(() => {
        mockSettings = createMockSettings();
    });

    it('shows a header badge for whitespace-only diffs', () => {
        const wrapper = mountDiffViewer(true);

        expect(wrapper.text()).toContain('space-only-diff');
        expect(wrapper.find('[data-testid="monaco-editor-settings"]').exists()).toBe(true);
    });

    it('does not show the badge for content changes', () => {
        const wrapper = mountDiffViewer(false);

        expect(wrapper.text()).not.toContain('space-only-diff');
    });

    it('passes Monaco action zones through to the editor', () => {
        const wrapper = mountDiffViewer(false, [
            {
                id: 'hunk-1',
                afterLineNumber: 4,
                label: '#1 -1 +2',
                meta: 'Old 4:1  New 4:2',
                actions: [
                    {
                        id: 'stage:hunk-1',
                        label: 'Stage Change',
                        onClick: vi.fn(),
                    },
                ],
            },
        ]);

        expect(wrapper.get('[data-testid="monaco-editor"]').attributes('data-action-zone-count')).toBe('1');
    });
});
