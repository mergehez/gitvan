import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../backend/services/app';
import { useDb } from '../../backend/services/database';
import type { AppBootstrapApi, EditorSettings } from '../../shared/gitClient';
import AppVue from '../App.vue';
import Settings from '../components/Settings.vue';
import { _coreState } from '../composables/coreState';
import { useAuth } from '../composables/useAuth';
import { useMergeHelper } from '../composables/useMerge';
import { useRepos } from '../composables/useRepos';
import { useSettings } from '../composables/useSettings';
import { tasks } from '../composables/useTasks';

type TaskLike<TResult, TParams = unknown> = {
    run: (params: TParams, identifier?: string) => Promise<TResult>;
    isRunning: (identifier?: string) => boolean;
    errorMessage: string | undefined;
    clearError: () => undefined;
};

const realUserDataDir = mkdtempSync(join(tmpdir(), 'gitvan-app-real-spec-'));
const realDatabasePath = process.env.GITVAN_REAL_DATABASE_PATH;

if (realDatabasePath && existsSync(realDatabasePath)) {
    mkdirSync(realUserDataDir, { recursive: true });
    copyFileSync(realDatabasePath, join(realUserDataDir, 'gitvan.sqlite'));

    const walPath = `${realDatabasePath}-wal`;
    const shmPath = `${realDatabasePath}-shm`;

    if (existsSync(walPath)) {
        copyFileSync(walPath, join(realUserDataDir, 'gitvan.sqlite-wal'));
    }

    if (existsSync(shmPath)) {
        copyFileSync(shmPath, join(realUserDataDir, 'gitvan.sqlite-shm'));
    }
}

if (typeof (document as any).queryCommandSupported !== 'function') {
    (document as any).queryCommandSupported = () => false;
}

useDb().configureDatabase(realUserDataDir);

const defaultEditorSettings: EditorSettings = {
    editors: [],
    defaultEditorPath: undefined,
    terminals: [],
    defaultTerminalPath: undefined,
    diffFontSize: 12,
    diffViewMode: 'full-file',
    showWhitespaceChanges: false,
    activeView: 'changes',
    showBranches: false,
};

const touchedTaskKeys = [
    'abortMerge',
    'getBootstrap',
    'getEditorSettings',
    'getOAuthProviderSettings',
    'updateEditorSettings',
    'getChanges',
    'getFileDiff',
    'getHistory',
    'getCommittedTree',
    'getCommittedFile',
    'getCommitDetail',
    'getCommitFileDiff',
    'getBranches',
    'getMergeConflictState',
    'getStashes',
    'listCloneableRepos',
    'refreshRepos',
    'selectRepo',
] as const;

const originalTasks = new Map<string, unknown>();

function createTask<TResult, TParams = unknown>(handler: (params: TParams, identifier?: string) => TResult | Promise<TResult>): TaskLike<TResult, TParams> {
    return {
        async run(params: TParams, identifier?: string) {
            return await handler(params, identifier);
        },
        isRunning() {
            return false;
        },
        errorMessage: undefined,
        clearError() {
            return undefined;
        },
    };
}

async function waitForAssertion(assertion: () => void | Promise<void>, timeoutMs = 5000) {
    const startedAt = Date.now();
    let lastError: unknown = undefined;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            await assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => window.setTimeout(resolve, 25));
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Timed out waiting for assertion.');
}

const realAppMethods = {
    abortMerge: (params: { repoId: number }) => app.abortMerge(params),
    getBootstrap: () => app.getBootstrap(),
    getEditorSettings: () => app.getEditorSettings(),
    getOAuthProviderSettings: () => app.getOAuthProviderSettings(),
    updateEditorSettings: (params: { settings: EditorSettings }) => app.updateEditorSettings(params),
    getChanges: (params: { repoId: number }) => app.getChanges(params),
    getFileDiff: (params: { repoId: number; path: string; kind: 'staged' | 'unstaged' }) => app.getDiff(params),
    getHistory: (params: { repoId: number }) => app.getHistory(params),
    getCommittedTree: (params: { repoId: number }) => app.getCommittedTree(params),
    getCommittedFile: (params: { repoId: number; path: string }) => app.getCommittedFile(params),
    getCommitDetail: (params: { repoId: number; commitSha: string }) => app.getCommit(params),
    getCommitFileDiff: (params: { repoId: number; commitSha: string; path: string; previousPath?: string | undefined }) => app.getCommitDiff(params),
    getBranches: (params: { repoId: number }) => app.getBranches(params),
    getMergeConflictState: (params: { repoId: number }) => app.getMergeConflictState(params),
    getStashes: (params: { repoId: number }) => app.getStashes(params),
    listCloneableRepos: (params: { accountId: number }) => app.listCloneableRepos(params),
    refreshRepos: () => app.refreshRepos(),
    resetSandboxRepos: () => app.resetSandboxRepos(),
    selectRepo: (params: { repoId: number }) => app.selectRepo(params),
} as const;

