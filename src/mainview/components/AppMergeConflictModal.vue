<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMergeHelper } from '../composables/useMerge';
import { useRepos } from '../composables/useRepos';
import { tasks } from '../composables/useTasks';
import Button from './Button.vue';
import ConflictMonacoEditor from './ConflictMonacoEditor.vue';
import IconButton from './IconButton.vue';

const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);
const mergeState = useMergeHelper();

const conflictedFiles = computed(() => mergeState.mergeConflictState?.conflictedFiles ?? []);
const mergedFiles = computed(() => mergeState.mergeConflictState?.mergedFiles ?? []);
const inlineConflictCount = ref<number>();
const mergeResolutionContent = ref('');
const isStandaloneConflictEditor = computed(() => !mergeState.mergeConflictState?.isMerging && Boolean(mergeState.activeMergeConflictEditor));
const isConflictModalVisible = computed(() => mergeState.isMergeConflictModalOpen && (mergeState.mergeConflictState?.isMerging || mergeState.activeMergeConflictEditor));
const modalTitle = computed(() => {
    if (isStandaloneConflictEditor.value) {
        return `Resolve conflict markers in ${mergeState.activeMergeConflictEditor?.path ?? 'selected file'}`;
    }

    if (!mergeState.mergeConflictState) {
        return 'Resolve merge conflicts';
    }

    const incoming = mergeState.mergeConflictState.incomingBranch;
    const target = mergeState.mergeConflictState.targetBranch;

    if (incoming && target) {
        return `Resolve conflicts before merging ${incoming} into ${target}`;
    }

    if (target) {
        return `Resolve conflicts before completing merge on ${target}`;
    }

    return 'Resolve merge conflicts';
});
const modalDescription = computed(() => {
    if (isStandaloneConflictEditor.value) {
        const count = activeEditorConflictCount.value;
        return count === 1 ? '1 conflict block detected in the selected file.' : `${count} conflict blocks detected in the selected file.`;
    }

    return `${conflictedFiles.value.length} conflicted file${conflictedFiles.value.length === 1 ? '' : 's'} remaining, ${mergedFiles.value.length} ready to commit`;
});
const editorTitle = computed(() => mergeState.activeMergeConflictEditor?.path ?? 'Inline merge editor');
const activeEditorConflictCount = computed(() => {
    if (!mergeState.activeMergeConflictEditor) {
        return 0;
    }

    return inlineConflictCount.value ?? mergeState.activeMergeConflictEditor.conflictCount ?? 0;
});

watch(
    () => mergeState.activeMergeConflictEditor,
    (nextEditor) => {
        inlineConflictCount.value = undefined;

        if (!nextEditor) {
            mergeResolutionContent.value = '';
            return;
        }

        mergeResolutionContent.value = nextEditor.result;
    },
    { immediate: true },
);
</script>

