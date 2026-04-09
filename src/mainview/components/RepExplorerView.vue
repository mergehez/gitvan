<script setup lang="ts">
import { computed } from 'vue';
import type { CommittedFileEntry } from '../../shared/gitClient';
import { useRepos } from '../composables/useRepos';
import { fileIconAndLanguageByPath, formatBytes, readableDate } from '../lib/utils';
import EtSplitter from './EtSplitter.vue';
import FileTree, { type FileTreeItem } from './FileTree.vue';
import MonacoEditor from './MonacoEditor.vue';
import MonacoEditorSettingsButton from './MonacoEditorSettingsButton.vue';

type ExplorerNode = {
    id: string;
    title: string;
    path: string;
    kind: 'file' | 'directory';
    sizeBytes: number;
    children?: ExplorerNode[];
};

const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);

function sortTree(nodes: ExplorerNode[]) {
    nodes.sort((a, b) => {
        if (a.kind !== b.kind) {
            return a.kind === 'directory' ? -1 : 1;
        }

        return a.title.localeCompare(b.title, undefined, { sensitivity: 'accent' });
    });

    nodes.forEach((node) => {
        if (node.children) {
            sortTree(node.children);
        }
    });
}

function buildExplorerTree(files: CommittedFileEntry[]) {
    const root: FileTreeItem<ExplorerNode, { count: number }> = {
        id: 'committed-tree',
        title: 'Explorer',
        count: files.length,
        children: [],
    };
    const directories = new Map<string, ExplorerNode>();

    for (const file of files) {
        const parts = file.path.split('/').filter(Boolean);
        if (parts.length === 0) {
            continue;
        }

        let parentChildren = root.children;
        let currentDirectoryPath = '';

        for (const part of parts.slice(0, -1)) {
            currentDirectoryPath = currentDirectoryPath ? `${currentDirectoryPath}/${part}` : part;

            let directory = directories.get(currentDirectoryPath);
            if (!directory) {
                directory = {
                    id: `dir:${currentDirectoryPath}`,
                    title: part,
                    path: currentDirectoryPath,
                    kind: 'directory',
                    sizeBytes: 0,
                    children: [],
                };
                directories.set(currentDirectoryPath, directory);
                parentChildren.push(directory);
            }

            if (!directory.children) {
                directory.children = [];
            }

            parentChildren = directory.children;
        }

        parentChildren.push({
            id: `file:${file.path}`,
            title: parts[parts.length - 1] ?? file.path,
            path: file.path,
            kind: 'file',
            sizeBytes: file.sizeBytes,
        });
    }

    sortTree(root.children);
    return root;
}

const treeItem = computed(() => buildExplorerTree(repo.value.committedTree?.files ?? []));
const explorerCommit = computed(() => repo.value.history?.commits.find((commit) => commit.sha === repo.value.explorerCommitSha));
const explorerCommitShortSha = computed(() => explorerCommit.value?.shortSha ?? repo.value.committedTree?.commitSha?.slice(0, 7) ?? undefined);

function formatCommitOptionLabel(commit: NonNullable<typeof explorerCommit.value>) {
    return `${commit.shortSha} · ${commit.summary} · ${readableDate(new Date(commit.authoredAt))}`;
}

async function onCommitSelection(event: Event) {
    const nextCommitSha = (event.target as HTMLSelectElement).value;
    if (!nextCommitSha || nextCommitSha === repo.value.explorerCommitSha) {
        return;
    }

    await repo.value.selectExplorerCommit(nextCommitSha);
}
</script>