async function invokeRealAppMethod<TMethodName extends keyof typeof realAppMethods>(methodName: TMethodName, params: Parameters<(typeof realAppMethods)[TMethodName]>[0]) {
    const method = realAppMethods[methodName] as (
        params: Parameters<(typeof realAppMethods)[TMethodName]>[0]
    ) => ReturnType<(typeof realAppMethods)[TMethodName]> | Promise<ReturnType<(typeof realAppMethods)[TMethodName]>>;

    return await method(params);
}

function installRealAppTasks() {
    const taskStore = tasks as Record<string, unknown>;

    touchedTaskKeys.forEach((key) => {
        if (!originalTasks.has(key)) {
            originalTasks.set(key, taskStore[key]);
        }
    });

    taskStore.abortMerge = createTask((params: { repoId: number }) => invokeRealAppMethod('abortMerge', params));
    taskStore.getBootstrap = createTask(() => invokeRealAppMethod('getBootstrap', undefined));
    taskStore.getEditorSettings = createTask(() => invokeRealAppMethod('getEditorSettings', undefined));
    taskStore.getOAuthProviderSettings = createTask(() => invokeRealAppMethod('getOAuthProviderSettings', undefined));
    taskStore.updateEditorSettings = createTask((params: { settings: EditorSettings }) => invokeRealAppMethod('updateEditorSettings', params));
    taskStore.getChanges = createTask((params: { repoId: number }) => invokeRealAppMethod('getChanges', params));
    taskStore.getFileDiff = createTask((params: { repoId: number; path: string; kind: 'staged' | 'unstaged' }) => invokeRealAppMethod('getFileDiff', params));
    taskStore.getHistory = createTask((params: { repoId: number }) => invokeRealAppMethod('getHistory', params));
    taskStore.getCommittedTree = createTask((params: { repoId: number }) => invokeRealAppMethod('getCommittedTree', params));
    taskStore.getCommittedFile = createTask((params: { repoId: number; path: string }) => invokeRealAppMethod('getCommittedFile', params));
    taskStore.getCommitDetail = createTask((params: { repoId: number; commitSha: string }) => invokeRealAppMethod('getCommitDetail', params));
    taskStore.getCommitFileDiff = createTask((params: { repoId: number; commitSha: string; path: string; previousPath?: string | undefined }) =>
        invokeRealAppMethod('getCommitFileDiff', params)
    );
    taskStore.getBranches = createTask((params: { repoId: number }) => invokeRealAppMethod('getBranches', params));
    taskStore.getMergeConflictState = createTask((params: { repoId: number }) => invokeRealAppMethod('getMergeConflictState', params));
    taskStore.getStashes = createTask((params: { repoId: number }) => invokeRealAppMethod('getStashes', params));
    taskStore.listCloneableRepos = createTask((params: { accountId: number }) => invokeRealAppMethod('listCloneableRepos', params));
    taskStore.refreshRepos = createTask(() => invokeRealAppMethod('refreshRepos', undefined));
    taskStore.selectRepo = createTask((params: { repoId: number }) => invokeRealAppMethod('selectRepo', params));
}

