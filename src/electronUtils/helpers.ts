import pkgObj from '../../package.json' with { type: 'json' };

const pkg = JSON.parse(JSON.stringify(pkgObj));

type Config = {
    vuePort: number;
    apiPort: number;
    appId: string;
    copyright?: string;
    appName: string;
    dbFileName: string;
};

/** Ignores empty or invalid overrides so a typo'd env var cannot silently move the app to a random port. */
function resolvePort(override: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(override ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

const vuePort = resolvePort(process.env.GITVAN_VUE_PORT, pkg.config.vuePort);
const apiPort = resolvePort(process.env.GITVAN_API_PORT, pkg.config.apiPort);

export const appConfig = {
    ...(pkg.config as Config),
    vuePort,
    apiPort,
    projectName: pkg.name,
    vueBaseUrl: `http://127.0.0.1:${vuePort}`,
    apiBaseUrl: `http://127.0.0.1:${apiPort}`,
};

/** Backstop above the longest git timeout, so a lost backend answer never blocks the main process forever. */
export const apiRequestTimeoutMs = 12 * 60_000;

export async function callApiPost(method: string, params?: unknown): Promise<unknown> {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: params !== undefined ? JSON.stringify(params) : undefined,
        signal: AbortSignal.timeout(apiRequestTimeoutMs),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Backend error (${response.status}): ${text}`);
    }
    return response.json();
}
