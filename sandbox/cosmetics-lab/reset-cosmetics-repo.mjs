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

git(['init', '-b', 'main']);
git(['config', 'user.name', 'Gitvan Cosmetics Lab']);
git(['config', 'user.email', 'cosmetics-lab@example.com']);

// ── File 1: actual edits (no cosmetics) ──

const actualContent =
    [
        '// actual-edits.txt',
        '',
        'function greet(name) {',
        '    return "Hello, " + name + "!";',
        '}',
        '',
        'function add(a, b) {',
        '    return a + b;',
        '}',
        '',
        'const PI = 3.14159;',
        '',
    ].join('\n') + '\n';

// ── File 2: whitespace-only changes ──

const wsBaseline = ['// whitespace-demo.txt', '', 'function  calculate(value) {', '    return  value  *  2;', '}', '', 'const  items  =  [1, 2, 3];', ''].join('\n') + '\n';

const wsModified = ['// whitespace-demo.txt', '', 'function calculate(value) {', '   return value * 2;', '}', '', 'const items = [1, 2, 3];', ''].join('\n') + '\n';

// ── File 3: changes in ignored characters (quotes, braces) ──

const ignoredCharBaseline = ['// cosmetic-chars.txt', '', 'message = "Hello World"', 'title = "My App"', 'label = "Submit"', ''].join('\n') + '\n';

const ignoredCharModified = ['// cosmetic-chars.txt', '', "message = 'Hello World'", "title = 'My App'", "label = 'Submit'", ''].join('\n') + '\n';

// ── File 4: mixed — some cosmetic + some real changes ──

const mixedBaseline =
    ['// mixed.txt', '', 'function render(name) {', '    return "<div>" + name + "</div>";', '}', '', 'const debug = false;', 'const version = "1.0";', ''].join('\n') + '\n';

const mixedModified =
    ['// mixed.txt (modified)', '', 'function render(name) {', '    return "<div>" + name + "</div>";', '}', '', 'const debug = true;', 'const version = "1.0";', ''].join('\n') +
    '\n';

// ── File 5: only cosmetic changes (no actual content change) ──

const cosmeticOnlyBaseline = ['// cosmetics-only.txt', '', '/* eslint-disable */', 'const a = 1;', 'const b = 2;', '/* eslint-enable */', ''].join('\n') + '\n';

const cosmeticOnlyModified =
    ['// cosmetics-only.txt', '', '/* eslint-disable */', "const a = 1; // this comment doesn't change the meaning", 'const b = 2;', '/* eslint-enable */', ''].join('\n') + '\n';

// ── Commit baseline ──
writeFileSync(join(repoDir, 'actual-edits.txt'), actualContent, 'utf8');
writeFileSync(join(repoDir, 'whitespace-demo.txt'), wsBaseline, 'utf8');
writeFileSync(join(repoDir, 'cosmetic-chars.txt'), ignoredCharBaseline, 'utf8');
writeFileSync(join(repoDir, 'mixed.txt'), mixedBaseline, 'utf8');
writeFileSync(join(repoDir, 'cosmetics-only.txt'), cosmeticOnlyBaseline, 'utf8');
git(['add', '-A']);
git(['commit', '-m', 'Initial baseline']);

// ── Apply modifications ──
writeFileSync(join(repoDir, 'actual-edits.txt'), actualContent, 'utf8'); // no change — will leave unstaged below
writeFileSync(join(repoDir, 'whitespace-demo.txt'), wsModified, 'utf8');
writeFileSync(join(repoDir, 'cosmetic-chars.txt'), ignoredCharModified, 'utf8');
writeFileSync(join(repoDir, 'mixed.txt'), mixedModified, 'utf8');
writeFileSync(join(repoDir, 'cosmetics-only.txt'), cosmeticOnlyModified, 'utf8');

// Stage some, leave some unstaged
git(['add', 'cosmetics-only.txt']);
// whitespace-demo.txt, cosmetic-chars.txt, mixed.txt — unstaged
// actual-edits.txt — identical to committed (no change)

// ── verify ──
function countHunks(file) {
    const out = execFileSync('git', ['diff', '--unified=0', '--', file], { cwd: repoDir, encoding: 'utf8' });
    return (out.match(/^@@ /gm) || []).length;
}

console.log(`Done — repo ready at ${repoDir}\n`);
console.log('Files:');
for (const file of ['actual-edits.txt', 'whitespace-demo.txt', 'cosmetic-chars.txt', 'mixed.txt', 'cosmetics-only.txt']) {
    const staged = execFileSync('git', ['diff', '--staged', '--stat', '--', file], { cwd: repoDir, encoding: 'utf8' }).trim();
    const unstaged = execFileSync('git', ['diff', '--stat', '--', file], { cwd: repoDir, encoding: 'utf8' }).trim();
    const stagedHunks = execFileSync('git', ['diff', '--staged', '--unified=0', '--', file], { cwd: repoDir, encoding: 'utf8' });
    const unstagedHunks = execFileSync('git', ['diff', '--unified=0', '--', file], { cwd: repoDir, encoding: 'utf8' });
    console.log(`  ${file}`);
    if (staged) console.log(`    staged:   ${staged}`);
    if (unstaged) console.log(`    unstaged: ${unstaged}`);
}
console.log();
console.log('Try:  cd', repoDir);
