import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive } from 'vue';
import Settings from '../../components/Settings.vue';
import type { useSettings } from '../../composables/useSettings';

type SettingsState = ReturnType<typeof useSettings>;
type SettingsMock = Pick<SettingsState, 'isSettingsModalOpen' | 'selectedSettingsPanel'>;

let mockSettings: SettingsMock;

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

const closeButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    template: '<button type="button" data-testid="settings-close" @click="$emit(\'click\')"><slot /></button>',
});

function panelStub(name: string, testid: string) {
    return defineComponent({
        name,
        template: `<div data-testid="${testid}"></div>`,
    });
}

function mountSettings() {
    return mount(Settings, {
        global: {
            directives: {
                tooltip: {},
            },
            stubs: {
                IconButton: closeButtonStub,
                SettingsRepositories: panelStub('SettingsRepositories', 'panel-repositories'),
                SettingsEditors: panelStub('SettingsEditors', 'panel-editors'),
                SettingsTerminals: panelStub('SettingsTerminals', 'panel-terminals'),
                SettingsAccounts: panelStub('SettingsAccounts', 'panel-accounts'),
            },
        },
    });
}

function clickSidebarButton(wrapper: ReturnType<typeof mountSettings>, label: string) {
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === label);
    expect(button).toBeTruthy();
    return button!;
}

describe('Settings', () => {
    beforeEach(() => {
        mockSettings = reactive({
            isSettingsModalOpen: true,
            selectedSettingsPanel: 'repositories',
        } satisfies SettingsMock);
    });

    it('renders the four settings sections and the selected panel', () => {
        const wrapper = mountSettings();

        expect(wrapper.findAll('button').map((button) => button.text())).toEqual(expect.arrayContaining(['Repositories', 'Editors', 'Terminals', 'Accounts']));
        expect(wrapper.find('[data-testid="panel-repositories"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="panel-editors"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="panel-terminals"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="panel-accounts"]').exists()).toBe(false);
    });

    it('switches the visible panel from the sidebar', async () => {
        const wrapper = mountSettings();

        await clickSidebarButton(wrapper, 'Terminals').trigger('click');
        await nextTick();

        expect(mockSettings.selectedSettingsPanel).toBe('terminals');
        expect(wrapper.find('[data-testid="panel-terminals"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="panel-repositories"]').exists()).toBe(false);

        await clickSidebarButton(wrapper, 'Accounts').trigger('click');
        await nextTick();

        expect(mockSettings.selectedSettingsPanel).toBe('accounts');
        expect(wrapper.find('[data-testid="panel-accounts"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="panel-terminals"]').exists()).toBe(false);
    });

    it('marks the active section with the light button style', async () => {
        const wrapper = mountSettings();

        expect(clickSidebarButton(wrapper, 'Repositories').classes()).toContain('btn-light');
        expect(clickSidebarButton(wrapper, 'Editors').classes()).toContain('btn-secondary');

        await clickSidebarButton(wrapper, 'Editors').trigger('click');
        await nextTick();

        expect(clickSidebarButton(wrapper, 'Editors').classes()).toContain('btn-light');
        expect(clickSidebarButton(wrapper, 'Repositories').classes()).toContain('btn-secondary');
    });

    it('falls back to the editors panel for an unknown selection', () => {
        mockSettings.selectedSettingsPanel = 'editors';

        const wrapper = mountSettings();

        expect(wrapper.find('[data-testid="panel-editors"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="panel-repositories"]').exists()).toBe(false);
    });

    it('renders no settings content while the modal is closed', () => {
        mockSettings.isSettingsModalOpen = false;

        const wrapper = mountSettings();

        expect(wrapper.find('[data-testid="panel-repositories"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Repositories');
    });

    it('closes the settings modal when the dialog is dismissed', async () => {
        const wrapper = mountSettings();

        await wrapper.get('[data-testid="settings-close"]').trigger('click');
        await flushPromises();

        expect(mockSettings.isSettingsModalOpen).toBe(false);
        expect(wrapper.find('[data-testid="settings-close"]').exists()).toBe(false);
    });
});
