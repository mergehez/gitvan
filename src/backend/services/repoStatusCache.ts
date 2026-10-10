import type { RepoSidebarStatus } from '../../shared/types.js';

/**
 * Single owner for cached per-repository sidebar status.
 *
 * Sidebar status is the most frequently recomputed value in the backend: every mutating
 * method ends in a bootstrap that asks for it for every tracked repository. Caching it per
 * repository path keeps a mutation from re-scanning repositories it did not touch.
 *
 * Freshness comes from two rules rather than from the TTL alone:
 * - `refreshRepos` (the 20 s renderer poll and the manual refresh) drops the cache first, so
 *   working-tree edits made outside Gitvan are still noticed on that cadence.
 * - Any mutating git command invalidates the repository it ran in, so the bootstrap that
 *   follows a mutation always re-reads that repository.
 *
 * The TTL therefore only bounds how old the *other* repositories' cached status may be, and
 * is kept slightly above the poll interval so a mutation normally reuses the last poll's
 * sweep instead of paying for one of its own.
 */
export const repoSidebarStatusTtlMs = 30_000;

type CacheEntry = {
    status: RepoSidebarStatus;
    expiresAt: number;
};

const statusCache = new Map<string, CacheEntry>();
const inFlightStatuses = new Map<string, Promise<RepoSidebarStatus>>();
/**
 * Bumped by `invalidateAllRepoSidebarStatuses`. A scan that started before the refresh finished
 * reading the old state, so it must not repopulate the cache the refresh just emptied.
 */
let invalidationGeneration = 0;
/** Repository paths dropped by a mutating command since the last `takeInvalidatedRepoPaths`. */
const invalidatedPaths = new Set<string>();

/**
 * Returns the cached status for a repository when it is still valid, otherwise computes it.
 * Concurrent callers for the same path share one computation.
 */
export async function readRepoSidebarStatus(repoPath: string, compute: () => Promise<RepoSidebarStatus>, ttlMs: number = repoSidebarStatusTtlMs): Promise<RepoSidebarStatus> {
    const cached = statusCache.get(repoPath);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.status;
    }

    const pending = inFlightStatuses.get(repoPath);
    if (pending) {
        return await pending;
    }

    const requestGeneration = invalidationGeneration;
    const request = (async () => {
        const status = await compute();

        // A failed scan is not cached so the next caller retries instead of serving an error.
        if (!status.error && requestGeneration === invalidationGeneration) {
            statusCache.set(repoPath, { status, expiresAt: Date.now() + ttlMs });
        }

        return status;
    })();

    inFlightStatuses.set(repoPath, request);

    try {
        return await request;
    } finally {
        inFlightStatuses.delete(repoPath);
    }
}

/** Drops one repository's status. Called for every git command that can change repository state. */
export function invalidateRepoSidebarStatus(repoPath: string) {
    statusCache.delete(repoPath);
    invalidatedPaths.add(repoPath);
}

export function invalidateAllRepoSidebarStatuses() {
    invalidationGeneration += 1;
    statusCache.clear();
    invalidatedPaths.clear();
}

/**
 * The repositories a mutating command has invalidated since this was last called. A mutation
 * response only has to refresh those statuses instead of sweeping every repository.
 */
export function takeInvalidatedRepoPaths(): Set<string> {
    const paths = new Set(invalidatedPaths);
    invalidatedPaths.clear();

    return paths;
}

/** Whether a status is already cached, used to spot a repository the renderer has never seen. */
export function hasCachedRepoSidebarStatus(repoPath: string): boolean {
    return statusCache.has(repoPath);
}
