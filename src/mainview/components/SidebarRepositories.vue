<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Repo } from '../../shared/gitClient.ts';
import { useRepos } from '../composables/useRepos.ts';
import { useSettings } from '../composables/useSettings.ts';
import { tasks } from '../composables/useTasks.ts';
import { isButtonBusyStateSilenced } from '../lib/loadingIndicatorState.ts';
import Alert from './Alert.vue';
import Button from './Button.vue';
import CenteredInputModal from './CenteredInputModal.vue';
import FileTree, { FileTreeItem } from './FileTree.vue';
import IconButton from './IconButton.vue';

const repos = useRepos();
const settings = useSettings();

const isButtonBusyBlocked = computed(() => tasks.isBusy && !isButtonBusyStateSilenced.value);
const isAddMenuOpen = ref(false);
const addMenuAnchor = ref<HTMLElement>();
const addMenuPosition = ref({ top: 0, left: 0 });

function canPublishBranch(r: Repo) {
    return !r.status.error && !r.status.hasUpstream && r.status.publishableCommits > 0;
}

function canPublishNow(r: Repo) {
    return canPublishBranch(r) && r.status.hasRemote;
}

function publishLabel(r: Repo) {
    if (!r.status.hasRemote) {
        return `Publish branch with ${r.status.publishableCommits} commit${r.status.publishableCommits === 1 ? '' : 's'} (no remote configured)`;
    }

    return `Publish branch with ${r.status.publishableCommits} commit${r.status.publishableCommits === 1 ? '' : 's'}`;
}

function pullLabel(r: Repo) {
    return `Pull ${r.status.behind} commit${r.status.behind === 1 ? '' : 's'}`;
}

function pushLabel(r: Repo) {
    return `Push ${r.status.ahead} commit${r.status.ahead === 1 ? '' : 's'}`;
}

function statusIconClass(r: Repo) {
    if (r.status.error) {
        return 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]';
    }

    if (r.status.isDirty) {
        return 'bg-blue-500/60 ';
    }

    return 'opacity-0';
}

function statusLabel(r: Repo) {
    if (r.status.error) {
        return 'Error';
    }

    if (canPublishBranch(r)) {
        return publishLabel(r);
    }

    if (repos.canPull(r, true) && repos.canPush(r, true)) {
        return `Can pull ${r.status.behind} commit${r.status.behind === 1 ? '' : 's'} and push ${r.status.ahead} commit${r.status.ahead === 1 ? '' : 's'}`;
    }

    if (repos.canPull(r, true)) {
        return `Can pull ${r.status.behind} commit${r.status.behind === 1 ? '' : 's'}`;
    }

    if (repos.canPush(r, true)) {
        return `Can push ${r.status.ahead} commit${r.status.ahead === 1 ? '' : 's'}`;
    }

    return r.status.isDirty ? 'Dirty' : 'Clean';
}

function closeAddMenu() {
    isAddMenuOpen.value = false;
}

function updateAddMenuPosition() {
    if (!addMenuAnchor.value) {
        return;
    }

    const anchorRect = addMenuAnchor.value.getBoundingClientRect();
    addMenuPosition.value = {
        top: anchorRect.bottom + 8,
        left: anchorRect.left,
    };
}

async function toggleAddMenu() {
    if (isAddMenuOpen.value) {
        closeAddMenu();
        return;
    }

    isAddMenuOpen.value = true;
    await nextTick();
    updateAddMenuPosition();
}

function openCloneDialog() {
    closeAddMenu();
    repos.isCloneRepoModalOpen = true;
}

function openCreateDialog() {
    closeAddMenu();
    repos.isCreateRepoModalOpen = true;
}

async function addExistingRepo(targetGroupId?: number) {
    closeAddMenu();
    await repos.pickRepo(targetGroupId);
}

watch(
    () => repos.isCloneRepoModalOpen,
    (isOpen) => {
        if (isOpen) {
            closeAddMenu();
        }
    },
);

watch(
    () => repos.isCreateRepoModalOpen,
    (isOpen) => {
        if (isOpen) {
            closeAddMenu();
        }
    },
);

watch(isAddMenuOpen, (isOpen) => {
    if (!isOpen) {
        window.removeEventListener('resize', updateAddMenuPosition);
        window.removeEventListener('scroll', updateAddMenuPosition, true);
        return;
    }

    window.addEventListener('resize', updateAddMenuPosition);
    window.addEventListener('scroll', updateAddMenuPosition, true);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', updateAddMenuPosition);
    window.removeEventListener('scroll', updateAddMenuPosition, true);
});

const treeItems = computed<FileTreeItem<Repo>[]>(() => {
    const groups = repos.repoGroups;
    const ungroupedRepos = repos.repos.filter((repo) => repo.groupId === undefined || repo.groupId === null);

    const items = groups.map((group) => ({
        id: group.id,
        title: group.name,
        children: repos.repos
            .filter((repo) => repo.groupId === group.id)
            .map((repo) => ({
                ...repo,
                title: repo.name,
            })),
    }));

    if (ungroupedRepos.length > 0) {
        items.unshift({
            id: -1,
            title: 'Repositories',
            children: ungroupedRepos.map((repo) => ({
                ...repo,
                title: repo.name,
            })),
        });
    }

    return items;
});

