#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = join(__dirname, 'repo');
const stubsDir = join(__dirname, 'stubs');

rmSync(repoDir, { recursive: true, force: true });
mkdirSync(repoDir, { recursive: true });

function git(args) {
    execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' });
}

git(['init', '-b', 'main']);
git(['config', 'user.name', 'Gitvan Partial Changes Lab']);
git(['config', 'user.email', 'partial-changes-lab@example.com']);

const lineCount = 300;

function makeLines() {
    const lines = [];
    for (let i = 1; i <= lineCount; i++) lines.push(`line ${i}`);
    return lines;
}

function applyChanges(lines, changes) {
    const sorted = [...changes].sort((a, b) => b.at - a.at);
    for (const c of sorted) {
        if (c.type === 'modify') {
            lines[c.at - 1] = `line ${c.at} **MODIFIED**`;
        } else if (c.type === 'delete') {
            lines.splice(c.at - 1, c.count);
        } else if (c.type === 'add') {
            const insert = [];
            for (let j = 1; j <= c.count; j++) insert.push(`>> inserted after original line ${c.at}`);
            lines.splice(c.at, 0, ...insert);
        }
    }
}
const firstFile = 'first.txt';
const secondFile = 'second.txt';
const stubFile = 'stub.txt';
const untrackedFile = 'untracked.txt';
const deletedFile = 'removed.txt';

// ── Commit clean baseline ──
writeFileSync(join(repoDir, secondFile), makeLines().join('\n') + '\n', 'utf8');
writeFileSync(join(repoDir, firstFile), makeLines().join('\n') + '\n', 'utf8');
writeFileSync(join(repoDir, stubFile), readFileSync(join(stubsDir, 'old.txt'), 'utf8') + '\n', 'utf8');
writeFileSync(join(repoDir, deletedFile), 'This tracked file is deleted from the working tree.\n', 'utf8');
git(['add', secondFile, firstFile, stubFile, deletedFile]);
git(['commit', '-m', 'Initial baseline']);

// ── second file: overwrite with changes ──
const u = makeLines();
applyChanges(u, [
    { type: 'modify', at: 2 },
    { type: 'delete', at: 28, count: 3 },
    { type: 'add', at: 55, count: 2 },
    { type: 'modify', at: 80 },
    { type: 'delete', at: 110, count: 5 },
    { type: 'add', at: 140, count: 3 },
    { type: 'modify', at: 170 },
    { type: 'delete', at: 200, count: 2 },
    { type: 'add', at: 230, count: 4 },
]);
writeFileSync(join(repoDir, secondFile), u.join('\n') + '\n', 'utf8');

// ── first file: overwrite with changes, then stage ──
const s = makeLines();
applyChanges(s, [
    { type: 'modify', at: 3 },
    { type: 'delete', at: 32, count: 3 },
    { type: 'add', at: 60, count: 2 },
    { type: 'modify', at: 90 },
    { type: 'delete', at: 125, count: 4 },
    { type: 'add', at: 155, count: 3 },
]);
writeFileSync(join(repoDir, firstFile), s.join('\n') + '\n', 'utf8');
git(['add', firstFile]);

// stub file: overwrite with changes, then stage
writeFileSync(join(repoDir, stubFile), readFileSync(join(stubsDir, 'new.txt'), 'utf8') + '\n', 'utf8');

// ── untracked and deleted entries for the destructive-change specs ──
writeFileSync(join(repoDir, untrackedFile), 'This file was never committed.\n', 'utf8');
rmSync(join(repoDir, deletedFile), { force: true });

// ── verify ──
function countHunks(file) {
    const out = execFileSync('git', ['diff', '--unified=0', '--', file], { cwd: repoDir, encoding: 'utf8' });
    return (out.match(/^@@ /gm) || []).length;
}
function countStagedHunks(file) {
    const out = execFileSync('git', ['diff', '--staged', '--unified=0', '--', file], { cwd: repoDir, encoding: 'utf8' });
    return (out.match(/^@@ /gm) || []).length;
}

console.log(`Done — repo ready at ${repoDir}\n`);
console.log(`${secondFile} — 9 hunks (3× modify, 3× delete, 3× add):`);
console.log(`  git diff --unified=0 -- ${secondFile}  →  ${countHunks(secondFile)} hunks\n`);
console.log(`${firstFile} — 6 hunks (2× modify, 2× delete, 2× add):`);
console.log(`  git diff --staged --unified=0 -- ${firstFile}  →  ${countStagedHunks(firstFile)} hunks\n`);
console.log(`${stubFile} — 3 hunks (1× modify, 1× delete, 1× add):`);
console.log(`  git diff --staged --unified=0 -- ${stubFile}  →  ${countStagedHunks(stubFile)} hunks\n`);
console.log(`${untrackedFile} — untracked, ${deletedFile} — deleted from the working tree\n`);
console.log(`Try:  cd ${repoDir}`);