<template>
    <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
    >
        <div v-if="isConflictModalVisible" class="fixed inset-0 z-70 flex items-start justify-center bg-black/50 px-6 py-10 backdrop-blur-sm overflow-y-auto">
            <div class="w-full max-w-6xl overflow-auto rounded-2xl border border-white/10 bg-x1 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
                <div class="flex items-start justify-between border-b border-white/10 px-4 py-3">
                    <div>
                        <p class="text-xl font-semibold text-white">{{ modalTitle }}</p>
                        <p class="mt-1 text-sm opacity-50">{{ modalDescription }}</p>
                    </div>
                    <IconButton severity="raised" v-tooltip.bottom="'Abort Merge'" @click="mergeState.abortMerge()" icon="icon-[mdi--close] text-xl" />
                </div>

                <div class="flex h-[70vh] gap-0 overflow-y-auto">
                    <div class="overflow-y-auto border-b border-x4 px-2 py-2 border-r scrollbar-thin">
                        <div v-if="isStandaloneConflictEditor" class="space-y-3">
                            <div class="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                                Resolve the conflict markers inline, then save and stage the file.
                            </div>

                            <div v-if="mergeState.activeMergeConflictEditor" class="rounded-xl border border-white/10 bg-x0 px-4 py-3">
                                <div class="flex items-center justify-between gap-3">
                                    <div>
                                        <p class="text-sm font-medium text-white">{{ mergeState.activeMergeConflictEditor.path }}</p>
                                        <p class="text-xs text-amber-300">{{ activeEditorConflictCount }} conflict{{ activeEditorConflictCount === 1 ? '' : 's' }}</p>
                                    </div>
                                    <Button severity="secondary" smaller @click="repo.openFileInEditor(mergeState.activeMergeConflictEditor.path)"> Open in Editor </Button>
                                </div>
                            </div>
                        </div>

                        <template v-else>
                            <div v-if="conflictedFiles.length === 0" class="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                                All conflicts are resolved. You can review the staged files and commit the merge.
                            </div>

                            <div v-else class="space-y-1">
                                <div
                                    v-for="file in [...conflictedFiles, ...conflictedFiles, ...conflictedFiles, ...conflictedFiles]"
                                    :key="file.path"
                                    class="rounded-xl border border-white/10 bg-x0 px-4 py-2"
                                >
                                    <div class="flex flex-col">
                                        <div class="flex space-x-2 items-center flex-wrap">
                                            <p class="text-sm font-medium text-white">{{ file.path }}</p>
                                            <p class="text-xs text-amber-300">
                                                {{
                                                    file.conflictCount === undefined
                                                        ? 'Needs manual resolution'
                                                        : `${file.conflictCount} conflict${file.conflictCount === 1 ? '' : 's'}`
                                                }}
                                            </p>
                                        </div>

                                        <div class="flex justify-end gap-2 items-center mt-1">
                                            <Button severity="secondary" class="text-white/70" smaller @click="repo.openFileInEditor(file.path)"> Open in Editor </Button>
                                            <Button severity="secondary" class="text-white/70" smaller @click="mergeState.openInlineMergeEditor(file.path)">
                                                Resolve Inline
                                            </Button>
                                            <Button
                                                severity="warning"
                                                smaller
                                                v-loading="tasks.markMergeConflictResolved.isRunning(file.path)"
                                                @click="mergeState.markMergeConflictResolved(file.path)"
                                                v-tooltip="
                                                    'This marks the file as resolved and stages it, but you still need to open it and resolve the conflict markers manually.'
                                                "
                                            >
                                                Mark Resolved
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div v-if="mergedFiles.length > 0" class="mt-6 flex flex-col gap-1">
                                <div class="flex items-center justify-between mb-2">
                                    <p class="text-sm font-semibold uppercase opacity-50">Resolved and staged</p>
                                </div>

                                <div v-for="file in mergedFiles" :key="`merged:${file.path}`" class="rounded-sm border border-emerald-400/20 bg-emerald-500/10 px-3 py-1">
                                    <p class="text-sm font-medium">{{ file.path }}</p>
                                </div>
                            </div>
                        </template>
                    </div>

                    <div class="overflow-y-auto flex-1 flex flex-col">
                        <div v-if="!mergeState.activeMergeConflictEditor" class="flex h-full min-h-96 flex-col items-center justify-center px-8 text-center">
                            <p class="text-lg font-semibold">Inline merge editor</p>
                            <p class="mt-2 max-w-md text-sm leading-6 opacity-40">
                                Open any conflicted file to resolve it inline with VS Code-style actions directly above each conflict block.
                            </p>
                        </div>

                        <div v-else class="space-y-4 h-full flex-1 flex flex-col overflow-auto">
                            <div class="flex-1 overflow-auto flex flex-col px-1.5">
                                <div class="flex items-center gap-4 px-2 pt-2">
                                    <p class="font-semibold text-white flex-1">{{ editorTitle }}</p>
                                    <div class="flex items-center gap-2">
                                        <Button severity="light" class="py-0.5 px-2" @click="mergeState.closeInlineMergeEditor()"> Close </Button>
                                        <Button
                                            severity="primary"
                                            class="py-0.5 px-2"
                                            :disabled="activeEditorConflictCount > 0"
                                            v-loading="tasks.isOperationRunning(`saveMergeConflictResolution:${mergeState.activeMergeConflictEditor.path}`)"
                                            @click="mergeState.saveMergeConflictResolution(mergeState.activeMergeConflictEditor.path, mergeResolutionContent)"
                                        >
                                            Save and Stage
                                        </Button>
                                    </div>
                                </div>

                                <div class="mt-2 h-136 min-h-0 flex-1">
                                    <ConflictMonacoEditor
                                        v-model="mergeResolutionContent"
                                        :path-for-language="mergeState.activeMergeConflictEditor.path"
                                        :font-size="13"
                                        @conflict-count-change="inlineConflictCount = $event"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-between border-t border-white/10 px-6 py-4">
                    <p class="text-sm opacity-50">
                        {{
                            isStandaloneConflictEditor
                                ? 'Resolve the selected file inline, then save and stage it when every conflict block is cleared.'
                                : 'Resolve files inline, in your editor, or with branch-specific shortcuts, then commit the merge when every conflict is cleared.'
                        }}
                    </p>
                    <div class="flex items-center gap-3">
                        <Button
                            v-if="!isStandaloneConflictEditor"
                            class="whitespace-nowrap"
                            severity="secondary"
                            v-loading="tasks.isOperationRunning('abortMerge')"
                            @click="mergeState.abortMerge()"
                        >
                            Abort Merge
                        </Button>
                        <Button
                            v-if="!isStandaloneConflictEditor"
                            severity="primary"
                            class="whitespace-nowrap"
                            :disabled="!mergeState.mergeConflictState?.canCommit"
                            v-loading="tasks.isOperationRunning('commitMerge')"
                            @click="mergeState.commitMerge()"
                        >
                            Commit Merge
                        </Button>
                        <Button v-if="isStandaloneConflictEditor" class="whitespace-nowrap" severity="light" @click="mergeState.dismissMergeConflictModal()"> Close </Button>
                    </div>
                </div>
            </div>
        </div>
    </Transition>
</template>
