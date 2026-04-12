<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRepos } from '../composables/useRepos';
import { tasks } from '../composables/useTasks';
import Alert from './Alert.vue';
import Button from './Button.vue';
import DraggableList from './DraggableList.vue';
import Icon from './Icon.vue';
import IconButton from './IconButton.vue';

type GroupSelection = 'create' | `group:${number}`;

const repos = useRepos();
const selectedGroup = ref<GroupSelection>('create');
const newGroupName = ref('');
const selectedRepositoryIds = ref<number[]>([]);

const repositories = computed(() => {
    return [...repos.repos].sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name));
});

const groups = computed(() => repos.repoGroups);
const activeGroupIndex = computed(() => groups.value.findIndex((group) => group.id === selectedGroupId.value));

const isCreateMode = computed(() => selectedGroup.value === 'create');
const selectedGroupId = computed<number | undefined>(() => {
    if (selectedGroup.value === 'create') {
        return undefined;
    }

    return Number(selectedGroup.value.replace('group:', ''));
});

const activeGroup = computed(() => {
    if (selectedGroupId.value === undefined) {
        return undefined;
    }

    return groups.value.find((group) => group.id === selectedGroupId.value);
});

const activeGroupName = computed(() => {
    if (selectedGroup.value === 'create') {
        return newGroupName.value.trim();
    }

    return activeGroup.value?.name ?? '';
});

const activeGroupRepositoryIds = computed(() => {
    const groupId = selectedGroupId.value;
    if (groupId === undefined) {
        return [];
    }

    return repositories.value
        .filter((r) => r.groupId === groupId)
        .map((repository) => repository.id)
        .sort((left, right) => left - right);
});

const selectedRepositoryIdSet = computed(() => new Set(selectedRepositoryIds.value));
const hasPendingChanges = computed(() => {
    if (isCreateMode.value) {
        return activeGroupName.value.length > 0;
    }

    if ((activeGroup.value?.name ?? '') !== newGroupName.value.trim()) {
        return newGroupName.value.trim().length > 0;
    }

    if (selectedRepositoryIds.value.length !== activeGroupRepositoryIds.value.length) {
        return true;
    }

    const activeIds = new Set(activeGroupRepositoryIds.value);
    return selectedRepositoryIds.value.some((repositoryId) => !activeIds.has(repositoryId));
});

const canSave = computed(() => activeGroupName.value.length > 0 && hasPendingChanges.value);
const saveLabel = computed(() => (isCreateMode.value ? 'Create group' : 'Save changes'));

function resetDraftFromSelection() {
    if (selectedGroup.value === 'create') {
        newGroupName.value = '';
        selectedRepositoryIds.value = [];
        return;
    }

    newGroupName.value = activeGroup.value?.name ?? '';
    selectedRepositoryIds.value = repositories.value.filter((repository) => repository.groupId === selectedGroupId.value).map((repository) => repository.id);
}

watch(
    groups,
    (nextGroups) => {
        if (selectedGroup.value === 'create') {
            return;
        }

        if (!nextGroups.some((group) => group.id === selectedGroupId.value)) {
            selectedGroup.value = nextGroups[0] ? `group:${nextGroups[0].id}` : 'create';
        }
    },
    { immediate: true },
);

watch(
    () => selectedGroup.value,
    () => {
        resetDraftFromSelection();
    },
    { immediate: true },
);

watch(
    () => [activeGroup.value?.name, activeGroupRepositoryIds.value.join(','), repositories.value.length],
    () => {
        if (hasPendingChanges.value) {
            return;
        }

        resetDraftFromSelection();
    },
);

function openCreateGroup() {
    selectedGroup.value = 'create';
}

function openExistingGroup(groupId: number) {
    selectedGroup.value = `group:${groupId}`;
}

async function moveActiveGroup(direction: 'up' | 'down') {
    if (selectedGroupId.value === undefined) {
        return;
    }

    await repos.moveRepoGroup(selectedGroupId.value, direction);
}

async function deleteActiveGroup() {
    if (selectedGroupId.value === undefined) {
        return;
    }

    await repos.deleteRepoGroup(selectedGroupId.value);
}

