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
function gitCapture(args) {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
}

git(['init', '-b', 'main']);
git(['config', 'user.name', 'Gitvan Conflict Lab']);
git(['config', 'user.email', 'conflict-lab@example.com']);

// ── baseline files ──
writeFileSync(
    join(repoDir, 'story.txt'),
    ['Release Notes', '=============', '', 'Headline: Shared baseline text', 'Status: pending', 'Owner: product-team', ''].join('\n'),
    'utf8'
);

writeFileSync(
    join(repoDir, 'config.json'),
    JSON.stringify(
        {
            environment: 'shared',
            apiBaseUrl: 'https://shared.example.test',
            featureFlag: false,
        },
        null,
        4
    ) + '\n',
    'utf8'
);

writeFileSync(join(repoDir, 'notes.md'), ['# Deployment Checklist', '', '- Verify migrations', '- Notify QA', '- Prepare release notes', ''].join('\n'), 'utf8');

writeFileSync(join(repoDir, 'unchanged-one.txt'), 'This file is intentionally left unchanged.\n', 'utf8');
writeFileSync(join(repoDir, 'unchanged-two.txt'), 'This file also stays unchanged across all branches.\n', 'utf8');

writeFileSync(join(repoDir, 'feature-only.txt'), ['Feature-only notes', '==================', '', 'Status: baseline', 'Owner: shared', ''].join('\n'), 'utf8');

writeFileSync(join(repoDir, 'main-only.txt'), ['Main-only notes', '===============', '', 'Status: baseline', 'Owner: shared', ''].join('\n'), 'utf8');

git(['add', '.']);
git(['commit', '-m', 'Initial baseline']);

// ── feature branch edits ──
git(['switch', '-c', 'feature/conflicting-copy']);

writeFileSync(
    join(repoDir, 'story.txt'),
    ['Release Notes', '=============', '', 'Headline: Feature branch rewrite', 'Status: ready-for-review', 'Owner: feature-team', ''].join('\n'),
    'utf8'
);

writeFileSync(
    join(repoDir, 'config.json'),
    JSON.stringify(
        {
            environment: 'feature-branch',
            apiBaseUrl: 'https://feature.example.test',
            featureFlag: true,
        },
        null,
        4
    ) + '\n',
    'utf8'
);

writeFileSync(join(repoDir, 'notes.md'), ['# Deployment Checklist', '', '- Verify migrations', '- Notify support', '- Prepare feature announcement', ''].join('\n'), 'utf8');

writeFileSync(join(repoDir, 'feature-only.txt'), ['Feature-only notes', '==================', '', 'Status: updated-on-feature', 'Owner: feature-team', ''].join('\n'), 'utf8');

writeFileSync(join(repoDir, 'main-only.txt'), ['Main-only notes', '===============', '', 'Status: updated-on-feature', 'Owner: release-team', ''].join('\n'), 'utf8');

git(['add', '.']);
git(['commit', '-m', 'Feature branch edits conflicting and clean files']);

// ── switch back to main, different edits ──
git(['switch', 'main']);

writeFileSync(
    join(repoDir, 'story.txt'),
    ['Release Notes', '=============', '', 'Headline: Main branch rewrite', 'Status: blocked-by-review', 'Owner: core-team', ''].join('\n'),
    'utf8'
);

writeFileSync(
    join(repoDir, 'config.json'),
    JSON.stringify(
        {
            environment: 'main-branch',
            apiBaseUrl: 'https://main.example.test',
            featureFlag: false,
        },
        null,
        4
    ) + '\n',
    'utf8'
);

writeFileSync(join(repoDir, 'notes.md'), ['# Deployment Checklist', '', '- Verify database backup', '- Notify QA', '- Prepare production summary', ''].join('\n'), 'utf8');

git(['add', '.']);
git(['commit', '-m', 'Main branch edits conflicting and clean files']);

// ── merge (intentionally causes conflicts) ──
let mergeOk = false;
try {
    git(['merge', 'feature/conflicting-copy']);
    mergeOk = true;
} catch {
    // Expected — merge conflicts
}

if (mergeOk) {
    console.error('Expected a merge conflict, but merge completed cleanly.');
    process.exit(1);
}

// ── rewrite story.txt with adjacent conflict blocks ──
writeFileSync(
    join(repoDir, 'story.txt'),
    [
        'Release Notes',
        '=============',
        '',
        '<<<<<<< HEAD',
        'Headline: Main branch rewrite',
        '=======',
        'Headline: Feature branch rewrite',
        '>>>>>>> feature/conflicting-copy',
        '<<<<<<< HEAD',
        'Status: blocked-by-review',
        '=======',
        'Status: ready-for-review',
        '>>>>>>> feature/conflicting-copy',
        '<<<<<<< HEAD',
        'Owner: core-team',
        '=======',
        'Owner: feature-team',
        '>>>>>>> feature/conflicting-copy',
        '',
    ].join('\n'),
    'utf8'
);

console.log(`Dummy repository created at: ${repoDir}`);
console.log('Repository is intentionally left in a merge-conflict state.');
console.log('Conflicted files: story.txt, config.json, notes.md');
console.log('story.txt contains adjacent conflict blocks with no unchanged lines between them');
console.log('Changed without conflict: feature-only.txt, main-only.txt');
console.log('Unchanged files: unchanged-one.txt, unchanged-two.txt');
