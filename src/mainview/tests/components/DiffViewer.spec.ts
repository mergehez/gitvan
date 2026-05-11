import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import type { EditorSettings } from '../../../shared/gitClient';
import DiffViewer from '../../components/DiffViewer.vue';
import type { MonacoEditorActionZone } from '../../components/monacoEditorTypes';
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
            diffViewMode: 'full-file',
            diffIgnoredChars: '',
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

const monacoEditorStub = defineComponent({
    name: 'MonacoEditor',
    emits: ['visible-diff-change'],
    props: {
        actionZones: {
            type: Array,
            default: () => [],
        },
        diffIgnoredChars: {
            type: String,
            default: '',
        },
    },
    template: '<div data-testid="monaco-editor" :data-action-zone-count="actionZones.length" :data-diff-ignored-chars="diffIgnoredChars">Monaco</div>',
});

const monacoEditorSettingsButtonStub = {
    name: 'MonacoEditorSettingsButton',
    template: '<button type="button" data-testid="monaco-editor-settings">Settings</button>',
};

function mountDiffViewer(onlyWhitespaceChanges: boolean, noActualChange = false, actionZones?: MonacoEditorActionZone[]) {
    return mount(DiffViewer, {
        props: {
            state: {
                title: 'README.md',
                original: 'one\nline\n',
                modified: onlyWhitespaceChanges ? 'one\nline  \n' : 'one\nchanged\n',
                pathForLanguage: 'README.md',
                previewMessage: undefined,
                onlyWhitespaceChanges,
                noActualChange,
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
        const wrapper = mountDiffViewer(true, true);

        expect(wrapper.text()).toContain('space-only-diff');
        expect(wrapper.text()).toContain('no actual change');
        expect(wrapper.find('[data-testid="monaco-editor-settings"]').exists()).toBe(true);
    });

    it('does not show the badge for content changes', () => {
        const wrapper = mountDiffViewer(false);

        expect(wrapper.text()).not.toContain('space-only-diff');
        expect(wrapper.text()).not.toContain('no actual change');
    });

    it('shows the no-actual-change badge for ignored-char-only diffs', () => {
        const wrapper = mountDiffViewer(false, true);

        expect(wrapper.text()).not.toContain('space-only-diff');
        expect(wrapper.text()).toContain('no actual change');
    });

    it('shows the no-actual-change badge when Monaco reports no visible changes', async () => {
        const wrapper = mountDiffViewer(false, false, [
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

        wrapper.getComponent(monacoEditorStub).vm.$emit('visible-diff-change', false);
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain('no actual change');
    });

    it('passes Monaco action zones through to the editor', () => {
        const wrapper = mountDiffViewer(false, false, [
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

    it('passes ignored diff characters through to the editor', () => {
        mockSettings.state.diffIgnoredChars = ',;"\'';

        const wrapper = mountDiffViewer(false);

        expect(wrapper.get('[data-testid="monaco-editor"]').attributes('data-diff-ignored-chars')).toBe(',;"\'');
    });
});
