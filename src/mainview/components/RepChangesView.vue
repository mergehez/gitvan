<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ChangeStatus } from '../../shared/types.ts';
import { type ChangeFileContextMenuAction, type ChangeFileContextMenuIgnoreOption } from '../../shared/types.ts';
import { useDiffViewer } from '../composables/useDiffViewer';
import { useFileSort } from '../composables/useFileSort';
import { useMergeHelper } from '../composables/useMerge';
import { useRepos } from '../composables/useRepos';
import { useSettings } from '../composables/useSettings';
import { tasks } from '../composables/useTasks';
import type { ContextMenuEntry } from '../directives';
import { buildOpenWithEntries } from '../lib/buildOpenWithEntries';
import { buildFileSortMenuEntries, sortFilesByMode } from '../lib/fileSort';
import Alert from './Alert.vue';
import Button from './Button.vue';
import ChangesFileTree from './ChangesFileTree.vue';
import type { HunkActionsConfig } from './DiffsDiffEditor.vue';
import DiffViewer from './DiffViewer.vue';
import EtSplitter from './EtSplitter.vue';
import type { FileTreeItem } from './FileTree.vue';
import FileTree from './FileTree.vue';
import IconButton from './IconButton.vue';

const repos = useRepos();
const settings = useSettings();
const repo = computed(() => repos.getSelectedRepo()!);
const mergeState = useMergeHelper();
const openWithEditors = computed(() => {
    return settings.getOpenWithEditors();
});

const stagedFileSort = useFileSort('changes-staged');
const unstagedFileSort = useFileSort('changes-unstaged');
const stashFilesFileSort = useFileSort('stash-files');

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
    noActualChange?: boolean;
    cosmeticCheckTooLarge?: boolean;
};

type TreeItem = FileTreeItem<ChangeTreeEntry, { isStaged: boolean }>;

type ChangeTreeHeaderItem = FileTreeItem<ChangeTreeEntry, { isStaged: boolean }>;

function findChangeEntry(kind: 'staged' | 'unstaged', path: string) {
    const entries = kind === 'staged' ? (repo.value?.changes?.staged ?? []) : (repo.value?.changes?.unstaged ?? []);

    return entries.find((entry) => entry.path === path);
}

function hasBackendNoActualChange(kind: 'staged' | 'unstaged', path: string) {
    const entry = findChangeEntry(kind, path);

    return kind === 'staged' ? entry?.stagedNoActualChange === true : entry?.unstagedNoActualChange === true;
}

function hasBackendCosmeticCheckTooLarge(kind: 'staged' | 'unstaged', path: string) {
    const entry = findChangeEntry(kind, path);

    return kind === 'staged' ? entry?.stagedTooLargeForCosmeticCheck === true : entry?.unstagedTooLargeForCosmeticCheck === true;
}

const treeItems = computed<TreeItem[]>(() => {
    return [
        {
            id: 'staged',
            title: 'Staged Changes',
            isStaged: true,
            children: sortFilesByMode(
                (repo.value?.changes?.staged ?? []).map((e) => ({
                    id: `staged-${e.path}`,
                    title: e.path,
                    subtitle: e.previousPath,
                    path: e.path,
                    status: e.stagedStatus,
                    noActualChange: hasBackendNoActualChange('staged', e.path),
                    cosmeticCheckTooLarge: hasBackendCosmeticCheckTooLarge('staged', e.path),
                    isStaged: true,
                })),
                stagedFileSort.mode.value
            ),
        },
        {
            id: 'unstaged',
            title: 'Changes',
            isStaged: false,
            children: sortFilesByMode(
                (repo.value?.changes?.unstaged ?? []).map((e) => ({
                    id: `unstaged-${e.path}`,
                    title: e.path,
                    subtitle: e.previousPath,
                    path: e.path,
                    status: e.unstagedStatus,
                    noActualChange: hasBackendNoActualChange('unstaged', e.path),
                    cosmeticCheckTooLarge: hasBackendCosmeticCheckTooLarge('unstaged', e.path),
                    isStaged: false,
                })),
                unstagedFileSort.mode.value
            ),
        },
    ];
});

const selectedDiffConflictCount = computed(() => {
    const matches = repo.value.curDiff?.entry.modified.match(/^<<<<<<< /gm);
    return matches?.length ?? 0;
});
const baseSelectedDiffViewerState = useDiffViewer(computed(() => repo.value.curDiff));
const selectedStashDiffViewerState = useDiffViewer(computed(() => repo.value.currStashDiff));

