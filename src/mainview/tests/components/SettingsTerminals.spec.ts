import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import SettingsTerminals from '../../components/SettingsTerminals.vue';
import { useSettings } from '../../composables/useSettings';

type SettingsState = ReturnType<typeof useSettings>;

let mockSettings: Pick<SettingsState, 'state' | 'pickTerminalApplication' | 'addTerminal' | 'removeTerminal' | 'setDefaultTerminal'>;

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        isBusy: false,
    },
}));

describe('SettingsTerminals', () => {
    beforeEach(() => {
        mockSettings = reactive({
            state: {
                editors: [],
                defaultEditorPath: undefined,
                terminals: [
                    { path: '/bin/zsh', label: 'zsh', locked: true },
                    { path: '/opt/homebrew/bin/fish', label: 'fish', locked: false },
                ],
                defaultTerminalPath: '/bin/zsh',
                diffFontSize: 12,
                diffViewMode: 'full-file',
                showWhitespaceChanges: false,
                activeView: 'changes',
                showBranches: false,
            },
            pickTerminalApplication: vi.fn(),
            addTerminal: vi.fn(),
            removeTerminal: vi.fn(),
            setDefaultTerminal: vi.fn(),
        });
    });

    it('disables removal for locked built-in terminals', async () => {
        const wrapper = mount(SettingsTerminals, {
            global: {
                stubs: {
                    Button: {
                        template: '<button type="button"><slot /></button>',
                    },
                },
            },
        });

        const removeButtons = wrapper.findAll('button').filter((entry) => entry.text() === 'Remove');
        expect(removeButtons).toHaveLength(2);
        expect(removeButtons[0]!.attributes('disabled')).toBeDefined();
        expect(removeButtons[1]!.attributes('disabled')).toBeUndefined();
    });
});
