import { existsSync } from 'fs';
import { join } from 'path';
import { areEquivalentIgnoringDiffChars, isJavaScriptTypeScriptPath } from '../../../shared/diffIgnoredChars.js';
import type { ChangeStatus, FileChangeEntry, FileDiffData, FileDiffEntry, FileDiffRequestKind, RepoChangesData, RepoSidebarStatus } from '../../../shared/types.js';
import { GitCommandError, runGit, runGitWithInput, runWithConcurrency } from './git-common.js';
import {
    appendGitIgnoreEntry,
    applyPartialFilePatch,
    buildDiffStats,
    buildImagePreview,
    fileTooBigPreviewMessage,
    getUnpushedCommitSet,
    isImagePath,
    isPreviewTooLarge,
    labelForStatus,
    normalizeGitIgnoreEntry,
    parseConflictMarkerPaths,
    parsePorcelainTrackedEntries,
    parseRawDiffOutput,
    readGitObjectContents,
    readGitObjectSizes,
    readGitRevisionFile,
    readGitRevisionFileBuffer,
    readGitRevisionFileSize,
    readWorkingTreeFile,
    readWorkingTreeFileBuffer,
    readWorkingTreeFileSize,
    textByteSize,
} from './git-helpers.js';

export const changesGit = {
    async getRepoSidebarStatus(repoPath: string): Promise<RepoSidebarStatus> {
        try {
            const [output, remotesOutput] = await Promise.all([runGit(['status', '--porcelain=v2', '--branch'], repoPath), runGit(['remote'], repoPath)]);

            let branch: string | undefined = undefined;
            let ahead = 0;
            let behind = 0;
            let hasUpstream = false;
            let changedFiles = 0;
            let stagedFiles = 0;
            let unstagedFiles = 0;
            const hasRemote =
                remotesOutput
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean).length > 0;

            for (const line of output.split('\n')) {
                if (!line) {
                    continue;
                }

                if (line.startsWith('# branch.head ')) {
                    const headValue = line.slice('# branch.head '.length).trim();
                    branch = headValue === '(detached)' ? 'Detached HEAD' : headValue;
                    continue;
                }

                if (line.startsWith('# branch.upstream ')) {
                    hasUpstream = true;
                    continue;
                }

                if (line.startsWith('# branch.ab ')) {
                    const [, , rawAhead = '+0', rawBehind = '-0'] = line.split(' ');
                    ahead = Number.parseInt(rawAhead.replace('+', ''), 10) || 0;
                    behind = Number.parseInt(rawBehind.replace('-', ''), 10) || 0;
                    continue;
                }

                if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
                    const xy = line.split(' ')[1] ?? '..';
                    const hasVisibleChange = (xy[0] && xy[0] !== '.') || (xy[1] && xy[1] !== '.');

                    if (xy[0] && xy[0] !== '.') {
                        stagedFiles++;
                    }
                    if (xy[1] && xy[1] !== '.') {
                        unstagedFiles++;
                    }

                    if (hasVisibleChange) {
                        changedFiles++;
                    }

                    continue;
                }

                if (line.startsWith('? ')) {
                    unstagedFiles++;
                    changedFiles++;
                }
            }

            const publishableCommits =
                !hasUpstream && branch && branch !== 'Detached HEAD' ? Number.parseInt(await runGit(['rev-list', '--count', 'HEAD', '--not', '--remotes'], repoPath), 10) || 0 : 0;

            return {
                branch,
                ahead,
                behind,
                hasRemote,
                hasUpstream,
                publishableCommits,
                changedFiles,
                stagedFiles,
                unstagedFiles,
                isDirty: changedFiles > 0,
                error: undefined,
                lastScannedAt: new Date().toISOString(),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

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
                error: message,
                lastScannedAt: new Date().toISOString(),
            };
        }
    },
    async getRepoChanges(
        repoPath: string,
        options: {
            ignoredChars?: string;
            showWhitespaceChanges?: boolean;
        } = {}
    ): Promise<RepoChangesData> {
        const [stagedRaw, unstagedRaw, untrackedRaw, trackedStatusRaw, conflictCheckRaw] = await Promise.all([
            runGit(['diff', '--staged', '--raw', '-z', '--find-renames', '--'], repoPath),
            runGit(['diff', '--raw', '-z', '--find-renames', '--'], repoPath),
            runGit(['ls-files', '--others', '--exclude-standard', '-z'], repoPath),
            runGit(['status', '--porcelain=v2'], repoPath),
            runGit(['diff', 'HEAD', '--check', '--'], repoPath, [0, 1, 2, 128]).catch(() => ''),
        ]);

        // A file can keep conflict markers after its unmerged stages are gone, so the index alone is not enough.
        const conflictMarkerPaths = parseConflictMarkerPaths(conflictCheckRaw);

        const stagedMap = new Map<string, ChangeMapEntry>(parseRawDiffOutput(stagedRaw).map((entry) => [entry.path, entry]));
        const unstagedEntries = parseRawDiffOutput(unstagedRaw);
        const untrackedEntries: ChangeMapEntry[] = untrackedRaw
            .split('\0')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((path) => ({ path, previousPath: undefined, status: 'untracked' as const, oldSha: undefined, newSha: undefined }));

        const unstagedMap = new Map<string, ChangeMapEntry>([...unstagedEntries, ...untrackedEntries].map((entry) => [entry.path, entry]));

        for (const entry of parsePorcelainTrackedEntries(trackedStatusRaw)) {
            const existing = stagedMap.get(entry.path) || unstagedMap.get(entry.path);

            if (entry.stagedStatus !== 'clean' && !stagedMap.has(entry.path)) {
                stagedMap.set(entry.path, {
                    path: entry.path,
                    previousPath: existing?.previousPath,
                    status: entry.stagedStatus,
                    oldSha: undefined,
                    newSha: undefined,
                });
            }

            if (entry.unstagedStatus !== 'clean' && !unstagedMap.has(entry.path)) {
                unstagedMap.set(entry.path, {
                    path: entry.path,
                    previousPath: existing?.previousPath,
                    status: entry.unstagedStatus,
                    oldSha: undefined,
                    newSha: undefined,
                });
            }
        }

        const allPaths = new Set([...stagedMap.keys(), ...unstagedMap.keys()]);
        const cosmeticCandidates: CosmeticCandidate[] = [];
        const entries: FileChangeEntry[] = [...allPaths]
            .sort((left, right) => left.localeCompare(right))
            .map((path) => {
                const stagedEntry = stagedMap.get(path);
                const unstagedEntry = unstagedMap.get(path);
                const stagedStatus = stagedEntry?.status ?? 'clean';
                const unstagedStatus = unstagedEntry?.status ?? 'clean';
                const primaryStatus = stagedStatus !== 'clean' ? stagedStatus : unstagedStatus;

                const entry = {
                    path,
                    previousPath: stagedEntry?.previousPath ?? unstagedEntry?.previousPath ?? undefined,
                    stagedStatus,
                    unstagedStatus,
                    hasConflictMarkers: conflictMarkerPaths.has(path) ? true : undefined,
                    displayStatus: labelForStatus(primaryStatus),
                } satisfies FileChangeEntry;

                if (entry.stagedStatus === 'modified') {
                    cosmeticCandidates.push({
                        entry,
                        kind: 'staged',
                        originalSha: stagedEntry?.oldSha,
                        modifiedSha: stagedEntry?.newSha,
                        workingTreePath: undefined,
                    });
                }

                if (entry.unstagedStatus === 'modified') {
                    cosmeticCandidates.push({
                        entry,
                        kind: 'unstaged',
                        originalSha: unstagedEntry?.oldSha,
                        modifiedSha: undefined,
                        workingTreePath: join(repoPath, path),
                    });
                }

                return entry;
            });

        if (entries.length < cosmeticCheckFileCountLimit && cosmeticCandidates.length > 0) {
            await applyCosmeticChangeChecks(repoPath, cosmeticCandidates, options);
        }

        const stagedNumstat = await runGit(['diff', '--staged', '--numstat', '--'], repoPath).catch(() => '');
        const unstagedNumstat = await runGit(['diff', '--numstat', '--'], repoPath).catch(() => '');

        function parseNumstatTotals(output: string): RepoChangesData['stagedStats'] {
            let addedLines = 0;
            let removedLines = 0;

            for (const line of output.split('\n')) {
                const parts = line.trim().split('\t');
                if (parts.length < 3) continue;

                const added = Number(parts[0]);
                const removed = Number(parts[1]);

                if (!Number.isNaN(added)) addedLines += added;
                if (!Number.isNaN(removed)) removedLines += removed;
            }

            return { addedLines, removedLines, hasChanges: addedLines !== 0 || removedLines !== 0 };
        }

        return {
            staged: entries.filter((entry) => entry.stagedStatus !== 'clean'),
            unstaged: entries.filter((entry) => entry.unstagedStatus !== 'clean'),
            stagedStats: parseNumstatTotals(stagedNumstat),
            unstagedStats: parseNumstatTotals(unstagedNumstat),
        };
    },
    async listUnmergedRepoFiles(repoPath: string): Promise<string[]> {
        const output = await runGit(['diff', '--name-only', '--diff-filter=U', '--'], repoPath, [0, 1, 128]);

        return output
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean);
    },
    async getFileDiff(repoPath: string, filePath: string, kind: FileDiffRequestKind): Promise<FileDiffData> {
        const absolutePath = join(repoPath, filePath);
        let entry: FileDiffEntry | undefined = undefined;

        if (kind === 'staged') {
            const stagedPatch = await runGit(['diff', '--staged', '--', filePath], repoPath);

            if (stagedPatch) {
                const [originalSize, modifiedSize] = await Promise.all([readGitRevisionFileSize(repoPath, `HEAD:${filePath}`), readGitRevisionFileSize(repoPath, `:${filePath}`)]);
                const stats = buildDiffStats(stagedPatch, originalSize, modifiedSize);

                if (isPreviewTooLarge(originalSize, modifiedSize)) {
                    entry = {
                        label: 'Staged',
                        kind: 'staged',
                        patch: stagedPatch,
                        original: '',
                        modified: '',
                        stats,
                        previewMessage: fileTooBigPreviewMessage,
                    };
                } else {
                    const [original, modified, originalBuffer, modifiedBuffer] = await Promise.all([
                        readGitRevisionFile(repoPath, `HEAD:${filePath}`),
                        readGitRevisionFile(repoPath, `:${filePath}`),
                        isImagePath(filePath) ? readGitRevisionFileBuffer(repoPath, `HEAD:${filePath}`) : Promise.resolve(undefined),
                        isImagePath(filePath) ? readGitRevisionFileBuffer(repoPath, `:${filePath}`) : Promise.resolve(undefined),
                    ]);

                    entry = {
                        label: 'Staged',
                        kind: 'staged',
                        patch: stagedPatch,
                        original: originalBuffer ? '' : original,
                        modified: modifiedBuffer ? '' : modified,
                        stats,
                        nonCodePreview: buildImagePreview(filePath, originalBuffer, modifiedBuffer),
                    };
                }
            }
        } else {
            const unstagedPatch = await runGit(['diff', '--', filePath], repoPath);

            if (unstagedPatch) {
                const [originalSize, modifiedSize] = await Promise.all([readGitRevisionFileSize(repoPath, `:${filePath}`), Promise.resolve(readWorkingTreeFileSize(absolutePath))]);
                const stats = buildDiffStats(unstagedPatch, originalSize, modifiedSize);

                if (isPreviewTooLarge(originalSize, modifiedSize)) {
                    entry = {
                        label: 'Unstaged',
                        kind: 'unstaged',
                        patch: unstagedPatch,
                        original: '',
                        modified: '',
                        stats,
                        previewMessage: fileTooBigPreviewMessage,
                    };
                } else {
                    const [original, modified, originalBuffer, modifiedBuffer] = await Promise.all([
                        readGitRevisionFile(repoPath, `:${filePath}`),
                        Promise.resolve(readWorkingTreeFile(absolutePath)),
                        isImagePath(filePath) ? readGitRevisionFileBuffer(repoPath, `:${filePath}`) : Promise.resolve(undefined),
                        isImagePath(filePath) ? Promise.resolve(readWorkingTreeFileBuffer(absolutePath)) : Promise.resolve(undefined),
                    ]);

                    entry = {
                        label: 'Unstaged',
                        kind: 'unstaged',
                        patch: unstagedPatch,
                        original: originalBuffer ? '' : original,
                        modified: modifiedBuffer ? '' : modified,
                        stats,
                        nonCodePreview: buildImagePreview(filePath, originalBuffer, modifiedBuffer),
                    };
                }
            } else if (existsSync(absolutePath)) {
                const untrackedPatch = await runGit(['diff', '--no-index', '--', '/dev/null', absolutePath], repoPath, [0, 1]);

                if (untrackedPatch) {
                    const modifiedSize = readWorkingTreeFileSize(absolutePath);
                    const stats = buildDiffStats(untrackedPatch, 0, modifiedSize);

                    if (isPreviewTooLarge(modifiedSize)) {
                        entry = {
                            label: 'Untracked',
                            kind: 'untracked',
                            patch: untrackedPatch,
                            original: '',
                            modified: '',
                            stats,
                            previewMessage: fileTooBigPreviewMessage,
                        };
                    } else {
                        const modifiedBuffer = isImagePath(filePath) ? readWorkingTreeFileBuffer(absolutePath) : undefined;
                        const modifiedText = modifiedBuffer ? '' : readWorkingTreeFile(absolutePath);
                        entry = {
                            label: 'Untracked',
                            kind: 'untracked',
                            patch: untrackedPatch,
                            original: '',
                            modified: modifiedText,
                            stats: buildDiffStats(untrackedPatch, 0, modifiedBuffer ? modifiedSize : textByteSize(modifiedText)),
                            nonCodePreview: buildImagePreview(filePath, undefined, modifiedBuffer),
                        };
                    }
                }
            }
        }

        if (!entry) {
            entry = {
                label: 'No diff available',
                kind,
                patch: 'No diff content was returned for this file.',
                original: '',
                modified: 'No diff content was returned for this file.',
                stats: buildDiffStats('', 0, 0),
            };
        }

        return { path: filePath, entry };
    },
    async stageRepoFile(repoPath: string, filePath: string) {
        await runGit(['add', '--', filePath], repoPath);
    },
    async stageRepoFiles(repoPath: string, filePaths: string[]) {
        if (!filePaths.length) {
            return;
        }
        await runGit(['add', '--', ...filePaths], repoPath);
    },
    async stageAllRepoFiles(repoPath: string) {
        await runGit(['add', '--all', '--', '.'], repoPath);
    },
    async unstageRepoFile(repoPath: string, filePath: string) {
        await runGit(['reset', '--quiet', '--', filePath], repoPath);
    },
    async unstageRepoFiles(repoPath: string, filePaths: string[]) {
        if (!filePaths.length) {
            return;
        }
        await runGit(['reset', '--quiet', '--', ...filePaths], repoPath);
    },
    async discardRepoFile(repoPath: string, filePath: string) {
        const output = await runGit(['ls-files', '--error-unmatch', '--', filePath], repoPath, [0, 1]);

        if (output.length > 0) {
            await runGit(['restore', '--worktree', '--', filePath], repoPath);
            return;
        }

        await runGit(['clean', '-fd', '--', filePath], repoPath);
    },
    async discardRepoFiles(repoPath: string, filePaths: string[]) {
        if (!filePaths.length) {
            return;
        }

        // One index lookup partitions the whole batch, so each side is one git process
        // instead of a lookup plus a mutation per file.
        const trackedRaw = await runGit(['ls-files', '-z', '--error-unmatch', '--', ...filePaths], repoPath, [0, 1]);
        const trackedPaths = new Set(trackedRaw.split('\0').filter(Boolean));
        const untrackedPaths = filePaths.filter((filePath) => !trackedPaths.has(filePath));

        if (trackedPaths.size > 0) {
            await runGit(['restore', '--worktree', '--', ...trackedPaths], repoPath);
        }

        if (untrackedPaths.length > 0) {
            await runGit(['clean', '-fd', '--', ...untrackedPaths], repoPath);
        }
    },
    async unstageAllRepoFiles(repoPath: string) {
        // `restore --staged` refuses paths holding unmerged stages and needs a resolvable HEAD.
        await runGit(['reset', '--quiet', '--', '.'], repoPath);
    },
    async applyPatch(repoPath: string, patch: string, mode: 'stage' | 'unstage' | 'discard') {
        try {
            await applyPartialFilePatch(repoPath, patch, mode);
        } catch (error) {
            console.log(`Failed to apply patch in ${mode} mode:\n${patch}`);
            throw error;
        }
    },
    async discardAllRepoChanges(repoPath: string) {
        await runGit(['restore', '--worktree', '--', '.'], repoPath);
        await runGit(['clean', '-fd', '--', '.'], repoPath);
    },
    async restoreRepoFile(repoPath: string, filePath: string, kind: 'staged' | 'unstaged') {
        const args = ['restore', '--source=HEAD'];
        if (kind === 'staged') {
            args.push('--staged');
        }
        args.push('--worktree', '--', filePath);
        await runGit(args, repoPath);
    },
    async restoreRepoFiles(repoPath: string, filePaths: string[], kind: 'staged' | 'unstaged') {
        if (!filePaths.length) {
            return;
        }

        const args = ['restore', '--source=HEAD'];
        if (kind === 'staged') {
            args.push('--staged');
        }
        args.push('--worktree', '--', ...filePaths);
        await runGit(args, repoPath);
    },
    async deleteStagedRepoFile(repoPath: string, filePath: string) {
        await runGit(['rm', '-f', '--', filePath], repoPath);
    },
    async deleteStagedRepoFiles(repoPath: string, filePaths: string[]) {
        if (!filePaths.length) {
            return;
        }
        await runGit(['rm', '-f', '--', ...filePaths], repoPath);
    },
    async ignoreRepoPath(repoPath: string, targetPath: string, mode: 'file' | 'directory' | 'pattern') {
        appendGitIgnoreEntry(repoPath, normalizeGitIgnoreEntry(targetPath, mode));
    },
    async commitRepoChanges(repoPath: string, summary: string, description: string, amend = false) {
        const trimmedSummary = summary.trim();
        if (!trimmedSummary) {
            throw new Error('Commit summary is required.');
        }

        const args = ['commit'];
        if (amend) {
            args.push('--amend');
        }
        args.push('-m', trimmedSummary);
        if (description.trim()) {
            args.push('-m', description.trim());
        }
        await runGit(args, repoPath);
    },
    async undoLastRepoCommit(repoPath: string) {
        await runGit(['reset', '--soft', 'HEAD~1'], repoPath);
    },
    /**
     * Rewrites an unpushed commit with a new message and replays its descendants on top.
     * The tree is copied verbatim through `commit-tree`, so no staged or working-tree
     * change can leak into the commit the way `commit --amend` would allow.
     */
    async rewordRepoCommit(repoPath: string, commitSha: string, summary: string, description: string) {
        const trimmedSummary = summary.trim();
        if (!trimmedSummary) {
            throw new Error('Commit summary is required.');
        }

        const targetSha = await runGit(['rev-parse', '--verify', `${commitSha}^{commit}`], repoPath, [0, 128]);
        if (!targetSha) {
            throw new GitCommandError('The commit to edit no longer exists. Refresh the history and try again.', ['git', 'rev-parse', commitSha], '');
        }

        // Rewriting a pushed commit would silently diverge the branch from its remote.
        const unpushedCommits = await getUnpushedCommitSet(repoPath);
        if (!unpushedCommits.has(targetSha)) {
            throw new GitCommandError('Only unpushed commits can be edited.', ['git', 'rev-list', 'HEAD', '--not', '--remotes'], '');
        }

        const [treeSha, parentsRaw, authorRaw] = await Promise.all([
            runGit(['rev-parse', `${targetSha}^{tree}`], repoPath),
            runGit(['show', '-s', '--format=%P', targetSha], repoPath),
            runGit(['show', '-s', '--format=%an%x1f%ae%x1f%aI', targetSha], repoPath),
        ]);

        const parentArgs = parentsRaw
            .split(' ')
            .filter(Boolean)
            .flatMap((parentSha) => ['-p', parentSha]);
        const [authorName = '', authorEmail = '', authorDate = ''] = authorRaw.split('\u001f');
        const trimmedDescription = description.trim();
        const message = trimmedDescription ? `${trimmedSummary}\n\n${trimmedDescription}\n` : `${trimmedSummary}\n`;

        const rewrittenSha = await runGitWithInput(['commit-tree', treeSha, ...parentArgs, '-F', '-'], repoPath, message, [0], true, {
            GIT_AUTHOR_NAME: authorName,
            GIT_AUTHOR_EMAIL: authorEmail,
            GIT_AUTHOR_DATE: authorDate,
        });

        // Nothing but the message changes, so every replayed patch applies to an identical
        // parent tree; `--rebase-merges` keeps any local merge commits in place and
        // `--autostash` carries unstaged work across the rewrite untouched.
        await runGit(['rebase', '--onto', rewrittenSha, targetSha, '--rebase-merges', '--autostash'], repoPath, [0], true);
    },
};

