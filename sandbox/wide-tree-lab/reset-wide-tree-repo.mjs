#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = join(__dirname, 'repo');
const fileCount = 400;

rmSync(repoDir, { recursive: true, force: true });
mkdirSync(join(repoDir, 'notes'), { recursive: true });

function git(args) {
    execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' });
}

git(['init', '-b', 'main']);
git(['config', 'user.name', 'Gitvan Wide Tree Lab']);
git(['config', 'user.email', 'wide-tree-lab@example.com']);

writeFileSync(join(repoDir, 'README.md'), 'Wide tree lab\n', 'utf8');

for (let index = 1; index <= fileCount; index++) {
    const name = `note-${String(index).padStart(3, '0')}.txt`;
    writeFileSync(join(repoDir, 'notes', name), `note ${String(index).padStart(3, '0')}\n`, 'utf8');
}

git(['add', 'README.md', 'notes']);
git(['commit', '-m', 'Wide tree baseline']);

console.log(`Lab repository created at: ${repoDir}`);
console.log(`${fileCount + 1} files under one expanded directory tree.`);