async function reorderRepositories({ item, fromIndex, toIndex }: { item: { id: number }; fromIndex: number; toIndex: number }) {
    if (tasks.isBusy || fromIndex === toIndex) {
        return;
    }

    await repos.reorderRepo(item.id, toIndex);
}

function toggleRepository(repositoryId: number, checked: boolean) {
    const nextIds = new Set(selectedRepositoryIds.value);

    if (checked) {
        nextIds.add(repositoryId);
    } else {
        nextIds.delete(repositoryId);
    }

    selectedRepositoryIds.value = Array.from(nextIds).sort((left, right) => left - right);
}

async function saveGroup() {
    if (isCreateMode.value) {
        const targetGroupName = activeGroupName.value;
        if (!targetGroupName) {
            return;
        }

        const createdGroup = await repos.createRepoGroup(targetGroupName);
        if (createdGroup) {
            selectedGroup.value = `group:${createdGroup.id}`;
        }
        return;
    }

    const targetGroupId = selectedGroupId.value;
    if (targetGroupId === undefined) {
        return;
    }

    const targetGroupName = newGroupName.value.trim();
    const renamedGroup = targetGroupName !== (activeGroup.value?.name ?? '');

    if (renamedGroup) {
        await repos.renameRepoGroup(targetGroupId, targetGroupName);
    }

    const selectedIds = selectedRepositoryIdSet.value;
    const updates = repositories.value
        .map((repo) => {
            const nextGroupId = selectedIds.has(repo.id) ? targetGroupId : repo.groupId === targetGroupId ? undefined : repo.groupId;

            if (nextGroupId === repo.groupId) {
                return undefined;
            }

            return {
                repoId: repo.id,
                groupId: nextGroupId,
            };
        })
        .filter((update) => update !== undefined);

    if (!updates.length) {
        return;
    }

    await repos.updateRepoGroups(updates, `Group ${targetGroupName} updated.`);
}

const repositoriesForList = computed(() => {
    return repositories.value.map((repository) => ({
        id: repository.id,
        title: repository.name,
        subtitle: repository.path,
        groupId: repository.groupId,
        groupName: repository.groupName?.trim() ?? '',
    }));
});

function isSelected(repositoryId: number) {
    return selectedRepositoryIdSet.value.has(repositoryId);
}
</script>