const cosmeticCheckSizeLimit = 50 * 1024;
const cosmeticCheckFileCountLimit = 100;
/** Bounded fan-out for the rare entries the batched pass cannot classify. */
const cosmeticCheckConcurrency = 6;

type ChangeMapEntry = {
    path: string;
    previousPath: string | undefined;
    status: ChangeStatus;
    oldSha: string | undefined;
    newSha: string | undefined;
};

type CosmeticCandidate = {
    entry: FileChangeEntry;
    kind: 'staged' | 'unstaged';
    /** `HEAD` blob for staged changes, the index blob for unstaged ones. */
    originalSha: string | undefined;
    /** The index blob for staged changes; the working tree supplies the other side. */
    modifiedSha: string | undefined;
    workingTreePath: string | undefined;
};

function isTooLargeForCosmeticCheck(...sizes: Array<number | undefined>) {
    return sizes.some((size) => size !== undefined && size > cosmeticCheckSizeLimit);
}

function cosmeticIgnoreOptions(filePath: string) {
    return { sortModuleImports: isJavaScriptTypeScriptPath(filePath) };
}

function assignCosmeticResult(candidate: CosmeticCandidate, noActualChange: boolean, tooLarge: boolean) {
    if (candidate.kind === 'staged') {
        candidate.entry.stagedNoActualChange = noActualChange;
        candidate.entry.stagedTooLargeForCosmeticCheck = tooLarge;
        return;
    }

    candidate.entry.unstagedNoActualChange = noActualChange;
    candidate.entry.unstagedTooLargeForCosmeticCheck = tooLarge;
}

