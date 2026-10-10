import { reactive } from 'vue';
import type { AccountSummary, AppBootstrapApi, AppMutationApi, GroupSummary, Repo, RepoSidebarStatus, RepoSummary } from '../../shared/types';

/** Used for a repository this renderer has never seen and the mutation did not report a status for. */
export function emptyRepoSidebarStatus(): RepoSidebarStatus {
    return {
        branch: undefined,
        ahead: 0,
        behind: 0,
        hasRemote: false,
        hasUpstream: false,
        publishableCommits: 0,
        changedFiles: 0,
        stagedFiles: 0,
        unstagedFiles: 0,
        isDirty: false,
        error: undefined,
        lastScannedAt: undefined,
    };
}

function sameRepoRow(left: RepoSummary, right: RepoSummary) {
    return (
        left.id === right.id &&
        left.name === right.name &&
        left.path === right.path &&
        left.sequence === right.sequence &&
        left.groupId === right.groupId &&
        left.groupName === right.groupName &&
        left.accountId === right.accountId &&
        left.accountLabel === right.accountLabel &&
        left.terminalPath === right.terminalPath &&
        left.addedAt === right.addedAt &&
        left.lastOpenedAt === right.lastOpenedAt
    );
}

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

    /**
     * Applies a mutation response. Only the repositories whose row or status actually changed
     * become new objects, so a repository the mutation did not touch keeps its identity and the
     * views bound to it do not re-render.
     */
    applyMutation(next: AppMutationApi) {
        const previousById = new Map(_coreState.repos.map((repo) => [repo.id, repo]));
        const patchedStatusById = new Map(next.statuses.map((patch) => [patch.id, patch.status]));

        const repos = next.repos.map((summary) => {
            const previous = previousById.get(summary.id);
            const status = patchedStatusById.get(summary.id) ?? previous?.status ?? emptyRepoSidebarStatus();

            if (previous && previous.status === status && sameRepoRow(previous, summary)) {
                return previous;
            }

            return { ...summary, status };
        });

        const reposChanged = repos.length !== _coreState.repos.length || repos.some((repo, index) => repo !== _coreState.repos[index]);

        _coreState.repos = repos;
        _coreState.repoGroups = next.groups;
        _coreState.selectedRepoId = next.selectedRepoId;
        _coreState.accounts = next.accounts;
        _coreState.sandboxLabsAvailable = next.sandboxLabsAvailable;

        // Only the repository instances feed the counter's watcher; the rest are read directly.
        if (reposChanged) {
            _coreState.stateCounter++;
        }
    },
});