<template>
    <div class="flex flex-col flex-1 w-full ">
        <div class="flex items-center gap-3 border-b border-x6 px-3 py-2">
            <div class="min-w-0 flex-1 text-xs tracking-tight opacity-70">
                Showing repository files as of {{ explorerCommitShortSha ? `commit ${explorerCommitShortSha}` : 'the selected commit' }}. Later commits are not included.
            </div>
            <label class="flex items-center gap-2 text-xs text-white/65">
                <span class="shrink-0 uppercase opacity-70">Snapshot</span>
                <select
                    class="max-w-90 rounded border border-white/20 bg-x1 px-1.5 py-0.5 text-xs text-white outline-none"
                    :value="repo.explorerCommitSha"
                    @change="onCommitSelection">
                    <option v-for="commit in repo.history?.commits ?? []" :key="commit.sha" :value="commit.sha">
                        {{ formatCommitOptionLabel(commit) }}
                    </option>
                </select>
            </label>
        </div>
        <EtSplitter class="flex-1 overflow-y-auto " base-side="left" default-width="280px" min-width="220px" max-width="50%"
            local-storage-key="explorerSidebarWidth">
            <template #left>
                <FileTree :item="treeItem" empty-text="No committed files found" :selection="repo.currCommittedFilePath" no-actions
                    :onSelect="(item) => item.kind === 'file' && repo.selectCommittedFile(item.path)">
                    <template #item-leftIcon="slotProps">
                        <span
                            class="icon shrink-0 text-sm"
                            :class="slotProps.isGroup
                                ? slotProps.isCollapsed
                                    ? 'icon-[mdi--folder-outline] text-amber-100'
                                    : 'icon-[mdi--folder-open-outline] text-amber-100'
                                : fileIconAndLanguageByPath(slotProps.item.path).icon
                                "></span>
                    </template>
                    <template #item-rightIcon="slotProps">
                        <span v-if="!slotProps.isGroup && slotProps.item.sizeBytes > 0" class="text-2xs opacity-45">
                            {{ formatBytes(slotProps.item.sizeBytes) }}
                        </span>
                    </template>
                </FileTree>
            </template>

            <template #right>
                <div v-if="!(repo.history?.commits.length ?? 0)" class="grid h-full place-items-center px-6 text-sm text-white/45">
                    No commits found.
                </div>

                <div v-else-if="!(repo.committedTree?.files.length ?? 0)" class="grid h-full place-items-center px-6 text-sm text-white/45">
                    No committed files found in this snapshot.
                </div>

                <div v-else-if="!repo.currCommittedFile" class="grid h-full place-items-center px-6 text-sm text-white/45">
                    Select a file to inspect the committed contents.
                </div>

                <div v-else class="flex h-full min-h-0 flex-col">
                    <div class="flex items-center border-b border-x5 px-2 py-1.5 text-xs font-medium gap-1">
                        <div class="line-clamp-1 flex-1 text-white">{{ repo.currCommittedFile.path }}</div>
                        <span class="rounded-full bg-white/8 px-2 py-0.5 text-xs text-white/70">{{ formatBytes(repo.currCommittedFile.sizeBytes) }}</span>
                        <MonacoEditorSettingsButton v-if="!repo.currCommittedFile.previewMessage && !repo.currCommittedFile.preview?.kind" hide-diff-options />
                    </div>

                    <div v-if="repo.currCommittedFile.previewMessage" class="grid min-h-0 flex-1 place-items-center bg-x1 px-6 text-sm text-white/50">
                        {{ repo.currCommittedFile.previewMessage }}
                    </div>

                    <div v-else-if="repo.currCommittedFile.preview?.kind === 'image'"
                        class="grid min-h-0 flex-1 place-items-center overflow-auto bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_60%)] p-6">
                        <img
                            :src="repo.currCommittedFile.preview.src"
                            :alt="repo.currCommittedFile.path"
                            class="max-h-full max-w-full rounded-lg border border-white/10 bg-black/20 object-contain shadow-[0_20px_60px_rgba(0,0,0,0.35)]" />
                    </div>

                    <MonacoEditor
                        v-else
                        no-head
                        readonly
                        :model-value="repo.currCommittedFile.content"
                        :path-for-language="repo.currCommittedFile.path"
                        class="min-h-0 flex-1" />
                </div>
            </template>
        </EtSplitter>
    </div>
</template>
