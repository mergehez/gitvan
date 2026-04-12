import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import AppIntegratedTerminalModal from '../../components/AppIntegratedTerminalModal.vue';
import { useRepos } from '../../composables/useRepos';
import { useSettings } from '../../composables/useSettings';

type ReposState = ReturnType<typeof useRepos>;
type SettingsState = ReturnType<typeof useSettings>;

type IntegratedTerminalRepoMock = {
    id: number;
    name: string;
    terminalPath: string | undefined;
};

type IntegratedTerminalReposMock = {
    repos: IntegratedTerminalRepoMock[];
    integratedTerminalRepoId: number | undefined;
    integratedTerminalRepoName: string | undefined;
    closeIntegratedTerminal: ReturnType<typeof vi.fn>;
    assignRepoTerminal: ReturnType<typeof vi.fn>;
};

let mockRepos: IntegratedTerminalReposMock;
let mockSettings: Pick<SettingsState, 'state'>;

const createIntegratedTerminalSession = vi.fn();
const closeIntegratedTerminalSession = vi.fn();
const writeIntegratedTerminalSession = vi.fn();
const resizeIntegratedTerminalSession = vi.fn();

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => mockRepos as unknown as ReposState,
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

vi.mock('../../lib/gitClient', () => ({
    gitClientRpc: {
        request: {
            createIntegratedTerminalSession: (...args: unknown[]) => createIntegratedTerminalSession(...args),
            closeIntegratedTerminalSession: (...args: unknown[]) => closeIntegratedTerminalSession(...args),
            writeIntegratedTerminalSession: (...args: unknown[]) => writeIntegratedTerminalSession(...args),
            resizeIntegratedTerminalSession: (...args: unknown[]) => resizeIntegratedTerminalSession(...args),
        },
    },
}));

vi.mock('xterm', () => {
    class MockTerminal {
        cols = 80;
        rows = 24;
        open() {}
        loadAddon() {}
        onData() {
            return { dispose() {} };
        }
        dispose() {}
        write() {}
        writeln() {}
    }

    return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: class {
        fit() {}
    },
}));

describe('AppIntegratedTerminalModal', () => {
    beforeEach(() => {
        createIntegratedTerminalSession.mockResolvedValue({
            sessionId: 'session-1',
            cwd: '/tmp/repo',
            shellPath: '/bin/zsh',
        });
        closeIntegratedTerminalSession.mockResolvedValue(undefined);
        writeIntegratedTerminalSession.mockResolvedValue(undefined);
        resizeIntegratedTerminalSession.mockResolvedValue(undefined);

        mockRepos = reactive({
            repos: [{ id: 1, name: 'Repo', terminalPath: undefined }],
            integratedTerminalRepoId: undefined,
            integratedTerminalRepoName: undefined,
            closeIntegratedTerminal: vi.fn(),
            assignRepoTerminal: vi.fn(async (repoId: number, terminalPath: string | undefined) => {
                const repo = mockRepos.repos.find((entry) => entry.id === repoId);
                if (repo) {
                    repo.terminalPath = terminalPath;
                }
            }),
        });

        mockSettings = reactive({
            state: {
                editors: [],
                defaultEditorPath: undefined,
                terminals: [
                    { path: '/bin/zsh', label: 'zsh', locked: true },
                    { path: '/bin/bash', label: 'bash', locked: false },
                ],
                defaultTerminalPath: '/bin/zsh',
                diffFontSize: 12,
                diffViewMode: 'full-file',
                showWhitespaceChanges: false,
                activeView: 'changes',
                showBranches: false,
            },
        });

        (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
            constructor(_callback: ResizeObserverCallback) {}
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;

        window.gitClient = {
            invoke: vi.fn(),
            onNativeCommand: vi.fn(() => () => undefined),
            onIntegratedTerminalEvent: () => () => undefined,
        };
    });

    it('persists the repo terminal selection and restarts the session with the selected shell', async () => {
        const wrapper = mount(AppIntegratedTerminalModal, {
            attachTo: document.body,
            global: {
                stubs: {
                    Button: {
                        props: ['smaller'],
                        emits: ['click'],
                        template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
                    },
                    CenteredModal: {
                        props: ['open', 'title', 'contentClass'],
                        emits: ['update:open'],
                        template: '<div><slot /></div>',
                    },
                },
            },
        });

        mockRepos.integratedTerminalRepoId = 1;
        mockRepos.integratedTerminalRepoName = 'Repo';
        await flushPromises();

        expect(createIntegratedTerminalSession).toHaveBeenCalledWith({
            repoId: 1,
            cols: 80,
            rows: 24,
            terminalPath: '/bin/zsh',
        });

        await wrapper.get('select').setValue('/bin/bash');
        await flushPromises();

        expect(mockRepos.assignRepoTerminal).toHaveBeenCalledWith(1, '/bin/bash');
        expect(closeIntegratedTerminalSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
        expect(createIntegratedTerminalSession).toHaveBeenLastCalledWith({
            repoId: 1,
            cols: 80,
            rows: 24,
            terminalPath: '/bin/bash',
        });

        wrapper.unmount();
    });
});
