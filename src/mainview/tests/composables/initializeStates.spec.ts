import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppBootstrapApi } from '../../../shared/types';

const { refreshReposRun, applyBootstrap, loadActiveViewData, loadRepositoryStashes, loadMergeConflictState } = vi.hoisted(() => ({
    refreshReposRun: vi.fn(),
    applyBootstrap: vi.fn(),
    loadActiveViewData: vi.fn(async () => undefined),
    loadRepositoryStashes: vi.fn(async () => undefined),
    loadMergeConflictState: vi.fn(async () => undefined),
}));

const bootstrap: AppBootstrapApi = {
    repos: [],
    groups: [],
    accounts: [],
    selectedRepoId: undefined,
    sandboxLabsAvailable: false,
};

vi.mock('../../composables/useTasks', () => ({
    initTasks: vi.fn(),
    tasks: {
        isBusy: false,
        refreshRepos: { run: refreshReposRun },
        getBootstrap: { run: vi.fn(async () => bootstrap) },
        getEditorSettings: { run: vi.fn(async () => ({ activeView: 'changes' })) },
        getOAuthProviderSettings: { run: vi.fn(async () => ({})) },
    },
}));

vi.mock('../../composables/coreState', () => ({
    _coreState: { applyBootstrap },
}));

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => ({
        getSelectedRepo: () => ({
            loadActiveViewData,
            loadRepositoryStashes,
        }),
    }),
}));

vi.mock('../../composables/useMerge', () => ({
    useMergeHelper: () => ({ loadMergeConflictState }),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({ state: { activeView: 'changes' } }),
}));

vi.mock('../../appClient', () => ({
    appClientRpc: { request: { refreshRepos: refreshReposRun } },
}));

import { initializeStates } from '../../composables/initializeStates';

let appState: ReturnType<typeof initializeStates>;

beforeAll(async () => {
    mount(
        defineComponent({
            setup() {
                appState = initializeStates();
                return () => null;
            },
        })
    );

    // Let the bootstrap the mount kicked off settle before the assertions.
    await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(() => {
    applyBootstrap.mockReset();
    loadActiveViewData.mockClear();
    loadRepositoryStashes.mockClear();
    loadMergeConflictState.mockClear();
    refreshReposRun.mockReset();
    refreshReposRun.mockResolvedValue(bootstrap);
});

describe('initializeStates refresh paths', () => {
    it('only applies repository status when polling', async () => {
        await appState.refreshStatuses();

        expect(refreshReposRun).toHaveBeenCalledTimes(1);
        expect(applyBootstrap).toHaveBeenCalledWith(bootstrap);
        expect(loadActiveViewData).not.toHaveBeenCalled();
        expect(loadMergeConflictState).not.toHaveBeenCalled();
        expect(loadRepositoryStashes).not.toHaveBeenCalled();
    });

    it('reloads the active view, conflicts and stashes for a foreground refresh', async () => {
        await appState.refreshActiveView();

        expect(applyBootstrap).toHaveBeenCalledWith(bootstrap);
        expect(loadActiveViewData).toHaveBeenCalledTimes(1);
        expect(loadMergeConflictState).toHaveBeenCalledTimes(1);
        expect(loadRepositoryStashes).toHaveBeenCalledTimes(1);
    });
});
