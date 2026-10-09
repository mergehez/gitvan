/**
 * Single owner for the fetched "commits no remote has" set.
 *
 * `git rev-list HEAD --not --remotes` walks the whole unpublished history, and the history
 * view, the tag list and the commit detail pane all ask for it. The set is shared per
 * repository and dropped the same way the sidebar status is:
 * - any mutating git command invalidates the repository it ran in (see `git-common.ts`), so a
 *   commit, fetch, push or reset always re-reads it;
 * - the renderer's poll and the manual refresh invalidate everything, which is how edits made
 *   outside Gitvan are noticed.
 *
 * The in-flight promise is cached too, so two views opening at once share one walk.
 */
const unpushedCommits = new Map<string, Promise<Set<string>>>();

/** Returns the cached set, computing and caching it when it is missing. */
export async function readUnpushedCommitSet(repoPath: string, compute: () => Promise<Set<string>>): Promise<Set<string>> {
    const cached = unpushedCommits.get(repoPath);
    if (cached) {
        return await cached;
    }

    const request = (async () => {
        try {
            return await compute();
        } catch (error) {
            // A failed walk must not be cached, or the next caller would serve the failure.
            unpushedCommits.delete(repoPath);
            throw error;
        }
    })();

    unpushedCommits.set(repoPath, request);
    return await request;
}

/** The cached set without computing it, for callers that can fall back to a cheaper query. */
export function readCachedUnpushedCommitSet(repoPath: string): Promise<Set<string>> | undefined {
    return unpushedCommits.get(repoPath);
}

export function invalidateUnpushedCommitSet(repoPath: string) {
    unpushedCommits.delete(repoPath);
}

export function invalidateAllUnpushedCommitSets() {
    unpushedCommits.clear();
}
