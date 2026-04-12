import { chmodSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
const helperCandidates = [
    join(projectRoot, 'node_modules', 'node-pty', 'prebuilds', `darwin-${process.arch}`, 'spawn-helper'),
    join(projectRoot, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper'),
    join(projectRoot, 'node_modules', 'node-pty', 'build', 'Debug', 'spawn-helper'),
];

function ensureExecutable(filePath: string) {
    if (!existsSync(filePath)) {
        return false;
    }

    const mode = statSync(filePath).mode;
    if ((mode & 0o111) === 0o111) {
        return true;
    }

    chmodSync(filePath, mode | 0o755);
    return true;
}

let repairedAny = false;

for (const candidate of helperCandidates) {
    repairedAny = ensureExecutable(candidate) || repairedAny;
}

if (repairedAny) {
    console.log('Ensured node-pty spawn-helper is executable.');
}
