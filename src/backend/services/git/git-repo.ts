import { existsSync, mkdirSync } from 'fs';
import { basename, dirname } from 'path';
import type { BranchesData, BranchSummary, RemoteOperation } from '../../../shared/gitClient.js';
import { createRemoteGitEnv, createRemoteGitEnvForUrl, GitCommandError, GitRemoteAuth, runGit } from './git-common.js';
import { normalizeBranchName, parseTrackCounts } from './git-helpers.js';

export const repoGit = {
    isPullBlockedByLocalChangesError(error: unknown) {
        if (!(error instanceof GitCommandError)) {
            return false;
        }

        const details = `${error.message}\n${error.stderr}\n${error.stdout}`;
        return /local changes to the following files would be overwritten by merge/i.test(details);
    },
    getPullBlockedByLocalChangesFiles(error: unknown) {
        if (!(error instanceof GitCommandError)) {
            return [] as string[];
        }

        const details = `${error.stderr}\n${error.stdout}\n${error.message}`;
        const lines = details.split('\n');
        const headerIndex = lines.findIndex((line) => /local changes to the following files would be overwritten by merge/i.test(line));

        if (headerIndex === -1) {
            return [] as string[];
        }

        const files: string[] = [];
        const seen = new Set<string>();

        for (const rawLine of lines.slice(headerIndex + 1)) {
            const trimmedLine = rawLine.trim();

            if (!trimmedLine) {
                if (files.length > 0) {
                    break;
                }

                continue;
            }

            if (/^(please |aborting|error:|hint:)/i.test(trimmedLine)) {
                break;
            }

            const normalizedPath = trimmedLine.replace(/^[*-]\s*/, '');
            if (!normalizedPath || seen.has(normalizedPath)) {
                continue;
            }

            seen.add(normalizedPath);
            files.push(normalizedPath);
        }

        return files;
    },
    isPullMergeConflictError(error: unknown) {
        if (!(error instanceof GitCommandError)) {
            return false;
        }

        const details = `${error.message}\n${error.stderr}\n${error.stdout}`;
        return /(automatic merge failed|conflict \(|merge conflict)/i.test(details);
    },
    isStashRestoreConflictError(error: unknown) {
        if (!(error instanceof GitCommandError)) {
            return false;
        }

        const details = `${error.message}\n${error.stderr}\n${error.stdout}`;
        return /(automatic merge failed|conflict \(|merge conflict|could not restore untracked files)/i.test(details);
    },
    async resolveGitRepo(inputPath: string) {
        const topLevelPath = await runGit(['rev-parse', '--show-toplevel'], inputPath);

        return { name: basename(topLevelPath), path: topLevelPath };
    },
    async cloneGitRepo(remoteUrl: string, destinationPath: string, auth: GitRemoteAuth | undefined = undefined) {
        const normalizedRemoteUrl = remoteUrl.trim();
        const normalizedDestinationPath = destinationPath.trim();

        if (!normalizedRemoteUrl) {
            throw new GitCommandError('A repository URL is required to clone.', ['git', 'clone'], '');
        }

        if (!normalizedDestinationPath) {
            throw new GitCommandError('A destination path is required to clone.', ['git', 'clone'], '');
        }

        if (existsSync(normalizedDestinationPath)) {
            throw new GitCommandError('The destination folder already exists.', ['git', 'clone', normalizedRemoteUrl, normalizedDestinationPath], '');
        }

        const parentDirectory = dirname(normalizedDestinationPath);
        mkdirSync(parentDirectory, { recursive: true });

        const env = createRemoteGitEnvForUrl(normalizedRemoteUrl, auth);
        await runGit(['clone', normalizedRemoteUrl, normalizedDestinationPath], parentDirectory, [0], true, env);
    },
    async initializeGitRepo(destinationPath: string) {
        const normalizedDestinationPath = destinationPath.trim();

        if (!normalizedDestinationPath) {
            throw new GitCommandError('A destination path is required to create a repository.', ['git', 'init'], '');
        }

        if (existsSync(normalizedDestinationPath)) {
            throw new GitCommandError('The destination folder already exists.', ['git', 'init', normalizedDestinationPath], '');
        }

        mkdirSync(normalizedDestinationPath, { recursive: true });

        try {
            await runGit(['init', '-b', 'main', normalizedDestinationPath], dirname(normalizedDestinationPath));
        } catch {
            await runGit(['init', normalizedDestinationPath], dirname(normalizedDestinationPath));
            await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], normalizedDestinationPath);
        }
    },
    async getRepoBranches(repoPath: string): Promise<BranchesData> {
        const output = await runGit(
            [
                'for-each-ref',
                '--sort=-committerdate',
                '--format=%(refname:short)\t%(refname)\t%(HEAD)\t%(upstream:short)\t%(upstream:track)\t%(objectname:short)\t%(contents:subject)',
                'refs/heads',
                'refs/remotes',
            ],
            repoPath
        );

        const branches = output
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [name, refName, headMarker, upstream, track, commit, subject] = line.split('\t');
                if (!name || !refName) {
                    return undefined;
                }

                const kind = refName.startsWith('refs/remotes/') ? 'remote' : 'local';
                const s = parseTrackCounts(track ?? '');
                const normalizedName = normalizeBranchName(name);

                return {
                    name: normalizedName,
                    refName,
                    kind,
                    isCurrent: headMarker === '*',
                    upstream: upstream || undefined,
                    ahead: s.ahead,
                    behind: s.behind,
                    commit: commit || undefined,
                    subject: subject || undefined,
                } satisfies BranchSummary;
            })
            .filter((branch): branch is BranchSummary => !!branch)
            .filter((branch) => !branch.refName.endsWith('/HEAD'));

        return {
            currentBranch: branches.find((branch) => branch.isCurrent)?.name ?? undefined,
            local: branches.filter((branch) => branch.kind === 'local'),
            remote: branches.filter((branch) => branch.kind === 'remote'),
        };
    },
    async checkoutRepoBranch(repoPath: string, branchName: string) {
        await runGit(['switch', normalizeBranchName(branchName)], repoPath);
    },
    async createRepoBranch(repoPath: string, branchName: string) {
        const trimmedName = normalizeBranchName(branchName);
        if (!trimmedName) {
            throw new Error('Branch name is required.');
        }

        await runGit(['switch', '-c', trimmedName], repoPath);
    },
    async createRemoteRepoBranch(repoPath: string, branchName: string, auth: GitRemoteAuth | undefined = undefined) {
        const trimmedName = normalizeBranchName(branchName);
        if (!trimmedName) {
            throw new Error('Branch name is required.');
        }

        const remotesOutput = await runGit(['remote'], repoPath);
        const remotes = remotesOutput
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        const remoteName = remotes.includes('origin') ? 'origin' : remotes[0];

        if (!remoteName) {
            throw new GitCommandError('Cannot create the remote branch because no remote is configured.', ['git', 'push', '-u'], '');
        }

        await runGit(['switch', '-c', trimmedName], repoPath);
        const env = await createRemoteGitEnv(repoPath, auth);
        await runGit(['push', '-u', remoteName, trimmedName], repoPath, [0], true, env);
    },
    async publishRepoBranch(repoPath: string, auth: GitRemoteAuth | undefined = undefined) {
        const [branchOutput, remotesOutput] = await Promise.all([runGit(['branch', '--show-current'], repoPath), runGit(['remote'], repoPath)]);

        const branchName = branchOutput.trim();
        if (!branchName) {
            throw new GitCommandError('Cannot publish the current branch from a detached HEAD state.', ['git', 'branch', '--show-current'], '');
        }

        const remotes = remotesOutput
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        const remoteName = remotes.includes('origin') ? 'origin' : remotes[0];

        if (!remoteName) {
            throw new GitCommandError('Cannot publish the current branch because no remote is configured.', ['git', 'push', '-u'], '');
        }

        const env = await createRemoteGitEnv(repoPath, auth);
        await runGit(['push', '-u', remoteName, branchName], repoPath, [0], true, env);
    },
    async runRepoRemoteOperation(repoPath: string, operation: RemoteOperation, auth: GitRemoteAuth | undefined = undefined) {
        const env = await createRemoteGitEnv(repoPath, auth);

        switch (operation) {
            case 'fetch':
                await runGit(['fetch', '--all', '--prune'], repoPath, [0], true, env);
                return;
            case 'pull':
                await runGit(['pull', '--no-rebase'], repoPath, [0], true, env);
                return;
            case 'push':
                await runGit(['push'], repoPath, [0], true, env);
                return;
            default:
                throw new GitCommandError(`Unsupported remote operation: ${String(operation)}`, ['git', String(operation)], '');
        }
    },
};
