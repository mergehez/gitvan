import { onMounted, onUnmounted, watch } from 'vue';
import { gitClientRpc } from '../lib/gitClient.ts';
import { useSettings } from './useSettings.ts';
import { useMergeHelper } from './useMerge.ts';
import type { AppBootstrapApi } from '../../shared/gitClient.ts';
import { runWithButtonLoadingIndicatorSilenced } from '../lib/loadingIndicatorState.ts';
import { initTasks, tasks } from './useTasks.ts';
import { useRepos } from './useRepos.ts';
import { _coreState } from './coreState.ts';

export async function applyMutation(nextBootstrap: AppBootstrapApi) {
    _coreState.applyBootstrap(nextBootstrap);
    const repos = useRepos();
    const repo = repos.getSelectedRepo();
    if (repo) await repo.loadActiveViewData();
    await useMergeHelper().loadMergeConflictState();
    if (repo) await repo.loadRepositoryStashes();
}

function createGitClientAppState() {
    const settings = useSettings();
    const mergeHelper = useMergeHelper();
    const repos = useRepos();

    watch(
        () => settings.state.activeView,
        () => {
            repos.getSelectedRepo()?.loadActiveViewData();
        }
    );

    return {
        async loadBootstrap() {
            const nextBootstrap = await tasks.getBootstrap.run(undefined);

            _coreState.applyBootstrap(nextBootstrap);
            settings.state = await tasks.getEditorSettings.run(undefined);
            settings.oauthProviderSettings = await tasks.getOAuthProviderSettings.run(undefined);
            hasLoadedBootstrap = true;

            const nextActiveView = settings.state.activeView;
            const activeViewChanged = settings.state.activeView !== nextActiveView;
            settings.state.activeView = nextActiveView;
            settings.state.showBranches = false;

            if (!activeViewChanged) {
                const repo = repos.getSelectedRepo();
                if (repo) await repo.loadActiveViewData();
            }

            await mergeHelper.loadMergeConflictState();
            const repo = repos.getSelectedRepo();
            if (repo) await repo.loadRepositoryStashes();
        },

        async refreshForPolling() {
            if (tasks.isBusy) {
                return;
            }

            try {
                await runWithButtonLoadingIndicatorSilenced(async () => {
                    const nextBootstrap = await gitClientRpc.request.refreshRepos(undefined);
                    await applyMutation(nextBootstrap);
                });
            } catch (error) {
                console.error('Polling refresh failed', error);
            }
        },
    };
}

type GitClientAppState = ReturnType<typeof createGitClientAppState>;

type GitClientAppHotData = {
    sharedState?: GitClientAppState | undefined;
    hasLoadedBootstrap?: boolean;
};

const hotData = import.meta.hot?.data as GitClientAppHotData | undefined;

let sharedState: GitClientAppState | undefined = hotData?.sharedState;
let consumerCount = 0;
let pollingHandle: number | undefined = undefined;
let hasLoadedBootstrap = hotData?.hasLoadedBootstrap ?? false;
let lastForegroundRefreshAt = 0;
let foregroundRefreshHandle: number | undefined = undefined;

function clearForegroundRefresh() {
    if (foregroundRefreshHandle !== undefined) {
        window.clearTimeout(foregroundRefreshHandle);
        foregroundRefreshHandle = undefined;
    }
}

function refreshForForeground() {
    if (!sharedState || document.visibilityState === 'hidden') {
        return;
    }

    if (tasks.isBusy) {
        clearForegroundRefresh();
        foregroundRefreshHandle = window.setTimeout(() => {
            foregroundRefreshHandle = undefined;
            refreshForForeground();
        }, 300);
        return;
    }

    const now = Date.now();
    if (now - lastForegroundRefreshAt < 1500) {
        return;
    }

    lastForegroundRefreshAt = now;
    void sharedState.refreshForPolling();
}

function scheduleForegroundRefresh(delay = 120) {
    clearForegroundRefresh();
    foregroundRefreshHandle = window.setTimeout(() => {
        foregroundRefreshHandle = undefined;
        refreshForForeground();
    }, delay);
}

function onWindowFocus() {
    scheduleForegroundRefresh();
}

function onDocumentVisibilityChange() {
    if (document.visibilityState === 'visible') {
        scheduleForegroundRefresh();
    }
}

if (import.meta.hot) {
    import.meta.hot.accept();
    import.meta.hot.dispose((data) => {
        const nextData = data as GitClientAppHotData;
        nextData.sharedState = sharedState;
        nextData.hasLoadedBootstrap = hasLoadedBootstrap;
    });
}

export function initializeStates() {
    initTasks();
    sharedState ??= createGitClientAppState();

    onMounted(() => {
        consumerCount++;

        if (consumerCount !== 1) {
            return;
        }

        if (!hasLoadedBootstrap) {
            void sharedState!.loadBootstrap();
        } else {
            scheduleForegroundRefresh(0);
        }

        window.addEventListener('focus', onWindowFocus);
        document.addEventListener('visibilitychange', onDocumentVisibilityChange);

        pollingHandle = window.setInterval(() => {
            void sharedState!.refreshForPolling();
        }, 20_000);
    });

    onUnmounted(() => {
        consumerCount = Math.max(0, consumerCount - 1);

        if (consumerCount === 0 && pollingHandle !== undefined) {
            window.clearInterval(pollingHandle);
            pollingHandle = undefined;
        }

        if (consumerCount !== 0) {
            return;
        }

        clearForegroundRefresh();
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
    });

    return sharedState;
}
