import type { FileDiffData, RepoStashDetail, RepoStashEntry } from '../../../shared/types.js';
import type { GitRemoteAuth } from './git-common.js';
import { createRemoteGitEnv, runGit } from './git-common.js';
import {
    buildDiffStats,
    buildImagePreview,
    fileTooBigPreviewMessage,
    isImagePath,
    isPreviewTooLarge,
    parseCommitFilesWithConflicts,
    readGitRevisionFileBuffer,
    readGitRevisionFileSize,
} from './git-helpers.js';

/**
 * The revision that holds the modified side of one stashed path. A stash commit tracks only the
 * paths that existed at its base, so a file the stash introduced lives in its untracked commit or
 * its index commit instead — and the name-status of `stash show` does not say which.
 */
async function resolveStashModifiedRevision(repoPath: string, stashRef: string, filePath: string) {
    for (const revision of [stashRef, `${stashRef}^3`, `${stashRef}^2`]) {
        if ((await readGitRevisionFileSize(repoPath, `${revision}:${filePath}`)) !== undefined) {
            return revision;
        }
    }

    // A path the stash deleted is missing everywhere, and its diff is the deletion against the base.
    return stashRef;
}

export const stashGit = {
    async getRepoStashes(repoPath: string): Promise<RepoStashEntry[]> {
        const output = await runGit(['stash', 'list', '--format=%gd%x1f%gs%x1f%cr'], repoPath, [0, 1], true);

        return output
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const [ref = '', message = '', createdAtRelative = ''] = line.split('\u001f');
                return { ref, message, createdAtRelative: createdAtRelative || undefined } satisfies RepoStashEntry;
            });
    },
    async getRepoStashDetail(repoPath: string, stashRef: string): Promise<RepoStashDetail> {
        const stashes = await this.getRepoStashes(repoPath);
        const stash = stashes.find((entry) => entry.ref === stashRef);

        if (!stash) {
            throw new Error('The selected stash could not be found.');
        }

        const filesRaw = await runGit(['stash', 'show', '--name-status', '--include-untracked', stashRef], repoPath, [0, 1]);
        return { ...stash, files: parseCommitFilesWithConflicts(filesRaw, new Set<string>()) };
    },
    async getRepoStashFileDiff(repoPath: string, stashRef: string, filePath: string, previousPath?: string): Promise<FileDiffData> {
        const originalPath = previousPath ?? filePath;
        const baseRevision = `${stashRef}^1`;
        const modifiedRevision = await resolveStashModifiedRevision(repoPath, stashRef, filePath);

        const [patch, originalSize, modifiedSize] = await Promise.all([
            runGit(['diff', baseRevision, modifiedRevision, '--', filePath], repoPath, [0, 1]),
            readGitRevisionFileSize(repoPath, `${baseRevision}:${originalPath}`),
            readGitRevisionFileSize(repoPath, `${modifiedRevision}:${filePath}`),
        ]);

        const stats = buildDiffStats(patch || '', originalSize, modifiedSize);

        if (isPreviewTooLarge(originalSize, modifiedSize)) {
            return {
                path: filePath,
                entry: {
                    label: stashRef,
                    kind: 'staged',
                    patch: patch || fileTooBigPreviewMessage,
                    original: '',
                    modified: '',
                    stats,
                    previewMessage: fileTooBigPreviewMessage,
                },
            };
        }

        const [original, modified] = await Promise.all([
            runGit(['show', `${baseRevision}:${originalPath}`], repoPath, [0, 128], false),
            runGit(['show', `${modifiedRevision}:${filePath}`], repoPath, [0, 128], false),
        ]);
        const nonCodePreview = isImagePath(filePath)
            ? buildImagePreview(
                  filePath,
                  await readGitRevisionFileBuffer(repoPath, `${baseRevision}:${originalPath}`),
                  await readGitRevisionFileBuffer(repoPath, `${modifiedRevision}:${filePath}`)
              )
            : undefined;

        return {
            path: filePath,
            entry: {
                label: stashRef,
                kind: 'staged',
                patch: patch || 'No diff content was returned for this file.',
                original,
                modified,
                stats,
                nonCodePreview,
            },
        };
    },
    async stashRepoChanges(repoPath: string, auth?: GitRemoteAuth) {
        const env = await createRemoteGitEnv(repoPath, auth);
        const stashMessage = `stash-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await runGit(['stash', 'push', '--include-untracked', '-m', stashMessage], repoPath, [0], true, env);
    },
    async restoreRepoStash(repoPath: string, stashRef: string) {
        await runGit(['stash', 'pop', '--index', stashRef], repoPath, [0]);
    },
    async discardRepoStash(repoPath: string, stashRef: string) {
        await runGit(['stash', 'drop', stashRef], repoPath, [0]);
    },
};
