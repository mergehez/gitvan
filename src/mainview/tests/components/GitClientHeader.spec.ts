import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive } from 'vue';
import GitClientHeader from '../../components/GitClientHeader.vue';
import type { useAuth } from '../../composables/useAuth';
import type { useMergeHelper } from '../../composables/useMerge';
import type { useRepos } from '../../composables/useRepos';
import type { useSettings } from '../../composables/useSettings';

type AuthState = ReturnType<typeof useAuth>;
type SettingsState = ReturnType<typeof useSettings>;
type ReposState = ReturnType<typeof useRepos>;
type MergeState = ReturnType<typeof useMergeHelper>;

type HeaderAuthMock = { promptRepoAccountAssignment: ReturnType<typeof vi.fn> };
type HeaderSettingsMock = { state: { activeView: string; showBranches: boolean }; setActiveView: (view: string) => Promise<void> };
type HeaderReposMock = Pick<ReposState, 'getSelectedRepo'>;
type HeaderMergeMock = Pick<MergeState, 'mergeConflictState' | 'openMergeConflictModal'>;

let mockAuth: HeaderAuthMock;
let mockSettings: HeaderSettingsMock;
let mockRepos: HeaderReposMock;
let mockMerge: HeaderMergeMock;

const settingsState = reactive({
    activeView: 'changes',
    showBranches: false,
});

vi.mock('../../composables/useAuth.ts', () => ({
    useAuth: () => mockAuth as unknown as AuthState,
}));

