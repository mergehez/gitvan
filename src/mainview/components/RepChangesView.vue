<script setup lang="ts">
import DiffViewer from './DiffViewer.vue';
import ChangesFileTree from './ChangesFileTree.vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { tasks } from '../composables/useTasks';
import Button from './Button.vue';
import FileTree, { FileTreeItem } from './FileTree.vue';
import { ChangeStatus, type ChangeFileContextMenuAction, type ChangeFileContextMenuIgnoreOption, type ChangeFileContextMenuOptions } from '../../shared/gitClient';
import Alert from './Alert.vue';
import EtSplitter from './EtSplitter.vue';
import { useDiffViewer } from '../composables/useDiffViewer';
import { useMergeHelper } from '../composables/useMerge';
import { useRepos } from '../composables/useRepos';
import IconButton from './IconButton.vue';
import { gitClientRpc } from '../lib/gitClient';

const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);
const mergeState = useMergeHelper();

const showDescription = ref(false);
const selectedStagedIds = ref<string[]>([]);
const selectedUnstagedIds = ref<string[]>([]);
const selectionAnchorIds = ref<Partial<Record<'staged' | 'unstaged', string>>>({});

type TTreeData = {
    status: ChangeStatus;
    isStaged: boolean;
};

type ChangeTreeEntry = TTreeData & {
    path: string;
    title: string;
    subtitle?: string;
    id: string;
};

type TreeItem = FileTreeItem<TTreeData, { isStaged: boolean }>;
const treeItems = computed<TreeItem[]>(() => {
    return [
        {
            id: 'staged',
            title: 'Staged Changes',
            isStaged: true,
            children: (repo.value?.changes?.staged ?? []).map((e) => ({
                id: `staged-${e.path}`,
                title: e.path,
                subtitle: e.previousPath,
                path: e.path,
                status: e.stagedStatus,
                isStaged: true,
            })),
        },
        {
            id: 'unstaged',
            title: 'Changes',
            isStaged: false,
            children: (repo.value?.changes?.unstaged ?? []).map((e) => ({
                id: `unstaged-${e.path}`,
                title: e.path,
                subtitle: e.previousPath,
                path: e.path,
                status: e.unstagedStatus,
                isStaged: false,
            })),
        },
    ];
});

const selectedDiffConflictCount = computed(() => {
    const matches = repo.value.curDiff?.entry.modified.match(/^<<<<<<< /gm);
    return matches?.length ?? 0;
});
const selectedDiffViewerState = useDiffViewer(computed(() => repo.value.curDiff));
const selectedStashDiffViewerState = useDiffViewer(computed(() => repo.value.currStashDiff));
const stashTreeItem = computed<FileTreeItem>(() => {
    return {
        id: 'stash',
        title: 'Stash',
        children: repo.value.stashes.map((stash) => ({
            id: stash.ref,
            title: stash.message,
            ref: stash.ref,
            createdAtRelative: stash.createdAtRelative,
        })),
    };
});

const stashFilesTreeItem = computed<FileTreeItem>(() => {
    return {
        id: repo.value.currStash?.ref ?? '-',
        title: 'Files',
        children:
            repo.value.currStash?.files.map((file) => ({
                id: file.path,
                title: file.path,
                subtitle: file.previousPath,
                path: file.path,
                status: file.status,
            })) ?? [],
    };
});

function isFileOperationRunning(action: 'openFileInEditor' | 'discardFile' | 'stageFile' | 'unstageFile', path: string) {
    return tasks.isOperationRunning(`${action}:${path}`);
}

function isStashOperationRunning(action: 'restoreStash' | 'discardStash', stashRef: string) {
    return tasks.isOperationRunning(`${action}:${stashRef}`);
}

async function onSelectChangeFile(path: string, kind: 'staged' | 'unstaged') {
    repo.value.clearSelectedRepositoryStash();
    await repo.value.selectChange({ kind, path });
}

async function onSelectStash(stashRef: string) {
    await repo.value.selectRepositoryStash(stashRef);
}

