import { Electroview } from 'electrobun/view';
import { GitClientBridge, GitClientElectrobunRpc, GitClientRequestMap, RendererDiagnosticPayload } from '../../electrobun';
import type { IntegratedTerminalEvent, NativeCommand } from '../../shared/gitClient';

let installPromise: Promise<void> | undefined;
let diagnosticsInstalled = false;

type DiagnosticParts = {
    message: string;
    details?: string;
};

function createListenerSubscription<TListener>(listeners: Set<TListener>, listener: TListener) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

function toDiagnosticMessage(value: unknown, seen = new WeakSet<object>()): string {
    if (value instanceof Error) {
        return value.stack || value.message || String(value);
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value == null) {
        return String(value);
    }

    if (typeof value === 'object') {
        if (seen.has(value)) {
            return '[circular]';
        }

        seen.add(value);

        try {
            return JSON.stringify(value, (_key, nestedValue) => {
                if (nestedValue instanceof Error) {
                    return {
                        name: nestedValue.name,
                        message: nestedValue.message,
                        stack: nestedValue.stack,
                    };
                }

                if (typeof nestedValue === 'object' && nestedValue !== null) {
                    if (seen.has(nestedValue)) {
                        return '[circular]';
                    }

                    seen.add(nestedValue);
                }

                return nestedValue;
            });
        } catch {
            return Object.prototype.toString.call(value);
        }
    }

    return Object.prototype.toString.call(value);
}

function isErrorLike(value: unknown): value is { message?: unknown; stack?: unknown; cause?: unknown; reason?: unknown; error?: unknown } {
    return typeof value === 'object' && value !== null;
}

function extractDiagnosticParts(value: unknown): DiagnosticParts {
    if (value instanceof Error) {
        return {
            message: value.message || String(value),
            details: value.stack || undefined,
        };
    }

    if (isErrorLike(value)) {
        const nestedCandidate = value.reason ?? value.error ?? value.cause;

        if (nestedCandidate && nestedCandidate !== value) {
            const nested = extractDiagnosticParts(nestedCandidate);
            if (nested.message !== '[object Object]') {
                return nested;
            }
        }

        const message = typeof value.message === 'string' && value.message.length > 0 ? value.message : undefined;
        const stack = typeof value.stack === 'string' && value.stack.length > 0 ? value.stack : undefined;

        if (message || stack) {
            return {
                message: message || stack || 'Unknown renderer error',
                details: stack,
            };
        }
    }

    return {
        message: toDiagnosticMessage(value),
    };
}

function extractConsoleDiagnosticParts(args: unknown[]): DiagnosticParts {
    const errorLikeArg = args.find((arg) => {
        if (arg instanceof Error) {
            return true;
        }

        if (!isErrorLike(arg)) {
            return false;
        }

        return typeof arg.message === 'string' || typeof arg.stack === 'string' || arg.reason instanceof Error || arg.error instanceof Error || arg.cause instanceof Error;
    });

    if (errorLikeArg) {
        const extracted = extractDiagnosticParts(errorLikeArg);
        const prefix = args
            .filter((arg) => arg !== errorLikeArg)
            .map((arg) => toDiagnosticMessage(arg))
            .filter(Boolean)
            .join(' ')
            .trim();

        return {
            message: prefix ? `${prefix} ${extracted.message}`.trim() : extracted.message,
            details: extracted.details,
        };
    }

    return {
        message: args.map((arg) => toDiagnosticMessage(arg)).join(' '),
    };
}

function installRendererDiagnostics(rpc: { send: { rendererDiagnostic: (payload: RendererDiagnosticPayload) => void } }) {
    if (diagnosticsInstalled) {
        return;
    }

    diagnosticsInstalled = true;

    const originalConsoleError = window.console.error.bind(window.console);

    const sendDiagnostic = (payload: RendererDiagnosticPayload) => {
        try {
            rpc.send.rendererDiagnostic(payload);
        } catch {
            // Ignore diagnostic transport failures to avoid recursive reporting.
        }
    };

    window.console.error = (...args: unknown[]) => {
        originalConsoleError(...args);

        const diagnostic = extractConsoleDiagnosticParts(args);

        sendDiagnostic({
            type: 'console-error',
            message: diagnostic.message,
            details: diagnostic.details,
        });
    };

    window.addEventListener('error', (event) => {
        sendDiagnostic({
            type: 'window-error',
            message: event.message || 'Uncaught window error',
            details: event.error instanceof Error ? event.error.stack || event.error.message : undefined,
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const diagnostic = extractDiagnosticParts(event.reason);

        sendDiagnostic({
            type: 'unhandled-rejection',
            message: diagnostic.message || 'Unhandled promise rejection',
            details: diagnostic.details,
        });
    });
}

export function ensureGitClientBridge() {
    if (window.gitClient) {
        return Promise.resolve();
    }

    if (installPromise) {
        return installPromise;
    }

    installPromise = (async () => {
        const nativeCommandListeners = new Set<(command: NativeCommand) => void>();
        const integratedTerminalEventListeners = new Set<(event: IntegratedTerminalEvent) => void>();

        const electroview = new Electroview({
            rpc: Electroview.defineRPC<GitClientElectrobunRpc>({
                handlers: {
                    requests: {},
                    messages: {
                        nativeCommand(command) {
                            nativeCommandListeners.forEach((listener) => listener(command));
                        },
                        integratedTerminalEvent(event) {
                            integratedTerminalEventListeners.forEach((listener) => listener(event));
                        },
                    },
                },
            }),
        });
        installRendererDiagnostics(electroview.rpc as { send: { rendererDiagnostic: (payload: RendererDiagnosticPayload) => void } });

        const gitClient: GitClientBridge<GitClientRequestMap> = {
            invoke(name, params) {
                return (electroview.rpc!.request[name] as (params: GitClientRequestMap[typeof name]['params']) => Promise<GitClientRequestMap[typeof name]['response']>)(params);
            },
            onNativeCommand(listener) {
                return createListenerSubscription(nativeCommandListeners, listener);
            },
            onIntegratedTerminalEvent(listener) {
                return createListenerSubscription(integratedTerminalEventListeners, listener);
            },
        };

        window.gitClient = gitClient;
    })();

    return installPromise;
}
