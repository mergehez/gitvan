/**
 * Raised when a repository-scoped request arrives after that repository was removed. The client
 * can race a removal — a delete, a reset — against a request it already had in flight, so the
 * backend answers with this instead of a TypeError and callers can treat it as a known outcome.
 */
export const repositoryNotFoundMessage = 'The selected repository could not be found.';

export function isRepositoryNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

    return message.includes(repositoryNotFoundMessage);
}

/**
 * Runs an automatic load that can lose the race against a repository being removed. Only that
 * outcome is swallowed; anything else still propagates so real failures keep surfacing.
 */
export async function ignoreRemovedRepository<T>(load: () => Promise<T>): Promise<T | undefined> {
    try {
        return await load();
    } catch (error) {
        if (!isRepositoryNotFoundError(error)) {
            throw error;
        }

        return undefined;
    }
}
