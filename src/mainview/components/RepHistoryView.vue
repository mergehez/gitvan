<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CommitSummary, CommitTag } from '../../shared/gitClient';
import { useContextMenu } from '../composables/useContextMenu';
import { useDiffViewer } from '../composables/useDiffViewer';
import { useRepos } from '../composables/useRepos';
import { tasks } from '../composables/useTasks';
import { readableDate } from '../lib/utils';
import CenteredInputModal from './CenteredInputModal.vue';
import ChangesFileTree from './ChangesFileTree.vue';
import DiffViewer from './DiffViewer.vue';
import EtSplitter from './EtSplitter.vue';
import FileTree, { FileTreeItem } from './FileTree.vue';
import IconButton from './IconButton.vue';
import type { ContextMenuEntry } from './contextMenuTypes';

const contextMenu = useContextMenu();
const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);
const latestCommitSha = computed(() => repo.value.history?.commits[0]?.sha ?? undefined);
const selectedCommitDiffViewerState = useDiffViewer(computed(() => repo.value.currCommitDiff));
const isCreateTagModalOpen = ref(false);
const createTagName = ref('');
const isRenameTagModalOpen = ref(false);
const renameTagName = ref('');
const renameTargetTagName = ref<string>();
const activeTagCommitSha = ref<string>();

function canAmendCommitItem(item: { id: string; isUnpushed?: boolean }) {
    return item.id === latestCommitSha.value && item.isUnpushed;
}

function canUndoCommitItem(item: { id: string; isUnpushed?: boolean }) {
    return canAmendCommitItem(item) && (repo.value.history?.commits.length ?? 0) > 1;
}

async function onAmendCommitItem(item: { id: string; isUnpushed?: boolean }) {
    if (!canAmendCommitItem(item)) {
        return;
    }

    if (repo.value.currCommitSha !== item.id) {
        await repo.value.selectCommit(item.id);
    }

    await repo.value.beginAmendSelectedCommit();
}

async function onUndoCommitItem(item: { id: string; isUnpushed?: boolean }) {
    if (!canUndoCommitItem(item)) {
        return;
    }

    if (repo.value.currCommitSha !== item.id) {
        await repo.value.selectCommit(item.id);
    }

    await repo.value.undoSelectedCommit();
}

const treeItem = computed<FileTreeItem>(() => {
    return {
        id: '-',
        title: '',
        children:
            repo.value.history?.commits.map((e) => ({
                id: e.sha,
                title: e.summary,
                shortSha: e.shortSha,
                at: new Date(e.authoredAt),
                by: e.authorName,
                tags: e.tags,
                isUnpushed: e.isUnpushed,
            })) ?? [],
    };
});

const treeItemFiles = computed<FileTreeItem>(() => {
    return {
        id: repo.value.currCommit?.sha ?? '-',
        title: 'Files',
        children:
            repo.value.currCommit?.files.map((e) => ({
                id: e.path,
                title: e.path,
                subtitle: e.previousPath,
                path: e.path,
                status: e.status,
                hadConflict: e.hadConflict,
            })) ?? [],
    };
});

function tagBadgeClass(tag: CommitTag) {
    return tag.isUnpushed ? 'border-amber-300/35 bg-amber-400/12 text-amber-100' : 'border-blue-400 bg-blue-500 text-white';
}

type CommitListItem = Pick<CommitSummary, 'shortSha' | 'tags' | 'isUnpushed'> & {
    id: string;
    title: string;
    by: string;
    at: Date;
};

function tagsForCommit(commit: CommitSummary | undefined) {
    return repo.value.editableTagsForCommit(commit);
}

async function openCreateTagModal(commit: CommitSummary) {
    activeTagCommitSha.value = commit.sha;
    createTagName.value = '';

    if (repo.value.currCommitSha !== commit.sha) {
        await repo.value.selectCommit(commit.sha);
    }

    isCreateTagModalOpen.value = true;
}

function closeCreateTagModal() {
    isCreateTagModalOpen.value = false;
    createTagName.value = '';
    activeTagCommitSha.value = undefined;
}

async function submitCreateTag() {
    const commitSha = activeTagCommitSha.value;
    const tagName = createTagName.value.trim();

    if (!commitSha || !tagName) {
        return;
    }

    await repo.value.createTag(commitSha, tagName);
    closeCreateTagModal();
}

async function openRenameTagModal(commit: CommitSummary, tagName: string) {
    activeTagCommitSha.value = commit.sha;
    renameTargetTagName.value = tagName;
    renameTagName.value = tagName;

    if (repo.value.currCommitSha !== commit.sha) {
        await repo.value.selectCommit(commit.sha);
    }

    isRenameTagModalOpen.value = true;
}

