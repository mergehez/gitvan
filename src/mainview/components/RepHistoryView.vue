<script setup lang="ts">
import { computed } from 'vue';
import FileTree, { FileTreeItem } from './FileTree.vue';
import DiffViewer from './DiffViewer.vue';
import ChangesFileTree from './ChangesFileTree.vue';
import { readableDate } from '../lib/utils';
import EtSplitter from './EtSplitter.vue';
import { useDiffViewer } from '../composables/useDiffViewer';
import { useRepos } from '../composables/useRepos';
import IconButton from './IconButton.vue';

const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);
const latestCommitSha = computed(() => repo.value.history?.commits[0]?.sha ?? undefined);
const selectedCommitDiffViewerState = useDiffViewer(computed(() => repo.value.currCommitDiff));

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
            <FileTree :item="treeItem" empty-text="No history found" item-class="px-0!" :selection="repo.currCommitSha" :onSelect="(t) => repo.selectCommit(t.id)">
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
</template>
