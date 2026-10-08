<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CommitSummary, CommitTag } from '../../shared/types.ts';
import { useDiffViewer } from '../composables/useDiffViewer';
import { useFileHistory } from '../composables/useFileHistory';
import { useFileSort } from '../composables/useFileSort';
import { useRepos } from '../composables/useRepos';
import { tasks } from '../composables/useTasks';
import type { ContextMenuEntry } from '../directives';
import { buildFileSortMenuEntries, sortFilesByMode } from '../lib/fileSort';
import { authorColor } from '../lib/authorColors';
import { readableDate } from '../lib/utils';
import CenteredInputModal from './CenteredInputModal.vue';
import ChangesFileTree from './ChangesFileTree.vue';
import DiffViewer from './DiffViewer.vue';
import EtSplitter from './EtSplitter.vue';
import type { FileTreeItem } from './FileTree.vue';
import FileTree from './FileTree.vue';
import IconButton from './IconButton.vue';

const HISTORY_SEARCH_DEBOUNCE_MS = 500;

const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);
const { openFileHistory } = useFileHistory();
const historyFilesSort = useFileSort('history-files');
// Kept in sync with the repo so switching views does not drop an active search.
const historySearch = ref(repo.value.historySearchQuery);
const trimmedHistorySearch = computed(() => historySearch.value.trim());
const isHistorySearching = computed(() => trimmedHistorySearch.value.length > 0);
const isFileHistoryActive = computed(() => Boolean(repo.value.fileHistoryPath));
const isHistorySearchPending = computed(() => isHistorySearching.value && trimmedHistorySearch.value !== repo.value.historySearchQuery);
const isHistorySearchLoading = computed(() => isHistorySearching.value && (repo.value.isSearchingHistory || isHistorySearchPending.value));
const displayedHistoryCommits = computed(() => {
    if (isFileHistoryActive.value) {
        return repo.value.fileHistoryResults?.commits ?? [];
    }

    return isHistorySearching.value ? (repo.value.historySearchResults?.commits ?? []) : (repo.value.history?.commits ?? []);
});
const displayedHistoryHasMore = computed(() => {
    if (isFileHistoryActive.value) {
        return Boolean(repo.value.fileHistoryResults?.hasMore);
    }

    return isHistorySearching.value ? Boolean(repo.value.historySearchResults?.hasMore) : Boolean(repo.value.history?.hasMore);
});
const isLoadingMoreDisplayedHistory = computed(() => {
    if (isFileHistoryActive.value) {
        return repo.value.isLoadingMoreFileHistory;
    }

    return isHistorySearching.value ? repo.value.isLoadingMoreHistorySearch : repo.value.isLoadingMoreHistory;
});
const historyEmptyText = computed(() => {
    if (isFileHistoryActive.value) {
        return repo.value.isLoadingFileHistory ? 'Loading file history...' : 'No commits touched this file';
    }

    if (!isHistorySearching.value) {
        return 'No history found';
    }

    return isHistorySearchLoading.value ? 'Searching...' : 'No commits match your search';
});
const historyLoadMoreLabel = computed(() => (isHistorySearching.value && !isFileHistoryActive.value ? 'Load more results' : 'Load more commits'));
const historySearchStatusLabel = computed(() => {
    if (isHistorySearchLoading.value) {
        return 'Searching...';
    }

    const count = displayedHistoryCommits.value.length;
    const hasMore = displayedHistoryHasMore.value;

    return `${count}${hasMore ? '+' : ''} result${!hasMore && count === 1 ? '' : 's'}`;
});

let historySearchDebounceHandle: number | undefined;

function onHistorySearchInput() {
    if (historySearchDebounceHandle !== undefined) {
        window.clearTimeout(historySearchDebounceHandle);
        historySearchDebounceHandle = undefined;
    }

    const query = trimmedHistorySearch.value;

    if (!query) {
        const hadSearch = Boolean(repo.value.historySearchQuery);
        repo.value.clearHistorySearch();

        if (hadSearch) {
            void repo.value.loadHistory();
        }

        return;
    }

    historySearchDebounceHandle = window.setTimeout(() => {
        historySearchDebounceHandle = undefined;
        void repo.value.searchHistory(query);
    }, HISTORY_SEARCH_DEBOUNCE_MS);
}

watch(historySearch, onHistorySearchInput);

onBeforeUnmount(() => {
    if (historySearchDebounceHandle !== undefined) {
        window.clearTimeout(historySearchDebounceHandle);
        historySearchDebounceHandle = undefined;
    }
});

