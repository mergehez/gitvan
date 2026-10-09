import { expect, test as base, type Page } from '@playwright/test';

const apiBase = process.env.PLAYWRIGHT_API_BASE ?? 'http://127.0.0.1:5276';

type HandlerError = {
    seq: number;
    method: string;
    message: string;
    code: string;
};

type HealthResponse = {
    ok: boolean;
    handlerErrorCount: number;
    handlerErrors: HandlerError[];
};

/** A repository removed mid-request is a race the app classifies and handles, not a fault. */
const expectedErrorCodes = new Set(['repository-not-found']);

async function readHealth(): Promise<HealthResponse> {
    const response = await fetch(`${apiBase}/health`);

    if (!response.ok) {
        throw new Error(`The browser-spec backend at ${apiBase} did not answer /health (${response.status}).`);
    }

    return (await response.json()) as HealthResponse;
}

async function callApi<TResult>(method: string, params?: unknown): Promise<TResult> {
    const response = await fetch(`${apiBase}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: params === undefined ? undefined : JSON.stringify(params),
    });

    if (!response.ok) {
        throw new Error(`${method} failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as TResult;
}

type EditorSettings = {
    activeView: string;
    diffIgnoredChars: string;
    diffIgnoredCharsEnabled: boolean;
    showWhitespaceChanges: boolean;
    showBranches: boolean;
    [key: string]: unknown;
};

/**
 * Puts the settings the specs change back to their defaults. Nothing else resets them, so without
 * this the ignored characters, whitespace handling, or active view of one spec would leak into
 * every spec that runs after it — and into the next run.
 */
async function resetEditorSettings() {
    const current = await callApi<EditorSettings>('getEditorSettings');
    const defaults = {
        activeView: 'changes',
        showBranches: false,
        diffIgnoredChars: '',
        diffIgnoredCharsEnabled: true,
        showWhitespaceChanges: false,
    };

    if (Object.entries(defaults).every(([key, value]) => current[key] === value)) {
        return;
    }

    await callApi('updateEditorSettings', { settings: { ...current, ...defaults } });
}

async function selectRepo(page: Page, name: string, openChangesView: boolean) {
    const repoButton = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();
    await expect(repoButton).toBeVisible();
    // The repository the app auto-selects after a reset can be a merge lab, whose conflict modal
    // covers the sidebar, so the click is dispatched on the button instead of hit-tested.
    await repoButton.dispatchEvent('click');

    if (openChangesView) {
        await page.getByRole('button', { name: 'Changes', exact: true }).click();
    }
}

export type OpenSandboxRepoOptions = {
    /**
     * A merge lab's resolver opens over the app as soon as the repository is selected, and its
     * overlay covers the nav buttons — so its spec keeps the changes view already underneath.
     */
    openChangesView?: boolean;
};

/**
 * Gives the test a known starting point: the sandbox labs recreated from their reset scripts and
 * the persisted settings back at their defaults. Every test opens the lab it needs, so no test
 * depends on what an earlier one left behind and each one can run on its own.
 */
export async function openSandboxRepo(page: Page, name: string, options: OpenSandboxRepoOptions = {}) {
    await resetEditorSettings();
    await page.goto('/');

    // The reset button lives in the sidebar, which only renders once the bootstrap has landed.
    const resetButton = page.locator('#hidden-reset-sandboxes');
    await expect(resetButton).toBeAttached();

    const resetFinished = page.waitForResponse((response) => response.url().includes('/api/resetSandboxRepos'));
    // The button is deliberately hidden, so it can only be triggered programmatically.
    await resetButton.dispatchEvent('click');
    await resetFinished;

    await selectRepo(page, name, options.openChangesView ?? true);
}

/**
 * `test` asserts that nothing unexpected failed in the backend while the test ran. Without it a
 * green run happily hides a handler that threw on every request.
 */
export const test = base.extend({
    page: async ({ page }, use, testInfo) => {
        const before = await readHealth();
        const alreadyRecorded = new Set(before.handlerErrors.map((error) => error.seq));

        await use(page);

        // A failing test already reports its own cause; do not replace it with a backend one.
        if (testInfo.errors.length > 0) {
            return;
        }

        const unexpected = (await readHealth()).handlerErrors.filter((error) => !alreadyRecorded.has(error.seq) && !expectedErrorCodes.has(error.code));

        expect(
            unexpected,
            `The backend reported unexpected errors during "${testInfo.title}":\n${unexpected.map((error) => `  ${error.method}: ${error.message}`).join('\n')}`
        ).toEqual([]);
    },
});

export { expect };