async function resetRealAppState(resetSandboxes = false) {
    const auth = useAuth();
    const settings = useSettings();
    const repos = useRepos();
    const merge = useMergeHelper();

    if (resetSandboxes) {
        await invokeRealAppMethod('resetSandboxRepos', undefined);
    }

    const bootstrap = await invokeRealAppMethod('getBootstrap', undefined);
    const mergeSoftRepos = bootstrap.repos.filter((repo) => repo.groupName?.toLowerCase() === 'mergesoft');
    const preferredRepoId = mergeSoftRepos[0]?.id ?? bootstrap.repos[0]?.id;
    const selectedBootstrap = preferredRepoId ? await invokeRealAppMethod('selectRepo', { repoId: preferredRepoId }) : bootstrap;
    const editorSettings = await invokeRealAppMethod('updateEditorSettings', { settings: { ...defaultEditorSettings } });
    const oauthProviderSettings = await invokeRealAppMethod('getOAuthProviderSettings', undefined);

    settings.state = editorSettings;
    settings.oauthProviderSettings = oauthProviderSettings;

    _coreState.applyBootstrap(selectedBootstrap as AppBootstrapApi);

    auth.oauthDeviceFlow = undefined;
    repos.isCloneRepoModalOpen = false;
    repos.isCreateRepoModalOpen = false;
    settings.isSettingsModalOpen = false;
    settings.selectedSettingsPanel = 'editors';

    merge.mergeConflictModalRepositoryId = undefined;
    merge.mergeConflictState = undefined;
    merge.isMergeConflictModalOpen = false;
    merge.activeMergeConflictEditor = undefined;
    merge.resolvedMergeConflictPaths = new Set<string>();

    localStorage.clear();
    (window as any).gitClient = {
        async invoke(method: string, params?: unknown) {
            if (method in realAppMethods) {
                return await (
                    invokeRealAppMethod as <TMethodName extends keyof typeof realAppMethods>(
                        methodName: TMethodName,
                        nextParams: Parameters<(typeof realAppMethods)[TMethodName]>[0]
                    ) => Promise<Awaited<ReturnType<(typeof realAppMethods)[TMethodName]>>>
                )(method as keyof typeof realAppMethods, params as never);
            }

            throw new Error(`Unsupported test RPC method: ${method}`);
        },
        onNativeCommand() {
            return () => undefined;
        },
        onIntegratedTerminalEvent() {
            return () => undefined;
        },
    };
}

function restoreTasks() {
    const taskStore = tasks as Record<string, unknown>;
    touchedTaskKeys.forEach((key) => {
        const original = originalTasks.get(key);
        if (original === undefined) {
            Reflect.deleteProperty(taskStore, key);
            return;
        }

        taskStore[key] = original;
    });
}

function mountRealApp() {
    return mount(AppVue, {
        global: {
            directives: {
                tooltip: {},
                loading: {},
            },
        },
    });
}

function mountRealSettingsWindow(initialPanel?: 'repositories' | 'accounts' | 'editors' | 'terminals') {
    const settings = useSettings();
    settings.selectedSettingsPanel = initialPanel ?? 'editors';
    settings.isSettingsModalOpen = true;

    return mount(Settings, {
        global: {
            directives: {
                tooltip: {},
                loading: {},
            },
        },
    });
}

async function waitForActiveChangeDiff() {
    await waitForAssertion(() => {
        const repo = useRepos().getSelectedRepo();
        const changeCount = (repo?.changes?.staged.length ?? 0) + (repo?.changes?.unstaged.length ?? 0);

        if (changeCount === 0) {
            expect(repo?.curDiff).toBeUndefined();
            return;
        }

        expect(repo?.curDiff).toBeDefined();
    });
}

async function waitForActiveCommitDiff() {
    await waitForAssertion(() => {
        const repo = useRepos().getSelectedRepo();
        const fileCount = repo?.currCommit?.files.length ?? 0;

        if (fileCount === 0) {
            expect(repo?.currCommitDiff).toBeUndefined();
            return;
        }

        expect(repo?.currCommitDiff).toBeDefined();
    });
}

