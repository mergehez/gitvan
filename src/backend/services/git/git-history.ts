import type { CommitDetail, CommittedFileData, CommittedTreeData, FileDiffData, HistoryData } from '../../../shared/gitClient.js';
import { runGit } from './git-common.js';
import {
    buildDiffStats,
    buildImagePreview,
    extractConflictPathsFromCommitBody,
    fileTooBigPreviewMessage,
    isImagePath,
    isPreviewTooLarge,
    parseCommitFilesWithConflicts,
    parseCommitTags,
    parseRefs,
    parseUnifiedDiffHunks,
    readGitRevisionFile,
    readGitRevisionFileBuffer,
    readGitRevisionFileSize,
} from './git-helpers.js';

function parseLsTreeEntries(output: string) {
    return output
        .split('\0')
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
            const match = line.match(/^(\d+)\s+(blob|commit|tree)\s+([0-9a-f]+)\s+(\d+|-)\t(.+)$/i);
            if (!match) {
                return [];
            }

            const [, , type, , sizeRaw, path] = match;
            if (type !== 'blob') {
                return [];
            }

            return [
                {
                    path,
                    sizeBytes: sizeRaw === '-' ? 0 : Number.parseInt(sizeRaw, 10) || 0,
                },
            ];
        })
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'accent' }));
}

function isBinaryBuffer(buffer: Buffer | undefined) {
    if (!buffer || buffer.length === 0) {
        return false;
    }

    for (const byte of buffer.subarray(0, Math.min(buffer.length, 8000))) {
        if (byte === 0) {
            return true;
        }
    }

    return false;
}

export const historyGit = {
    async _getHeadCommitSha(repoPath: string) {
        const output = await runGit(['rev-parse', '--verify', 'HEAD'], repoPath, [0, 128]);
        return output || undefined;
    },
    async _resolveCommittedRevision(repoPath: string, commitSha?: string) {
        if (commitSha) {
            const output = await runGit(['rev-parse', '--verify', commitSha], repoPath, [0, 128]);
            return output || undefined;
        }

        return await this._getHeadCommitSha(repoPath);
    },
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
                .filter(Boolean)
        );
    },
    _normalizeTagName(tagName: string) {
        const normalized = tagName.trim();

        if (!normalized) {
            throw new Error('Tag name is required.');
        }

        return normalized;
    },
    async _assertValidTagName(repoPath: string, tagName: string) {
        await runGit(['check-ref-format', '--allow-onelevel', `refs/tags/${tagName}`], repoPath);
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
                    const isUnpushed = unpushedCommits.has(sha);

                    return {
                        sha,
                        shortSha,
                        summary,
                        authorName,
                        authorEmail,
                        authoredAt,
                        refs: parseRefs(refsRaw ?? ''),
                        tags: parseCommitTags(refsRaw ?? '', isUnpushed),
                        isUnpushed,
                    };
                }),
        };
    },
    async getCommittedTree(repoPath: string, commitSha?: string): Promise<CommittedTreeData> {
        const resolvedCommitSha = await this._resolveCommittedRevision(repoPath, commitSha);

        if (!resolvedCommitSha) {
            return {
                commitSha: undefined,
                files: [],
            };
        }

        const output = await runGit(['ls-tree', '-r', '-l', '-z', '--full-tree', resolvedCommitSha], repoPath);

        return {
            commitSha: resolvedCommitSha,
            files: parseLsTreeEntries(output),
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
            tags: parseCommitTags(refsRaw ?? '', unpushedCommits.has(sha)),
            isUnpushed: unpushedCommits.has(sha),
            body: parsedBody.body,
            files: parseCommitFilesWithConflicts(filesRaw, parsedBody.conflictPaths),
            patch,
        };
    },
    async createRepoTag(repoPath: string, commitSha: string, tagName: string) {
        const normalizedTagName = this._normalizeTagName(tagName);
        await this._assertValidTagName(repoPath, normalizedTagName);
        await runGit(['tag', normalizedTagName, commitSha], repoPath);
    },
    async deleteRepoTag(repoPath: string, tagName: string) {
        const normalizedTagName = this._normalizeTagName(tagName);
        await runGit(['tag', '-d', normalizedTagName], repoPath);
    },
    async renameRepoTag(repoPath: string, tagName: string, nextTagName: string) {
        const normalizedTagName = this._normalizeTagName(tagName);
        const normalizedNextTagName = this._normalizeTagName(nextTagName);

        if (normalizedTagName === normalizedNextTagName) {
            return;
        }

        await this._assertValidTagName(repoPath, normalizedNextTagName);

        const targetObject = await runGit(['rev-parse', '--verify', `${normalizedTagName}^{}`], repoPath);
        await runGit(['tag', normalizedNextTagName, targetObject], repoPath);
        await runGit(['tag', '-d', normalizedTagName], repoPath);
    },
    async getCommittedFile(repoPath: string, filePath: string, commitSha?: string): Promise<CommittedFileData> {
        const resolvedCommitSha = await this._resolveCommittedRevision(repoPath, commitSha);

        if (!resolvedCommitSha) {
            throw new Error('The repository does not have any commits yet.');
        }

        const revisionPath = `${resolvedCommitSha}:${filePath}`;
        const sizeBytes = (await readGitRevisionFileSize(repoPath, revisionPath)) ?? 0;

        if (isPreviewTooLarge(sizeBytes)) {
            return {
                commitSha: resolvedCommitSha,
                path: filePath,
                sizeBytes,
                content: '',
                previewMessage: fileTooBigPreviewMessage,
            };
        }

        const buffer = await readGitRevisionFileBuffer(repoPath, revisionPath);
        const imagePreview = buildImagePreview(filePath, undefined, buffer);
        const previewSrc = imagePreview?.modifiedSrc ?? imagePreview?.originalSrc;

        if (previewSrc) {
            return {
                commitSha: resolvedCommitSha,
                path: filePath,
                sizeBytes,
                content: '',
                preview: {
                    kind: 'image',
                    src: previewSrc,
                },
            };
        }

        if (isBinaryBuffer(buffer)) {
            return {
                commitSha: resolvedCommitSha,
                path: filePath,
                sizeBytes,
                content: '',
                previewMessage: 'Binary file cannot be previewed.',
            };
        }

        return {
            commitSha: resolvedCommitSha,
            path: filePath,
            sizeBytes,
            content: await readGitRevisionFile(repoPath, revisionPath),
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
        const hunks = parseUnifiedDiffHunks(patch || '');

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
                    hunks,
                    supportsPartialStage: false,
                    supportsPartialUnstage: false,
                    supportsPartialDiscard: false,
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
                  await readGitRevisionFileBuffer(repoPath, `${commitSha}:${filePath}`)
              )
            : undefined;

        return {
            path: filePath,
            entry: {
                label: commitSha.slice(0, 7),
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
};
