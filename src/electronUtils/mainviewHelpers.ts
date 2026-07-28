import type { RendererDiagnosticPayload } from './helpers';

export function createAppClientPpc<AppApi extends object>(appClient: undefined | { invoke(method: string, params?: unknown): Promise<unknown> }) {
    async function invoke(method: string, params?: unknown): Promise<unknown> {
        if (appClient) {
            return appClient.invoke(method, params);
        }
        // Fallback: call the backend API directly via HTTP (dev mode without Electron)
        const response = await fetch(`/api/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: params !== undefined ? JSON.stringify(params) : undefined,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Backend error (${response.status}): ${text}`);
        }
        return response.json();
    }

    const request: AppApi = new Proxy<AppApi>(Object.create(null), {
        get(_target, propertyKey: string) {
            return (params?: unknown) => invoke(propertyKey, params);
        },
    });

    return {
        request,
    };
}

export function createBrowserOnlyAppClientPpc(apiPort: string, timeoutMs: number = 75_000) {
    function trimTrailingSlash(value: string) {
        return value.replace(/\/+$/u, '');
    }

    function resolveDev2ApiBase() {
        const configuredBase = import.meta.env.VITE_DEV2_API_BASE?.trim();
        if (configuredBase) {
            return trimTrailingSlash(configuredBase);
        }

        const hostname = window.location.hostname || '127.0.0.1';
        return `http://${hostname}:${apiPort}/api`;
    }

    async function invoke(method: string, params?: unknown): Promise<any> {
        const controller = new AbortController();
        const timeoutHandle = window.setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
        const requestUrl = `${resolveDev2ApiBase()}/${method}`;

        try {
            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: params !== undefined ? JSON.stringify(params) : undefined,
                signal: controller.signal,
                cache: 'no-store',
            });

            const responseText = await response.text();
            const responseBody = responseText.trim() ? JSON.parse(responseText) : undefined;

            if (!response.ok) {
                throw new Error(responseBody?.error || response.statusText || `HTTP ${response.status}`);
            }

            return responseBody;
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(`Backend request "${method}" timed out after ${timeoutMs}ms.`);
            }

            throw error;
        } finally {
            window.clearTimeout(timeoutHandle);
        }
    }

    function installDev2GitClientBridge() {
        installRendererDiagnostics();
        // Minimal stub of the Electrobun bridge shape
        window.electronAPI = {
            invoke,
            onNativeCommand: () => () => {},
            sendDiagnostic: () => undefined,
        };
    }

    return {
        resolveDev2ApiBase,
        invoke,
        installDev2GitClientBridge,
    };
}

let rendererDiagnosticsInstalled = false;
export function installRendererDiagnostics() {
    function toMessage(value: unknown): string {
        if (value instanceof Error) return value.stack || value.message || String(value);
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    function formatConsoleArgs(args: unknown[]): { message: string; details?: string } {
        const error = args.find((a): a is Error => a instanceof Error);
        if (error) {
            const prefix = args
                .filter((a) => a !== error)
                .map(toMessage)
                .filter(Boolean)
                .join(' ');
            return {
                message: prefix ? `${prefix} ${error.message}` : error.message,
                details: error.stack,
            };
        }
        return { message: args.map(toMessage).join(' ') };
    }

    function install(): void {
        if (rendererDiagnosticsInstalled) return;
        rendererDiagnosticsInstalled = true;

        const originalConsoleError = window.console.error.bind(window.console);

        const send = (payload: RendererDiagnosticPayload) => {
            try {
                window.electronAPI?.sendDiagnostic?.(payload);
            } catch {
                /* ignore */
            }
        };

        window.console.error = (...args: unknown[]) => {
            originalConsoleError(...args);
            const { message, details } = formatConsoleArgs(args);
            send({ type: 'console-error', message, details });
        };

        window.addEventListener('error', (event) => {
            send({
                type: 'window-error',
                message: event.message || 'Uncaught window error',
                details: event.error instanceof Error ? event.error.stack || event.error.message : undefined,
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            const msg = event.reason instanceof Error ? event.reason.message : toMessage(event.reason);
            const stk = event.reason instanceof Error ? event.reason.stack : undefined;
            send({ type: 'unhandled-rejection', message: msg || 'Unhandled promise rejection', details: stk });
        });
    }

    install();
}