const openNewGroupModal = ref(false);
const newGroupName = ref('');
const isRenameRepoModalOpen = ref(false);
const renameRepoId = ref<number>();
const renameRepoName = ref('');
const canSubmitRepoRename = computed(() => {
    return Boolean(renameRepoId.value !== undefined && renameRepoName.value.trim());
});
const isRenameRepoRunning = computed(() => {
    return renameRepoId.value !== undefined && tasks.renameRepo.isRunning();
});

function openRenameRepoModal(repo: Repo) {
    renameRepoId.value = repo.id;
    renameRepoName.value = repo.name;
    isRenameRepoModalOpen.value = true;
}

function closeRenameRepoModal() {
    isRenameRepoModalOpen.value = false;
    renameRepoId.value = undefined;
    renameRepoName.value = '';
}

async function createGroup() {
    if (!newGroupName.value.trim()) {
        return;
    }

    await repos.createRepoGroup(newGroupName.value.trim());
    newGroupName.value = '';
    openNewGroupModal.value = false;
}

async function submitRepoRename() {
    if (renameRepoId.value === undefined || !renameRepoName.value.trim()) {
        return;
    }

    await repos.renameRepo(renameRepoId.value, renameRepoName.value);
    closeRenameRepoModal();
}

async function openRepoContextMenu(repoId: number) {
    await repos.openRepoContextMenu(repoId, openRenameRepoModal);
}

function fetchGroupRepos(groupId: number) {
    const reposInGroup = repos.repos.filter((r) => groupId == -1 || r.groupId === groupId);
    for (const repo of reposInGroup) {
        if (repo.canFetch()) {
            void repos.runRepoRemoteOperation(repo.id, 'fetch');
        }
    }
}
</script>

