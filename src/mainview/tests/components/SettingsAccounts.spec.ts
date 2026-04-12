import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import type { AccountSummary } from '../../../shared/gitClient';
import SettingsAccounts from '../../components/SettingsAccounts.vue';
import { useAuth } from '../../composables/useAuth';
import { useSettings } from '../../composables/useSettings';
import { tasks } from '../../composables/useTasks';

type AuthState = ReturnType<typeof useAuth>;
type SettingsState = ReturnType<typeof useSettings>;
type TasksState = typeof tasks;
type SettingsAccountsAuthMock = Pick<AuthState, 'accounts' | 'oauthDeviceFlow' | 'reorderAccount'>;

let mockAuth: SettingsAccountsAuthMock;

vi.mock('../../composables/useAuth', () => ({
    useAuth: () => mockAuth as unknown as AuthState,
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () =>
        ({
            oauthProviderSettings: {
                githubClientId: '',
                gitlabClientId: '',
                gitlabHost: 'gitlab.com',
            },
        }) as SettingsState,
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: { isBusy: false } as unknown as TasksState,
}));

function createAccount(id: number, label: string, isDefault = false): AccountSummary {
    return {
        id,
        label,
        provider: 'github',
        authKind: 'oauth',
        username: label.toLowerCase(),
        host: 'github.com',
        hasSecret: true,
        isDefault,
        createdAt: '2026-04-01T00:00:00.000Z',
    };
}

function createMockAuth() {
    return reactive({
        accounts: [createAccount(1, 'Work', true), createAccount(2, 'Personal')],
        oauthDeviceFlow: undefined,
        reorderAccount: vi.fn(() => Promise.resolve()),
    } satisfies SettingsAccountsAuthMock);
}

const buttonStub = defineComponent({
    name: 'Button',
    emits: ['click'],
    template: '<button :disabled="$attrs.disabled" @click="$emit(\'click\', $event)"><slot /></button>',
});

const iconButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    template: '<button :disabled="$attrs.disabled" @click="$emit(\'click\', $event)"><slot /></button>',
});

const draggableListStub = defineComponent({
    name: 'DraggableList',
    props: {
        items: {
            type: Array,
            required: true,
        },
        onSelect: {
            type: Function,
            required: false,
        },
        onReorder: {
            type: Function,
            required: true,
        },
    },
    template: `
        <div>
            <div v-for="(entry, index) in items" :key="entry.id">
                <button type="button" @click="onSelect && onSelect(entry)">{{ entry.title }}</button>
                <button type="button" :aria-label="'Reorder ' + entry.title + ' down'" @click="onReorder({ item: entry, fromIndex: index, toIndex: index + 1 })">
                    reorder
                </button>
            </div>
        </div>
    `,
});

function mountSettingsAccounts() {
    return mount(SettingsAccounts, {
        global: {
            stubs: {
                Button: buttonStub,
                DraggableList: draggableListStub,
                IconButton: iconButtonStub,
            },
        },
    });
}

describe('SettingsAccounts', () => {
    beforeEach(() => {
        mockAuth = createMockAuth();
    });

    it('reorders accounts from the sidebar list', async () => {
        const wrapper = mountSettingsAccounts();

        await wrapper.get('button[aria-label="Reorder Work down"]').trigger('click');

        expect(mockAuth.reorderAccount).toHaveBeenCalledWith(1, 1);
    });
});
