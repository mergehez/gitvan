<script setup lang="ts">
import { useSettings } from '../composables/useSettings';
import { tasks } from '../composables/useTasks';
import Button from './Button.vue';

const settings = useSettings();

async function addEditorFromPicker() {
    const editor = await settings.pickEditorApplication();

    if (!editor) {
        return;
    }

    await settings.addEditor(editor);
}

function removeEditorByPath(path: string) {
    void settings.removeEditor(path);
}

function makeDefaultEditor(path: string) {
    void settings.setDefaultEditor(path);
}
</script>

<template>
    <section class="rounded-[20px] border border-white/10 bg-white/4 p-5">
        <h2 class="mt-2 text-xl font-semibold text-white flex items-center justify-between">
            <div class="flex-1">Editors</div>
            <Button severity="primary" small :disabled="tasks.isBusy" @click="addEditorFromPicker"> Add editor </Button>
        </h2>
        <p class="mt-3 text-sm leading-6 text-default">
            Configure how the <span class="font-medium text-white">Open in Editor</span> action behaves when you launch a changed file from source control.
        </p>

        <div v-if="settings.state.editors.length === 0" class="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-4 text-sm text-x7">No editors configured yet.</div>

        <div v-else class="mt-4 space-y-2">
            <div v-for="editor in settings.state.editors" :key="editor.path" class="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-x0/80 px-4 py-3">
                <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-white">{{ editor.label }}</p>
                    <p class="mt-1 truncate text-xs text-x7">{{ editor.path }}</p>
                </div>
                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
                        :class="
                            settings.state.defaultEditorPath === editor.path
                                ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
                                : 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                        "
                        @click="makeDefaultEditor(editor.path)"
                    >
                        {{ settings.state.defaultEditorPath === editor.path ? 'Default' : 'Make default' }}
                    </button>
                    <button
                        type="button"
                        class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                        @click="removeEditorByPath(editor.path)"
                    >
                        Remove
                    </button>
                </div>
            </div>
        </div>
    </section>
</template>