function buildIgnoreOptions(path: string): ChangeFileContextMenuIgnoreOption[] {
    const segments = path.split('/').filter(Boolean);
    const fileName = segments.at(-1);

    if (!fileName) {
        return [];
    }

    const extensionIndex = fileName.lastIndexOf('.');
    const extension = extensionIndex > 0 && extensionIndex < fileName.length - 1 ? fileName.slice(extensionIndex + 1) : undefined;

    return [
        {
            value: path,
            mode: 'file' as const,
        },
        {
            value: fileName,
            mode: 'file' as const,
        },
        ...(extension
            ? [
                  {
                      value: `*.${extension}`,
                      mode: 'pattern' as const,
                  },
              ]
            : []),
        ...segments.slice(0, -1).map((_, index) => {
            const folderPath = segments.slice(0, index + 1).join('/');

            return {
                value: folderPath,
                mode: 'directory' as const,
            };
        }),
    ];
}

function entryKind(item: ChangeTreeEntry) {
    return item.isStaged ? 'staged' : 'unstaged';
}

function entriesForKind(kind: 'staged' | 'unstaged') {
    return (treeItems.value.find((item) => item.isStaged === (kind === 'staged'))?.children as ChangeTreeEntry[] | undefined) ?? [];
}

function selectedIdsForKind(kind: 'staged' | 'unstaged') {
    return kind === 'staged' ? selectedStagedIds.value : selectedUnstagedIds.value;
}

function setSelectedIds(kind: 'staged' | 'unstaged', ids: string[]) {
    const nextIds = [...new Set(ids)];

    if (kind === 'staged') {
        selectedStagedIds.value = nextIds;
        selectedUnstagedIds.value = [];
        return;
    }

    selectedUnstagedIds.value = nextIds;
    selectedStagedIds.value = [];
}

function visibleSelectionForKind(kind: 'staged' | 'unstaged') {
    const ids = selectedIdsForKind(kind);
    if (ids.length > 0) {
        return ids;
    }

    if (repo.value.currChangeKind === kind && repo.value.currChangePath) {
        return [`${kind}-${repo.value.currChangePath}`];
    }

    return [];
}

function updateChangeSelection(item: ChangeTreeEntry, event?: MouseEvent, keepExistingSelection = false) {
    const kind = entryKind(item);
    const currentIds = [...selectedIdsForKind(kind)];
    const entryIds = entriesForKind(kind).map((entry) => entry.id);
    const anchorId = selectionAnchorIds.value[kind];

    if (keepExistingSelection && currentIds.includes(item.id)) {
        return currentIds;
    }

    if (event?.shiftKey && anchorId && entryIds.includes(anchorId)) {
        const startIndex = entryIds.indexOf(anchorId);
        const endIndex = entryIds.indexOf(item.id);
        const [rangeStart, rangeEnd] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        const nextIds = entryIds.slice(rangeStart, rangeEnd + 1);
        setSelectedIds(kind, nextIds);
        return nextIds;
    }

    if (event?.metaKey || event?.ctrlKey) {
        const toggledIds = currentIds.includes(item.id) ? currentIds.filter((id) => id !== item.id) : [...currentIds, item.id];
        const nextIds = toggledIds.length > 0 ? toggledIds.sort((left, right) => entryIds.indexOf(left) - entryIds.indexOf(right)) : [item.id];
        setSelectedIds(kind, nextIds);
        selectionAnchorIds.value[kind] = item.id;
        return nextIds;
    }

    setSelectedIds(kind, [item.id]);
    selectionAnchorIds.value[kind] = item.id;
    return [item.id];
}

function selectedEntriesForItem(item: ChangeTreeEntry, event?: MouseEvent) {
    const kind = entryKind(item);
    const nextIds = updateChangeSelection(item, event, true);
    const selectedSet = new Set(nextIds);
    return entriesForKind(kind).filter((entry) => selectedSet.has(entry.id));
}

