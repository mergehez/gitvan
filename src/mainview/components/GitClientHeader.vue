<script setup lang="ts">
import { computed, ref } from 'vue';
import { NavigationView } from '../../shared/gitClient';
import Button from './Button.vue';
import { useSettings } from '../composables/useSettings';
import { useMergeHelper } from '../composables/useMerge';
import { useAuth } from '../composables/useAuth';
import { useRepos } from '../composables/useRepos';
import IconButton from './IconButton.vue';

const settings = useSettings();
const auth = useAuth();
const mergeState = useMergeHelper();
const repos = useRepos();
const repo = computed(() => repos.getSelectedRepo()!);

const repositoryHeadline = computed(() => {
    if (!repo.value) {
        return 'No repository selected';
    }

    return repo.value.name;
});

const syncLabel = computed(() => {
    if (!repo.value) {
        return 'No remote sync data';
    }

    const s = repo.value.status;
    if (s.ahead === 0 && s.behind === 0) {
        return 'In sync';
    }

    return `${s.ahead} ahead / ${s.behind} behind`;
});
const repositoryStats = computed(() => {
    if (!repo.value) {
        return {
            branch: 'Unknown',
            changedFiles: '0',
            sync: '',
        };
    }

    return {
        branch: repo.value.status.branch ?? 'Unknown',
        changedFiles: String(repo.value.status.changedFiles),
        sync: syncLabel.value,
    };
});

const showHealth = ref(false);

function promptAccountAssignment() {
    void auth.promptRepoAccountAssignment(repo.value);
}

const mergeConflictButtonLabel = computed(() => {
    const count = mergeState.mergeConflictState?.conflictedFiles.length ?? 0;
    return count > 0 ? `Resolve Conflicts (${count})` : 'Complete Merge';
});

const navItems = computed<Array<{ label: string; value: NavigationView; subtitle?: string }>>(() => [
    // { value: 'branches', label: repositoryHeadline.value, subtitle: `/ ${repositoryStats.value.branch}` },
    { value: 'changes', label: 'Changes' },
    { value: 'history', label: 'History' },
    // { value: 'branches', label: 'Branches' },
]);
</script>

<template>
    <header class="flex items-center gap-1 border-b border-white/10 bg-x1/75 px-4 py-2">
        <Button severity="secondary" @click="settings.state.showBranches = !settings.state.showBranches">
            {{ repositoryHeadline }}<span class="text-sm opacity-70 pl-1">{{ repositoryStats.branch }}</span>
        </Button>
        <Button
            v-for="item in navItems"
            :key="item.value"
            :severity="settings.state.activeView === item.value ? 'success' : 'secondary'"
            @click="settings.setActiveView(item.value)"
        >
            {{ item.label }}<span v-if="item.subtitle" class="text-sm opacity-70 pl-1">{{ item.subtitle }}</span>
        </Button>

        <i class="flex-1"></i>

        <Button
            v-if="mergeState.mergeConflictState?.isMerging"
            severity="danger"
            small
            title="Open Merge Conflict Resolver"
            class="mr-2"
            @click="mergeState.openMergeConflictModal()"
        >
            {{ mergeConflictButtonLabel }}
        </Button>

        <Button severity="secondary" smaller v-tooltip.bottom="'Assign Repository Account'" aria-label="Assign Repository Account" @click="promptAccountAssignment">
            Account: {{ repo.assignedAccountName() }}
        </Button>
        <div class="relative">
            <IconButton severity="raised" @click="showHealth = !showHealth" icon="icon-[mdi--information-slab-circle] text-lg" />
            <div v-if="showHealth" class="absolute top-full z-10 right-0 justify-start grid grid-cols-[auto_1fr] gap-2 rounded bg-x4 border border-x7 text-sm px-2 py-2 w-100">
                <p class="text-xs font-semibold uppercase col-span-full opacity-50">Info</p>
                <span>Path:</span> <b class="break-all">{{ repo?.path || 'Unknown' }}</b> <span>Last scan:</span>
                <b>{{ repo?.status.lastScannedAt?.replace('T', ' ').split('.')[0] || 'Not scanned yet' }}</b> <span>Validation:</span>
                <b>{{ repo ? 'Git repository' : 'Waiting for repository' }}</b> <span>Errors:</span> <b>{{ repo?.status.error ?? 'None' }}</b> <span>Status:</span>
                <b>{{ repositoryStats.sync }}</b>
            </div>
            <!-- <div v-if="showHealth" v-html="repositoryHealthHtml" class="absolute top-full z-10 right-0 mt-1 w-max border border-x2 rounded bg-x3"></div> -->
        </div>
    </header>
</template>