function closeRenameTagModal() {
    isRenameTagModalOpen.value = false;
    renameTargetTagName.value = undefined;
    renameTagName.value = '';
    activeTagCommitSha.value = undefined;
}

async function submitRenameTag() {
    const currentTagName = renameTargetTagName.value;
    const nextTagName = renameTagName.value.trim();

    if (!currentTagName || !nextTagName) {
        return;
    }

    await repo.value.renameTag(currentTagName, nextTagName);
    closeRenameTagModal();
}

function buildCommitContextMenuEntries(commit: CommitSummary): ContextMenuEntry[] {
    const entries: ContextMenuEntry[] = [];

    if (commit.isUnpushed) {
        entries.push({
            id: `commit-add-tag:${commit.sha}`,
            label: 'Add Tag...',
            action: async () => {
                await openCreateTagModal(commit);
            },
        });
    }

    const editableTags = tagsForCommit(commit);
    if (!editableTags.length) {
        return entries.length
            ? entries
            : [
                  {
                      id: `commit-no-tag-actions:${commit.sha}`,
                      label: 'No tag actions available',
                      disabled: true,
                  },
              ];
    }

    if (entries.length) {
        entries.push({ type: 'separator', id: `commit-tag-separator:${commit.sha}` });
    }

    entries.push({
        id: `commit-rename-tag:${commit.sha}`,
        label: editableTags.length === 1 ? 'Rename Tag...' : 'Rename Tag',
        action:
            editableTags.length === 1
                ? async () => {
                      await openRenameTagModal(commit, editableTags[0]!.name);
                  }
                : undefined,
        children:
            editableTags.length > 1
                ? editableTags.map((tag) => ({
                      id: `commit-rename-tag:${commit.sha}:${tag.name}`,
                      label: tag.name,
                      action: async () => {
                          await openRenameTagModal(commit, tag.name);
                      },
                  }))
                : undefined,
    });
    entries.push({
        id: `commit-delete-tag:${commit.sha}`,
        label: 'Delete Tag',
        danger: editableTags.length === 1,
        action:
            editableTags.length === 1
                ? async () => {
                      await repo.value.deleteTag(editableTags[0]!.name);
                  }
                : undefined,
        children:
            editableTags.length > 1
                ? editableTags.map((tag) => ({
                      id: `commit-delete-tag:${commit.sha}:${tag.name}`,
                      label: tag.name,
                      danger: true,
                      action: async () => {
                          await repo.value.deleteTag(tag.name);
                      },
                  }))
                : undefined,
    });

    return entries;
}

async function onOpenCommitContextMenu(item: CommitListItem, event?: MouseEvent) {
    if (repo.value.currCommitSha !== item.id) {
        await repo.value.selectCommit(item.id);
    }

    if (!event) {
        return;
    }

    contextMenu.openAtEvent(
        event,
        buildCommitContextMenuEntries({
            sha: item.id,
            shortSha: item.shortSha,
            summary: item.title,
            authorName: item.by,
            authorEmail: '',
            authoredAt: item.at instanceof Date ? item.at.toISOString() : String(item.at),
            refs: [],
            tags: item.tags,
            isUnpushed: item.isUnpushed,
        })
    );
}
</script>