function buildChangeContextMenuOptions(items: ChangeTreeEntry[]): ChangeFileContextMenuOptions {
    const firstItem = items[0]!;
    const isStaged = firstItem.isStaged;
    const statuses = new Set(items.map((item) => item.status));
    const hasSingleSelection = items.length === 1;
    const canIgnoreFile = hasSingleSelection && !isStaged && firstItem.status !== 'deleted';
    const onlyStatus = statuses.size === 1 ? items[0]!.status : undefined;
    const primaryAction = (() => {
        if (onlyStatus === 'deleted') {
            return 'revert-deletion';
        }

        if (onlyStatus === 'untracked' || onlyStatus === 'added') {
            return 'delete-file';
        }

        if (!isStaged && onlyStatus) {
            return 'discard-changes';
        }

        return undefined;
    })();
    const deletedOnly = hasSingleSelection && onlyStatus === 'deleted';

    return {
        selectionCount: items.length,
        primaryAction,
        stageAction: isStaged ? 'unstage-files' : 'stage-files',
        canIgnore: canIgnoreFile,
        ignoreOptions: canIgnoreFile ? buildIgnoreOptions(firstItem.path) : [],
        showCopyPaths: hasSingleSelection,
        showRevealInFinder: hasSingleSelection && !deletedOnly,
        showOpenWithDefaultProgram: hasSingleSelection && !deletedOnly,
    };
}

async function runChangeContextAction(items: ChangeTreeEntry[], action: ChangeFileContextMenuAction) {
    const firstItem = items[0]!;
    const paths = items.map((item) => item.path);

    if (action.kind === 'discard-changes') {
        await repo.value.discardFiles(paths);
        return;
    }

    if (action.kind === 'stage-files') {
        await repo.value.stageFiles(paths);
        return;
    }

    if (action.kind === 'unstage-files') {
        await repo.value.unstageFiles(paths);
        return;
    }

    if (action.kind === 'delete-file') {
        await repo.value.deleteFiles(paths, firstItem.isStaged ? 'staged' : 'unstaged');
        return;
    }

    if (action.kind === 'revert-deletion') {
        await repo.value.revertDeletions(paths, firstItem.isStaged ? 'staged' : 'unstaged');
        return;
    }

    if (action.kind === 'ignore-path') {
        await repo.value.ignorePath(action.value, action.mode);
        return;
    }

    if (action.kind === 'copy-file-path') {
        await repo.value.copyFilePath(firstItem.path, 'absolute');
        return;
    }

    if (action.kind === 'copy-relative-file-path') {
        await repo.value.copyFilePath(firstItem.path, 'relative');
        return;
    }

    if (action.kind === 'reveal-in-finder') {
        await repo.value.revealFileInFinder(firstItem.path);
        return;
    }

    await repo.value.openFileWithDefaultProgram(firstItem.path);
}

async function onOpenChangeContextMenu(item: ChangeTreeEntry, event?: MouseEvent) {
    const selectedItems = selectedEntriesForItem(item, event);
    await onSelectChangeFile(item.path, item.isStaged ? 'staged' : 'unstaged');

    const action = await gitClientRpc.request.showChangeFileContextMenu(buildChangeContextMenuOptions(selectedItems));

    if (!action) {
        return;
    }

    await runChangeContextAction(selectedItems, action);
}

async function onSelectChangeEntry(item: ChangeTreeEntry, event?: MouseEvent) {
    updateChangeSelection(item, event);
    await onSelectChangeFile(item.path, item.isStaged ? 'staged' : 'unstaged');
}

function onInputEnter(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.metaKey && repo.value.canCommit()) {
        repo.value.commitRepository();
    }
}

function listenToKeyboardShortcuts(event: KeyboardEvent) {
    if (!event.metaKey || event.shiftKey) return;

    if (event.key === 'p' && repo.value.canPush() && !tasks.isOperationRunning(`runRemoteOperation:push-${repo.value.id}`)) {
        repos.runRepoRemoteOperation(repo.value.id, 'push');
        event.preventDefault();
    }
}
onMounted(() => {
    document.addEventListener('keydown', listenToKeyboardShortcuts);
});

