<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BranchSummary } from '../../shared/types.ts';
import { useRepos } from '../composables/useRepos.ts';
import { tasks } from '../composables/useTasks.ts';
import CenteredInputModal from './CenteredInputModal.vue';
import type { FileTreeItem } from './FileTree.vue';
import FileTree from './FileTree.vue';
import IconButton from './IconButton.vue';

const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);

watch(
    [() => repo.value.id, () => repo.value.status.lastScannedAt],
    () => {
        void repo.value.loadBranches();
    },
    { immediate: true }
);

const localBranches = computed<FileTreeItem<BranchSummary, { selection: string | undefined }>>(() => ({
    id: 'local-branches',
    title: 'Local branches',
    selection: repo.value.branches?.local.find((b) => b.isCurrent)?.refName,
    children: (repo.value.branches?.local ?? []).map((branch) => ({
        id: branch.refName,
        title: branch.name,
        subtitle: branch.subject ?? undefined,
        ...branch,
    })),
}));
const remoteBranches = computed<FileTreeItem<BranchSummary, { selection: string | undefined }>>(() => ({
    id: 'remote-branches',
    title: 'Remote branches',
    selection: repo.value.branches?.remote.find((b) => b.isCurrent)?.refName,
    children: (repo.value.branches?.remote ?? []).map((branch) => ({
        id: branch.refName,
        title: branch.name,
        subtitle: branch.subject ?? undefined,
        ...branch,
    })),
}));

function onBranchSelect(branch: BranchSummary, local: boolean) {
    if (branch.isCurrent || tasks.isBusy) {
        return;
    }

    if (local) {
        void repo.value.checkoutBranch(branch.name);
    } else {
        void repo.value.checkoutBranch(branch.refName);
    }
}

const isAddBranchOpen = ref(false);
const newBranchName = ref('');
const newBranchType = ref<'local' | 'remote'>('local');

function startAddBranch(type: 'local' | 'remote') {
    isAddBranchOpen.value = true;
    newBranchType.value = type;
    newBranchName.value = '';
}

async function createBranch() {
    if (newBranchType.value === 'local') {
        await repo.value.createBranch(newBranchName.value);
    } else {
        await repo.value.createRemoteBranch(newBranchName.value);
    }

    isAddBranchOpen.value = false;
    newBranchName.value = '';
}
</script>

<template>
    <aside class="border-r border-white/10 bg-x1/75 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl h-full overflow-auto flex flex-col">
        <!-- <div class="mb-5 flex gap-1 items-center px-2">
            <p class="px-2 text-lg font-bold text-white mr-1">{{ repo.name }}</p>
        </div> -->

        <div class="flex-1 flex flex-col gap-2">
            <FileTree
                :item="localBranches"
                empty-text="No branches"
                :left-icon="() => 'icon-[mdi--source-branch]'"
                :right-icon="(t) => (t.isCurrent ? 'icon-[mdi--check-bold] text-green-400' : '')"
                :selection="localBranches.selection"
                :onSelect="(r) => onBranchSelect(r, true)"
            >
                <template #header-actions>
                    <IconButton severity="raised" smaller data-testid="branches-add-local" @click.stop="startAddBranch('local')" icon="icon-[mdi--plus]" />
                </template>
            </FileTree>
            <FileTree
                :item="remoteBranches"
                empty-text="No branches"
                :left-icon="() => 'icon-[mdi--source-branch]'"
                :right-icon="(t) => (t.isCurrent ? 'icon-[mdi--check-bold] text-green-400' : '')"
                :selection="remoteBranches.selection"
                :onSelect="(r) => onBranchSelect(r, false)"
            >
                <template #header-actions>
                    <IconButton severity="raised" smaller data-testid="branches-add-remote" @click.stop="startAddBranch('remote')" icon="icon-[mdi--plus]" />
                </template>
            </FileTree>
        </div>
    </aside>
    <CenteredInputModal
        v-model:open="isAddBranchOpen"
        v-model:value="newBranchName"
        :title="`Add ${newBranchType === 'local' ? 'Local' : 'Remote'} Branch`"
        :input-label="'Branch name'"
        submit-label="Create"
        :can-submit="!!newBranchName.trim()"
        :is-loading="tasks.isOperationRunning(newBranchType === 'local' ? 'createBranch' : 'createRemoteBranch')"
        :submit="createBranch"
    />
</template>
