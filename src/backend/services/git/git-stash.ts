import type { FileDiffData, RepoStashDetail, RepoStashEntry } from '../../../shared/gitClient.js';
import { createRemoteGitEnv, GitRemoteAuth, runGit } from './git-common.js';
import {
    buildDiffStats,
    buildImagePreview,
    fileTooBigPreviewMessage,
    isImagePath,
    isPreviewTooLarge,
    parseCommitFilesWithConflicts,
    parseUnifiedDiffHunks,
    readGitRevisionFileBuffer,
    readGitRevisionFileSize,
} from './git-helpers.js';

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

        const [patch, originalSize, modifiedSize] = await Promise.all([
            runGit(['diff', baseRevision, stashRef, '--', filePath], repoPath, [0, 1]),
            readGitRevisionFileSize(repoPath, `${baseRevision}:${originalPath}`),
            readGitRevisionFileSize(repoPath, `${stashRef}:${filePath}`),
        ]);

        const stats = buildDiffStats(patch || '', originalSize, modifiedSize);
        const hunks = parseUnifiedDiffHunks(patch || '');

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
                    hunks,
                    supportsPartialStage: false,
                    supportsPartialUnstage: false,
                    supportsPartialDiscard: false,
                    previewMessage: fileTooBigPreviewMessage,
                },
            };
        }

        const [original, modified] = await Promise.all([
            runGit(['show', `${baseRevision}:${originalPath}`], repoPath, [0, 128], false),
            runGit(['show', `${stashRef}:${filePath}`], repoPath, [0, 128], false),
        ]);
        const nonCodePreview = isImagePath(filePath)
            ? buildImagePreview(
                  filePath,
                  await readGitRevisionFileBuffer(repoPath, `${baseRevision}:${originalPath}`),
                  await readGitRevisionFileBuffer(repoPath, `${stashRef}:${filePath}`)
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
                hunks,
                supportsPartialStage: false,
                supportsPartialUnstage: false,
                supportsPartialDiscard: false,
                nonCodePreview,
            },
        };
    },
    async stashRepoChanges(repoPath: string, auth: GitRemoteAuth | undefined = undefined) {
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
