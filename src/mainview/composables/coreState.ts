import { reactive } from 'vue';
import type { AccountSummary, AppBootstrapApi, GroupSummary, Repo } from '../../shared/types';

export const _coreState = reactive({
    stateCounter: 0,
    accounts: [] as AccountSummary[],
    repos: [] as Repo[],
    repoGroups: [] as GroupSummary[],
    selectedRepoId: undefined as number | undefined,
    sandboxLabsAvailable: false,

    applyBootstrap(nextBootstrap: AppBootstrapApi) {
        _coreState.repos = nextBootstrap.repos;
        _coreState.repoGroups = nextBootstrap.groups;
        _coreState.selectedRepoId = nextBootstrap.selectedRepoId;
        _coreState.accounts = nextBootstrap.accounts;
        _coreState.sandboxLabsAvailable = nextBootstrap.sandboxLabsAvailable;
        _coreState.stateCounter++;
    },
});
