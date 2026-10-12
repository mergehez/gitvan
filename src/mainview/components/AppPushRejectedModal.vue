<script setup lang="ts">
import { computed } from 'vue';
import { useRepos } from '../composables/useRepos';
import Alert from './Alert.vue';
import Button from './Button.vue';
import CenteredModal from './CenteredModal.vue';

const repos = useRepos();

const modalRepo = computed(() => repos.repos.find((repo) => repo.id === repos.pushRejectedRepoId));
const incomingCommitCount = computed(() => modalRepo.value?.status.behind ?? 0);

async function pullRemoteChanges() {
    const repoId = repos.pushRejectedRepoId;
    if (repoId === undefined) {
        return;
    }

    repos.closePushRejectedModal();
    await repos.runRepoRemoteOperation(repoId, 'pull');
}
</script>

<template>
    <CenteredModal v-model:open="repos.isPushRejectedModalOpen" title="Push rejected" content-class="max-w-xl">
        <div class="space-y-5 px-6 py-5">
            <Alert severity="warning">
                Git refused the push because the remote branch has commits
                <span class="font-semibold text-white">{{ modalRepo?.name ?? 'this repository' }}</span> does not have yet. Pushing now would drop them.
            </Alert>

            <div class="rounded-xl border border-white/10 bg-x0/70 px-4 py-4">
                <p class="text-sm font-semibold text-white">Why the push is not possible</p>
                <p class="mt-1 text-xs leading-5 text-white/60">
                    <span class="font-mono text-white/85">{{ modalRepo?.status.branch ?? 'The current branch' }}</span>
                    <template v-if="incomingCommitCount > 0">
                        is {{ incomingCommitCount }} commit{{ incomingCommitCount === 1 ? '' : 's' }} behind its remote counterpart. Git only accepts a push that follows on from
                        the remote tip.
                    </template>
                    <template v-else> is behind its remote counterpart. Git only accepts a push that follows on from the remote tip. </template>
                </p>
            </div>

            <p class="text-sm leading-6 text-white/65">Choose <span class="font-semibold text-white">Pull</span> to bring the remote commits in, then push again.</p>

            <div class="flex items-center justify-end gap-3 border-t border-x3 pt-4">
                <Button severity="light" @click="repos.closePushRejectedModal()"> Close </Button>
                <Button severity="primary" @click="pullRemoteChanges()"> Pull </Button>
            </div>
        </div>
    </CenteredModal>
</template>
