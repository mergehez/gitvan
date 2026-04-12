<script setup lang="ts">
import { useSettings } from '../composables/useSettings';
import { tasks } from '../composables/useTasks';
import Button from './Button.vue';

const settings = useSettings();

async function addTerminalFromPicker() {
    const terminal = await settings.pickTerminalApplication();

    if (!terminal) {
        return;
    }

    await settings.addTerminal(terminal);
}

function removeTerminalByPath(path: string) {
    void settings.removeTerminal(path);
}

function makeDefaultTerminal(path: string) {
    void settings.setDefaultTerminal(path);
}
</script>

<template>
    <section class="rounded-[20px] border border-white/10 bg-white/4 p-5">
        <h2 class="mt-2 flex items-center justify-between text-xl font-semibold text-white">
            <div class="flex-1">Terminals</div>
            <Button severity="primary" small :disabled="tasks.isBusy" @click="addTerminalFromPicker"> Add terminal </Button>
        </h2>
        <p class="mt-3 text-sm leading-6 text-default">
            Configure the shell choices available in the <span class="font-medium text-white">Integrated Terminal</span>. Built-in terminals are locked and can be selected per
            repository.
        </p>

        <div v-if="settings.state.terminals.length === 0" class="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-4 text-sm text-x7">No terminals configured yet.</div>

        <div v-else class="mt-4 space-y-2">
            <div
                v-for="terminal in settings.state.terminals"
                :key="terminal.path"
                class="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-x0/80 px-4 py-3"
            >
                <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-white">
                        {{ terminal.label }}
                        <span v-if="terminal.locked" class="ml-2 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/55"
                            >Built-in</span
                        >
                    </p>
                    <p class="mt-1 truncate text-xs text-x7">{{ terminal.path }}</p>
                </div>
                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
                        :class="
                            settings.state.defaultTerminalPath === terminal.path
                                ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
                                : 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                        "
                        @click="makeDefaultTerminal(terminal.path)"
                    >
                        {{ settings.state.defaultTerminalPath === terminal.path ? 'Default' : 'Make default' }}
                    </button>
                    <button
                        type="button"
                        class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/10 disabled:hover:bg-white/5"
                        :disabled="terminal.locked"
                        @click="removeTerminalByPath(terminal.path)"
                    >
                        Remove
                    </button>
                </div>
            </div>
        </div>
    </section>
</template>