async function unmountRealApp(wrapper: VueWrapper<any>) {
    wrapper.unmount();
    await flushPromises();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function findButtonByText(wrapper: VueWrapper<any>, label: string) {
    const match = wrapper.findAll('button').find((entry) => entry.text().replace(/\s+/g, ' ').trim() === label);
    if (!match) {
        throw new Error(`Button not found: ${label}`);
    }

    return match;
}

describe('App real navigation', () => {
    beforeAll(async () => {
        installRealAppTasks();
        await resetRealAppState(false);
    });

    beforeEach(async () => {
        await resetRealAppState(false);
    });

    afterAll(() => {
        restoreTasks();
    });

    it('navigates between changes, history, and branches on the real app', async () => {
        const bootstrap = await invokeRealAppMethod('getBootstrap', undefined);
        const selectedRepoId = bootstrap.repos.find((repo) => repo.groupName?.toLowerCase() === 'mergesoft')?.id ?? bootstrap.selectedRepoId ?? bootstrap.repos[0]?.id;
        expect(selectedRepoId).toBeDefined();

        const changes = await invokeRealAppMethod('getChanges', { repoId: selectedRepoId! });
        const history = await invokeRealAppMethod('getHistory', { repoId: selectedRepoId! });
        const branches = await invokeRealAppMethod('getBranches', { repoId: selectedRepoId! });

        const wrapper = mountRealApp();
        await flushPromises();
        await waitForAssertion(() => expect(useRepos().getSelectedRepo()?.changes).toBeDefined());
        await waitForActiveChangeDiff();

        expect(wrapper.text()).toContain('Staged Changes');
        expect(wrapper.text()).toContain('Changes');
        expect(useRepos().getSelectedRepo()?.changes).toEqual(changes);

        await findButtonByText(wrapper, 'History').trigger('click');
        await flushPromises();
        await waitForAssertion(() => expect(useRepos().getSelectedRepo()?.history).toBeDefined());
        await waitForActiveCommitDiff();

        expect(wrapper.text()).toContain(history.commits[0]?.summary ?? 'No commits');
        expect(useRepos().getSelectedRepo()?.history).toEqual(history);

        if (history.commits[0]) {
            const commit = await invokeRealAppMethod('getCommitDetail', { repoId: selectedRepoId!, commitSha: history.commits[0].sha });
            expect(useRepos().getSelectedRepo()?.currCommit?.sha).toBe(commit.sha);
        }

        await findButtonByText(wrapper, 'Branches').trigger('click');
        await flushPromises();
        await waitForAssertion(() => expect(useRepos().getSelectedRepo()?.branches).toBeDefined());

        expect(wrapper.text()).toContain('Branches');
        expect(wrapper.text()).toContain('Local branches');
        expect(useSettings().state.activeView).toBe('branches');
        expect(wrapper.text()).toContain(branches.local[0]?.name ?? 'No local branches');

        await wrapper.find('header').findAll('button')[0]!.trigger('click');
        await flushPromises();
        await waitForAssertion(() => expect(useSettings().state.activeView).toBe('changes'));
        await waitForActiveChangeDiff();

        expect(useRepos().getSelectedRepo()?.changes).toEqual(changes);
        await unmountRealApp(wrapper);
    });

    it('updates the real header and panel when selecting another repository', async () => {
        const bootstrap = await invokeRealAppMethod('getBootstrap', undefined);
        const mergeSoftRepos = bootstrap.repos.filter((repo) => repo.groupName?.toLowerCase() === 'mergesoft');
        expect(mergeSoftRepos.length).toBeGreaterThanOrEqual(2);

        const firstRepo = mergeSoftRepos[0]!;
        const secondRepo = mergeSoftRepos[1]!;
        const secondRepoChanges = await invokeRealAppMethod('getChanges', { repoId: secondRepo.id });

        const wrapper = mountRealApp();
        await flushPromises();
        await waitForAssertion(() => expect(wrapper.find(`[data-testid="file-tree-item-${secondRepo.id}"]`).exists()).toBe(true));
        await waitForAssertion(() => expect(useRepos().getSelectedRepo()?.changes).toBeDefined());
        await waitForActiveChangeDiff();

        expect(useRepos().selectedRepoId).toBe(firstRepo.id);

        await useRepos().selectRepo(secondRepo.id);
        await flushPromises();
        await waitForAssertion(() => expect(useRepos().selectedRepoId).toBe(secondRepo.id));
        await waitForAssertion(() => expect(useRepos().getSelectedRepo()?.changes).toBeDefined());
        await waitForActiveChangeDiff();

        expect(useRepos().selectedRepoId).toBe(secondRepo.id);
        expect(useRepos().getSelectedRepo()?.path).toBe(secondRepo.path);
        expect(wrapper.text()).toContain('Staged Changes');
        expect(useRepos().getSelectedRepo()?.changes).toEqual(secondRepoChanges);
        await unmountRealApp(wrapper);
    });

    it('opens the settings modal from the sidebar settings button', async () => {
        const wrapper = mountRealApp();
        await flushPromises();
        await waitForAssertion(() => expect(wrapper.find('button[aria-label="Repository Settings"]').exists()).toBe(true));

        await wrapper.get('button[aria-label="Repository Settings"]').trigger('click');
        await flushPromises();

        await waitForAssertion(() => {
            expect(useSettings().isSettingsModalOpen).toBe(true);
            expect(useSettings().selectedSettingsPanel).toBe('repositories');
        });
        expect(wrapper.text()).toContain('Settings');
        await unmountRealApp(wrapper);
    });

    it('navigates between repositories, editors, terminals, and accounts in the settings window', async () => {
        const wrapper = mountRealSettingsWindow('repositories');
        await flushPromises();
        await waitForAssertion(() => expect(wrapper.text()).toContain('Settings'));

        expect(wrapper.text()).toContain('Groups');

        await findButtonByText(wrapper, 'Editors').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('Add editor');
        expect(wrapper.text()).toContain('Open in Editor');

        await findButtonByText(wrapper, 'Terminals').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('Add terminal');
        expect(wrapper.text()).toContain('Integrated Terminal');

        await findButtonByText(wrapper, 'Accounts').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('Accounts');
        expect(wrapper.text()).toContain('No account selected');

        await findButtonByText(wrapper, 'Repositories').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('Groups');
        await unmountRealApp(wrapper);
    });
});