vi.mock('../../composables/useSettings.ts', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

vi.mock('../../composables/useRepos.ts', () => ({
    useRepos: () => mockRepos as unknown as ReposState,
}));

vi.mock('../../composables/useMerge.ts', () => ({
    useMergeHelper: () => mockMerge as unknown as MergeState,
}));

function createRepo(
    overrides: Partial<{
        name: string;
        path: string;
        branch: string;
        ahead: number;
        behind: number;
        changedFiles: number;
        error: string;
        lastScannedAt: string;
        assignedAccountName: () => string | undefined;
    }> = {}
) {
    return {
        id: 1,
        name: overrides.name ?? 'Alpha',
        path: overrides.path ?? '/tmp/alpha',
        status: {
            branch: overrides.branch ?? 'main',
            ahead: overrides.ahead ?? 2,
            behind: overrides.behind ?? 1,
            changedFiles: overrides.changedFiles ?? 3,
            error: overrides.error,
            lastScannedAt: overrides.lastScannedAt === undefined ? '2026-03-27T10:00:00.000Z' : overrides.lastScannedAt,
        },
        assignedAccountName: overrides.assignedAccountName ?? (() => 'Work'),
    };
}

const buttonStub = defineComponent({
    name: 'Button',
    props: {
        severity: { type: String, required: false },
        small: { type: Boolean, default: false },
        smaller: { type: Boolean, default: false },
        disabled: { type: Boolean, default: false },
    },
    emits: ['click'],
    template: '<button type="button" :data-severity="severity" @click="$emit(\'click\', $event)"><slot /></button>',
});

const iconButtonStub = defineComponent({
    name: 'IconButton',
    props: {
        icon: { type: String, required: false },
        severity: { type: String, required: false },
    },
    emits: ['click'],
    template: '<button type="button" data-testid="header-health" @click="$emit(\'click\', $event)"><slot /></button>',
});

function mountHeader() {
    return mount(GitClientHeader, {
        global: {
            stubs: { Button: buttonStub, IconButton: iconButtonStub },
            directives: { tooltip: {} },
        },
    });
}

function buttonWithText(wrapper: ReturnType<typeof mountHeader>, text: string) {
    const button = wrapper.findAll('button').find((entry) => entry.text().startsWith(text));

    expect(button, `button starting with "${text}"`).toBeTruthy();

    return button!;
}

beforeEach(() => {
    settingsState.activeView = 'changes';
    settingsState.showBranches = false;

    mockAuth = {
        promptRepoAccountAssignment: vi.fn(() => Promise.resolve()),
    };
    mockSettings = {
        state: settingsState,
        setActiveView: vi.fn(async (view: string) => {
            settingsState.activeView = view as typeof settingsState.activeView;
        }),
    };
    mockRepos = {
        getSelectedRepo: () => createRepo() as never,
    };
    mockMerge = {
        mergeConflictState: undefined,
        openMergeConflictModal: vi.fn(),
    };
});

describe('GitClientHeader', () => {
    it('shows the repository headline and branch and toggles the branches sidebar', async () => {
        const wrapper = mountHeader();
        const toggle = wrapper.get('[data-testid="toggle-branches-sidebar"]');

        expect(toggle.text()).toContain('Alpha');
        expect(toggle.text()).toContain('main');

        await toggle.trigger('click');
        expect(settingsState.showBranches).toBe(true);

        await toggle.trigger('click');
        expect(settingsState.showBranches).toBe(false);
    });

    it('marks the active view and switches views when a nav item is clicked', async () => {
        settingsState.activeView = 'history';
        const wrapper = mountHeader();

        expect(buttonWithText(wrapper, 'History').attributes('data-severity')).toBe('success');
        expect(buttonWithText(wrapper, 'Changes').attributes('data-severity')).toBe('secondary');
        expect(wrapper.findAll('button').filter((entry) => entry.attributes('data-severity') === 'success')).toHaveLength(1);

        await buttonWithText(wrapper, 'Explorer').trigger('click');
        await nextTick();

        expect(mockSettings.setActiveView).toHaveBeenCalledWith('explorer');
        expect(buttonWithText(wrapper, 'Explorer').attributes('data-severity')).toBe('success');
        expect(buttonWithText(wrapper, 'History').attributes('data-severity')).toBe('secondary');
    });

    it('reveals the repository info panel from the health button', async () => {
        const wrapper = mountHeader();

        expect(wrapper.text()).not.toContain('Git repository');

        await wrapper.get('[data-testid="header-health"]').trigger('click');

        const panel = wrapper.text();
        expect(panel).toContain('Path:');
        expect(panel).toContain('/tmp/alpha');
        expect(panel).toContain('2026-03-27 10:00:00');
        expect(panel).toContain('Git repository');
        expect(panel).toContain('2 ahead / 1 behind');
        expect(panel).toContain('None');
    });

    it('reports an in-sync repository that has never been scanned', async () => {
        mockRepos = {
            getSelectedRepo: () => createRepo({ ahead: 0, behind: 0, lastScannedAt: '', error: 'not a git repository' }) as never,
        };
        const wrapper = mountHeader();

        await wrapper.get('[data-testid="header-health"]').trigger('click');

        expect(wrapper.text()).toContain('In sync');
        expect(wrapper.text()).toContain('Not scanned yet');
        expect(wrapper.text()).toContain('not a git repository');
    });

    it('offers the merge conflict button only while a merge is in progress', async () => {
        const idle = mountHeader();
        expect(idle.text()).not.toContain('Complete Merge');
        expect(idle.text()).not.toContain('Resolve Conflicts');

        mockMerge.mergeConflictState = { isMerging: true, conflictedFiles: ['a.ts', 'b.ts'] } as never;
        const conflicted = mountHeader();

        await buttonWithText(conflicted, 'Resolve Conflicts (2)').trigger('click');
        expect(mockMerge.openMergeConflictModal).toHaveBeenCalledTimes(1);

        mockMerge.mergeConflictState = { isMerging: true, conflictedFiles: [] } as never;
        const clean = mountHeader();

        expect(buttonWithText(clean, 'Complete Merge').exists()).toBe(true);
    });

    it('assigns a repository account from the header button', async () => {
        const wrapper = mountHeader();
        const accountButton = buttonWithText(wrapper, 'Account: Work');

        await accountButton.trigger('click');

        expect(mockAuth.promptRepoAccountAssignment).toHaveBeenCalledTimes(1);
        expect(mockAuth.promptRepoAccountAssignment.mock.calls[0]![0]).toMatchObject({ name: 'Alpha' });
        expect(mockAuth.promptRepoAccountAssignment.mock.calls[0]![1]).toBeInstanceOf(MouseEvent);
    });

    it('falls back to an empty label when the repository has no account', () => {
        mockRepos = { getSelectedRepo: () => createRepo({ assignedAccountName: () => undefined }) as never };
        const wrapper = mountHeader();

        expect(buttonWithText(wrapper, 'Account:').text()).toBe('Account:');
    });
});