const selectedDiffViewerState = computed(() => {
    const state = baseSelectedDiffViewerState.value;
    const currentDiff = repo.value.curDiff;

    if (!state || !currentDiff?.path) {
        return state;
    }

    const treeKind = currentDiff.entry.kind === 'staged' ? 'staged' : 'unstaged';
    const cachedNoActualChange = hasBackendNoActualChange(treeKind, currentDiff.path);

    if (!cachedNoActualChange || state.noActualChange) {
        return state;
    }

    return {
        ...state,
        noActualChange: true,
    };
});

watch(
    () => [repo.value.id, settings.state.diffIgnoredCharsEnabled ? settings.state.diffIgnoredChars : '', settings.state.showWhitespaceChanges],
    () => {
        void repo.value.loadChanges();
    },
    {
        immediate: false,
    }
);
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
        children: sortFilesByMode(
            repo.value.currStash?.files.map((file) => ({
                id: file.path,
                title: file.path,
                subtitle: file.previousPath,
                path: file.path,
                status: file.status,
            })) ?? [],
            stashFilesFileSort.mode.value
        ),
    };
});

const hunkActionsConfig = computed<HunkActionsConfig | undefined>(() => {
    const entry = repo.value.curDiff?.entry;
    if (!entry) return undefined;
    if (entry.kind === 'untracked') return undefined;

    // If the file is locked, don't show any hunk action buttons
    if (repo.value.isFileLocked(repo.value.curDiff!.path)) return undefined;

    return {
        kind: entry.kind,
        oldSizeBytes: entry.stats.oldSizeBytes,
        newSizeBytes: entry.stats.newSizeBytes,
        patch: entry.patch,
        onStage: async (patch) => {
            if (!repo.value.curDiff || !patch) return;
            await repo.value.applyPatch(patch, 'stage', 'hunk');
        },
        onUnstage: async (patch) => {
            if (!repo.value.curDiff || !patch) return;
            await repo.value.applyPatch(patch, 'unstage', 'hunk');
        },
        onDiscard: async (patch) => {
            if (!repo.value.curDiff || !patch) return;
            const hunkPatch = patch;
            console.log('[onDiscard]', { patchLen: hunkPatch.length, preview: hunkPatch.slice(0, 200) });
            await repo.value.applyPatch(hunkPatch, 'discard', 'hunk');
        },
    };
});

function isFileOperationRunning(action: 'openFileInEditor' | 'discardFile' | 'stageFile' | 'unstageFile', path: string) {
    return tasks.isOperationRunning(`${action}:${path}`);
}

