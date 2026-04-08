export { GitCommandError } from './git/git-common.js';
import { changesGit } from './git/git-changes.js';
import { historyGit } from './git/git-history.js';
import { mergeGit } from './git/git-merge.js';
import { repoGit } from './git/git-repo.js';
import { stashGit } from './git/git-stash.js';

export const git = {
    ...repoGit,
    ...mergeGit,
    ...changesGit,
    ...historyGit,
    ...stashGit,
};
