import { reactive } from 'vue';
import type { AccountSummary, Repo, GroupSummary, AppBootstrapApi } from '../../shared/gitClient';

export const _coreState = reactive({
    stateCounter: 0,
    accounts: [] as AccountSummary[],
    repos: [] as Repo[],
    repoGroups: [] as GroupSummary[],
    selectedRepoId: undefined as number | undefined,

    applyBootstrap(nextBootstrap: AppBootstrapApi) {
        _coreState.repos = nextBootstrap.repos;
        _coreState.repoGroups = nextBootstrap.groups;
        _coreState.selectedRepoId = nextBootstrap.selectedRepoId;
        _coreState.accounts = nextBootstrap.accounts;
        _coreState.stateCounter++;
    },
});
