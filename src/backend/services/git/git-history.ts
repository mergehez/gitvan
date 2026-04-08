import type { CommitDetail, FileDiffData, HistoryData } from '../../../shared/gitClient.js';
import { runGit } from './git-common.js';
import {
    buildDiffStats,
    buildImagePreview,
    extractConflictPathsFromCommitBody,
    fileTooBigPreviewMessage,
    isImagePath,
    isPreviewTooLarge,
    parseCommitFilesWithConflicts,
    parseRefs,
    readGitRevisionFileBuffer,
    readGitRevisionFileSize,
} from './git-helpers.js';

export const historyGit = {
    async _getUnpushedCommitSet(repoPath: string, maxCount?: number) {
        const args = ['rev-list'];

        if (maxCount) {
            args.push('--max-count', String(maxCount));
        }

        args.push('HEAD', '--not', '--remotes');

        const output = await runGit(args, repoPath, [0, 128]);

        return new Set(
            output
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
        );
    },
    async getRepoHistory(repoPath: string): Promise<HistoryData> {
        const [output, unpushedCommits] = await Promise.all([
            runGit(['log', '--date=iso-strict', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%d%x1f%s', '-n', '60'], repoPath),
            this._getUnpushedCommitSet(repoPath, 60),
        ]);

        return {
            commits: output
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                    const [sha, shortSha, authorName, authorEmail, authoredAt, refsRaw, summary] = line.split('\u001f');

                    const commit = { sha, shortSha, summary, authorName, authorEmail, authoredAt, refs: parseRefs(refsRaw ?? ''), isUnpushed: false };
                    return { ...commit, isUnpushed: unpushedCommits.has(commit.sha) };
                }),
        };
    },
    async getCommitDetail(repoPath: string, commitSha: string): Promise<CommitDetail> {
        const [summaryRaw, filesRaw, patch, unpushedCommits] = await Promise.all([
            runGit(['show', '-s', '--date=iso-strict', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%d%x1f%s%x1f%b', commitSha], repoPath),
            runGit(['show', '-m', '--first-parent', '--name-status', '--format=', '--find-renames', commitSha], repoPath),
            runGit(['show', '-m', '--first-parent', '--stat', '--patch', '--format=medium', '--find-renames', commitSha], repoPath),
            this._getUnpushedCommitSet(repoPath),
        ]);

        const [sha, shortSha, authorName, authorEmail, authoredAt, refsRaw, summary, body] = summaryRaw.split('\u001f');
        const parsedBody = extractConflictPathsFromCommitBody(body?.trim() ?? '');

        return {
            sha,
            shortSha,
            summary,
            authorName,
            authorEmail,
            authoredAt,
            refs: parseRefs(refsRaw ?? ''),
            isUnpushed: unpushedCommits.has(sha),
            body: parsedBody.body,
            files: parseCommitFilesWithConflicts(filesRaw, parsedBody.conflictPaths),
            patch,
        };
    },
    async getCommitFileDiff(repoPath: string, commitSha: string, filePath: string, previousPath?: string): Promise<FileDiffData> {
        const originalPath = previousPath ?? filePath;
        const parentRevision = `${commitSha}^1`;

        const [patch, originalSize, modifiedSize] = await Promise.all([
            runGit(['show', '-m', '--first-parent', '--format=', '--patch', commitSha, '--', filePath], repoPath),
            readGitRevisionFileSize(repoPath, `${parentRevision}:${originalPath}`),
            readGitRevisionFileSize(repoPath, `${commitSha}:${filePath}`),
        ]);
        const stats = buildDiffStats(patch || '', originalSize, modifiedSize);

        if (isPreviewTooLarge(originalSize, modifiedSize)) {
            return {
                path: filePath,
                entry: {
                    label: commitSha.slice(0, 7),
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
            runGit(['show', `${parentRevision}:${originalPath}`], repoPath, [0, 128], false),
            runGit(['show', `${commitSha}:${filePath}`], repoPath, [0, 128], false),
        ]);
        const nonCodePreview = isImagePath(filePath)
            ? buildImagePreview(
                  filePath,
                  await readGitRevisionFileBuffer(repoPath, `${parentRevision}:${originalPath}`),
                  await readGitRevisionFileBuffer(repoPath, `${commitSha}:${filePath}`),
              )
            : undefined;

        return {
            path: filePath,
            entry: { label: commitSha.slice(0, 7), kind: 'staged', patch: patch || 'No diff content was returned for this file.', original, modified, stats, nonCodePreview },
        };
    },
};
