import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import SettingsEditors from '../../components/SettingsEditors.vue';
import type { useSettings } from '../../composables/useSettings';
import type { tasks } from '../../composables/useTasks';

type SettingsState = ReturnType<typeof useSettings>;
type TasksState = typeof tasks;
type SettingsEditorsMock = Pick<SettingsState, 'state' | 'pickEditorApplication' | 'addEditor' | 'removeEditor' | 'setDefaultEditor'>;

let mockSettings: SettingsEditorsMock;
let mockIsBusy = false;

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        get isBusy() {
            return mockIsBusy;
        },
    } as unknown as TasksState,
}));

const VS_CODE_PATH = '/Applications/Visual Studio Code.app';
const ZED_PATH = '/Applications/Zed.app';

const buttonStub = defineComponent({
    name: 'Button',
    emits: ['click'],
    props: {
        disabled: {
            type: Boolean,
            default: false,
        },
    },
    template: '<button type="button" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
});

function createMockSettings(overrides: Partial<SettingsState['state']> = {}) {
    return reactive({
        state: {
            editors: [
                { path: VS_CODE_PATH, label: 'Visual Studio Code' },
                { path: ZED_PATH, label: 'Zed' },
            ],
            defaultEditorPath: VS_CODE_PATH,
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
            ...overrides,
        },
        pickEditorApplication: vi.fn(),
        addEditor: vi.fn(() => Promise.resolve()),
        removeEditor: vi.fn(() => Promise.resolve()),
        setDefaultEditor: vi.fn(() => Promise.resolve()),
    } satisfies SettingsEditorsMock);
}

function mountSettingsEditors() {
    return mount(SettingsEditors, {
        global: {
            stubs: {
                Button: buttonStub,
            },
        },
    });
}

function editorRow(wrapper: ReturnType<typeof mountSettingsEditors>, path: string) {
    return wrapper.get(`[data-testid="settings-editor-${path}"]`);
}

function findButton(wrapper: ReturnType<typeof mountSettingsEditors>, label: string) {
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === label);
    expect(button).toBeTruthy();
    return button!;
}

describe('SettingsEditors', () => {
    beforeEach(() => {
        mockSettings = createMockSettings();
        mockIsBusy = false;
    });

    it('lists every configured editor with its label and path', () => {
        const wrapper = mountSettingsEditors();

        const rows = wrapper.findAll('[data-testid^="settings-editor-"]');
        expect(rows).toHaveLength(2);
        expect(rows[0]!.text()).toContain('Visual Studio Code');
        expect(rows[1]!.text()).toContain('Zed');
        expect(rows[0]!.text()).toContain(VS_CODE_PATH);
        expect(rows[1]!.text()).toContain(ZED_PATH);
    });

    it('shows the empty state when no editors are configured', () => {
        mockSettings = createMockSettings({ editors: [], defaultEditorPath: undefined });

        const wrapper = mountSettingsEditors();

        expect(wrapper.text()).toContain('No editors configured yet.');
        expect(wrapper.findAll('[data-testid^="settings-editor-"]')).toHaveLength(0);
    });

    it('marks the default editor and offers the action on the others', async () => {
        const wrapper = mountSettingsEditors();

        const defaultButton = editorRow(wrapper, VS_CODE_PATH)
            .findAll('button')
            .find((button) => button.text() === 'Default')!;
        const makeDefaultButton = editorRow(wrapper, ZED_PATH)
            .findAll('button')
            .find((button) => button.text() === 'Make default')!;

        expect(defaultButton.classes()).toContain('text-emerald-300');

        await makeDefaultButton.trigger('click');

        expect(mockSettings.setDefaultEditor).toHaveBeenCalledWith(ZED_PATH);
    });

    it('persists an editor chosen in the native picker', async () => {
        mockSettings.pickEditorApplication = vi.fn(() => Promise.resolve({ path: ZED_PATH, label: 'Zed' }));

        const wrapper = mountSettingsEditors();

        await findButton(wrapper, 'Add editor').trigger('click');
        await flushPromises();

        expect(mockSettings.pickEditorApplication).toHaveBeenCalledTimes(1);
        expect(mockSettings.addEditor).toHaveBeenCalledWith({ path: ZED_PATH, label: 'Zed' });
    });

    it('does not persist anything when the native picker is dismissed', async () => {
        mockSettings.pickEditorApplication = vi.fn(() => Promise.resolve(undefined));

        const wrapper = mountSettingsEditors();

        await findButton(wrapper, 'Add editor').trigger('click');
        await flushPromises();

        expect(mockSettings.pickEditorApplication).toHaveBeenCalledTimes(1);
        expect(mockSettings.addEditor).not.toHaveBeenCalled();
    });

    it('removes the editor the row belongs to', async () => {
        const wrapper = mountSettingsEditors();

        await findButtonInRow(wrapper, ZED_PATH, 'Remove').trigger('click');
        await flushPromises();

        expect(mockSettings.removeEditor).toHaveBeenCalledWith(ZED_PATH);
    });

    it('disables adding an editor while another task is running', async () => {
        mockIsBusy = true;

        const wrapper = mountSettingsEditors();

        expect(findButton(wrapper, 'Add editor').attributes('disabled')).toBeDefined();

        mockIsBusy = false;
        mockSettings.state = { ...mockSettings.state };
        await wrapper.vm.$nextTick();

        expect(findButton(wrapper, 'Add editor').attributes('disabled')).toBeUndefined();
    });
});

function findButtonInRow(wrapper: ReturnType<typeof mountSettingsEditors>, path: string, label: string) {
    const button = editorRow(wrapper, path)
        .findAll('button')
        .find((candidate) => candidate.text() === label);
    expect(button).toBeTruthy();
    return button!;
}
