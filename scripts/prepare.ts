/// <reference types="node" />

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type BuildMode = 'unsigned' | 'signed' | 'notarized';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function printUsage() {
    console.log(`Usage: npm run release:prepare -- [--test] [--unsigned|--signed|--notarize]

Runs the release preparation flow:
- release audit
- optional release-facing tests
- macOS artifact build

Flags:
  --test       Run release-facing tests before building.
  --unsigned   Build unsigned macOS artifacts.
  --signed     Build signed macOS artifacts.
  --notarize   Build signed and notarized macOS artifacts.
  --help       Show this help message.

Default build mode: --notarize
`);
}

function parseArgs(args: string[]) {
    let runTests = false;
    let buildMode: BuildMode = 'notarized';

    for (const arg of args) {
        switch (arg) {
            case '--test':
                runTests = true;
                break;
            case '--unsigned':
                buildMode = 'unsigned';
                break;
            case '--signed':
                buildMode = 'signed';
                break;
            case '--notarize':
                buildMode = 'notarized';
                break;
            case '--help':
            case '-h':
                printUsage();
                process.exit(0);
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return { runTests, buildMode };
}

async function runCommand(command: string, args: string[]) {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: projectRoot,
            stdio: 'inherit',
            env: process.env,
        });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            if (signal) {
                reject(new Error(`${command} ${args.join(' ')} terminated by signal ${signal}.`));
                return;
            }

            reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
        });
    });
}

async function main() {
    const { runTests, buildMode } = parseArgs(process.argv.slice(2));

    console.log('==> Running release audit');
    await runCommand(npmCommand, ['run', 'release:audit']);

    if (runTests) {
        console.log('==> Running release-facing tests');
        await runCommand(npmCommand, ['run', 'test:release']);
    }

    console.log(`==> Building ${buildMode} macOS release artifacts`);
    let buildScript = 'release:mac';

    if (buildMode === 'signed') {
        buildScript = 'release:mac:signed';
    } else if (buildMode === 'notarized') {
        buildScript = 'release:mac:notarized';
    }

    await runCommand(npmCommand, ['run', buildScript]);
    console.log('==> Release preparation finished');
}

await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});
