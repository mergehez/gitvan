<script setup lang="ts">
import { computed, ref } from 'vue';
import { tasks } from '../composables/useTasks';
import FileTree, { FileTreeItem } from './FileTree.vue';
import { BranchSummary } from '../../shared/gitClient';
import { useRepos } from '../composables/useRepos';
import IconButton from './IconButton.vue';

const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);

type BranchTreeData = BranchSummary;

const localBranches = computed<FileTreeItem<BranchTreeData>>(() => ({
    id: 'local-branches',
    title: 'Local branches',
    children: (repo.value.branches?.local ?? []).map((branch) => ({
        id: branch.refName,
        title: branch.name,
        subtitle: branch.subject ?? undefined,
        ...branch,
    })),
}));

const remoteBranches = computed<FileTreeItem<BranchTreeData>>(() => ({
    id: 'remote-branches',
    title: 'Remote branches',
    children: (repo.value.branches?.remote ?? []).map((branch) => ({
        id: branch.refName,
        title: branch.name,
        subtitle: branch.subject ?? undefined,
        ...branch,
    })),
}));

function branchTrackLabel(branch: BranchSummary) {
    if (branch.ahead > 0 && branch.behind > 0) {
        return `${branch.ahead} ahead / ${branch.behind} behind`;
    }

    if (branch.ahead > 0) {
        return `${branch.ahead} ahead`;
    }

    if (branch.behind > 0) {
        return `${branch.behind} behind`;
    }

    return branch.isCurrent ? 'Current' : '';
}

function selectLocalBranch(branch: BranchSummary) {
    if (branch.isCurrent || tasks.isBusy) {
        return;
    }

    void repo.value.checkoutBranch(branch.name);
}

const newLocalBranchName = ref('');
const newRemoteBranchName = ref('');
const canCreateRemoteBranch = computed(() => repo.value.status.hasRemote && !tasks.isBusy && !!newRemoteBranchName.value.trim());
</script>

<template>
    <div class="w-full px-2">
        <h3 class="mt-2 px-2 text-xl font-semibold text-white">Branches</h3>

        <div class="mt-5 grid gap-4">
            <div class="grid gap-4 lg:grid-cols-2">
                <div class="rounded-[22px] border border-white/10 bg-black/20 p-2">
                    <FileTree
                        :item="localBranches"
                        empty-text="No local branches"
                        :selection="repo.branches?.currentBranch ? `refs/heads/${repo.branches.currentBranch}` : undefined"
                        :onSelect="selectLocalBranch"
                    >
                        <template #header-actions>
                            <div class="flex gap-1 items-center">
                                <input
                                    v-model="newLocalBranchName"
                                    type="text"
                                    placeholder="new branch..."
                                    :disabled="tasks.isBusy || !repo.status.hasRemote"
                                    class="w-40 rounded border border-white/10 bg-x0/80 px-2 py-1 text-xs text-white outline-none disabled:cursor-not-allowed disabled:opacity-40"
                                />
                                <IconButton
                                    icon="icon-[mdi--cloud-upload-outline]"
                                    smaller
                                    :disabled="tasks.isBusy || !newLocalBranchName.trim()"
                                    @click="repo.createBranch(newLocalBranchName)"
                                    v-tooltip="repo.status.hasRemote ? 'Create remote branch' : 'Configure a remote first'"
                                />
                            </div>
                        </template>
                        <template #item-leftIcon>
                            <span class="icon icon-[mdi--source-branch] text-xl text-sky-200"></span>
                        </template>
                        <template #item-title="{ item }">
                            <div>
                                <p class="text-xs tracking-tight leading-tight">{{ item.name }}</p>
                                <p v-if="item.subject" class="line-clamp-1 text-xs tracking-tighter leading-tight opacity-30">{{ item.subject }}</p>
                            </div>
                        </template>
                        <template #item-rightIcon="{ item }">
                            <span class="text-xs font-semibold text-x7">{{ branchTrackLabel(item) }}</span>
                        </template>
                        <template #item-actions="{ item }">
                            <IconButton
                                severity="light"
                                :disabled="item.isCurrent || tasks.isBusy"
                                v-tooltip="item.isCurrent ? 'Current branch' : 'Checkout branch'"
                                @click.stop="selectLocalBranch(item)"
                                :icon="item.isCurrent ? 'icon-[mdi--check]' : 'icon-[mdi--swap-horizontal]'"
                            >
                            </IconButton>
                        </template>
                    </FileTree>
                </div>

                <div class="rounded-[22px] border border-white/10 bg-black/20 p-2">
                    <FileTree :item="remoteBranches" empty-text="No remote branches" no-actions :onSelect="() => {}">
                        <template #header-actions>
                            <div class="flex gap-1 items-center">
                                <input
                                    v-model="newRemoteBranchName"
                                    type="text"
                                    placeholder="new remote branch..."
                                    :disabled="tasks.isBusy || !repo.status.hasRemote"
                                    class="w-40 rounded border border-white/10 bg-x0/80 px-2 py-1 text-xs text-white outline-none disabled:cursor-not-allowed disabled:opacity-40"
                                />
                                <IconButton
                                    icon="icon-[mdi--cloud-upload-outline]"
                                    smaller
                                    :disabled="!canCreateRemoteBranch"
                                    v-tooltip="repo.status.hasRemote ? 'Create remote branch' : 'Configure a remote first'"
                                    @click="repo.createRemoteBranch(newRemoteBranchName)"
                                />
                            </div>
                        </template>
                        <template #item-leftIcon>
                            <span class="icon icon-[mdi--source-branch] text-xl text-sky-200"></span>
                        </template>
                        <template #item-title="{ item }">
                            <div>
                                <p class="text-xs tracking-tight leading-tight">{{ item.name }}</p>
                                <p v-if="item.subject" class="line-clamp-1 text-xs tracking-tighter leading-tight opacity-30">{{ item.subject }}</p>
                            </div>
                        </template>
                        <template #item-rightIcon="{ item }">
                            <span class="text-xs font-semibold text-x7">{{ branchTrackLabel(item) }}</span>
                        </template>
                    </FileTree>
                </div>
            </div>
        </div>
    </div>
</template>
