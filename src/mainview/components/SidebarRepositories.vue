<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Repo } from '../../shared/gitClient.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useContextMenu } from '../composables/useContextMenu.ts';
import { useRepos } from '../composables/useRepos.ts';
import { useSettings } from '../composables/useSettings.ts';
import { tasks } from '../composables/useTasks.ts';
import { isButtonBusyStateSilenced } from '../lib/loadingIndicatorState.ts';
import Button from './Button.vue';
import CenteredInputModal from './CenteredInputModal.vue';
import type { ContextMenuEntry } from './contextMenuTypes';
import FileTree, { FileTreeItem } from './FileTree.vue';
import IconButton from './IconButton.vue';

const auth = useAuth();
const repos = useRepos();
const settings = useSettings();
const appContextMenu = useContextMenu();

const isButtonBusyBlocked = computed(() => tasks.isBusy && !isButtonBusyStateSilenced.value);
const isAddMenuOpen = ref(false);
const addMenuAnchor = ref<HTMLElement>();
const addMenuPosition = ref({ top: 0, left: 0 });
const contextMenuGroupId = ref<number>();
const contextMenuRepoId = ref<number>();
const openWithEditors = computed(() => {
    const defaultEditorPath = settings.state.defaultEditorPath;

    return [...settings.state.editors].sort((left, right) => {
        if (left.path === defaultEditorPath) {
            return -1;
        }

        if (right.path === defaultEditorPath) {
            return 1;
        }

        return left.label.localeCompare(right.label, undefined, { sensitivity: 'accent' });
    });
});
const fileManagerLabel = navigator.userAgent.includes('Mac') ? 'Open in Finder' : 'Open in File Manager';

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

function closeContextMenu() {
    appContextMenu.closeMenu();
    contextMenuGroupId.value = undefined;
    contextMenuRepoId.value = undefined;
}

function openContextMenu(event: MouseEvent | undefined, items: ContextMenuEntry[]) {
    if (!event || items.length === 0) {
        return;
    }

    closeAddMenu();
    appContextMenu.openAtEvent(event, items);
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
            closeContextMenu();
        }
    }
);

watch(
    () => repos.isCreateRepoModalOpen,
    (isOpen) => {
        if (isOpen) {
            closeAddMenu();
            closeContextMenu();
        }
    }
);