<template>
    <aside class="border-r border-white/10 bg-x1/75 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl h-full overflow-auto flex flex-col">
        <div class="mb-5 flex gap-1 items-center px-2">
            <p class="text-sm font-medium text-white mr-1">Repos</p>

            <div ref="addMenuAnchor" class="relative">
                <IconButton severity="secondary" :disabled="isButtonBusyBlocked" v-tooltip.bottom="'Add Repository'" @click="toggleAddMenu" icon="icon-[mdi--plus]" />
            </div>

            <IconButton
                severity="secondary"
                :disabled="isButtonBusyBlocked"
                v-tooltip.bottom="'Repository Settings'"
                @click="settings.openSettingsWindow('repositories')"
                icon="icon-[mdi--cog-outline]"
            />

            <IconButton
                severity="secondary"
                :disabled="isButtonBusyBlocked"
                v-tooltip.bottom="'Add Repository Group'"
                @click="openNewGroupModal = true"
                icon="icon-[mdi--folder-plus-outline]"
            />

            <IconButton
                severity="secondary"
                :disabled="isButtonBusyBlocked"
                v-tooltip.bottom="'Refresh Repositories'"
                @click="repos.refreshRepositories()"
                icon="icon-[ic--refresh]"
            />

            <IconButton
                severity="secondary"
                :disabled="isButtonBusyBlocked"
                v-tooltip.bottom="'Fetch All Repositories in All Groups'"
                @click="fetchGroupRepos(-1)"
                icon="icon-[fluent--cloud-sync-16-regular] "
            />
        </div>

        <div class="flex-1 flex flex-col gap-2">
            <FileTree
                v-for="treeItem in treeItems"
                :key="treeItem.id"
                :item="treeItem"
                empty-text="No repositories"
                :selection="repos.selectedRepoId"
                :onSelect="(r) => repos.selectRepo(r.id)"
                :onContextMenu="(r) => openRepoContextMenu(r.id)"
            >
                <template #header-actions="{ item }">
                    <IconButton
                        v-if="!item.children.length"
                        severity="raised"
                        smaller
                        v-tooltip.bottom="`Delete group ${item.title}`"
                        @click.stop="repos.deleteRepoGroup(item.id)"
                        icon="icon-[mingcute--delete-2-fill]"
                    />
                    <IconButton
                        severity="raised"
                        :disabled="isButtonBusyBlocked"
                        smaller
                        v-tooltip.bottom="'Fetch Repositories in Group'"
                        @click="fetchGroupRepos(item.id)"
                        icon="icon-[fluent--cloud-sync-16-regular] "
                    />
                    <IconButton
                        severity="raised"
                        smaller
                        v-tooltip.bottom="`Add repository to group ${item.title}`"
                        @click.stop="addExistingRepo(item.id)"
                        icon="icon-[mdi--plus]"
                    />
                </template>
                <template #item-leftIcon="{ item }">
                    <span
                        class="icon text-sm"
                        :class="tasks.isOperationRunning(`runRemoteOperation:fetch-${item.id}`) ? 'icon-[mdi--cloud-refresh] animate-spin' : 'icon-[mdi--source-branch]'"
                    ></span>
                </template>
                <template #item-title="{ item }">
                    <p class="text-xs tracking-tight">{{ item.title }}</p>
                </template>
                <template #item-rightIcon="{ item }">
                    <div class="flex items-center gap-1">
                        <IconButton
                            v-if="canPublishBranch(item)"
                            severity="raised"
                            smaller
                            :disabled="isButtonBusyBlocked || !canPublishNow(item)"
                            v-tooltip.right="publishLabel(item)"
                            @click.stop="repos.publishRepoBranch(item.id)"
                            v-loading="tasks.isOperationRunning(`publishBranch:${item.id}`)"
                            icon="icon-[mdi--plus-thick] text-amber-300 text-xs"
                        />
                        <IconButton
                            v-if="repos.canPull(item, true)"
                            severity="raised"
                            smaller
                            :disabled="isButtonBusyBlocked"
                            :title="pullLabel(item)"
                            v-tooltip.right="pullLabel(item)"
                            @click.stop="repos.runRepoRemoteOperation(item.id, 'pull')"
                            v-loading="tasks.isOperationRunning(`runRemoteOperation:pull-${item.id}`)"
                            icon="icon-[fa--arrow-down] text-emerald-300 text-xs"
                        />
                        <IconButton
                            v-if="repos.canPush(item, true)"
                            severity="raised"
                            smaller
                            :disabled="isButtonBusyBlocked"
                            :title="pushLabel(item)"
                            v-tooltip.right="pushLabel(item)"
                            @click.stop="repos.runRepoRemoteOperation(item.id, 'push')"
                            v-loading="tasks.isOperationRunning(`runRemoteOperation:push-${item.id}`)"
                            icon="icon-[fa--arrow-up] text-sky-300 text-xs"
                        />
                        <span class="h-2 w-2 shrink-0 rounded-full" :class="statusIconClass(item)" :title="statusLabel(item)" v-tooltip.right="statusLabel(item)" />
                    </div>
                </template>
            </FileTree>
        </div>
        <div class="mt-4 px-2">
            <Alert severity="secondary" class="mb-2 py-1 justify-center rounded px-2 flex items-center gap-2" v-if="tasks.isAnyLongRunningOperation()">
                <span class="icon icon-[mingcute--loading-fill] text-blue-500 text-2xl animate-spin"></span>
                <span class="text-xs">Running: {{ tasks.getLongRunningOperation || '...' }}</span>
            </Alert>
            <Button
                severity="secondary"
                class="w-full justify-center"
                :disabled="isButtonBusyBlocked"
                v-loading="tasks.isOperationRunning('resetSandboxRepos')"
                @click="repos.resetSandboxRepos()"
            >
                <span class="icon icon-[mdi--flask-outline] mr-1.5 text-sm"></span>
                <span>Reset Sandboxes</span>
            </Button>
        </div>
    </aside>
    <Teleport to="body">
        <div v-if="isAddMenuOpen" class="fixed inset-0 z-80" @click="closeAddMenu">
            <div
                class="fixed z-90 overflow-hidden rounded border border-x7 bg-x3 shadow-lg shadow-x3 flex flex-col"
                :style="{
                    top: `${addMenuPosition.top}px`,
                    left: `${addMenuPosition.left}px`,
                }"
                @click.stop
            >
                <Button severity="secondary" class="justify-start gap-1.5" small @click="openCloneDialog">
                    <span class="icon icon-[mdi--download-network-outline] text-sm opacity-60"></span>
                    <span class="opacity-90 text-xs">Clone Repository...</span>
                </Button>
                <Button severity="secondary" class="justify-start gap-1.5" small @click="openCreateDialog">
                    <span class="icon icon-[mdi--folder-plus-outline] text-sm opacity-60"></span>
                    <span class="opacity-90 text-xs">Create New Repository...</span>
                </Button>
                <Button severity="secondary" class="justify-start gap-1.5" small @click="addExistingRepo()">
                    <span class="icon icon-[mdi--folder-open-outline] text-sm opacity-60"></span>
                    <span class="opacity-90 text-xs">Add Existing Repository...</span>
                </Button>
            </div>
        </div>
    </Teleport>

    <CenteredInputModal
        v-model:open="isRenameRepoModalOpen"
        v-model:value="renameRepoName"
        title="Rename Repository"
        input-label="Repository name"
        submit-label="Rename"
        :can-submit="canSubmitRepoRename"
        :is-loading="isRenameRepoRunning"
        :submit="submitRepoRename"
        :close="closeRenameRepoModal"
    />

    <CenteredInputModal
        v-model:open="openNewGroupModal"
        v-model:value="newGroupName"
        title="Create Repository Group"
        input-label="Group name"
        submit-label="Create"
        :can-submit="!!newGroupName.trim()"
        :is-loading="tasks.isOperationRunning('createRepoGroup')"
        :submit="createGroup"
    />
</template>
