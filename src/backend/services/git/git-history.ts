import type { CommitDetail, CommitMessageData, CommittedFileData, CommittedTreeData, FileDiffData, HistoryData, HistoryRequest } from '../../../shared/types.js';
import { runGit } from './git-common.js';
import {
    buildDiffStats,
    buildImagePreview,
    extractConflictPathsFromCommitBody,
    fileTooBigPreviewMessage,
    getUnpushedCommitSet,
    isImagePath,
    isPreviewTooLarge,
    parseCommitFilesWithConflicts,
    parseCommitTags,
    parseRefs,
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

const DEFAULT_HISTORY_PAGE_SIZE = 60;

function normalizePageCount(value: number | undefined, fallback: number, minimum: number) {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(minimum, Math.trunc(value));
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
    async getRepoHistory(repoPath: string, request: HistoryRequest = {}): Promise<HistoryData> {
        const limit = normalizePageCount(request.limit, DEFAULT_HISTORY_PAGE_SIZE, 1);
        const skip = normalizePageCount(request.skip, 0, 0);
        const search = request.search?.trim();
        const path = request.path?.trim();

        // `git log --follow` applies --skip to the raw commit walk rather than to the matched
        // commits (so skipping 2 raw commits could drop zero or many rows). Followed pages are
        // therefore fetched with --max-count and sliced locally.
        const pagesFollowedHistory = Boolean(path && request.followRenames);
        const fetchSkip = pagesFollowedHistory ? 0 : skip;
        const fetchLimit = pagesFollowedHistory ? skip + limit : limit;
        const pageStart = pagesFollowedHistory ? skip : 0;
        const pageEnd = pagesFollowedHistory ? skip + limit : limit;

        const logArgs = ['log', '--date=iso-strict', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%d%x1f%s', '--max-count', String(fetchLimit + 1), '--skip', String(fetchSkip)];

        if (search) {
            // Literal, case-insensitive message matching so user input never has to be
            // escaped as a regex.
            logArgs.push('-i', '-F', `--grep=${search}`);
        }

        if (path) {
            if (request.followRenames) {
                logArgs.push('--follow');
            }

            logArgs.push('--', path);
        }

        // Matches can sit anywhere in history, so the whole unpushed set is needed
        // instead of a window of it.
        const needsWholeUnpushedSet = Boolean(search || path);

        const [output, unpushedCommits] = await Promise.all([
            runGit(logArgs, repoPath),
            needsWholeUnpushedSet ? getUnpushedCommitSet(repoPath) : getUnpushedCommitSet(repoPath, skip + limit + 1),
        ]);

        const lines = output.split('\n').filter(Boolean);

        return {
            commits: lines.slice(pageStart, pageEnd).map((line) => {
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
            hasMore: lines.length > pageEnd,
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
    /** The message alone, so opening the reword popover never loads a patch. */
    async getRepoCommitMessage(repoPath: string, commitSha: string): Promise<CommitMessageData> {
        const output = await runGit(['show', '-s', '--format=%s%x1f%b', commitSha], repoPath);
        const [summary = '', body = ''] = output.split('\u001f');

        return { summary, body: body.trim() };
    },
    async getCommitDetail(repoPath: string, commitSha: string): Promise<CommitDetail> {
        const [summaryRaw, filesRaw, patch, unpushedCommits] = await Promise.all([
            runGit(['show', '-s', '--date=iso-strict', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%d%x1f%s%x1f%b', commitSha], repoPath),
            runGit(['show', '-m', '--first-parent', '--name-status', '--format=', '--find-renames', commitSha], repoPath),
            runGit(['show', '-m', '--first-parent', '--stat', '--patch', '--format=medium', '--find-renames', commitSha], repoPath),
            getUnpushedCommitSet(repoPath),
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
                nonCodePreview,
            },
        };
    },
};
