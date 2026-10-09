import type { TagSummary, TagsData } from '../../../shared/types.js';
import { createRemoteGitEnv, GitCommandError, resolveRemoteName, runGit, type GitRemoteAuth } from './git-common.js';
import { getUnpushedCommitSet } from './git-helpers.js';

const TAG_REF_PREFIX = 'refs/tags/';

// One record per tag: name, object type, object sha, peeled sha, created date, subject
// (the tag message for annotated tags, the commit subject otherwise), peeled subject and
// tagger. `%1f` keeps every field on a single line so records stay newline separated.
const TAG_FORMAT = ['%(refname:short)', '%(objecttype)', '%(objectname)', '%(*objectname)', '%(creatordate:iso-strict)', '%(subject)', '%(*subject)', '%(taggername)'].join('%1f');

function normalizeTagName(tagName: string) {
    const normalized = tagName.trim();

    if (!normalized) {
        throw new Error('Tag name is required.');
    }

    return normalized;
}

async function assertValidTagName(repoPath: string, tagName: string) {
    await runGit(['check-ref-format', '--allow-onelevel', `${TAG_REF_PREFIX}${tagName}`], repoPath);
}

function parseTagLine(line: string): TagSummary | undefined {
    const [name, objectType, objectName, peeledName, createdAt, subject, peeledSubject, taggerName] = line.split('\u001f');
    const isAnnotated = objectType === 'tag';
    // Annotated tags point at a tag object, so the commit is the peeled sha.
    const commitSha = (isAnnotated ? peeledName : objectName) ?? '';

    if (!name || !commitSha) {
        return undefined;
    }

    return {
        name,
        commitSha,
        shortSha: commitSha.slice(0, 7),
        commitSummary: (isAnnotated ? peeledSubject : subject) ?? '',
        createdAt: createdAt ?? '',
        isAnnotated,
        message: isAnnotated && subject ? subject : undefined,
        taggerName: taggerName || undefined,
        isTargetUnpushed: false,
    };
}

export const tagsGit = {
    _normalizeTagName: normalizeTagName,
    _assertValidTagName: assertValidTagName,
    async getRepoTags(repoPath: string): Promise<TagsData> {
        const [output, unpushedCommits] = await Promise.all([
            runGit(['for-each-ref', 'refs/tags', '--sort=-creatordate', `--format=${TAG_FORMAT}`], repoPath),
            getUnpushedCommitSet(repoPath),
        ]);

        return {
            tags: output
                .split('\n')
                .filter(Boolean)
                .flatMap((line) => {
                    const tag = parseTagLine(line);

                    return tag ? [{ ...tag, isTargetUnpushed: unpushedCommits.has(tag.commitSha) }] : [];
                }),
        };
    },
    /** Annotated when a message is given, lightweight otherwise. */
    async createRepoTag(repoPath: string, commitSha: string, tagName: string, message?: string) {
        const normalizedTagName = normalizeTagName(tagName);
        await assertValidTagName(repoPath, normalizedTagName);

        const trimmedMessage = message?.trim();
        if (trimmedMessage) {
            await runGit(['tag', '-a', normalizedTagName, commitSha, '-m', trimmedMessage], repoPath);
            return;
        }

        await runGit(['tag', normalizedTagName, commitSha], repoPath);
    },
    async deleteRepoTag(repoPath: string, tagName: string) {
        await runGit(['tag', '-d', normalizeTagName(tagName)], repoPath);
    },
    /** Recreates the tag under a new name, keeping the original target and annotation. */
    async renameRepoTag(repoPath: string, tagName: string, nextTagName: string) {
        const normalizedTagName = normalizeTagName(tagName);
        const normalizedNextTagName = normalizeTagName(nextTagName);

        if (normalizedTagName === normalizedNextTagName) {
            return;
        }

        await assertValidTagName(repoPath, normalizedNextTagName);

        const [objectType, targetObject] = await Promise.all([
            runGit(['cat-file', '-t', normalizedTagName], repoPath),
            runGit(['rev-parse', '--verify', `${normalizedTagName}^{}`], repoPath),
        ]);

        if (objectType.trim() === 'tag') {
            const message = await runGit(['for-each-ref', `${TAG_REF_PREFIX}${normalizedTagName}`, '--format=%(contents)'], repoPath);
            await runGit(['tag', '-a', normalizedNextTagName, targetObject, '-m', message], repoPath);
        } else {
            await runGit(['tag', normalizedNextTagName, targetObject], repoPath);
        }

        await runGit(['tag', '-d', normalizedTagName], repoPath);
    },
    async pushRepoTag(repoPath: string, tagName: string, auth?: GitRemoteAuth) {
        const normalizedTagName = normalizeTagName(tagName);
        const remoteName = await resolveRemoteName(repoPath);

        if (!remoteName) {
            throw new GitCommandError('Cannot push the tag because no remote is configured.', ['git', 'push'], '');
        }

        const env = await createRemoteGitEnv(repoPath, auth);
        await runGit(['push', remoteName, `${TAG_REF_PREFIX}${normalizedTagName}`], repoPath, [0], true, env);
    },
    async pushRepoAllTags(repoPath: string, auth?: GitRemoteAuth) {
        const remoteName = await resolveRemoteName(repoPath);

        if (!remoteName) {
            throw new GitCommandError('Cannot push tags because no remote is configured.', ['git', 'push', '--tags'], '');
        }

        const env = await createRemoteGitEnv(repoPath, auth);
        await runGit(['push', remoteName, '--tags'], repoPath, [0], true, env);
    },
    async deleteRemoteRepoTag(repoPath: string, tagName: string, auth?: GitRemoteAuth) {
        const normalizedTagName = normalizeTagName(tagName);
        const remoteName = await resolveRemoteName(repoPath);

        if (!remoteName) {
            throw new GitCommandError('Cannot delete the remote tag because no remote is configured.', ['git', 'push'], '');
        }

        const env = await createRemoteGitEnv(repoPath, auth);
        await runGit(['push', remoteName, `:${TAG_REF_PREFIX}${normalizedTagName}`], repoPath, [0], true, env);
    },
};
