import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import type { EditorSettings } from '../../../shared/gitClient';
import DiffViewer from '../../components/DiffViewer.vue';
import type { HunkActionsConfig } from '../../components/DiffsDiffEditor.vue';
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

const diffsDiffEditorStub = defineComponent({
    name: 'DiffsDiffEditor',
    emits: ['visible-diff-change'],
    props: {
        diffIgnoredChars: {
            type: String,
            default: '',
        },
        hunkActionsConfig: {
            type: Object,
            default: undefined,
        },
    },
    template: '<div data-testid="diffs-diff-editor" :data-has-hunk-config="String(Boolean(hunkActionsConfig))" :data-diff-ignored-chars="diffIgnoredChars">Diffs</div>',
});

const monacoEditorSettingsButtonStub = {
    name: 'MonacoEditorSettingsButton',
    template: '<button type="button" data-testid="monaco-editor-settings">Settings</button>',
};

function mountDiffViewer(onlyWhitespaceChanges: boolean, noActualChange = false, hunkActionsConfig?: HunkActionsConfig) {
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
            hunkActionsConfig,
        },
        global: {
            stubs: {
                Alert: alertStub,
                IconButton: iconButtonStub,
                DiffsDiffEditor: diffsDiffEditorStub,
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

    it('shows the no-actual-change badge when the diff renderer reports no visible changes', async () => {
        const wrapper = mountDiffViewer(false, false);

        wrapper.getComponent(diffsDiffEditorStub).vm.$emit('visible-diff-change', false);
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain('no actual change');
    });

    it('passes hunk actions config through to the diff renderer', () => {
        const wrapper = mountDiffViewer(false, false, {
            kind: 'unstaged',
            oldSizeBytes: 100,
            newSizeBytes: 100,
            patch: '',
            onStage: vi.fn() as any,
        });

        expect(wrapper.get('[data-testid="diffs-diff-editor"]').attributes('data-has-hunk-config')).toBe('true');
    });

    it('passes ignored diff characters through to the diff renderer', () => {
        mockSettings.state.diffIgnoredChars = ',;"\'';

        const wrapper = mountDiffViewer(false);

        expect(wrapper.get('[data-testid="diffs-diff-editor"]').attributes('data-diff-ignored-chars')).toBe(',;"\'');
    });
});
