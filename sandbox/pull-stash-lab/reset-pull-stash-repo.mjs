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

mkdirSync(originDir, { recursive: true });
git(['init', '--bare'], originDir);
git(['clone', originDir, repoDir], dirname(repoDir));

git(['config', 'user.name', 'Gitvan Pull Stash Lab'], repoDir);
git(['config', 'user.email', 'pull-stash-lab@example.com'], repoDir);

writeFileSync(
    join(repoDir, 'story.txt'),
    ['Release Notes', '=============', '', 'Headline: Shared baseline', 'Status: pending', 'Checklist: verify migrations', ''].join('\n'),
    'utf8'
);

git(['add', 'story.txt'], repoDir);
git(['commit', '-m', 'Initial baseline'], repoDir);
git(['push', '-u', 'origin', 'main'], repoDir);

// Origin moves ahead by rewriting the same file the working tree edits locally.
mkdirSync(upstreamDir, { recursive: true });
git(['clone', originDir, upstreamDir], dirname(upstreamDir));
git(['config', 'user.name', 'Gitvan Upstream Writer'], upstreamDir);
git(['config', 'user.email', 'upstream@example.com'], upstreamDir);

writeFileSync(
    join(upstreamDir, 'story.txt'),
    ['Release Notes', '=============', '', 'Headline: Origin release draft', 'Status: ready-for-release', 'Checklist: verify migrations and rollout notes', ''].join('\n'),
    'utf8'
);
git(['add', 'story.txt'], upstreamDir);
git(['commit', '-m', 'Advance origin with incoming release update'], upstreamDir);
git(['push', 'origin', 'main'], upstreamDir);

// Tracking refs must already show the incoming commit, and the working tree edit
// is what makes the first pull fail with "local changes would be overwritten".
git(['fetch', 'origin'], repoDir);
writeFileSync(
    join(repoDir, 'story.txt'),
    ['Release Notes', '=============', '', 'Headline: Local working tree draft', 'Status: blocked-by-qa', 'Checklist: verify migrations and smoke tests', ''].join('\n'),
    'utf8'
);

console.log(`Lab repository created at: ${repoDir}`);
console.log(`Origin remote created at: ${originDir}`);
console.log('The repository is behind origin/main with an unstaged edit to the same file,');
console.log('so the first pull is blocked and the retried pull after stashing succeeds.');