/**
 * Classifies every modified entry through one `cat-file --batch-check` for the sizes and
 * one `cat-file --batch` for the contents, instead of four git processes per file. The
 * working-tree side is read from disk, and entries whose blobs are not in the raw diff
 * (rare porcelain-only rows) fall back to a bounded per-file pool.
 */
async function applyCosmeticChangeChecks(repoPath: string, candidates: CosmeticCandidate[], options: { ignoredChars?: string; showWhitespaceChanges?: boolean }) {
    const batched: CosmeticCandidate[] = [];
    const fallback: CosmeticCandidate[] = [];

    for (const candidate of candidates) {
        if (isImagePath(candidate.entry.path)) {
            assignCosmeticResult(candidate, false, false);
            continue;
        }

        const hasBlobs = candidate.kind === 'staged' ? Boolean(candidate.originalSha && candidate.modifiedSha) : Boolean(candidate.originalSha);

        (hasBlobs ? batched : fallback).push(candidate);
    }

    if (batched.length > 0) {
        const allShas = new Set<string>();
        for (const candidate of batched) {
            if (candidate.originalSha) allShas.add(candidate.originalSha);
            if (candidate.modifiedSha) allShas.add(candidate.modifiedSha);
        }

        const sizes = await readGitObjectSizes(repoPath, [...allShas]);
        const sized = batched.map((candidate) => {
            const workingTreeSize = candidate.workingTreePath ? readWorkingTreeFileSize(candidate.workingTreePath) : undefined;
            const originalSize = candidate.originalSha ? sizes.get(candidate.originalSha) : undefined;
            const modifiedSize = candidate.modifiedSha ? sizes.get(candidate.modifiedSha) : workingTreeSize;

            return { candidate, tooLarge: isTooLargeForCosmeticCheck(originalSize, modifiedSize) };
        });

        const contentShas = new Set<string>();
        for (const { candidate, tooLarge } of sized) {
            if (tooLarge) {
                assignCosmeticResult(candidate, false, true);
                continue;
            }

            if (candidate.originalSha) contentShas.add(candidate.originalSha);
            if (candidate.modifiedSha) contentShas.add(candidate.modifiedSha);
        }

        const contents = await readGitObjectContents(repoPath, [...contentShas]);

        for (const { candidate, tooLarge } of sized) {
            if (tooLarge) {
                continue;
            }

            const original = candidate.originalSha ? (contents.get(candidate.originalSha) ?? '') : '';
            const modified = candidate.modifiedSha ? (contents.get(candidate.modifiedSha) ?? '') : readWorkingTreeFile(candidate.workingTreePath!);

            assignCosmeticResult(
                candidate,
                areEquivalentIgnoringDiffChars(
                    original,
                    modified,
                    options.ignoredChars ?? '',
                    !(options.showWhitespaceChanges ?? false),
                    cosmeticIgnoreOptions(candidate.entry.path)
                ),
                false
            );
        }
    }

    if (fallback.length > 0) {
        await runWithConcurrency(
            fallback.map((candidate) => async () => {
                const result = await hasNoActualChangeForKind(repoPath, candidate.entry.path, candidate.kind, options.ignoredChars, options.showWhitespaceChanges);
                assignCosmeticResult(candidate, result.noActualChange, result.tooLarge);
            }),
            cosmeticCheckConcurrency
        );
    }
}