function stageAllUnlockedFiles() {
    const unstaged = repo.value.changes?.unstaged ?? [];
    const unlockedPaths = unstaged.filter((e) => !repo.value.isFileLocked(e.path)).map((e) => e.path);
    if (unlockedPaths.length > 0) {
        repo.value.stageFiles(unlockedPaths);
    }
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

    const items = [
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
    // Deduplicate options with later ones taking precedence
    return items.filter((option, index) => {
        return !items.slice(index + 1).some((other) => other.value === option.value);
    });
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

function buildChangeContextMenuEntries(items: ChangeTreeEntry[]): ContextMenuEntry[] {
    const firstItem = items[0]!;
    const isStaged = firstItem.isStaged;
    const statuses = new Set(items.map((item) => item.status));
    const hasSingleSelection = items.length === 1;
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
    const countLabel = items.length === 1 ? 'singular' : 'plural';
    const stageActionLabel = {
        'stage-files': {
            singular: 'Stage File',
            plural: 'Stage Files',
        },
        'unstage-files': {
            singular: 'Unstage File',
            plural: 'Unstage Files',
        },
    }[isStaged ? 'unstage-files' : 'stage-files'][countLabel];
    const primaryActionLabel = primaryAction
        ? {
              'discard-changes': {
                  singular: 'Discard Changes',
                  plural: 'Discard Changes',
              },
              'delete-file': {
                  singular: 'Delete File',
                  plural: 'Delete Files',
              },
              'revert-deletion': {
                  singular: 'Revert Deletion',
                  plural: 'Revert Deletions',
              },
          }[primaryAction][countLabel]
        : undefined;

    const entries: ContextMenuEntry[] = [];
    const canAddSeperator = () => {
        const last = entries.at(-1);
        if (!last) return false;
        if ('type' in last && last.type === 'separator') return false;
        return true;
    };

    // Skip destructive/staging actions when this specific file is locked
    const isLocked = !isStaged && (firstItem.path ? repo.value.isFileLocked(firstItem.path) : false);

    // Lock/unlock toggle
    if (!isStaged) {
        entries.push({
            id: `change-lock:${firstItem.id}`,
            label: isLocked ? 'Unlock file (enable staging)' : 'Lock file (disable staging)',
            action: async () => {
                if (isLocked) {
                    repo.value.unlockFile(firstItem.path);
                } else {
                    repo.value.lockFile(firstItem.path);
                }
            },
        });
    }
    if (!isLocked && primaryAction && primaryActionLabel) {
        entries.push({
            id: `change-primary:${firstItem.id}`,
            label: primaryActionLabel,
            action: async () => {
                await runChangeContextAction(items, { kind: primaryAction });
            },
        });
    }

    if (!isLocked) {
        entries.push({
            id: `change-stage:${firstItem.id}`,
            label: stageActionLabel,
            action: async () => {
                await runChangeContextAction(items, { kind: isStaged ? 'unstage-files' : 'stage-files' });
            },
        });
    }

    if (!isStaged) {
        if (canAddSeperator()) {
            entries.push({ type: 'separator', id: `change-separator-cosmetic:${firstItem.id}` });
        }
        if (!isLocked) {
            entries.push(...buildBulkChangeClassificationMenuEntries('unstaged'));
        }
    }

    if (hasSingleSelection && !isStaged && firstItem.status !== 'deleted') {
        if (canAddSeperator()) {
            entries.push({ type: 'separator', id: `change-separator-ignore:${firstItem.id}` });
        }
        entries.push({
            id: `change-ignore:${firstItem.id}`,
            label: 'Ignore...',
            children: buildIgnoreOptions(firstItem.path).map((option) => ({
                id: `change-ignore:${firstItem.id}:${option.mode}:${option.value}`,
                label: option.value,
                action: async () => {
                    await runChangeContextAction(items, {
                        kind: 'ignore-path',
                        value: option.value,
                        mode: option.mode,
                    });
                },
            })),
        });
    }

    if (hasSingleSelection) {
        if (canAddSeperator()) {
            entries.push({ type: 'separator', id: `change-separator-file:${firstItem.id}` });
        }

        entries.push({
            id: `change-copy-path:${firstItem.id}`,
            label: 'Copy File Path',
            action: async () => {
                await runChangeContextAction(items, { kind: 'copy-file-path' });
            },
        });
        entries.push({
            id: `change-copy-relative-path:${firstItem.id}`,
            label: 'Copy Relative File Path',
            action: async () => {
                await runChangeContextAction(items, { kind: 'copy-relative-file-path' });
            },
        });

        if (!deletedOnly) {
            entries.push({
                id: `change-reveal:${firstItem.id}`,
                label: navigator.userAgent.includes('Mac') ? 'Reveal in Finder' : 'Reveal in File Manager',
                action: async () => {
                    await runChangeContextAction(items, { kind: 'reveal-in-finder' });
                },
            });
            entries.push({
                id: `change-open-with:${firstItem.id}`,
                label: 'Open with...',
                children: buildOpenWithEntries({
                    keyPrefix: `change-open-with:${firstItem.id}`,
                    editors: openWithEditors.value,
                    onOpenWithEditor: async (editorPath) => {
                        await runChangeContextAction(items, {
                            kind: 'open-with-editor',
                            editorPath,
                        });
                    },
                    onPickProgram: async () => {
                        await runChangeContextAction(items, { kind: 'open-with' });
                    },
                }),
            });
        }
    }

    return entries;
}

function buildChangeHeaderContextMenuEntries(item: ChangeTreeHeaderItem): ContextMenuEntry[] {
    const sortState = item.isStaged ? stagedFileSort : unstagedFileSort;
    const entries: ContextMenuEntry[] = [...buildFileSortMenuEntries(sortState.mode.value, (mode) => sortState.setMode(mode), item.isStaged ? 'staged-sort' : 'unstaged-sort')];

    if (!item.isStaged) {
        entries.push({ type: 'separator', id: 'change-header-separator-sort' });
        entries.push(...buildBulkChangeClassificationMenuEntries('unstaged'));
    }

    return entries;
}

function buildStashFilesHeaderContextMenuEntries(): ContextMenuEntry[] {
    return [
        ...buildFileSortMenuEntries(stashFilesFileSort.mode.value, (mode) => stashFilesFileSort.setMode(mode), 'stash-files-sort'),
        { type: 'separator', id: 'stash-files-header-separator-sort' },
        ...buildBulkChangeClassificationMenuEntries('unstaged'),
    ];
}

function buildBulkChangeClassificationMenuEntries(kind: 'unstaged'): ContextMenuEntry[] {
    const noActualChangeEntries = entriesForKind(kind).filter((entry) => entry.noActualChange === true && !repo.value.isFileLocked(entry.path));
    const actualChangeEntries = entriesForKind(kind).filter((entry) => entry.noActualChange !== true && !repo.value.isFileLocked(entry.path));
    const noActualChangePaths = noActualChangeEntries.map((entry) => entry.path);
    const actualChangePaths = actualChangeEntries.map((entry) => entry.path);

    return [
        {
            id: `${kind}-discard-cosmetic`,
            label: 'Discard All Cosmetic Changes',
            disabled: noActualChangePaths.length === 0,
            action: async () => {
                await repo.value.discardFiles(noActualChangePaths);
            },
        },
        {
            id: `${kind}-stage-cosmetic`,
            label: 'Stage All Cosmetic Changes',
            disabled: noActualChangePaths.length === 0,
            action: async () => {
                await repo.value.stageFiles(noActualChangePaths);
            },
        },
        {
            id: `${kind}-stage-real`,
            label: 'Stage All Real Changes',
            disabled: actualChangePaths.length === 0,
            action: async () => {
                await repo.value.stageFiles(actualChangePaths);
            },
        },
    ];
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

    if (action.kind === 'open-with') {
        await settings.openRepoPathInEditor({ repoId: repo.value.id, path: firstItem.path, mode: 'pick' }, `change:${firstItem.path}:pick-editor`);
        return;
    }

    if (typeof action === 'object' && action.kind === 'open-with-editor') {
        await settings.openRepoPathInEditor({ repoId: repo.value.id, path: firstItem.path, editorPath: action.editorPath }, `change:${firstItem.path}:editor:${action.editorPath}`);
        return;
    }

    await repo.value.openFileWithDefaultProgram(firstItem.path);
}
function getContextMenuItems(item: ChangeTreeEntry) {
    const selectedItems = selectedEntriesForItem(item);
    // await onSelectChangeFile(item.path, item.isStaged ? 'staged' : 'unstaged');

    return buildChangeContextMenuEntries(selectedItems);
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
                            :getContextMenuItems="getContextMenuItems"
                            :getHeaderContextMenuItems="buildChangeHeaderContextMenuEntries"
                            :onSelect="(t, event) => onSelectChangeEntry(t as ChangeTreeEntry, event)"
                        >
                            <template #header-actions="{ item }">
                                <span
                                    class="mr-1 text-xs flex items-center gap-1 tracking-tight"
                                    v-tooltip="
                                        item.isStaged && repo.changes?.stagedStats
                                            ? 'Diff: +{{ repo.changes.stagedStats.addedLines }} -{{ repo.changes.stagedStats.removedLines }}'
                                            : !item.isStaged && repo.changes?.unstagedStats
                                              ? 'Diff: +{{ repo.changes.unstagedStats.addedLines }} -{{ repo.changes.unstagedStats.removedLines }}'
                                              : 'No changes'
                                    "
                                >
                                    <template v-if="item.isStaged && repo.changes?.stagedStats">
                                        <span class="text-green-400">+{{ repo.changes.stagedStats.addedLines }}</span>
                                        <span class="text-red-400">-{{ repo.changes.stagedStats.removedLines }}</span>
                                    </template>
                                    <template v-else-if="!item.isStaged && repo.changes?.unstagedStats">
                                        <span class="text-green-400">+{{ repo.changes.unstagedStats.addedLines }}</span>
                                        <span class="text-red-400">-{{ repo.changes.unstagedStats.removedLines }}</span>
                                    </template>
                                </span>
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
                                    @click="item.isStaged ? repo.unstageAllFiles() : stageAllUnlockedFiles()"
                                    :icon="item.isStaged ? 'icon-[mdi--minus]' : 'icon-[mdi--plus]'"
                                />
                            </template>
                            <template #before-status="{ item }">
                                <span
                                    v-if="item.path && repo.isFileLocked(item.path)"
                                    class="icon icon-[mdi--lock] text-xs opacity-50"
                                    v-tooltip="'Staging disabled for this file'"
                                ></span>
                                <span
                                    v-if="item.path && item.cosmeticCheckTooLarge"
                                    class="icon icon-[mdi--alert-circle-outline] text-xs opacity-50"
                                    v-tooltip="'Too large to check for cosmetic changes'"
                                ></span>
                            </template>
                            <template #item-actions="{ item }">
                                <IconButton
                                    v-if="!item.isStaged && !(item.path && repo.isFileLocked(item.path))"
                                    class="focus:opacity-100 p-px text-xs"
                                    v-tooltip="'Discard change'"
                                    v-loading="isFileOperationRunning('discardFile', item.path!)"
                                    @click.stop="repo.discardFile(item.path!)"
                                    icon="icon-[codicon--discard]"
                                />
                                <IconButton
                                    v-if="!(item.path && repo.isFileLocked(item.path))"
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
                                :getContextMenuItems="getContextMenuItems"
                                :getHeaderContextMenuItems="buildStashFilesHeaderContextMenuEntries"
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
                    <DiffViewer :state="selectedDiffViewerState" :hunk-actions-config="hunkActionsConfig">
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
