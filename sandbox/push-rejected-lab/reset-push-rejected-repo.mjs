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

git(['config', 'user.name', 'Gitvan Push Rejected Lab'], repoDir);
git(['config', 'user.email', 'push-rejected-lab@example.com'], repoDir);

writeFileSync(
    join(repoDir, 'story.txt'),
    ['Release Notes', '=============', '', 'Headline: Shared baseline', 'Status: pending', 'Checklist: verify migrations', ''].join('\n'),
    'utf8'
);

git(['add', 'story.txt'], repoDir);
git(['commit', '-m', 'Initial baseline'], repoDir);
git(['push', '-u', 'origin', 'main'], repoDir);

// Origin moves on from a separate clone, and the lab clone never fetches it back, so the
// tracking ref stays at the baseline and the divergence is only visible to git push.
mkdirSync(upstreamDir, { recursive: true });
git(['clone', originDir, upstreamDir], dirname(upstreamDir));
git(['config', 'user.name', 'Gitvan Upstream Writer'], upstreamDir);
git(['config', 'user.email', 'upstream@example.com'], upstreamDir);

writeFileSync(join(upstreamDir, 'notes.md'), ['# Upstream Notes', '', '- Only origin has this file until the pull lands.', ''].join('\n'), 'utf8');
git(['add', 'notes.md'], upstreamDir);
git(['commit', '-m', 'Advance origin with incoming release notes'], upstreamDir);
git(['push', 'origin', 'main'], upstreamDir);

// Touching a different file keeps the pull that follows the rejection a clean merge.
writeFileSync(join(repoDir, 'changelog.md'), ['# Local Changelog', '', '- Committed locally without fetching origin first.', ''].join('\n'), 'utf8');
git(['add', 'changelog.md'], repoDir);
git(['commit', '-m', 'Add local changelog entry'], repoDir);

console.log(`Lab repository created at: ${repoDir}`);
console.log(`Origin remote created at: ${originDir}`);
console.log('The repository is a commit ahead of its stale tracking ref while origin/main is a commit ahead of it,');
console.log('so Push is offered and git rejects it as a non-fast-forward until the lab fetches.');
