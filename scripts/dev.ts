#!/usr/bin/env bun
/**
 * Claims the dev ports for a fresh Vite, and nothing else.
 *
 * A dev server left behind by an interrupted session keeps holding the API and UI ports. Vite runs
 * with `strictPort`, so a second one dies on EADDRINUSE while the stale process keeps answering —
 * including the `/health` probe a Playwright `webServer` uses, which then adopts that orphan, runs
 * every spec against another database and stub, and loses the server the moment the new config
 * load reaps it. That is the flake this launcher removes: the ports are cleared here, before Vite
 * binds and before Playwright probes.
 *
 * `bun scripts/dev.ts --reap-only` claims the ports and exits. That is what `test:e2e` runs before
 * the Playwright CLI: Playwright adopts anything that already answers, so the ports have to be free
 * before it starts, and keeping the reap in this separate process keeps it out of Playwright's own
 * process tree — a reaper that runs inside a `webServer` can otherwise kill the server Playwright
 * just started.
 */
import { execSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read straight from the environment: importing `appConfig` here resolves it through the module
// graph, which reports the packaged ports even when they were overridden for this run. The flags
// exist for the browser run, whose ports are its own and are not exported by the npm script.
function portFromFlag(flag: string) {
    const index = process.argv.indexOf(flag);

    return index === -1 ? Number.NaN : Number.parseInt(process.argv[index + 1] ?? '', 10);
}

const apiPort = portFromFlag('--api-port') || Number.parseInt(process.env.GITVAN_API_PORT ?? '', 10) || 5176;
const vuePort = portFromFlag('--vue-port') || Number.parseInt(process.env.GITVAN_VUE_PORT ?? '', 10) || 5177;
const reapOnly = process.argv.includes('--reap-only');

// Vite does not understand the reaping flags, so they never reach it.
const viteArgs = process.argv.slice(2).filter((arg, index, args) => !['--api-port', '--vue-port'].includes(args[index - 1] ?? '') && arg !== '--reap-only');

/** Only a dev server is reaped: this launcher and the app it starts are the two to leave alone. */
function isDevServer(pid: number) {
    try {
        const command = execSync(`ps -o command= -p ${pid} || true`).toString();

        return command.includes('vite') || command.includes('scripts/dev.ts') || command.includes('bun run dev');
    } catch {
        return false;
    }
}

function listeningPids(port: number) {
    try {
        return execSync(`lsof -ti:${port} -sTCP:LISTEN || true`)
            .toString()
            .split('\n')
            .map((value) => Number.parseInt(value, 10))
            .filter((pid) => Number.isInteger(pid));
    } catch {
        return [];
    }
}

/**
 * A parent that already holds a connection on the port makes `lsof` list this launcher's own
 * process tree, so the launcher itself, its parent and its children are never candidates.
 */
function isOwnProcessTree(pid: number) {
    if (pid === process.pid || pid === process.ppid) {
        return true;
    }

    try {
        const parent = Number.parseInt(execSync(`ps -o ppid= -p ${pid} || true`).toString().trim(), 10);

        return parent === process.pid;
    } catch {
        return false;
    }
}

for (const port of [apiPort, vuePort]) {
    for (const pid of listeningPids(port)) {
        if (isOwnProcessTree(pid) || !isDevServer(pid)) {
            continue;
        }

        console.log(`Stopping the dev server still holding port ${port}: ${pid}`);
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            /* it exited between the check and the signal */
        }
    }
}

if (reapOnly) {
    process.exit(0);
}

// Vite is spawned through its own entry and through `node`, not through this launcher's runtime:
// that entry is an ESM script with a `node` shebang, and running it under Bun panics on a NAPI
// call — which is exactly how a dev server ends up left behind for the next run to trip over.
const viteBin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'vite', 'bin', 'vite.js');
const nodePath = execSync('command -v node || true', { shell: '/bin/bash' }).toString().trim() || process.execPath;
const child = spawn(nodePath, [viteBin, ...viteArgs], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