onUnmounted(() => {
    document.removeEventListener('keydown', listenToKeyboardShortcuts);
});
</script>

<template>
    <EtSplitter
        class="flex-1 overflow-y-auto border border-white/10"
        base-side="left"
        default-width="200px"
        min-width="180px"
        max-width="50%"
        local-storage-key="changesSidebarWidth"
    >
        <template #left>
            <aside class="flex h-full flex-col border-b border-white/10 xl:border-r xl:border-b-0">
                <div class="flex items-center justify-between py-2 font-semibold tracking-[0.04em] text-default gap-1 pl-1">
                    <!-- <span class="pl-2">Changes</span> -->
                    <!-- <div class="flex items-center gap-1 text-x7"> -->
                    <Button
                        smaller
                        class="flex-1 px-1"
                        severity="secondary"
                        :disabled="!repo.canFetch()"
                        v-tooltip="'Fetch'"
                        v-loading="tasks.isOperationRunning(`runRemoteOperation:fetch-${repo.id}`)"
                        @click="repos.runRepoRemoteOperation(repo.id, 'fetch')"
                    >
                        <span class="icon icon-[mingcute--refresh-3-line] text-sm"></span> {{ 'Fetch' }}
                    </Button>
                    <Button
                        smaller
                        class="flex-1 px-1"
                        severity="secondary"
                        :disabled="!repo.canPull()"
                        v-tooltip="'Pull'"
                        v-loading="tasks.isOperationRunning(`runRemoteOperation:pull-${repo.id}`)"
                        @click="repos.runRepoRemoteOperation(repo.id, 'pull')"
                    >
                        <span class="icon icon-[fluent--arrow-down-12-filled] text-sm"></span> {{ 'Pull' }}
                    </Button>
                    <Button
                        smaller
                        class="flex-1 px-1"
                        severity="secondary"
                        :disabled="!repo.canPush()"
                        v-tooltip="'Push'"
                        v-loading="tasks.isOperationRunning(`runRemoteOperation:push-${repo.id}`)"
                        @click="repos.runRepoRemoteOperation(repo.id, 'push')"
                    >
                        <span class="icon icon-[fluent--arrow-up-12-filled] text-sm"></span> {{ 'Push' }}
                    </Button>
                    <Button
                        smaller
                        class="flex-1 px-1"
                        severity="secondary"
                        :disabled="!repo.canCommit()"
                        v-tooltip="repo.commitForm.amend ? 'Amend' : 'Commit'"
                        v-loading="tasks.isOperationRunning('commitRepo')"
                        @click="repo.commitRepository()"
                    >
                        <span class="icon icon-[mingcute--check-fill] text-sm"></span> {{ repo.commitForm.amend ? 'Amend' : 'Commit' }}
                    </Button>
                </div>

                <div class="pl-1 pb-3">
                    <div
                        v-if="repo.commitForm.amend"
                        class="mb-2 flex items-center justify-between rounded border border-amber-400/20 bg-amber-400/10 px-2 py-1.5 text-xs text-amber-200"
                    >
                        <span>Amending the latest unpushed commit</span>
                        <Button severity="light" smaller @click="repo.cancelAmendCommit()">Cancel</Button>
                    </div>
                    <div class="flex items-center gap-1">
                        <input
                            v-model="repo.commitForm.summary"
                            :disabled="!repo.changes?.staged.length && !repo.commitForm.amend"
                            :placeholder="repo.commitForm.amend ? 'Amend message' : repo.suggestedCommitSummary() || 'Message (⌘Enter to commit on main)'"
                            @keydown.enter.meta="onInputEnter"
                            class="flex-1 min-h-8 resize-none rounded border border-x6 bg-x0 px-2.5 py-1.5 text-xs text-white placeholder:opacity-70 focus:border-white/20"
                        />
                        <IconButton
                            severity="secondary"
                            @click="showDescription = !showDescription"
                            v-tooltip="showDescription ? 'Hide Description' : 'Show Description'"
                            :icon="showDescription ? 'icon-[mdi--chevron-up]' : 'icon-[mdi--chevron-down]'"
                        />
                    </div>
                    <textarea
                        v-if="showDescription"
                        v-model="repo.commitForm.description"
                        rows="4"
                        :disabled="!repo.changes?.staged.length && !repo.commitForm.amend"
                        placeholder="Optional description"
                        class="mt-2 w-full resize-none rounded border border-x6 bg-x0 px-2.5 py-1.5 text-xs text-white placeholder:opacity-70 focus:border-white/20"
                    >
                    </textarea>
                    <Button severity="primary" class="mt-1 w-full" small :disabled="!repo.canCommit()" @click="repo.commitRepository()">
                        <span class="icon icon-[mdi--check] mr-1.5 text-xs"></span>
                        <span>{{ repo.commitForm.amend ? 'Amend' : 'Commit' }}</span>
                    </Button>
                </div>

                <div class="flex-1 overflow-auto pb-2 scrollbar-thin">
                    <div class="space-y-3">
                        <ChangesFileTree
                            v-for="item in treeItems"
                            :key="item.title"
                            :item="item"
                            empty-text="No files"
                            :selection="visibleSelectionForKind(item.isStaged ? 'staged' : 'unstaged')"
                            :onContextMenu="(t, event) => onOpenChangeContextMenu(t as ChangeTreeEntry, event)"
                            :onSelect="(t, event) => onSelectChangeEntry(t as ChangeTreeEntry, event)"
                        >
                            <template #header-actions="{ item }">
                                <IconButton
                                    v-if="item.isStaged"
                                    severity="raised"
                                    v-tooltip="'Amend latest commit'"
                                    :disabled="repo.commitForm.amend"
                                    @click="repo.beginAmendSelectedCommit()"
                                    icon="icon-[mdi--pencil] text-xs"
                                />
                                <IconButton
                                    v-else
                                    severity="raised"
                                    v-show="item.children.length > 0"
                                    v-tooltip="'Discard all changes'"
                                    v-loading="tasks.isOperationRunning('discardAllChanges')"
                                    @click="repo.discardAllChanges()"
                                    icon="icon-[codicon--discard] text-xs"
                                />
                                <IconButton
                                    severity="raised"
                                    v-show="item.children.length > 0"
                                    v-tooltip="item.isStaged ? 'Unstage all files' : 'Stage all files'"
                                    v-loading="tasks.isOperationRunning(item.isStaged ? 'unstageAllFiles' : 'stageAllFiles')"
                                    @click="item.isStaged ? repo.unstageAllFiles() : repo.stageAllFiles()"
                                    :icon="item.isStaged ? 'icon-[mdi--minus]' : 'icon-[mdi--plus]'"
                                />
                            </template>
                            <template #item-actions="{ item }">
                                <IconButton
                                    class="focus:opacity-100 p-px text-xs"
                                    v-tooltip="'Open in Editor'"
                                    v-loading="isFileOperationRunning('openFileInEditor', item.path!)"
                                    @click.stop="repo.openFileInEditor(item.path!)"
                                    icon="icon-[mdi--application-edit-outline]"
                                />
                                <IconButton
                                    v-if="!item.isStaged"
                                    class="focus:opacity-100 p-px text-xs"
                                    v-tooltip="'Discard change'"
                                    v-loading="isFileOperationRunning('discardFile', item.path!)"
                                    @click.stop="repo.discardFile(item.path!)"
                                    icon="icon-[codicon--discard]"
                                />
                                <IconButton
                                    class="focus:opacity-100 p-px text-xs"
                                    v-tooltip="item.isStaged ? 'Unstage file' : 'Stage file'"
                                    v-loading="item.isStaged ? isFileOperationRunning('unstageFile', item.path!) : isFileOperationRunning('stageFile', item.path!)"
                                    @click.stop="item.isStaged ? repo.unstageFile(item.path!) : repo.stageFile(item.path!)"
                                    :icon="item.isStaged ? 'icon-[mdi--minus]' : 'icon-[mdi--plus]'"
                                />
                            </template>
                        </ChangesFileTree>
                    </div>
                </div>

                <div class="border-t border-white/10 pt-2">
                    <FileTree :item="stashTreeItem" empty-text="No stashes" :selection="repo.currStashRef ?? undefined" :onSelect="(t) => onSelectStash(t.ref)">
                        <template #item-leftIcon>
                            <span class="icon icon-[mdi--archive-arrow-down-outline] shrink-0 text-xs"></span>
                        </template>
                        <template #item-title="{ item }">
                            <div class="min-w-0 flex-1">
                                <p class="truncate text-xs tracking-tight">{{ item.title }}</p>
                                <p class="text-xs opacity-60">
                                    {{ item.ref }}<span v-if="item.createdAtRelative"> · {{ item.createdAtRelative }}</span>
                                </p>
                            </div>
                        </template>
                    </FileTree>
                </div>
            </aside>
        </template>
        <template #right>
            <div v-if="repo.currStash" class="flex h-full flex-col overflow-auto bg-black/10">
                <div class="border-b border-white/10 px-2 pb-2 pt-1">
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <p class="truncate text-lg font-semibold text-white">{{ repo.currStash.message }}</p>
                            <p class="text-sm tracking-tight opacity-50">
                                {{ repo.currStash.ref }}<span v-if="repo.currStash.createdAtRelative"> · {{ repo.currStash.createdAtRelative }}</span>
                            </p>
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                            <Button
                                severity="light"
                                smaller
                                v-loading="isStashOperationRunning('restoreStash', repo.currStash.ref)"
                                @click="repo.restoreRepositoryStash(repo.currStash.ref)"
                            >
                                Restore
                            </Button>
                            <Button
                                severity="light"
                                smaller
                                v-loading="isStashOperationRunning('discardStash', repo.currStash.ref)"
                                @click="repo.discardRepositoryStash(repo.currStash.ref)"
                            >
                                Discard
                            </Button>
                        </div>
                    </div>
                </div>
                <div class="flex h-full gap-2 overflow-auto px-2">
                    <EtSplitter
                        class="flex-1 overflow-y-auto"
                        base-side="left"
                        default-width="250px"
                        min-width="200px"
                        max-width="50%"
                        local-storage-key="changesStashFilesSidebarWidth"
                    >
                        <template #left>
                            <ChangesFileTree
                                class="w-full shrink-0"
                                :item="stashFilesTreeItem"
                                empty-text="No files"
                                :selection="repo.currStashFilePath ?? undefined"
                                no-actions
                                :onSelect="(t) => t.path && repo.selectRepositoryStashFile(t.path)"
                            >
                            </ChangesFileTree>
                        </template>
                        <template #right>
                            <p v-if="!repo.currStashDiff" class="px-3 py-3 text-sm text-x7">Select a stashed file to inspect its diff.</p>
                            <DiffViewer v-else :state="selectedStashDiffViewerState" />
                        </template>
                    </EtSplitter>
                </div>
            </div>
            <div v-else-if="repo.curDiff" class="flex flex-col h-full overflow-auto bg-x1">
                <div :key="`${repo.curDiff.path}-${repo.curDiff.entry.label}`" class="border border-white/10 bg-x0/80 flex-1 overflow-auto">
                    <DiffViewer :state="selectedDiffViewerState">
                        <template #before-header-actions>
                            <Alert severity="secondary" class="py-0 px-1 rounded text-xs font-semibold">
                                {{ repo.curDiff.entry.label.replace('changes', '') }}
                            </Alert>
                            <Button
                                v-if="repo.curDiff && selectedDiffConflictCount > 0"
                                severity="secondary"
                                smaller
                                v-tooltip="'Resolve conflict markers inline'"
                                @click="mergeState.openInlineMergeEditor(repo.curDiff.path)"
                            >
                                Resolve Conflicts
                            </Button>
                        </template>
                    </DiffViewer>
                </div>
            </div>
            <div v-if="!repo.curDiff" class="text-sm opacity-50 h-full grid place-items-center bg-x1">Choose a changed file to inspect its diff.</div>
        </template>
    </EtSplitter>
</template>
