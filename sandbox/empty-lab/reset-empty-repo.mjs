#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = join(__dirname, 'repo');

rmSync(repoDir, { recursive: true, force: true });
mkdirSync(repoDir, { recursive: true });

function git(args) {
    execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' });
}

// A repository that was created but never committed to: the state a user is in right after
// "Create New Repository". Nothing is staged, so the working tree holds one untracked file.
git(['init', '-b', 'main']);
git(['config', 'user.name', 'Gitvan Empty Lab']);
git(['config', 'user.email', 'empty-lab@example.com']);
writeFileSync(join(repoDir, 'README.md'), 'This repository has no commits yet.\n', 'utf8');

console.log(`Lab repository created at: ${repoDir}`);
console.log('It has no commits and one untracked file.');
