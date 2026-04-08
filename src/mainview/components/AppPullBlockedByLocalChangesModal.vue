<script setup lang="ts">
import { computed } from 'vue';
import { useRepos } from '../composables/useRepos';
import { tasks } from '../composables/useTasks';
import Alert from './Alert.vue';
import Button from './Button.vue';
import CenteredModal from './CenteredModal.vue';

const repos = useRepos();

const modalRepo = computed(() => repos.repos.find((repo) => repo.id === repos.pullBlockedRepoId));
const visibleFiles = computed(() => (repos.pullBlockedConflictingFiles.length > 5 ? repos.pullBlockedConflictingFiles.slice(0, 4) : repos.pullBlockedConflictingFiles));
const remainingFileCount = computed(() => (repos.pullBlockedConflictingFiles.length > 5 ? repos.pullBlockedConflictingFiles.length - visibleFiles.value.length : 0));
const isRetryRunning = computed(() => (repos.pullBlockedRepoId === undefined ? false : tasks.retryPullAfterStash.isRunning(String(repos.pullBlockedRepoId))));
</script>

<template>
    <CenteredModal v-model:open="repos.isPullBlockedByLocalChangesModalOpen" title="Pull blocked by local changes" content-class="max-w-2xl">
        <div class="space-y-5 px-6 py-5">
            <Alert severity="warning">
                Git cannot pull yet because incoming changes would overwrite local files in
                <span class="font-semibold text-white">{{ modalRepo?.name ?? 'this repository' }}</span
                >.
            </Alert>

            <div class="rounded-xl border border-white/10 bg-x0/70 px-4 py-4">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <p class="text-sm font-semibold text-white">Files blocking pull</p>
                        <p class="mt-1 text-xs text-white/60">
                            {{ repos.pullBlockedConflictingFiles.length }} file{{ repos.pullBlockedConflictingFiles.length === 1 ? '' : 's' }} need to be stashed before retrying.
                        </p>
                    </div>
                </div>

                <div class="mt-4 space-y-2">
                    <div v-for="path in visibleFiles" :key="path" class="rounded-lg border border-white/8 bg-x1 px-3 py-2 font-mono text-sm text-white/90">
                        {{ path }}
                    </div>
                    <p v-if="remainingFileCount > 0" class="text-sm text-white/60">{{ remainingFileCount }} more files</p>
                </div>
            </div>

            <p class="text-sm leading-6 text-white/65">
                Choose <span class="font-semibold text-white">Stash changes and retry</span> to stash your working tree, retry the pull, and keep the stash entry if the retry ends
                with merge conflicts.
            </p>

            <div class="flex items-center justify-end gap-3 border-t border-x3 pt-4">
                <Button severity="light" :disabled="isRetryRunning" @click="repos.closePullBlockedByLocalChangesModal()"> Cancel </Button>
                <Button severity="primary" v-loading="isRetryRunning" @click="repos.retryPullAfterStash()"> Stash changes and retry </Button>
            </div>
        </div>
    </CenteredModal>
</template>
