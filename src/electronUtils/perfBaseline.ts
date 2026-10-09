/**
 * Repeatable backend performance baseline for the performance items in todos.md.
 *
 * Run with: bun do.ts perf [--repos=8] [--files=60] [--commits=1500] [--repeats=3] [--json] [--keep]
 *
 * Every scenario builds its own throwaway repositories under the OS temp directory and runs
 * the real backend service functions, so the numbers cover process spawning, git work and
 * in-process parsing rather than a mock. Numbers belong in the PR description, not in
 * todos.md.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changesGit } from '../backend/services/git/git-changes.js';
import { runGit } from '../backend/services/git/git-common.js';
import { historyGit } from '../backend/services/git/git-history.js';
import { invalidateAllRepoSidebarStatuses, readRepoSidebarStatus } from '../backend/services/repoStatusCache.js';

type Options = {
    repos: number;
    files: number;
    commits: number;
    repeats: number;
    json: boolean;
    keep: boolean;
};

type Result = {
    scenario: string;
    note: string;
    medianMs: number;
    minMs: number;
    maxMs: number;
    detail?: string;
};

const fixtures: string[] = [];

function printUsage() {
    console.log('Usage: bun do.ts perf [--repos=8] [--files=60] [--commits=1500] [--repeats=3] [--json] [--keep]');
}

function parseOptions(argv: string[]): Options | undefined {
    const options: Options = { repos: 8, files: 60, commits: 1500, repeats: 3, json: false, keep: false };

    for (const arg of argv) {
        if (arg === '--json') {
            options.json = true;
            continue;
        }

        if (arg === '--keep') {
            options.keep = true;
            continue;
        }

        if (arg === '--help' || arg === '-h') {
            printUsage();
            return undefined;
        }

        const match = arg.match(/^--(repos|files|commits|repeats)=(\d+)$/);
        if (!match) {
            throw new Error(`Unknown argument: ${arg}`);
        }

        const value = Number.parseInt(match[2]!, 10);
        if (!Number.isFinite(value) || value < 1) {
            throw new Error(`Expected a positive number for --${match[1]}.`);
        }

        options[match[1] as 'repos' | 'files' | 'commits' | 'repeats'] = value;
    }

    return options;
}

function git(cwd: string, args: string[]) {
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createRepo(prefix: string, commits = 1, changedFiles = 0) {
    const repoPath = mkdtempSync(join(tmpdir(), `gitvan-perf-${prefix}-`));
    fixtures.push(repoPath);

    git(repoPath, ['init', '--quiet']);
    git(repoPath, ['config', 'user.name', 'Gitvan Perf']);
    git(repoPath, ['config', 'user.email', 'perf@example.com']);
    git(repoPath, ['config', 'commit.gpgsign', 'false']);

    writeFileSync(join(repoPath, 'seed.txt'), 'seed\n', 'utf8');
    git(repoPath, ['add', '--', 'seed.txt']);
    git(repoPath, ['commit', '--quiet', '-m', 'Initial commit']);

    for (let index = 1; index < commits; index += 1) {
        git(repoPath, ['commit', '--quiet', '--allow-empty', '-m', `Commit ${index}`]);
    }

    for (let index = 0; index < changedFiles; index += 1) {
        const name = `changed-${String(index).padStart(4, '0')}.txt`;
        writeFileSync(join(repoPath, name), `original content for ${name}\n`, 'utf8');
        git(repoPath, ['add', '--', name]);
    }

    if (changedFiles > 0) {
        git(repoPath, ['commit', '--quiet', '-m', `Add ${changedFiles} files`]);
        for (let index = 0; index < changedFiles; index += 1) {
            const name = `changed-${String(index).padStart(4, '0')}.txt`;
            writeFileSync(join(repoPath, name), `modified content for ${name}\nsecond line\n`, 'utf8');
        }
    }

    return repoPath;
}

function headSha(repoPath: string) {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
}

async function measure(scenario: string, note: string, fn: () => Promise<string | undefined>, repeats: number): Promise<Result> {
    const samples: number[] = [];
    let detail: string | undefined;

    for (let index = 0; index < repeats; index += 1) {
        const startedAt = performance.now();
        detail = (await fn()) ?? detail;
        samples.push(performance.now() - startedAt);
    }

    samples.sort((left, right) => left - right);
    const middle = Math.floor(samples.length / 2);

    return {
        scenario,
        note,
        medianMs: samples[middle]!,
        minMs: samples[0]!,
        maxMs: samples.at(-1)!,
        detail,
    };
}

async function runStatusSweep(options: Options): Promise<Result[]> {
    const repos = Array.from({ length: options.repos }, (_, index) => createRepo(`status-${index}`, 25, 3));
    let scans = 0;

    const sweep = async () => {
        scans = 0;
        await Promise.all(
            repos.map((repoPath) =>
                readRepoSidebarStatus(repoPath, async () => {
                    scans += 1;
                    return await changesGit.getRepoSidebarStatus(repoPath);
                })
            )
        );
    };

    const cold = await measure(
        `status sweep, cold cache (${options.repos} repos)`,
        'forces the full sweep on every repetition',
        async () => {
            invalidateAllRepoSidebarStatuses();
            await sweep();
            return `${scans} git scans`;
        },
        options.repeats
    );

    const warm = await measure(
        `status sweep, warm cache (${options.repos} repos)`,
        'same sweep with the cache populated by the cold run',
        async () => {
            await sweep();
            return `${scans} git scans`;
        },
        options.repeats
    );

    return [cold, warm];
}

async function runChangesFanOut(options: Options): Promise<Result[]> {
    const repoPath = createRepo('changes', 1, options.files);
    const cosmeticCapNote = options.files < 100 ? 'cosmetic check active' : 'above the 100-file cosmetic cap';

    return [
        await measure(
            `changes refresh (${options.files} modified files)`,
            cosmeticCapNote,
            async () => {
                const changes = await changesGit.getRepoChanges(repoPath, { ignoredChars: '', showWhitespaceChanges: false });
                return `${changes.unstaged.length} unstaged entries`;
            },
            options.repeats
        ),
    ];
}

async function runUnpushedWalk(options: Options): Promise<Result[]> {
    const repoPath = createRepo('unpushed', options.commits);

    return [
        await measure(
            `unpushed commit walk (${options.commits} commits)`,
            'git rev-list HEAD --not --remotes, uncapped',
            async () => {
                // Runs the same command the unpushed-commit helper issues, without depending on it.
                const output = await runGit(['rev-list', 'HEAD', '--not', '--remotes'], repoPath, [0, 128]);
                const commits = output.split('\n').filter(Boolean).length;
                return `${commits} commits`;
            },
            options.repeats
        ),
    ];
}

async function runCommitDetail(options: Options): Promise<Result[]> {
    const repoPath = createRepo('commit-detail', 1, 0);
    const touchedFiles = Math.max(1, Math.min(options.files, 200));

    for (let index = 0; index < touchedFiles; index += 1) {
        writeFileSync(join(repoPath, `detail-${String(index).padStart(4, '0')}.txt`), `payload ${index}\n`, 'utf8');
    }

    git(repoPath, ['add', '--', '.']);
    git(repoPath, ['commit', '--quiet', '-m', `Touch ${touchedFiles} files`]);
    const sha = headSha(repoPath);

    return [
        await measure(
            `commit detail (${touchedFiles} files)`,
            'includes the full patch payload and unpushed walk',
            async () => {
                const detail = await historyGit.getCommitDetail(repoPath, sha);
                const bytes = Buffer.byteLength(JSON.stringify(detail), 'utf8');
                return `${(bytes / 1024).toFixed(1)} KiB payload, ${detail.files.length} files`;
            },
            options.repeats
        ),
    ];
}

async function runBulkDiscard(options: Options): Promise<Result[]> {
    const repoPath = createRepo('discard', 1, 0);
    const paths = Array.from({ length: options.files }, (_, index) => `dirty-${String(index).padStart(4, '0')}.txt`);

    return [
        await measure(
            `bulk discard (${options.files} untracked files)`,
            'one git process pair per file',
            async () => {
                for (const path of paths) {
                    writeFileSync(join(repoPath, path), 'dirty\n', 'utf8');
                }

                await changesGit.discardRepoFiles(repoPath, paths);
                return `${paths.length} files discarded`;
            },
            1
        ),
    ];
}

function runtimeLabel() {
    return process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`;
}

function printTable(results: Result[], options: Options) {
    console.log('');
    console.log(`Gitvan backend baseline | ${runtimeLabel()} | ${process.platform} ${process.arch}`);
    console.log(`repos=${options.repos} files=${options.files} commits=${options.commits} repeats=${options.repeats}`);
    console.log('');

    const width = Math.max(...results.map((result) => result.scenario.length), 'scenario'.length);
    console.log(`${'scenario'.padEnd(width)}  ${'median'.padStart(10)}  ${'min'.padStart(10)}  ${'max'.padStart(10)}  detail`);
    console.log(`${'-'.repeat(width)}  ${'-'.repeat(10)}  ${'-'.repeat(10)}  ${'-'.repeat(10)}  ${'-'.repeat(24)}`);

    for (const result of results) {
        const median = `${result.medianMs.toFixed(1)} ms`;
        const min = `${result.minMs.toFixed(1)} ms`;
        const max = `${result.maxMs.toFixed(1)} ms`;
        console.log(`${result.scenario.padEnd(width)}  ${median.padStart(10)}  ${min.padStart(10)}  ${max.padStart(10)}  ${result.detail ?? ''}`);
    }

    console.log('');
    for (const result of results) {
        console.log(`- ${result.scenario}: ${result.note}`);
    }
    console.log('');
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    if (!options) {
        return;
    }

    const results: Result[] = [];

    try {
        results.push(...(await runStatusSweep(options)));
        results.push(...(await runChangesFanOut(options)));
        results.push(...(await runUnpushedWalk(options)));
        results.push(...(await runCommitDetail(options)));
        results.push(...(await runBulkDiscard(options)));
    } finally {
        if (!options.keep) {
            for (const fixture of fixtures) {
                rmSync(fixture, { recursive: true, force: true });
            }
        }
    }

    if (options.json) {
        console.log(JSON.stringify({ options, results }, null, 4));
        return;
    }

    printTable(results, options);

    if (options.keep) {
        console.log(`Fixtures kept at ${fixtures[0] ?? '(none)'}`);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
