#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const originDir = join(__dirname, 'origin.git');
const repoDir = join(__dirname, 'repo');
const upstreamDir = join(__dirname, 'upstream');

for (const d of [originDir, repoDir, upstreamDir]) rmSync(d, { recursive: true, force: true });

function git(args, cwd) {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
}
function gitOut(args, cwd) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

mkdirSync(originDir, { recursive: true });
git(['init', '--bare'], originDir);
git(['clone', originDir, repoDir], dirname(repoDir));

git(['config', 'user.name', 'Gitvan Pull Conflict Lab'], repoDir);
git(['config', 'user.email', 'pull-conflict-lab@example.com'], repoDir);

writeFileSync(
    join(repoDir, 'story.txt'),
    ['Release Notes', '=============', '', 'Headline: Shared baseline', 'Status: pending', 'Checklist: verify migrations', 'Footer: internal draft', ''].join('\n'),
    'utf8'
);

writeFileSync(join(repoDir, 'notes.md'), ['# Pull Conflict Lab', '', '- Local changes are intentionally left unstaged.', '- Origin has one newer commit.', ''].join('\n'), 'utf8');

git(['add', 'story.txt', 'notes.md'], repoDir);
git(['commit', '-m', 'Initial baseline'], repoDir);
git(['push', '-u', 'origin', 'main'], repoDir);

// Local commit that will conflict with origin
writeFileSync(
    join(repoDir, 'story.txt'),
    [
        'Release Notes',
        '=============',
        '',
        'Headline: Local branch draft',
        'Status: blocked-by-qa',
        'Checklist: verify migrations and smoke tests',
        'Footer: local branch update',
        '',
    ].join('\n'),
    'utf8'
);

git(['add', 'story.txt'], repoDir);
git(['commit', '-m', 'Create a local branch commit that will conflict with origin'], repoDir);

// Clone upstream and push an incompatible change
mkdirSync(upstreamDir, { recursive: true });
git(['clone', originDir, upstreamDir], dirname(upstreamDir));
git(['config', 'user.name', 'Gitvan Upstream Writer'], upstreamDir);
git(['config', 'user.email', 'upstream@example.com'], upstreamDir);

writeFileSync(
    join(upstreamDir, 'story.txt'),
    [
        'Release Notes',
        '=============',
        '',
        'Headline: Origin release draft',
        'Status: ready-for-release',
        'Checklist: verify migrations and rollout notes',
        'Footer: upstream release update',
        '',
    ].join('\n'),
    'utf8'
);

git(['add', 'story.txt'], upstreamDir);
git(['commit', '-m', 'Advance origin with incoming release update'], upstreamDir);
git(['push', 'origin', 'main'], upstreamDir);

// Fetch origin into the local repo
git(['fetch', 'origin'], repoDir);

// Overwrite working tree with unstaged changes
writeFileSync(
    join(repoDir, 'story.txt'),
    [
        'Release Notes',
        '=============',
        '',
        'Headline: Local working tree draft',
        'Status: blocked-by-qa',
        'Checklist: verify migrations and smoke tests',
        'Footer: local working tree edit',
        '',
    ].join('\n'),
    'utf8'
);

writeFileSync(
    join(repoDir, 'notes.md'),
    [
        '# Pull Conflict Lab',
        '',
        '- Local changes are intentionally left unstaged.',
        '- Origin has one newer commit.',
        '- The current branch also has one local commit that conflicts with origin.',
        '- Use Pull in Gitvan to trigger the stash prompt, then pull into a merge conflict.',
        '',
    ].join('\n'),
    'utf8'
);

console.log(`Lab repository created at: ${repoDir}`);
console.log(`Origin remote created at: ${originDir}`);
console.log('The repository has a local commit, is behind origin/main, and has local unstaged changes.');
console.log('Tracking refs were fetched so Gitvan should show both pull and push indicators.');
console.log('Test file: story.txt');
