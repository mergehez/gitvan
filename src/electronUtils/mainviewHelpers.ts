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
