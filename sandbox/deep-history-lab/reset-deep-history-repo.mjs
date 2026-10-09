#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = join(__dirname, 'repo');
const earlyCount = 30;
const lateCount = 38;

rmSync(repoDir, { recursive: true, force: true });
mkdirSync(repoDir, { recursive: true });

function git(args, options = {}) {
    execFileSync('git', args, { cwd: repoDir, stdio: 'ignore', ...options });
}

git(['init', '-b', 'main']);
git(['config', 'user.name', 'Gitvan Deep History Lab']);
git(['config', 'user.email', 'deep-history-lab@example.com']);

// One fast-import process builds the whole history, so rebuilding the fixture stays cheap
// enough for every browser spec that resets the sandbox.
const name = 'Gitvan Deep History Lab';
const email = 'deep-history-lab@example.com';
const authoredAt = 1_760_000_000;
const stream = [];
const trackedPaths = [];
let commitIndex = 0;

function commit(message) {
    commitIndex += 1;
    stream.push('commit refs/heads/main');
    stream.push(`committer ${name} <${email}> ${authoredAt + commitIndex * 60} +0000`);
    stream.push(`data ${Buffer.byteLength(message)}`);
    stream.push(message);
}

function addFile(path, content) {
    trackedPaths.push(path);
    stream.push(`M 100644 inline ${path}`);
    stream.push(`data ${Buffer.byteLength(content)}`);
    stream.push(content);
}

commit('Initial baseline');
addFile('README.md', 'Deep history lab\n');

for (let index = 1; index <= earlyCount; index++) {
    const path = `early/early-${String(index).padStart(2, '0')}.txt`;
    commit(`Add ${path}`);
    addFile(path, `early ${String(index).padStart(2, '0')}\n`);
}

// A snapshot with no files at all, far enough down the first page of history to be selectable.
commit('Remove every tracked file');
for (const path of trackedPaths) {
    stream.push(`D ${path}`);
}

for (let index = 1; index <= lateCount; index++) {
    const path = `notes/note-${String(index).padStart(2, '0')}.txt`;
    commit(`Add ${path}`);
    addFile(path, `note ${String(index).padStart(2, '0')}\n`);
}

git(['fast-import', '--quiet'], { input: `${stream.join('\n')}\n`, stdio: ['pipe', 'ignore', 'inherit'] });
git(['checkout', '--force', 'main']);

const commitTotal = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
console.log(`Lab repository created at: ${repoDir}`);
console.log(`${commitTotal} commits: ${earlyCount} early files, one empty-tree commit, ${lateCount} notes.`);