watch(
    () => appContextMenu.open,
    (isOpen) => {
        if (!isOpen) {
            contextMenuGroupId.value = undefined;
            contextMenuRepoId.value = undefined;
        }
    }
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
const isRenameGroupModalOpen = ref(false);
const renameGroupId = ref<number>();
const renameGroupName = ref('');
const isRenameRepoModalOpen = ref(false);
const renameRepoId = ref<number>();
const renameRepoName = ref('');
const canSubmitGroupRename = computed(() => Boolean(renameGroupId.value !== undefined && renameGroupName.value.trim()));
const isRenameGroupRunning = computed(() => renameGroupId.value !== undefined && tasks.isOperationRunning('renameRepoGroup'));
const canSubmitRepoRename = computed(() => {
    return Boolean(renameRepoId.value !== undefined && renameRepoName.value.trim());
});
const isRenameRepoRunning = computed(() => {
    return renameRepoId.value !== undefined && tasks.renameRepo.isRunning();
});

function openRenameRepoModal(repo: Repo) {
    closeContextMenu();
    renameRepoId.value = repo.id;
    renameRepoName.value = repo.name;
    isRenameRepoModalOpen.value = true;
}

function openRenameGroupModal(groupId: number) {
    const group = repos.repoGroups.find((entry) => entry.id === groupId);
    if (!group) {
        return;
    }

    closeContextMenu();
    renameGroupId.value = group.id;
    renameGroupName.value = group.name;
    isRenameGroupModalOpen.value = true;
}

function closeRenameGroupModal() {
    isRenameGroupModalOpen.value = false;
    renameGroupId.value = undefined;
    renameGroupName.value = '';
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

    closeContextMenu();
    await repos.createRepoGroup(newGroupName.value.trim());
    newGroupName.value = '';
    openNewGroupModal.value = false;
}

async function submitGroupRename() {
    if (renameGroupId.value === undefined || !renameGroupName.value.trim()) {
        return;
    }

    await repos.renameRepoGroup(renameGroupId.value, renameGroupName.value);
    closeRenameGroupModal();
}

async function submitRepoRename() {
    if (renameRepoId.value === undefined || !renameRepoName.value.trim()) {
        return;
    }

    await repos.renameRepo(renameRepoId.value, renameRepoName.value);
    closeRenameRepoModal();
}

function buildOpenWithItems(repo: Repo): ContextMenuEntry[] {
    return [
        ...openWithEditors.value.map((editor) => ({
            id: `open-with-editor:${repo.id}:${editor.path}`,
            label: editor.label,
            action: async () => {
                await tasks.openFileInEditor.run({ repoId: repo.id, path: '', editorPath: editor.path }, `repo:${repo.id}:editor:${editor.path}`);
            },
        })),
        ...(openWithEditors.value.length > 0 ? ([{ type: 'separator' as const, id: `open-with-separator:${repo.id}` }] as ContextMenuEntry[]) : []),
        {
            id: `open-with-picker:${repo.id}`,
            label: 'Pick Program',
            action: async () => {
                await tasks.openFileInEditor.run({ repoId: repo.id, path: '', mode: 'pick' }, `repo:${repo.id}:pick-editor`);
            },
        },
    ];
}

function buildMoveToGroupItems(repo: Repo): ContextMenuEntry[] {
    return [
        {
            id: `move-to-group:none:${repo.id}`,
            label: 'No Group',
            checked: repo.groupId === undefined,
            disabled: repo.groupId === undefined,
            action: async () => {
                await repos.updateRepoGroup(repo.id, undefined);
            },
        },
        ...repos.repoGroups.map((group) => ({
            id: `move-to-group:${repo.id}:${group.id}`,
            label: group.name,
            checked: repo.groupId === group.id,
            disabled: repo.groupId === group.id,
            action: async () => {
                await repos.updateRepoGroup(repo.id, group.id);
            },
        })),
    ];
}

function buildAssignAccountItems(repo: Repo): ContextMenuEntry[] {
    return [
        {
            id: `assign-account:none:${repo.id}`,
            label: 'Unassigned',
            checked: repo.accountId === undefined,
            disabled: repo.accountId === undefined,
            action: async () => {
                await auth.assignAccountToRepo(repo.id, undefined);
            },
        },
        ...auth.accounts.map((account) => ({
            id: `assign-account:${repo.id}:${account.id}`,
            label: account.host && account.host !== 'github.com' ? `${account.label} (${account.host})` : account.label,
            checked: repo.accountId === account.id,
            disabled: repo.accountId === account.id,
            action: async () => {
                await auth.assignAccountToRepo(repo.id, account.id);
            },
        })),
    ];
}

function buildRepoContextMenuItems(repo: Repo): ContextMenuEntry[] {
    const canPublish = canPublishBranch(repo);

    return [
        {
            id: `repo-fetch:${repo.id}`,
            label: 'Fetch',
            icon: 'icon-[mingcute--refresh-3-line]',
            disabled: !repos.canFetch(repo),
            action: async () => {
                await repos.runRepoRemoteOperation(repo.id, 'fetch');
            },
        },
        {
            id: `repo-pull:${repo.id}`,
            label: 'Pull',
            icon: 'icon-[fa--arrow-down]',
            disabled: !repos.canPull(repo),
            action: async () => {
                await repos.runRepoRemoteOperation(repo.id, 'pull');
            },
        },
        {
            id: `repo-push:${repo.id}`,
            label: 'Push',
            icon: 'icon-[fa--arrow-up]',
            disabled: !repos.canPush(repo),
            action: async () => {
                await repos.runRepoRemoteOperation(repo.id, 'push');
            },
        },
        {
            id: `repo-publish:${repo.id}`,
            label: repo.status.hasRemote ? 'Publish Branch' : 'Publish Branch (No Remote)',
            icon: 'icon-[mdi--plus-thick]',
            disabled: !canPublishNow(repo),
            action: async () => {
                await repos.publishRepoBranch(repo.id);
            },
        },
        { type: 'separator' as const, id: `repo-separator-actions:${repo.id}` },
        {
            id: `repo-open-with:${repo.id}`,
            label: 'Open with...',
            icon: 'icon-[mdi--application-outline]',
            children: buildOpenWithItems(repo),
        },
        {
            id: `repo-move-to-group:${repo.id}`,
            label: 'Move to Group...',
            icon: 'icon-[mdi--folder-move-outline]',
            children: buildMoveToGroupItems(repo),
        },
        {
            id: `repo-assign-account:${repo.id}`,
            label: 'Assign Account...',
            icon: 'icon-[mdi--account-switch-outline]',
            children: buildAssignAccountItems(repo),
        },
        { type: 'separator' as const, id: `repo-separator-system:${repo.id}` },
        {
            id: `repo-open-integrated-terminal:${repo.id}`,
            label: 'Open in Integrated Terminal',
            icon: 'icon-[mdi--console-network-outline]',
            action: async () => {
                repos.openRepoInIntegratedTerminal(repo.id);
            },
        },
        {
            id: `repo-open-terminal:${repo.id}`,
            label: 'Open in Terminal',
            icon: 'icon-[mdi--console-line]',
            action: async () => {
                await repos.openRepoInTerminal(repo.id);
            },
        },
        {
            id: `repo-open-file-manager:${repo.id}`,
            label: fileManagerLabel,
            icon: 'icon-[mdi--folder-open-outline]',
            action: async () => {
                await repos.revealRepoInFinder(repo.id);
            },
        },
        {
            id: `repo-copy-path:${repo.id}`,
            label: 'Copy Path',
            icon: 'icon-[mdi--content-copy]',
            action: async () => {
                await repos.copyRepoPath(repo.id);
            },
        },
        { type: 'separator' as const, id: `repo-separator-edit:${repo.id}` },
        {
            id: `repo-rename:${repo.id}`,
            label: 'Rename...',
            icon: 'icon-[mdi--pencil-outline]',
            action: async () => {
                openRenameRepoModal(repo);
            },
        },
        {
            id: `repo-delete:${repo.id}`,
            label: 'Remove Repository',
            icon: 'icon-[mingcute--delete-2-fill]',
            danger: true,
            action: async () => {
                await repos.removeRepo(repo.id);
            },
        },
    ].filter((entry) => !('id' in entry && entry.id === `repo-publish:${repo.id}` && !canPublish));
}

function buildGroupContextMenuItems(item: FileTreeItem<Repo>): ContextMenuEntry[] {
    const targetGroupId = typeof item.id === 'number' && item.id >= 0 ? item.id : undefined;

    const items: ContextMenuEntry[] = [
        {
            id: `group-fetch:${item.id}`,
            label: item.id === -1 ? 'Fetch Repositories' : 'Fetch Repositories in Group',
            icon: 'icon-[fluent--cloud-sync-16-regular]',
            disabled: isButtonBusyBlocked.value,
            action: async () => {
                fetchGroupRepos(Number(item.id));
            },
        },
        {
            id: `group-add-repo:${item.id}`,
            label: item.id === -1 ? 'Add Repository...' : `Add Repository to ${item.title}`,
            icon: 'icon-[mdi--plus]',
            disabled: isButtonBusyBlocked.value,
            action: async () => {
                await addExistingRepo(targetGroupId);
            },
        },
    ];

    if (item.id === -1) {
        return items;
    }

    const group = repos.repoGroups.find((entry) => entry.id === item.id);
    if (!group) {
        return items;
    }

    return [
        ...items,
        { type: 'separator' as const, id: `group-actions-separator:${group.id}` },
        {
            id: `group-rename:${group.id}`,
            label: 'Rename...',
            icon: 'icon-[mdi--pencil-outline]',
            action: async () => {
                openRenameGroupModal(group.id);
            },
        },
        {
            id: `group-delete:${group.id}`,
            label: 'Delete Group',
            icon: 'icon-[mingcute--delete-2-fill]',
            danger: true,
            action: async () => {
                await repos.deleteRepoGroup(group.id);
            },
        },
        { type: 'separator' as const, id: `group-separator:${group.id}` },
        {
            id: `group-move-up:${group.id}`,
            label: 'Move Up',
            icon: 'icon-[mdi--arrow-up]',
            disabled: group.sequence <= 1,
            action: async () => {
                await repos.moveRepoGroup(group.id, 'up');
            },
        },
        {
            id: `group-move-down:${group.id}`,
            label: 'Move Down',
            icon: 'icon-[mdi--arrow-down]',
            disabled: group.sequence >= repos.repoGroups.length,
            action: async () => {
                await repos.moveRepoGroup(group.id, 'down');
            },
        },
    ];
}

function openRepoContextMenu(repoId: number, event?: MouseEvent) {
    const repo = repos.repos.find((entry) => entry.id === repoId);
    if (!repo) {
        return;
    }

    contextMenuGroupId.value = undefined;
    contextMenuRepoId.value = repo.id;
    openContextMenu(event, buildRepoContextMenuItems(repo));
}

function openGroupContextMenu(item: FileTreeItem<Repo>, event?: MouseEvent) {
    contextMenuRepoId.value = undefined;
    contextMenuGroupId.value = Number(item.id);
    openContextMenu(event, buildGroupContextMenuItems(item));
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
                v-tooltip.bottom.html="'Refresh Repositories<br/>(Sync Gitvan state with filesystem)'"
                @click="repos.refreshRepositories()"
                icon="icon-[ic--refresh]"
            />

            <IconButton
                severity="secondary"
                :disabled="isButtonBusyBlocked"
                v-tooltip.bottom.html="'Fetch All Repositories in All Groups'"
                @click="fetchGroupRepos(-1)"
                icon="icon-[fluent--cloud-sync-16-regular] "
            />
        </div>

        <div class="flex-1 flex flex-col gap-2 overflow-y-auto scrollbar-thin">
            <div>
                <FileTree
                    v-for="treeItem in treeItems"
                    :key="treeItem.id"
                    :item="treeItem"
                    empty-text="No repositories"
                    :selection="repos.selectedRepoId"
                    :outline-selection="contextMenuRepoId"
                    :header-outlined="contextMenuGroupId === treeItem.id"
                    :onSelect="(r) => repos.selectRepo(r.id)"
                    :onContextMenu="(r, event) => openRepoContextMenu(r.id, event)"
                    :onHeaderContextMenu="(item, event) => openGroupContextMenu(item, event)"
                >
                    <template #header-actions>
                        <!-- <IconButton
                            severity="raised"
                            smaller
                            @click.stop="openGroupContextMenu(item, $event)"
                            icon="icon-[mdi--dots-vertical]" /> -->
                    </template>
                    <template #item-leftIcon="{ item }">
                        <span
                            class="icon text-sm"
                            :class="tasks.isOperationRunning(`runRemoteOperation:fetch-${item.id}`) ? 'icon-[mingcute--loading-fill] animate-spin' : 'icon-[mdi--source-branch]'"
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
        </div>
        <div class="mt-4 px-2">
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
        v-model:open="isRenameGroupModalOpen"
        v-model:value="renameGroupName"
        title="Rename Repository Group"
        input-label="Group name"
        submit-label="Rename"
        :can-submit="canSubmitGroupRename"
        :is-loading="isRenameGroupRunning"
        :submit="submitGroupRename"
        :close="closeRenameGroupModal"
    />

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
