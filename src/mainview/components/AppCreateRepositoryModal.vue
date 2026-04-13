<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRepos } from '../composables/useRepos';
import { tasks } from '../composables/useTasks';
import Button from './Button.vue';
import CenteredModal from './CenteredModal.vue';

const repos = useRepos();

const repositoryName = ref('');
const parentDirectory = ref('');
const selectedGroupId = ref<number>();

const destinationPathPreview = computed(() => {
    const normalizedParentDirectory = parentDirectory.value.trim().replace(/\/+$/, '');
    const normalizedRepositoryName = repositoryName.value.trim();

    if (!normalizedParentDirectory || !normalizedRepositoryName) {
        return '';
    }

    return `${normalizedParentDirectory}/${normalizedRepositoryName}`;
});
const canCreate = computed(() => Boolean(repositoryName.value.trim() && parentDirectory.value.trim()));
const isCreateRunning = computed(() => tasks.isOperationRunning('createTrackedLocalRepo'));

async function loadDefaults() {
    const defaults = await repos.getCloneRepoDefaults();
    parentDirectory.value = defaults.parentDirectory;
}

async function chooseDirectory() {
    const selectedDirectory = await repos.pickCloneRepoDirectory();
    if (selectedDirectory) {
        parentDirectory.value = selectedDirectory;
    }
}

async function submitCreate() {
    if (!canCreate.value) {
        return;
    }

    await repos.createTrackedLocalRepo({
        name: repositoryName.value,
        parentDirectory: parentDirectory.value,
        groupId: selectedGroupId.value,
    });
}

watch(
    () => repos.isCreateRepoModalOpen,
    (isOpen) => {
        if (!isOpen) {
            return;
        }

        repositoryName.value = '';
        selectedGroupId.value = undefined;
        void loadDefaults();
    },
    { immediate: true }
);
</script>

<template>
    <CenteredModal v-model:open="repos.isCreateRepoModalOpen" title="Create New Repository" content-class="max-w-2xl">
        <div class="space-y-5 px-6 py-5">
            <div class="space-y-2">
                <label class="text-sm font-medium text-white" for="create-repository-name">Repository Name</label>
                <input
                    id="create-repository-name"
                    v-model="repositoryName"
                    type="text"
                    placeholder="my-new-repository"
                    class="w-full rounded-lg border border-white/10 bg-x0 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                />
            </div>

            <div class="space-y-2">
                <label class="text-sm font-medium text-white" for="create-repository-directory">Local Path</label>
                <div class="flex gap-3">
                    <input
                        id="create-repository-directory"
                        v-model="parentDirectory"
                        type="text"
                        class="min-w-0 flex-1 rounded-lg border border-white/10 bg-x0 px-3 py-2.5 text-sm text-white outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                    />
                    <Button severity="secondary" @click="chooseDirectory"> Choose... </Button>
                </div>
                <p v-if="destinationPathPreview" class="text-xs text-x7">
                    Repository will be created at <span class="text-white">{{ destinationPathPreview }}</span>
                </p>
            </div>

            <div class="space-y-2">
                <label class="text-sm font-medium text-white" for="create-group-select">Group</label>
                <select
                    id="create-group-select"
                    v-model="selectedGroupId"
                    class="w-full rounded-lg border border-white/10 bg-x0 px-3 py-2.5 text-sm text-white outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                >
                    <option :value="undefined">No group</option>
                    <option v-for="group in repos.repoGroups" :key="group.id" :value="group.id">
                        {{ group.name }}
                    </option>
                </select>
            </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-5">
            <Button severity="light" @click="repos.isCreateRepoModalOpen = false"> Cancel </Button>
            <Button severity="primary" :disabled="!canCreate" v-loading="isCreateRunning" @click="submitCreate"> Create Repository </Button>
        </div>
    </CenteredModal>
</template>
