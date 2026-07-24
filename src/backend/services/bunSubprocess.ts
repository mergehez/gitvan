import { spawn } from 'child_process';

type CommandParams = {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    detached?: boolean;
};

function spawnProcess(params: CommandParams) {
    const child = spawn(params.command, params.args, {
        cwd: params.cwd,
        env: params.env,
        detached: params.detached === true,
        stdio: [params.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    if (params.detached) {
        child.unref();
    }

    if (params.input !== undefined && child.stdin) {
        child.stdin.write(params.input);
        child.stdin.end();
    }

    return child;
}

export async function executeTextCommand(params: CommandParams) {
    const child = spawnProcess(params);

    return await new Promise<[string, string, number]>((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout?.on('data', (chunk: Buffer | string) => {
            stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            resolve([
                Buffer.concat(stdoutChunks).toString('utf8'),
                Buffer.concat(stderrChunks).toString('utf8'),
                code ?? (signal ? 1 : 0),
            ]);
        });
    });
}

export async function executeBufferCommand(params: CommandParams) {
    const child = spawnProcess(params);

    return await new Promise<[Buffer, string, number]>((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout?.on('data', (chunk: Buffer | string) => {
            stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            resolve([
                Buffer.concat(stdoutChunks),
                Buffer.concat(stderrChunks).toString('utf8'),
                code ?? (signal ? 1 : 0),
            ]);
        });
    });
}
