<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TagSummary } from '../../shared/types.ts';
import { useRepos } from '../composables/useRepos';
import { useCreateTag, useRenameTag } from '../composables/useTagEditor';
import { toast } from '../composables/useToast';
import type { ContextMenuEntry } from '../directives';
import { writeClipboardText } from '../lib/nativePaths';
import { readableDate } from '../lib/utils';
import CenteredInputModal from './CenteredInputModal.vue';
import CommitInspectPane from './CommitInspectPane.vue';
import CreateTagModal from './CreateTagModal.vue';
import EtSplitter from './EtSplitter.vue';
import type { FileTreeItem } from './FileTree.vue';
import FileTree from './FileTree.vue';
import IconButton from './IconButton.vue';

type TagListItem = TagSummary & {
    id: string;
    title: string;
    subtitle: string;
};

type TagSortMode = 'recent' | 'name';

const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);
const createTag = useCreateTag();
const renameTag = useRenameTag();
const search = ref('');
const sortMode = ref<TagSortMode>('recent');

const selectedTag = computed(() => repo.value.selectedTag());
const loadedTags = computed(() => repo.value.tags?.tags ?? []);
const visibleTags = computed(() => {
    const query = search.value.trim().toLowerCase();
    const tags = query
        ? loadedTags.value.filter((tag) => tag.name.toLowerCase().includes(query) || tag.commitSummary.toLowerCase().includes(query) || tag.shortSha.toLowerCase().includes(query))
        : [...loadedTags.value];

    if (sortMode.value === 'name') {
        tags.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    }

    return tags;
});

const treeItem = computed<FileTreeItem<TagListItem, {}>>(() => ({
    id: 'tags',
    title: 'Tags',
    children: visibleTags.value.map((tag) => ({
        id: tag.name,
        title: tag.name,
        subtitle: tag.commitSummary,
        ...tag,
    })),
}));

const tagsEmptyText = computed(() => {
    if (repo.value.isLoadingTags) {
        return 'Loading tags...';
    }

    return loadedTags.value.length === 0 ? 'No tags yet' : 'No tags match your search';
});

const selectedTagCreatedAt = computed(() => {
    const createdAt = selectedTag.value?.createdAt;

    return createdAt ? readableDate(new Date(createdAt)) : '';
});

function openCreateTag() {
    createTag.open({ sha: 'HEAD', label: `HEAD · ${repo.value.status.branch ?? 'detached HEAD'}` });
}

function buildTagsHeaderContextMenuEntries(): ContextMenuEntry[] {
    return [
        {
            id: 'tags-sort-recent',
            label: 'Sort by Newest',
            checked: sortMode.value === 'recent',
            action: () => {
                sortMode.value = 'recent';
            },
        },
        {
            id: 'tags-sort-name',
            label: 'Sort by Name',
            checked: sortMode.value === 'name',
            action: () => {
                sortMode.value = 'name';
            },
        },
        { type: 'separator', id: 'tags-header-separator' },
        {
            id: 'tags-push-all',
            label: 'Push All Tags',
            disabled: !repo.value.status.hasRemote,
            action: async () => {
                await repo.value.pushAllTags();
            },
        },
        {
            id: 'tags-refresh',
            label: 'Refresh',
            action: async () => {
                await repo.value.loadTags();
            },
        },
    ];
}

function buildTagContextMenuEntries(item: TagListItem): ContextMenuEntry[] {
    const hasRemote = repo.value.status.hasRemote;

    return [
        {
            id: `tag-copy-name:${item.name}`,
            label: 'Copy Tag Name',
            action: async () => {
                await writeClipboardText(item.name);
                toast.showSuccessToast('Tag name copied.');
            },
        },
        { type: 'separator', id: `tag-separator-remote:${item.name}` },
        {
            id: `tag-push:${item.name}`,
            label: 'Push Tag',
            disabled: !hasRemote,
            action: async () => {
                await repo.value.pushTag(item.name);
            },
        },
        {
            id: `tag-delete-remote:${item.name}`,
            label: 'Delete Tag on Remote',
            danger: true,
            disabled: !hasRemote,
            action: async () => {
                await repo.value.deleteRemoteTag(item.name);
            },
        },
        { type: 'separator', id: `tag-separator-local:${item.name}` },
        {
            id: `tag-rename:${item.name}`,
            label: 'Rename Tag...',
            action: () => {
                renameTag.open(item.name);
            },
        },
        {
            id: `tag-delete:${item.name}`,
            label: 'Delete Tag',
            danger: true,
            action: async () => {
                await repo.value.deleteTag(item.name);
            },
        },
    ];
}
</script>

