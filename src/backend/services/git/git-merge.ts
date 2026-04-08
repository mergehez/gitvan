import { join } from 'node:path';
import type { MergeConflictFileDetails, MergeConflictState } from '../../../shared/gitClient.js';
import { runGit } from './git-common.js';
import { countConflictMarkers, parseIncomingBranchFromMergeMessage, readGitIndexStageFile, readGitMetadataFile, readWorkingTreeFile } from './git-helpers.js';

export const mergeGit = {
    async getRepoMergeConflictState(repoPath: string): Promise<MergeConflictState> {
        const mergeHead = await runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], repoPath, [0, 1, 128]);

        if (!mergeHead) {
            return {
                isMerging: false,
                targetBranch: undefined,
                incomingBranch: undefined,
                conflictedFiles: [],
                mergedFiles: [],
                canCommit: false,
            };
        }

        const [targetBranchRaw, mergeMessage, conflictedPathsRaw, mergedPathsRaw] = await Promise.all([
            runGit(['branch', '--show-current'], repoPath, [0, 128]),
            readGitMetadataFile(repoPath, 'MERGE_MSG'),
            runGit(['diff', '--name-only', '--diff-filter=U'], repoPath, [0, 1, 128]),
            runGit(['diff', '--cached', '--name-only'], repoPath, [0, 1, 128]),
        ]);

        const conflictedFiles = conflictedPathsRaw
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((path) => {
                const fileContent = readWorkingTreeFile(join(repoPath, path));
                const conflictCount = countConflictMarkers(fileContent);

                return {
                    path,
                    conflictCount: conflictCount > 0 ? conflictCount : undefined,
                };
            });

        const conflictedPathSet = new Set(conflictedFiles.map((file) => file.path));
        const mergedFiles = mergedPathsRaw
            .split('\n')
            .map((value) => value.trim())
            .filter((value) => value && !conflictedPathSet.has(value))
            .map((path) => ({ path }));

        return {
            isMerging: true,
            targetBranch: targetBranchRaw.trim() || undefined,
            incomingBranch: parseIncomingBranchFromMergeMessage(mergeMessage),
            conflictedFiles,
            mergedFiles,
            canCommit: conflictedFiles.length === 0,
        };
    },
    async getRepoMergeConflictFileDetails(repoPath: string, path: string): Promise<MergeConflictFileDetails> {
        const [base, current, incoming] = await Promise.all([
            readGitIndexStageFile(repoPath, 1, path),
            readGitIndexStageFile(repoPath, 2, path),
            readGitIndexStageFile(repoPath, 3, path),
        ]);

        const result = readWorkingTreeFile(join(repoPath, path));
        const conflictCount = countConflictMarkers(result);

        return {
            path,
            base,
            current,
            incoming,
            result,
            conflictCount: conflictCount > 0 ? conflictCount : undefined,
        };
    },
    async resolveRepoMergeConflict(repoPath: string, path: string, resolution: 'ours' | 'theirs') {
        await runGit(['checkout', resolution === 'ours' ? '--ours' : '--theirs', '--', path], repoPath);
        await runGit(['add', '--', path], repoPath);
    },
    async markRepoConflictResolved(repoPath: string, path: string) {
        await runGit(['add', '--', path], repoPath);
    },
    async saveRepoMergeConflictResolution(repoPath: string, path: string, resolvedContent: string) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(join(repoPath, path), resolvedContent, 'utf8');
        await runGit(['add', '--', path], repoPath);
    },
    async abortRepoMerge(repoPath: string) {
        await runGit(['merge', '--abort'], repoPath);
    },
    async commitRepoMerge(repoPath: string) {
        await runGit(['commit', '--no-edit'], repoPath);
    },
};