<template>
    <p v-if="(repo.history?.commits.length ?? 0) === 0" class="text-sm text-x7">No commits found.</p>
    <EtSplitter
        class="flex-1 overflow-y-auto border border-white/10"
        base-side="left"
        default-width="250px"
        min-width="200px"
        max-width="50%"
        local-storage-key="historyCommitsSidebarWidth"
    >
        <template #left>
            <FileTree
                :item="treeItem"
                empty-text="No history found"
                item-class="px-0!"
                :selection="repo.currCommitSha"
                :onSelect="(t) => repo.selectCommit(t.id)"
                :onContextMenu="(t, event) => onOpenCommitContextMenu(t as CommitListItem, event)"
            >
                <template #item-leftIcon> </template>
                <template #item-title="{ item }">
                    <div class="flex items-center w-full pl-1">
                        <span v-if="item.isUnpushed" class="icon icon-[mdi--arrow-up-thick] text-lg opacity-70"></span>
                        <div class="w-full flex-1 pl-1">
                            <p class="text-xs font-semibold whitespace-pre-wrap break-normal wrap-anywhere leading-tight">{{ item.title }}</p>
                            <div class="flex justify-between w-full">
                                <p class="text-2xs opacity-50 tracking-tight">{{ item.by }}</p>
                                <p class="text-2xs opacity-50 tracking-tight">{{ readableDate(item.at) }}</p>
                            </div>
                        </div>
                    </div>
                </template>
                <template #item-actions="{ item }">
                    <IconButton
                        v-if="canAmendCommitItem(item)"
                        class="focus:opacity-100 p-px text-xs"
                        v-tooltip="canAmendCommitItem(item) ? 'Amend latest commit' : 'Only the latest unpushed commit can be amended'"
                        @click.stop="onAmendCommitItem(item)"
                        icon="icon-[mdi--pencil]"
                    />
                    <IconButton
                        v-if="canUndoCommitItem(item)"
                        class="focus:opacity-100 p-px text-xs"
                        v-tooltip="canUndoCommitItem(item) ? 'Undo latest commit' : 'Undo is only available for the latest unpushed commit with a parent commit'"
                        @click.stop="onUndoCommitItem(item)"
                        icon="icon-[mdi--undo]"
                    />
                </template>
                <template #item-rightIcon="{ item }">
                    <div v-if="item.tags?.length" class="flex max-w-44 flex-wrap items-center justify-end gap-1">
                        <span
                            v-for="tag in item.tags"
                            :key="tag.name"
                            class="rounded border px-1.5 py-px text-[10px] font-medium leading-none"
                            :class="tagBadgeClass(tag)"
                            :title="tag.name"
                        >
                            {{ tag.name }}
                        </span>
                    </div>
                </template>
            </FileTree>
        </template>
        <template #right>
            <p v-if="!repo.currCommit" class="text-sm text-x7">Select a commit to inspect it.</p>

            <template v-else>
                <div class="border-b border-white/10 pb-3 px-2">
                    <p class="text-xl font-semibold text-white">{{ repo.currCommit.summary }}</p>
                    <p class="text-sm opacity-50 tracking-tight">
                        {{ repo.currCommit.shortSha }} · {{ repo.currCommit.authorName }} · {{ readableDate(new Date(repo.currCommit.authoredAt)) }}
                    </p>
                </div>
                <p v-if="repo.currCommit.body" class="mt-4 whitespace-pre-wrap text-sm leading-7 text-default">{{ repo.currCommit.body }}</p>
                <div class="px-2 flex gap-2 h-full overflow-auto">
                    <EtSplitter
                        class="flex-1 overflow-y-auto scrollbar-thin"
                        base-side="left"
                        default-width="250px"
                        min-width="200px"
                        max-width="50%"
                        local-storage-key="historyCommitFilesSidebarWidth"
                    >
                        <template #left>
                            <ChangesFileTree
                                class="w-full shrink-0"
                                :item="treeItemFiles"
                                empty-text="No files"
                                :selection="repo.currCommitFilePath ?? undefined"
                                show-path-tooltip
                                no-actions
                                :onSelect="(t) => t.path && repo.selectCommitFile(t.path)"
                            >
                                <template #before-status="{ item }">
                                    <span v-if="item.hadConflict" class="icon icon-[mingcute--git-merge-fill] text-[11px] text-amber-300" v-tooltip="'Had merge conflicts'"></span>
                                </template>
                            </ChangesFileTree>
                        </template>
                        <template #right>
                            <DiffViewer v-if="repo.currCommitDiff" :state="selectedCommitDiffViewerState"> </DiffViewer>
                            <i v-else></i>
                        </template>
                    </EtSplitter>
                </div>
            </template>
        </template>
    </EtSplitter>
    <CenteredInputModal
        v-model:open="isCreateTagModalOpen"
        v-model:value="createTagName"
        title="Add Tag"
        input-label="Tag name"
        :can-submit="Boolean(createTagName.trim()) && !tasks.isOperationRunning('createTag')"
        :is-loading="tasks.isOperationRunning('createTag')"
        submit-label="Create Tag"
        :submit="submitCreateTag"
        :close="closeCreateTagModal"
    />
    <CenteredInputModal
        v-model:open="isRenameTagModalOpen"
        v-model:value="renameTagName"
        title="Rename Tag"
        input-label="Tag name"
        :can-submit="Boolean(renameTagName.trim()) && renameTagName.trim() !== renameTargetTagName && !tasks.isOperationRunning('renameTag')"
        :is-loading="tasks.isOperationRunning('renameTag')"
        submit-label="Rename Tag"
        :submit="submitRenameTag"
        :close="closeRenameTagModal"
    />
</template>