<template>
    <EtSplitter class="flex-1 overflow-y-auto border border-white/10" base-side="left" default-width="250px" min-width="200px" max-width="50%" local-storage-key="tagsSidebarWidth">
        <template #left>
            <div class="sticky top-0 z-10 flex items-center gap-2 bg-x0 px-2 py-1.5">
                <input
                    v-model="search"
                    type="search"
                    placeholder="Search tags..."
                    data-testid="tags-search"
                    class="min-w-0 flex-1 rounded-lg border border-x5 bg-x0 px-2 py-1 text-xs text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                    @keydown.escape="search = ''"
                />
            </div>

            <FileTree
                :item="treeItem"
                :empty-text="tagsEmptyText"
                item-class="px-0!"
                :selection="repo.selectedTagName"
                :onSelect="(item) => repo.selectTag(item.id)"
                :getContextMenuItems="buildTagContextMenuEntries"
                :getHeaderContextMenuItems="buildTagsHeaderContextMenuEntries"
                noActions
            >
                <template #header-actions>
                    <IconButton severity="raised" smaller data-testid="tags-create" icon="icon-[mdi--tag-plus-outline]" v-tooltip="'New tag at HEAD'" @click="openCreateTag" />
                </template>
                <template #item-leftIcon>
                    <span class="icon icon-[mdi--tag-outline] shrink-0 text-sm opacity-60"></span>
                </template>
                <template #item-title="{ item }">
                    <div class="flex w-full min-w-0 flex-col py-0.5">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <p class="truncate text-xs font-semibold leading-tight">{{ item.title }}</p>
                            <span v-if="item.isAnnotated" class="shrink-0 rounded border border-white/15 bg-white/8 px-1 py-px text-[10px] font-medium leading-none opacity-70">
                                annotated
                            </span>
                            <span
                                v-if="item.isTargetUnpushed"
                                class="shrink-0 rounded border border-amber-300/35 bg-amber-400/12 px-1 py-px text-[10px] font-medium leading-none text-amber-100"
                                v-tooltip="'The tagged commit has not been pushed yet'"
                            >
                                unpushed
                            </span>
                        </div>
                        <p class="truncate text-2xs tracking-tight opacity-50">{{ item.shortSha }} · {{ item.subtitle }}</p>
                    </div>
                </template>
                <template #item-rightIcon="{ item }">
                    <p class="shrink-0 text-2xs tracking-tight opacity-50">{{ item.createdAt ? readableDate(new Date(item.createdAt)).replace(' at ', ' ') : '' }}</p>
                </template>
            </FileTree>
        </template>

        <template #right>
            <div v-if="selectedTag" class="border-b border-white/10 px-2 pb-3">
                <div class="flex items-center gap-2">
                    <span class="icon icon-[mdi--tag] text-lg opacity-70"></span>
                    <p class="text-xl font-semibold text-white" data-testid="selected-tag-name">{{ selectedTag.name }}</p>
                    <span v-if="selectedTag.isAnnotated" class="rounded border border-white/15 bg-white/8 px-1.5 py-px text-[10px] font-medium leading-none opacity-70">
                        annotated
                    </span>
                    <span
                        v-if="selectedTag.isTargetUnpushed"
                        class="rounded border border-amber-300/35 bg-amber-400/12 px-1.5 py-px text-[10px] font-medium leading-none text-amber-100"
                    >
                        unpushed
                    </span>
                </div>
                <p v-if="selectedTag.message" class="mt-1 whitespace-pre-wrap text-sm leading-6 text-default">{{ selectedTag.message }}</p>
                <p class="mt-1 text-2xs opacity-50">
                    Created {{ selectedTagCreatedAt }}
                    <span v-if="selectedTag.taggerName"> by {{ selectedTag.taggerName }}</span>
                </p>
            </div>

            <CommitInspectPane
                :commit="repo.currCommit"
                :diff="repo.currCommitDiff"
                :selected-file-path="repo.currCommitFilePath"
                sort-storage-key="tag-commit-files"
                local-storage-key-prefix="tagCommit"
                empty-text="Select a tag to inspect its commit."
                :on-select-file="(path) => repo.selectCommitFile(path)"
            />
        </template>
    </EtSplitter>

    <CreateTagModal
        v-model:open="createTag.isOpen"
        v-model:name="createTag.name"
        v-model:message="createTag.message"
        :target-label="createTag.target?.label ?? ''"
        :can-submit="createTag.canSubmit"
        :is-loading="createTag.isLoading"
        :submit="createTag.submit"
        :close="createTag.close"
    />
    <CenteredInputModal
        v-model:open="renameTag.isOpen"
        v-model:value="renameTag.nextTagName"
        title="Rename Tag"
        input-label="Tag name"
        :can-submit="renameTag.canSubmit"
        :is-loading="renameTag.isLoading"
        submit-label="Rename Tag"
        :submit="renameTag.submit"
        :close="renameTag.close"
    />
</template>