async function hasNoActualChangeForKind(
    repoPath: string,
    filePath: string,
    kind: FileDiffRequestKind,
    ignoredChars: string | undefined,
    showWhitespaceChanges: boolean | undefined
): Promise<{ noActualChange: boolean; tooLarge: boolean }> {
    if (isImagePath(filePath)) {
        return { noActualChange: false, tooLarge: false };
    }

    const absolutePath = join(repoPath, filePath);
    const diffIgnoreOptions = cosmeticIgnoreOptions(filePath);

    if (kind === 'staged') {
        const [originalSize, modifiedSize] = await Promise.all([readGitRevisionFileSize(repoPath, `HEAD:${filePath}`), readGitRevisionFileSize(repoPath, `:${filePath}`)]);

        if (isTooLargeForCosmeticCheck(originalSize, modifiedSize)) {
            return { noActualChange: false, tooLarge: true };
        }

        const [original, modified] = await Promise.all([readGitRevisionFile(repoPath, `HEAD:${filePath}`), readGitRevisionFile(repoPath, `:${filePath}`)]);

        return {
            noActualChange: areEquivalentIgnoringDiffChars(original, modified, ignoredChars ?? '', !(showWhitespaceChanges ?? false), diffIgnoreOptions),
            tooLarge: false,
        };
    }

    const [originalSize, modifiedSize] = await Promise.all([readGitRevisionFileSize(repoPath, `:${filePath}`), Promise.resolve(readWorkingTreeFileSize(absolutePath))]);

    if (isTooLargeForCosmeticCheck(originalSize, modifiedSize)) {
        return { noActualChange: false, tooLarge: true };
    }

    const [original, modified] = await Promise.all([readGitRevisionFile(repoPath, `:${filePath}`), Promise.resolve(readWorkingTreeFile(absolutePath))]);

    return {
        noActualChange: areEquivalentIgnoringDiffChars(original, modified, ignoredChars ?? '', !(showWhitespaceChanges ?? false), diffIgnoreOptions),
        tooLarge: false,
    };
}
