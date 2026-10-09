<script setup lang="ts">
import { computed } from 'vue';
import type { CommitDetail, FileDiffData } from '../../shared/types.ts';
import { useDiffViewer } from '../composables/useDiffViewer';
import { useFileHistory } from '../composables/useFileHistory';
import { useFileSort } from '../composables/useFileSort';
import type { ContextMenuEntry } from '../directives';
import { buildFileSortMenuEntries, sortFilesByMode } from '../lib/fileSort';
import { readableDate } from '../lib/utils';
import ChangesFileTree from './ChangesFileTree.vue';
import DiffViewer from './DiffViewer.vue';
import EtSplitter from './EtSplitter.vue';
import type { FileTreeItem } from './FileTree.vue';

const props = defineProps<{
    commit: CommitDetail | undefined;
    diff: FileDiffData | undefined;
    selectedFilePath: string | undefined;
    /** Namespaces the persisted file sort and sidebar width per view. */
    sortStorageKey: string;
    localStorageKeyPrefix: string;
    emptyText: string;
    onSelectFile: (path: string) => void;
}>();

const { openFileHistory } = useFileHistory();
const filesSort = useFileSort(props.sortStorageKey);
const diffViewerState = useDiffViewer(computed(() => props.diff));

const treeItemFiles = computed<FileTreeItem<{ status: string; hadConflict?: boolean }, {}>>(() => ({
    id: props.commit?.sha ?? '-',
    title: 'Files',
    children: sortFilesByMode(
        props.commit?.files.map((file) => ({
            id: file.path,
            title: file.path,
            subtitle: file.previousPath,
            path: file.path,
            status: file.status,
            hadConflict: file.hadConflict,
        })) ?? [],
        filesSort.mode.value
    ),
}));

function buildFilesHeaderContextMenuEntries(): ContextMenuEntry[] {
    return buildFileSortMenuEntries(filesSort.mode.value, (mode) => filesSort.setMode(mode), `${props.sortStorageKey}-sort`);
}

function buildFileContextMenuEntries(file: { path?: string; title: string }): ContextMenuEntry[] {
    const path = file.path ?? file.title;

    return [
        {
            id: `commit-file-history:${path}`,
            label: 'File History',
            action: async () => {
                await openFileHistory(path);
            },
        },
    ];
}
</script>

<template>
    <p v-if="!props.commit" class="text-sm text-x7">{{ props.emptyText }}</p>

    <template v-else>
        <div class="border-b border-white/10 pb-3 px-2">
            <p class="text-xl font-semibold text-white">{{ props.commit.summary }}</p>
            <p class="text-sm opacity-50 tracking-tight">
                {{ props.commit.shortSha }} · {{ props.commit.authorName }} <{{ props.commit.authorEmail }}> ·
                {{ readableDate(new Date(props.commit.authoredAt)) }}
            </p>
        </div>
        <p v-if="props.commit.body" class="mt-1 px-2 whitespace-pre-wrap text-sm leading-7 text-default max-h-30 overflow-y-auto bg-x1">{{ props.commit.body }}</p>
        <div class="px-2 flex gap-2 h-full overflow-auto">
            <EtSplitter
                class="flex-1 overflow-y-auto scrollbar-thin"
                base-side="left"
                default-width="250px"
                min-width="200px"
                max-width="50%"
                :local-storage-key="`${props.localStorageKeyPrefix}CommitFilesSidebarWidth`"
            >
                <template #left>
                    <ChangesFileTree
                        class="w-full shrink-0"
                        :item="treeItemFiles"
                        empty-text="No files"
                        :selection="props.selectedFilePath"
                        show-path-tooltip
                        no-actions
                        :onSelect="(item) => item.path && props.onSelectFile(item.path)"
                        :getContextMenuItems="buildFileContextMenuEntries"
                        :getHeaderContextMenuItems="buildFilesHeaderContextMenuEntries"
                    >
                        <template #before-status="{ item }">
                            <span v-if="(item as any).hadConflict" class="icon icon-[mingcute--git-merge-fill] text-[11px] text-amber-300" v-tooltip="'Had merge conflicts'"></span>
                        </template>
                    </ChangesFileTree>
                </template>
                <template #right>
                    <DiffViewer v-if="props.diff" :state="diffViewerState"> </DiffViewer>
                    <i v-else></i>
                </template>
            </EtSplitter>
        </div>
    </template>
</template>