<template>
    <div class="grid flex-1 grid-cols-[250px_1fr] bg-x1 overflow-auto">
        <aside class="flex flex-col py-4">
            <div class="flex items-center gap-3 pb-3">
                <h1 class="text-xl font-semibold text-white">Groups</h1>
                <IconButton severity="secondary" @click="openCreateGroup" icon="icon-[mdi--plus]" />
            </div>

            <div v-if="groups.length === 0" class="rounded-lg border border-dashed border-white/10 px-4 py-4 text-sm text-x7">No groups created yet.</div>

            <div class="min-h-0 overflow-auto flex flex-col border border-x3">
                <Button
                    v-for="group in groups"
                    :key="group.id"
                    as="div"
                    class="justify-start rounded-none px-0"
                    :severity="selectedGroup === `group:${group.id}` ? 'light' : 'secondary'"
                >
                    <div class="flex w-full items-center gap-1 px-2 py-1">
                        <button type="button" :aria-label="`Open group ${group.name}`" class="min-w-0 flex-1 text-left" @click="openExistingGroup(group.id)">
                            <div class="flex flex-col items-start">
                                <p class="text-sm font-medium text-white">{{ group.name }}</p>
                                <p class="mt-1 text-xs tracking-[0.12em] opacity-30">{{ group.repoCount }} repositories</p>
                            </div>
                        </button>
                        <div class="flex items-center gap-1">
                            <IconButton
                                smaller
                                :disabled="tasks.isBusy || group.sequence <= 1"
                                :aria-label="`Move ${group.name} up`"
                                @click="repos.moveRepoGroup(group.id, 'up')"
                                icon="icon-[mdi--arrow-up]"
                            />
                            <IconButton
                                smaller
                                :disabled="tasks.isBusy || group.sequence >= groups.length"
                                :aria-label="`Move ${group.name} down`"
                                @click="repos.moveRepoGroup(group.id, 'down')"
                                icon="icon-[mdi--arrow-down]"
                            />
                        </div>
                    </div>
                </Button>
            </div>
        </aside>

        <main class="overflow-auto h-full py-4 px-3 border-l border-x4 ml-2 flex flex-col">
            <div class="flex items-center gap-1 overflow-auto">
                <h2 class="text-xl font-semibold text-white flex-1">
                    {{ isCreateMode ? 'New group' : activeGroupName }}
                </h2>

                <div v-if="!isCreateMode && activeGroup" class="flex items-center justify-end gap-1">
                    <Button severity="secondary" small :disabled="tasks.isBusy || activeGroupIndex <= 0" @click="moveActiveGroup('up')">
                        <span class="icon icon-[mdi--arrow-up] mr-1"></span>
                        Move up
                    </Button>
                    <Button severity="secondary" small :disabled="tasks.isBusy || activeGroupIndex < 0 || activeGroupIndex >= groups.length - 1" @click="moveActiveGroup('down')">
                        <span class="icon icon-[mdi--arrow-down] mr-1"></span>
                        Move down
                    </Button>
                    <Button severity="danger" small :disabled="tasks.isBusy" @click="deleteActiveGroup">
                        <span class="icon icon-[mingcute--delete-2-fill] mr-1"></span>
                        Delete
                    </Button>
                </div>
                <Button severity="primary" :disabled="tasks.isBusy || !canSave" @click="saveGroup">
                    {{ saveLabel }}
                </Button>
            </div>

            <div class="mt-4 flex flex-col flex-1 overflow-auto">
                <div>
                    <label class="block text-xs font-semibold uppercase opacity-60"> Group name </label>
                    <input
                        v-model="newGroupName"
                        type="text"
                        placeholder="Frontend apps"
                        class="mt-1 w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                </div>

                <div class="flex flex-col overflow-auto mt-2 py-2 px-1 relative">
                    <div class="flex items-center justify-between gap-3">
                        <p class="text-xs font-semibold uppercase opacity-60">Repositories</p>
                        <p class="text-xs opacity-60">{{ selectedRepositoryIds.length }} selected</p>
                    </div>

                    <div v-if="repositories.length === 0" class="rounded-lg border border-dashed border-white/10 px-4 py-4 text-sm text-x7">No repositories added yet.</div>
                    <DraggableList
                        v-else
                        class="flex-1 mt-3 w-full border border-white/10"
                        :items="repositoriesForList"
                        empty-text="No repositories added yet."
                        item-class="border-b border-white/10 last:border-0"
                        :disabled="tasks.isBusy || isCreateMode"
                        :onSelect="(repository) => toggleRepository(repository.id, !selectedRepositoryIdSet.has(repository.id))"
                        :onReorder="reorderRepositories"
                    >
                        <template #item-leftIcon="{ item }">
                            <Icon
                                :icon="isSelected(item.id) ? 'icon-[mdi--checkbox-marked]' : 'icon-[mdi--checkbox-blank-outline]'"
                                :class="isSelected(item.id) ? 'text-green-500' : ''"
                            />
                        </template>
                        <template #item-title="{ item }">
                            <div class="flex items-center gap-2">
                                <p class="truncate font-medium" :class="{ ' text-green-500': isSelected(item.id) }">{{ item.title }}</p>
                            </div>
                        </template>
                        <template #item-rightIcon="{ item }">
                            <div class="flex items-center gap-1">
                                <Alert severity="secondary" class="px-1 py-0 text-xs" v-if="item.groupName && item.groupName !== activeGroupName">
                                    {{ item.groupName }}
                                </Alert>
                            </div>
                        </template>
                    </DraggableList>

                    <div v-if="isCreateMode" class="absolute inset-0 grid place-items-center bg-x0/80 pointer-events-none">
                        <p class="text-yellow-500">Create the group first, then add repositories to it.</p>
                    </div>
                </div>
            </div>
        </main>
    </div>
</template>