async function onLoadMoreHistory() {
    if (isFileHistoryActive.value) {
        await repo.value.loadMoreFileHistory();
        return;
    }

    if (isHistorySearching.value) {
        await repo.value.loadMoreHistorySearch();
        return;
    }

    await repo.value.loadMoreHistory();
}

async function onSelectCommitRow(item: { id: string }) {
    if (isFileHistoryActive.value) {
        await repo.value.selectFileHistoryCommit(item.id);
        return;
    }

    await repo.value.selectCommit(item.id);
}

function closeFileHistory() {
    const wasSearching = Boolean(repo.value.historySearchQuery);
    repo.value.closeFileHistory();

    // An active search already has results to show; otherwise the recent-commit page was
    // skipped while the file history was pinned, so reload it.
    if (!wasSearching) {
        void repo.value.loadHistory();
    }
}

function buildHistoryFileContextMenuEntries(item: { path?: string; title: string }): ContextMenuEntry[] {
    const path = item.path ?? item.title;

    return [
        {
            id: `history-file-history:${path}`,
            label: 'File History',
            action: async () => {
                await openFileHistory(path);
            },
        },
    ];
}

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

type CommitListItem = Pick<CommitSummary, 'shortSha' | 'tags' | 'isUnpushed'> & {
    id: string;
    title: string;
    authorName: string;
    authorEmail: string;
    authorColor: string;
    at: Date;
};
const treeItem = computed<FileTreeItem<CommitListItem, {}>>(() => {
    return {
        id: '-',
        title: '',
        children: displayedHistoryCommits.value.map((e) => ({
            id: e.sha,
            title: e.summary,
            shortSha: e.shortSha,
            at: new Date(e.authoredAt),
            authorName: e.authorName,
            authorEmail: e.authorEmail,
            // Keyed on the email so a renamed display name keeps its colour.
            authorColor: authorColor(e.authorEmail || e.authorName),
            tags: e.tags,
            isUnpushed: e.isUnpushed,
        })),
    };
});

const treeItemFiles = computed<FileTreeItem<{ status: string; hadConflict?: boolean }, {}>>(() => {
    return {
        id: repo.value.currCommit?.sha ?? '-',
        title: 'Files',
        children: sortFilesByMode(
            repo.value.currCommit?.files.map((e) => ({
                id: e.path,
                title: e.path,
                subtitle: e.previousPath,
                path: e.path,
                status: e.status,
                hadConflict: e.hadConflict,
            })) ?? [],
            historyFilesSort.mode.value
        ),
    };
});

function buildHistoryFilesHeaderContextMenuEntries(): ContextMenuEntry[] {
    return buildFileSortMenuEntries(historyFilesSort.mode.value, (mode) => historyFilesSort.setMode(mode), 'history-files-sort');
}

function tagBadgeClass(tag: CommitTag) {
    return tag.isUnpushed ? 'border-amber-300/35 bg-amber-400/12 text-amber-100' : 'border-blue-400 bg-blue-500 text-white';
}

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

