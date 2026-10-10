import { beforeEach, describe, expect, it } from 'vitest';
import type { AppBootstrapApi, AppMutationApi, RepoSidebarStatus, RepoStatusPatch, RepoSummary } from '../../../shared/types';
import { _coreState, emptyRepoSidebarStatus } from '../../composables/coreState';

function status(overrides: Partial<RepoSidebarStatus> = {}): RepoSidebarStatus {
    return { ...emptyRepoSidebarStatus(), ...overrides };
}

function summary(id: number, overrides: Partial<RepoSummary> = {}): RepoSummary {
    return {
        id,
        name: `repo-${id}`,
        path: `/tmp/repo-${id}`,
        sequence: id,
        groupId: undefined,
        groupName: undefined,
        accountId: undefined,
        accountLabel: undefined,
        terminalPath: undefined,
        addedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: undefined,
        ...overrides,
    };
}

function bootstrap(repos: Array<RepoSummary & { status: RepoSidebarStatus }>): AppBootstrapApi {
    return { repos, groups: [], accounts: [], selectedRepoId: repos[0]?.id, sandboxLabsAvailable: false };
}

function mutation(repos: RepoSummary[], statuses: RepoStatusPatch[] = []): AppMutationApi {
    return { repos, statuses, groups: [], accounts: [], selectedRepoId: repos[0]?.id, sandboxLabsAvailable: false };
}

beforeEach(() => {
    _coreState.applyBootstrap(bootstrap([]));
});

describe('coreState mutation merging', () => {
    it('keeps the identity of an unchanged repository and does not bump the counter', () => {
        _coreState.applyBootstrap(bootstrap([{ ...summary(1), status: status({ changedFiles: 3 }) }]));
        const before = _coreState.repos[0];
        const counter = _coreState.stateCounter;

        _coreState.applyMutation(mutation([summary(1)]));

        expect(_coreState.repos[0]).toBe(before);
        expect(_coreState.repos[0]?.status.changedFiles).toBe(3);
        expect(_coreState.stateCounter).toBe(counter);
    });

    it('gives a repository a new identity and status when a patch arrives', () => {
        _coreState.applyBootstrap(bootstrap([{ ...summary(1), status: status() }]));
        const before = _coreState.repos[0];
        const counter = _coreState.stateCounter;

        _coreState.applyMutation(mutation([summary(1)], [{ id: 1, status: status({ stagedFiles: 2 }) }]));

        expect(_coreState.repos[0]).not.toBe(before);
        expect(_coreState.repos[0]?.status.stagedFiles).toBe(2);
        expect(_coreState.stateCounter).toBe(counter + 1);
    });

    it('gives a repository a new identity when only its row changed', () => {
        _coreState.applyBootstrap(bootstrap([{ ...summary(1), status: status() }]));

        _coreState.applyMutation(mutation([summary(1, { name: 'renamed' })]));

        expect(_coreState.repos[0]?.name).toBe('renamed');
        expect(_coreState.repos[0]?.status).toBeDefined();
    });

    it('drops removed repositories and adds new ones without losing the rest', () => {
        _coreState.applyBootstrap(
            bootstrap([
                { ...summary(1), status: status() },
                { ...summary(2), status: status() },
            ])
        );
        const untouched = _coreState.repos[0];

        _coreState.applyMutation(mutation([summary(1), summary(3)], [{ id: 3, status: status({ behind: 1 }) }]));

        expect(_coreState.repos.map((repo) => repo.id)).toEqual([1, 3]);
        expect(_coreState.repos[0]).toBe(untouched);
        expect(_coreState.repos[1]?.status.behind).toBe(1);
    });

    it('falls back to an empty status for a repository it has never seen', () => {
        _coreState.applyMutation(mutation([summary(9)]));

        expect(_coreState.repos[0]?.status).toEqual(emptyRepoSidebarStatus());
    });

    it('applies the groups, accounts and selection it carries', () => {
        _coreState.applyMutation({
            repos: [],
            statuses: [],
            groups: [{ id: 4, name: 'Work', sequence: 1, repoCount: 0, createdAt: '2026-01-01T00:00:00.000Z' }],
            accounts: [],
            selectedRepoId: undefined,
            sandboxLabsAvailable: true,
        });

        expect(_coreState.repoGroups.map((group) => group.name)).toEqual(['Work']);
        expect(_coreState.selectedRepoId).toBeUndefined();
        expect(_coreState.sandboxLabsAvailable).toBe(true);
    });
});
