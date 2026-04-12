<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';
import { useRepos } from '../composables/useRepos';
import { useSettings } from '../composables/useSettings';
import { gitClientRpc } from '../lib/gitClient';
import CenteredModal from './CenteredModal.vue';

const repos = useRepos();
const settings = useSettings();

const modalOpen = computed({
    get: () => repos.integratedTerminalRepoId !== undefined,
    set: (value: boolean) => {
        if (!value) {
            repos.closeIntegratedTerminal();
        }
    },
});
const modalTitle = computed(() => (repos.integratedTerminalRepoName ? `Integrated Terminal · ${repos.integratedTerminalRepoName}` : 'Integrated Terminal'));
const activeRepo = computed(() => repos.repos.find((repo) => repo.id === repos.integratedTerminalRepoId));
const selectedTerminalPath = ref(activeRepo.value?.terminalPath || settings.state.defaultTerminalPath || '');
function isDefault(t: { path: string }) {
    return t.path === settings.state.defaultTerminalPath;
}

const terminalHostRef = ref<HTMLDivElement | null>(null);
const terminalRef = shallowRef<Terminal>();
const fitAddonRef = shallowRef<FitAddon>();
const sessionIdRef = ref<string>();
const currentWorkingDirectory = ref('');
const shellPath = ref('');
const exitCode = ref<number>();
const isStarting = ref(false);

let resizeObserver: ResizeObserver | undefined;
let disposeTerminalEventListener: (() => void) | undefined;

function disposeTerminalSurface() {
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    terminalRef.value?.dispose();
    terminalRef.value = undefined;
    fitAddonRef.value = undefined;
}

function scheduleTerminalResize() {
    const fitAddon = fitAddonRef.value;
    const terminal = terminalRef.value;
    const sessionId = sessionIdRef.value;

    if (!fitAddon || !terminal || !sessionId) {
        return;
    }

    requestAnimationFrame(() => {
        fitAddon.fit();

        void gitClientRpc.request.resizeIntegratedTerminalSession({
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
        });
    });
}

function createTerminalSurface() {
    const host = terminalHostRef.value;
    if (!host) {
        return;
    }

    const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        scrollback: 5000,
        allowTransparency: true,
        theme: {
            background: '#0b0f14',
        },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();

    terminal.onData((data) => {
        const sessionId = sessionIdRef.value;
        if (!sessionId) {
            return;
        }

        void gitClientRpc.request.writeIntegratedTerminalSession({
            sessionId,
            data,
        });
    });

    resizeObserver = new ResizeObserver(() => {
        scheduleTerminalResize();
    });
    resizeObserver.observe(host);

    terminalRef.value = terminal;
    fitAddonRef.value = fitAddon;
}

async function startTerminalSession(repoId: number, terminalPath?: string) {
    if (!terminalHostRef.value || sessionIdRef.value) {
        return;
    }

    createTerminalSurface();

    const terminal = terminalRef.value;
    if (!terminal) {
        return;
    }

    isStarting.value = true;
    exitCode.value = undefined;

    try {
        const session = await gitClientRpc.request.createIntegratedTerminalSession({
            repoId,
            cols: terminal.cols,
            rows: terminal.rows,
            terminalPath,
        });

        sessionIdRef.value = session.sessionId;
        currentWorkingDirectory.value = session.cwd;
        shellPath.value = session.shellPath;
        scheduleTerminalResize();
    } finally {
        isStarting.value = false;
    }
}

async function stopTerminalSession() {
    const sessionId = sessionIdRef.value;
    sessionIdRef.value = undefined;
    currentWorkingDirectory.value = '';
    shellPath.value = '';
    exitCode.value = undefined;

    if (sessionId) {
        await gitClientRpc.request.closeIntegratedTerminalSession({ sessionId });
    }

    disposeTerminalSurface();
}

async function applySelectedTerminal(nextValue: string) {
    const repoId = repos.integratedTerminalRepoId;
    if (repoId === undefined) {
        return;
    }

    const terminalPath = nextValue || undefined;
    await repos.assignRepoTerminal(repoId, terminalPath);

    if (repos.integratedTerminalRepoId !== repoId) {
        return;
    }

    await stopTerminalSession();
    await nextTick();
    await startTerminalSession(repoId, terminalPath);
}

function onTerminalSelectionChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    selectedTerminalPath.value = value;
    void applySelectedTerminal(value);
}

disposeTerminalEventListener = window.gitClient.onIntegratedTerminalEvent((event) => {
    if (event.sessionId !== sessionIdRef.value) {
        return;
    }

    const terminal = terminalRef.value;
    if (!terminal) {
        return;
    }

    if (event.kind === 'data') {
        terminal.write(event.data);
        return;
    }

    exitCode.value = event.exitCode;
    sessionIdRef.value = undefined;
    terminal.writeln(`\r\n[Process exited with code ${event.exitCode}]`);
});

watch(
    () => [repos.integratedTerminalRepoId, activeRepo.value?.terminalPath] as const,
    async ([repoId, repoTerminalPath], [previousRepoId]) => {
        if (previousRepoId !== undefined && previousRepoId !== repoId) {
            await stopTerminalSession();
        }

        if (repoId === undefined) {
            await stopTerminalSession();
            return;
        }

        selectedTerminalPath.value =
            repoTerminalPath && settings.state.terminals.some((terminal) => terminal.path === repoTerminalPath) ? repoTerminalPath : settings.state.defaultTerminalPath || '';

        await nextTick();
        await startTerminalSession(repoId, selectedTerminalPath.value || undefined);
    },
);

onBeforeUnmount(() => {
    disposeTerminalEventListener?.();
    disposeTerminalEventListener = undefined;
    void stopTerminalSession();
});
</script>

<template>
    <CenteredModal v-model:open="modalOpen" :title="modalTitle" content-class="max-w-6xl h-[78vh]">
        <div class="flex h-full min-h-0 flex-col bg-[#0b0f14]">
            <div class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-xs text-white/65">
                <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold text-white/85">{{ shellPath || 'Starting shell...' }}</p>
                    <p class="truncate text-white/45">{{ currentWorkingDirectory || 'Preparing terminal session...' }}</p>
                </div>
                <label class="flex min-w-0 items-center gap-2 text-white/55">
                    <span class="whitespace-nowrap">Terminal</span>
                    <select
                        :value="selectedTerminalPath"
                        class="min-w-45 rounded-lg border border-x6 bg-white/5 px-3 py-1.5 text-xs text-white outline-none transition focus:border-white/20"
                        :disabled="isStarting"
                        @change="onTerminalSelectionChange"
                    >
                        <option v-for="terminal in settings.state.terminals" :key="terminal.path" :value="terminal.path">
                            {{ terminal.label }} {{ isDefault(terminal) ? '(Default)' : '' }}
                        </option>
                    </select>
                </label>
                <span v-if="isStarting" class="text-amber-200">Starting…</span>
                <span v-else-if="exitCode !== undefined" class="text-white/45">Exited: {{ exitCode }}</span>
            </div>

            <div ref="terminalHostRef" class="integrated-terminal-host min-h-0 flex-1 overflow-hidden px-2 py-2"></div>
        </div>
    </CenteredModal>
</template>

<style>
.integrated-terminal-host .xterm {
    height: 100%;
}

.integrated-terminal-host .xterm-viewport {
    overflow-y: auto !important;
}
</style>