function buildCommitContextMenuEntries(item: CommitListItem): ContextMenuEntry[] {
    const commit = {
        sha: item.id,
        shortSha: item.shortSha,
        summary: item.title,
        authorName: item.by,
        authorEmail: '',
        authoredAt: item.at instanceof Date ? item.at.toISOString() : String(item.at),
        refs: [],
        tags: item.tags,
        isUnpushed: item.isUnpushed,
    };
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
            <div v-if="isFileHistoryActive" class="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-x0 px-2 py-1.5" data-testid="file-history-header">
                <button
                    type="button"
                    data-testid="file-history-back"
                    class="flex shrink-0 items-center gap-1 rounded border border-x5 bg-x1 px-1.5 py-0.5 text-2xs transition hover:bg-white/6"
                    @click="closeFileHistory"
                >
                    <span class="icon icon-[mdi--arrow-left]"></span>
                    All commits
                </button>
                <button
                    v-if="!repo.fileHistoryFollowRenames || repo.isIncludingFileHistoryRenames"
                    type="button"
                    data-testid="file-history-include-renames"
                    class="shrink-0 rounded border border-x5 bg-x1 px-1.5 py-0.5 text-2xs transition hover:bg-white/6 disabled:opacity-50"
                    :disabled="repo.isIncludingFileHistoryRenames"
                    v-tooltip="'Also follow this file across renames (might be slow)'"
                    @click="repo.includeFileHistoryRenames()"
                >
                    {{ repo.isIncludingFileHistoryRenames ? 'Including renames...' : 'Include renames' }}
                </button>
                <span
                    v-else
                    class="shrink-0 rounded border border-amber-300/35 bg-amber-400/12 px-1.5 py-px text-[10px] font-medium leading-none text-amber-100"
                    v-tooltip="'Following renames across the whole history'"
                >
                    renames
                </span>
                <p class="min-w-0 flex-1 truncate text-2xs opacity-70" :title="repo.fileHistoryPath">{{ repo.fileHistoryPath }}</p>
            </div>
            <div v-else class="sticky top-0 z-10 flex items-center gap-2 bg-x0 px-2 py-1.5">
                <input
                    v-model="historySearch"
                    type="search"
                    placeholder="Search commits..."
                    data-testid="history-search"
                    class="min-w-0 flex-1 rounded-lg border border-x5 bg-x0 px-2 py-1 text-xs text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                    @keydown.escape="historySearch = ''"
                />
                <span v-if="isHistorySearching" class="shrink-0 text-2xs tracking-tight opacity-60">{{ historySearchStatusLabel }}</span>
            </div>
            <FileTree
                :item="treeItem"
                :empty-text="historyEmptyText"
                item-class="px-0!"
                :selection="repo.currCommitSha"
                :onSelect="(t) => onSelectCommitRow(t)"
                :get-context-menu-items="buildCommitContextMenuEntries"
                noActions
            >
                <template #item-leftIcon> </template>
                <template #item-title="{ item, index }">
                    <div class="relative flex items-center w-full pl-1 border-t border-x2 py-1" :class="index % 2 == 0 ? '' : ''">
                        <span v-if="item.isUnpushed" class="icon icon-[mdi--arrow-up-thick] text-lg opacity-70"></span>
                        <div class="w-full flex-1 pl-1">
                            <p class="text-xs font-semibold whitespace-pre-wrap break-normal wrap-anywhere leading-tight">{{ item.title }}</p>
                            <div class="flex w-full items-center justify-between gap-2">
                                <p class="flex min-w-0 items-center gap-1 text-2xs tracking-tight">
                                    <span class="truncate" :style="{ color: item.authorColor }">{{ item.authorName }}</span>
                                    <span class="truncate opacity-45">&lt;{{ item.authorEmail }}&gt;</span>
                                </p>
                                <p class="shrink-0 text-2xs tracking-tight opacity-80">{{ readableDate(item.at).replace(' at ', ' ') }}</p>
                            </div>
                        </div>
                        <div class="absolute top-0 right-1 min-w-0 items-center justify-end gap-1 hidden group-hover:flex">
                            <IconButton
                                v-if="canAmendCommitItem(item)"
                                severity="info"
                                class="focus:opacity-100 p-px text-xs"
                                v-tooltip="canAmendCommitItem(item) ? 'Amend latest commit' : 'Only the latest unpushed commit can be amended'"
                                @click.stop="onAmendCommitItem(item)"
                                icon="icon-[mdi--pencil]"
                            />
                            <IconButton
                                v-if="canUndoCommitItem(item)"
                                severity="info"
                                class="focus:opacity-100 p-px text-xs"
                                v-tooltip="canUndoCommitItem(item) ? 'Undo latest commit' : 'Undo is only available for the latest unpushed commit with a parent commit'"
                                @click.stop="onUndoCommitItem(item)"
                                icon="icon-[mdi--undo]"
                            />
                        </div>
                    </div>
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
                <template #footer>
                    <div v-if="displayedHistoryHasMore || isLoadingMoreDisplayedHistory" class="px-4 py-2" data-testid="history-load-more">
                        <button
                            type="button"
                            class="rounded border border-x5 bg-x1 px-2 py-1 text-2xs transition hover:bg-white/6 disabled:opacity-50"
                            :disabled="isLoadingMoreDisplayedHistory"
                            @click="onLoadMoreHistory"
                        >
                            {{ isLoadingMoreDisplayedHistory ? 'Loading...' : historyLoadMoreLabel }}
                        </button>
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
                        {{ repo.currCommit.shortSha }} · {{ repo.currCommit.authorName }} <{{ repo.currCommit.authorEmail }}> ·
                        {{ readableDate(new Date(repo.currCommit.authoredAt)) }}
                    </p>
                </div>
                <p v-if="repo.currCommit.body" class="mt-1 px-2 whitespace-pre-wrap text-sm leading-7 text-default max-h-30 overflow-y-auto bg-x1">{{ repo.currCommit.body }}</p>
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
                                :getContextMenuItems="buildHistoryFileContextMenuEntries"
                                :getHeaderContextMenuItems="buildHistoryFilesHeaderContextMenuEntries"
                            >
                                <template #before-status="{ item }">
                                    <span
                                        v-if="(item as any).hadConflict"
                                        class="icon icon-[mingcute--git-merge-fill] text-[11px] text-amber-300"
                                        v-tooltip="'Had merge conflicts'"
                                    ></span>
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
