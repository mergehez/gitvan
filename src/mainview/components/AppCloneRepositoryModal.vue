<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AccountSummary, CloneRepoSourceTab, CloneableRepo } from '../../shared/gitClient';
import { useRepos } from '../composables/useRepos';
import { tasks } from '../composables/useTasks';

import { useAuth } from '../composables/useAuth';
import { useSettings } from '../composables/useSettings';
import { counted } from '../lib/utils';
import Alert from './Alert.vue';
import Button from './Button.vue';
import CenteredModal from './CenteredModal.vue';
import EtSplitter from './EtSplitter.vue';
import Icon from './Icon.vue';
import IconButton from './IconButton.vue';

const settings = useSettings();
const auth = useAuth();
const repos = useRepos();

const selectedTab = ref<CloneRepoSourceTab>('github');
const selectedBrowserAccountId = ref<number>();
const selectedUrlAccountId = ref<number>();
const selectedGroupId = ref<number>();
const selectedRepoId = ref<string>();
const reposFilter = ref('');
const parentDirectory = ref('');
const manualCloneUrl = ref('');
const availableRepositories = ref<CloneableRepo[]>([]);
let repoRequestToken = 0;

function isGithubDotComAccount(account: AccountSummary) {
    return account.authKind !== 'system-git' && account.provider === 'github' && (account.host === undefined || account.host === 'github.com');
}

function isGithubEnterpriseAccount(account: AccountSummary) {
    return account.authKind !== 'system-git' && Boolean(account.host && account.host !== 'github.com') && (account.provider === 'github' || account.provider === 'custom');
}

function pickPreferredAccountId(accounts: AccountSummary[]) {
    return accounts.find((account) => account.isDefault)?.id ?? accounts[0]?.id;
}

function deriveRepoNameFromUrl(remoteUrl: string) {
    const normalizedRemoteUrl = remoteUrl.trim().replace(/\/+$/, '');
    if (!normalizedRemoteUrl) {
        return '';
    }

    const withoutGitSuffix = normalizedRemoteUrl.replace(/\.git$/i, '');
    const segments = withoutGitSuffix.split(/[/:]/).filter(Boolean);
    return segments[segments.length - 1] ?? '';
}

function displayDestinationPath(basePath: string, repoName: string) {
    const normalizedBasePath = basePath.trim().replace(/\/+$/, '');
    const normalizedRepoName = repoName.trim();

    if (!normalizedBasePath || !normalizedRepoName) {
        return '';
    }

    return `${normalizedBasePath}/${normalizedRepoName}`;
}

const githubAccounts = computed(() => auth.accounts.filter(isGithubDotComAccount));
const githubEnterpriseAccounts = computed(() => auth.accounts.filter(isGithubEnterpriseAccount));
const cloneCapableAccounts = computed(() => auth.accounts.filter((account) => account.authKind !== 'system-git'));
const browserAccounts = computed(() => (selectedTab.value === 'github' ? githubAccounts.value : githubEnterpriseAccounts.value));
const selectedBrowserAccount = computed(() => browserAccounts.value.find((account) => account.id === selectedBrowserAccountId.value));
const selectedRepo = computed(() => availableRepositories.value.find((r) => r.id === selectedRepoId.value));
const filteredRepositories = computed(() => {
    const filter = reposFilter.value.trim().toLowerCase();
    if (!filter) {
        return availableRepositories.value;
    }

    return availableRepositories.value.filter((r) => {
        return (
            r.fullName.toLowerCase().includes(filter) ||
            r.name.toLowerCase().includes(filter) ||
            r.ownerLogin.toLowerCase().includes(filter) ||
            (r.description?.toLowerCase().includes(filter) ?? false)
        );
    });
});
const groupedRepositories = computed(() => {
    const groups = [] as { owner: string; repositories: CloneableRepo[] }[];

    const accountName = selectedBrowserAccount.value?.username ?? '';
    for (const r of filteredRepositories.value) {
        let ownerGroup = groups.find((group) => group.owner === r.ownerLogin);
        if (!ownerGroup) {
            ownerGroup = { owner: r.ownerLogin, repositories: [] };
            groups.push(ownerGroup);
        }
        ownerGroup.repositories.push(r);
    }

    return groups.map((group) => ({
        ownerLogin: accountName === group.owner ? 'Your repositories' : group.owner,
        repositories: group.repositories.sort((a, b) => a.name.localeCompare(b.name)),
    }));
});
const repoName = computed(() => {
    if (selectedTab.value === 'url') {
        return deriveRepoNameFromUrl(manualCloneUrl.value);
    }

    return selectedRepo.value?.name ?? '';
});
const cloneUrl = computed(() => {
    if (selectedTab.value === 'url') {
        return manualCloneUrl.value.trim();
    }

    return selectedRepo.value?.cloneUrl ?? '';
});
const activeAccountId = computed(() => {
    if (selectedTab.value === 'url') {
        return selectedUrlAccountId.value;
    }

    return selectedBrowserAccountId.value;
});
const destinationPathPreview = computed(() => displayDestinationPath(parentDirectory.value, repoName.value));
const canClone = computed(() => Boolean(parentDirectory.value.trim() && cloneUrl.value && repoName.value));
const isCloneRunning = computed(() => tasks.isOperationRunning('cloneTrackedRepo'));
const missingAccountMessage = computed(() => {
    if (selectedTab.value === 'url') {
        if (cloneCapableAccounts.value.length === 0) {
            return 'No saved account is available for authenticated cloning. Public repositories may still work, but private repositories and enterprise hosts usually require an account.';
        }

        if (selectedUrlAccountId.value === undefined) {
            return 'No saved account is selected. Use one if the repository requires authentication.';
        }

        return undefined;
    }

    if (selectedTab.value === 'github' && githubAccounts.value.length === 0) {
        return 'Connect a GitHub.com account to browse repositories from GitHub.com.';
    }

    if (selectedTab.value === 'enterprise' && githubEnterpriseAccounts.value.length === 0) {
        return 'Connect a GitHub Enterprise-compatible account to browse enterprise repositories.';
    }

    return undefined;
});

async function loadCloneDefaults() {
    const defaults = await repos.getCloneRepoDefaults();
    parentDirectory.value = defaults.parentDirectory;
}

async function chooseCloneDirectory() {
    const selectedDirectory = await repos.pickCloneRepoDirectory();
    if (selectedDirectory) {
        parentDirectory.value = selectedDirectory;
    }
}

async function refreshRepositoryList() {
    if (selectedTab.value === 'url' || selectedBrowserAccountId.value === undefined) {
        availableRepositories.value = [];
        selectedRepoId.value = undefined;
        tasks.listCloneableRepos.clearError();
        return;
    }

    const requestToken = ++repoRequestToken;
    const accountId = selectedBrowserAccountId.value;
    const repositories = await tasks.listCloneableRepos.run({ accountId });

    if (requestToken !== repoRequestToken) {
        return;
    }

    const accountName = selectedBrowserAccount.value?.username ?? '';
    const userRepos = repositories.filter((repo) => repo.ownerLogin.toLowerCase() === accountName.toLowerCase());
    const otherRepos = repositories.filter((repo) => repo.ownerLogin.toLowerCase() !== accountName.toLowerCase());

    availableRepositories.value = [...userRepos, ...otherRepos];

    if (!repositories.some((r) => r.id === selectedRepoId.value)) {
        selectedRepoId.value = repositories[0]?.id;
    }
}

async function submitClone() {
    if (!canClone.value) {
        return;
    }

    await repos.cloneTrackedRepo({
        accountId: activeAccountId.value,
        cloneUrl: cloneUrl.value,
        parentDirectory: parentDirectory.value,
        repoName: repoName.value,
        groupId: selectedGroupId.value,
    });
}

watch(
    () => repos.isCloneRepoModalOpen,
    (isOpen) => {
        if (!isOpen) {
            repoRequestToken++;
            tasks.listCloneableRepos.clearError();
            return;
        }

        reposFilter.value = '';
        manualCloneUrl.value = '';
        availableRepositories.value = [];
        selectedGroupId.value = undefined;
        selectedRepoId.value = undefined;
        selectedTab.value = 'github';
        selectedBrowserAccountId.value = pickPreferredAccountId(githubAccounts.value);
        selectedUrlAccountId.value = pickPreferredAccountId(cloneCapableAccounts.value);

        void loadCloneDefaults();

        if (selectedBrowserAccountId.value !== undefined) {
            void refreshRepositoryList();
        }
    },
    { immediate: true },
);

watch(browserAccounts, (accounts) => {
    if (selectedTab.value === 'url') {
        return;
    }

    if (!accounts.some((account) => account.id === selectedBrowserAccountId.value)) {
        selectedBrowserAccountId.value = pickPreferredAccountId(accounts);
    }
});

watch(selectedTab, (tab) => {
    reposFilter.value = '';
    tasks.listCloneableRepos.clearError();

    if (tab === 'url') {
        availableRepositories.value = [];
        selectedRepoId.value = undefined;

        if (!cloneCapableAccounts.value.some((account) => account.id === selectedUrlAccountId.value)) {
            selectedUrlAccountId.value = pickPreferredAccountId(cloneCapableAccounts.value);
        }

        return;
    }

    const nextAccounts = tab === 'github' ? githubAccounts.value : githubEnterpriseAccounts.value;
    selectedBrowserAccountId.value = pickPreferredAccountId(nextAccounts);
});

watch(selectedBrowserAccountId, () => {
    if (!repos.isCloneRepoModalOpen || selectedTab.value === 'url') {
        return;
    }

    void refreshRepositoryList();
});
</script>

<template>
    <CenteredModal title="Clone a Repository" v-model:open="repos.isCloneRepoModalOpen" content-class="max-w-2xl h-150">
        <div class="border-b border-x3 px-6">
            <div class="flex gap-2 justify-center">
                <button
                    type="button"
                    class="border-b-2 px-4 py-2 text-sm font-medium transition"
                    :class="selectedTab === 'github' ? 'border-sky-400 text-white' : 'border-transparent text-x7 hover:text-white'"
                    @click="selectedTab = 'github'"
                >
                    GitHub.com
                </button>
                <button
                    type="button"
                    class="border-b-2 px-4 py-2 text-sm font-medium transition"
                    :class="selectedTab === 'enterprise' ? 'border-sky-400 text-white' : 'border-transparent text-x7 hover:text-white'"
                    @click="selectedTab = 'enterprise'"
                >
                    GitHub Enterprise
                </button>
                <button
                    type="button"
                    class="border-b-2 px-4 py-2 text-sm font-medium transition"
                    :class="selectedTab === 'url' ? 'border-sky-400 text-white' : 'border-transparent text-x7 hover:text-white'"
                    @click="selectedTab = 'url'"
                >
                    URL
                </button>
            </div>
        </div>

        <div v-if="selectedTab === 'url'" class="px-6 py-5 grid grid-cols-[auto_1fr] items-center gap-2">
            <label class="text-sm font-medium text-white" for="clone-url-input">Repository URL</label>
            <input
                id="clone-url-input"
                v-model="manualCloneUrl"
                type="text"
                placeholder="https://github.com/owner/repository.git"
                class="rounded-lg border border-x5 bg-x0 px-3 py-1.5 text-sm text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
            />

            <label class="text-sm font-medium text-white" for="clone-url-account">Authentication account</label>
            <select
                id="clone-url-account"
                v-model="selectedUrlAccountId"
                class="rounded-lg border border-x5 bg-x0 px-3 py-1.5 text-sm text-white outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
            >
                <option :value="undefined">No saved account</option>
                <option v-for="account in cloneCapableAccounts" :key="account.id" :value="account.id">{{ account.label }}{{ account.host ? ` (${account.host})` : '' }}</option>
            </select>

            <Alert v-if="missingAccountMessage" severity="warning" class="col-span-2 mt-2">
                {{ missingAccountMessage }}
            </Alert>
        </div>

        <EtSplitter v-else class="flex-1 overflow-auto" base-side="left" default-width="180px" min-width="150px" max-width="50%" local-storage-key="cloneRepositorySidebarWidth">
            <template #left>
                <aside class="border-r border-x3 bg-x0/35 px-1 py-3 h-full">
                    <div class="mb-2 flex items-center justify-between">
                        <p class="text-sm font-bold tracking-narrow pl-1">Accounts</p>
                        <IconButton severity="secondary" smaller @click="settings.openSettingsWindow('accounts')" v-tooltip="'Manage accounts'" icon="icon-[mdi--cog-outline]" />
                    </div>

                    <div v-if="browserAccounts.length === 0" class="space-y-3 rounded-xl border border-dashed border-x3 bg-x0/3 px-4 py-5 text-sm text-x7">
                        <p>
                            {{
                                selectedTab === 'github'
                                    ? 'Connect a GitHub.com account in Settings to browse available repositories.'
                                    : 'Connect a GitHub Enterprise-compatible account in Settings to browse available repositories.'
                            }}
                        </p>
                        <Button severity="primary" class="w-full justify-center" @click="settings.openSettingsWindow('accounts')"> Open Account Settings </Button>
                    </div>

                    <div v-else class="space-y-1">
                        <Button
                            v-for="account in browserAccounts"
                            :key="account.id"
                            small
                            :severity="account.id === selectedBrowserAccountId ? 'primary' : 'secondary'"
                            class="w-full text-left justify-start"
                            @click="selectedBrowserAccountId = account.id"
                        >
                            <p class="text-sm font-medium truncate text-white leading-tight">{{ account.label }}</p>
                        </Button>
                    </div>
                </aside>
            </template>
            <template #right>
                <section class="flex min-h-0 flex-col px-2 pt-2 overflow-auto h-full">
                    <Alert v-if="tasks.listCloneableRepos.errorMessage" severity="danger" class="mb-4">
                        {{ tasks.listCloneableRepos.errorMessage }}
                    </Alert>
                    <Alert v-else-if="missingAccountMessage" severity="warning" class="mb-4">
                        {{ missingAccountMessage }}
                    </Alert>

                    <div v-if="tasks.listCloneableRepos.isRunning()" class="flex h-full items-center justify-center px-8 text-center opacity-80 gap-2">
                        <Icon icon="icon-[mingcute--loading-fill]" class="animate-spin text-2xl" />
                        Loading repositories...
                    </div>
                    <div v-else-if="selectedBrowserAccount" class="pl-1 gap-2 flex items-center mb-1">
                        <p class="text-sm font-bold tracking-narrow">
                            {{ counted(filteredRepositories, 'repository') }}
                        </p>
                        <IconButton
                            severity="secondary"
                            :disabled="selectedBrowserAccountId === undefined"
                            v-tooltip="'Refresh repository list'"
                            @click="refreshRepositoryList"
                            icon="icon-[ic--refresh]"
                        />
                        <i class="flex-1"></i>
                        <input
                            v-model="reposFilter"
                            type="search"
                            placeholder="Search..."
                            class="w-30 rounded-lg border border-x5 bg-x0 px-2 py-1 text-xs text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                        />
                    </div>

                    <div class="flex-1 overflow-y-auto scrollbar-thin">
                        <i v-if="tasks.listCloneableRepos.isRunning()"></i>

                        <div
                            v-else-if="browserAccounts.length > 0 && filteredRepositories.length === 0"
                            class="flex h-full items-center justify-center px-8 text-center text-sm text-x7"
                        >
                            {{ reposFilter ? 'No repositories match the current filter.' : 'No repositories are available for the selected account.' }}
                        </div>

                        <div v-else class="space-y-3 px-1 py-1 min-h-1/2">
                            <div v-for="g in groupedRepositories" :key="g.ownerLogin" class="space-y-1">
                                <p class="text-xs font-semibold tracking-tight opacity-50">{{ g.ownerLogin }}</p>
                                <Button
                                    v-for="repository in g.repositories"
                                    :key="repository.id"
                                    class="w-full gap-3 text-left pl-2 pr-1 rounded-sm"
                                    :severity="repository.id === selectedRepoId ? 'success' : 'secondary'"
                                    @click="selectedRepoId = repository.id"
                                >
                                    <Icon :icon="repository.isPrivate ? 'icon-[mdi--lock-outline]' : 'icon-[mdi--source-repository]'" class="opacity-70" />
                                    <p class="truncate flex-1 text-xs">{{ repository.fullName }}</p>
                                    <Alert v-if="repository.defaultBranch" severity="secondary" class="px-1 py-0 text-2xs rounded-md">
                                        {{ repository.defaultBranch }}
                                    </Alert>
                                    <!-- <p v-if="repository.description" class="mt-1 line-clamp-2 text-xs leading-5 text-x7">
                                                {{ repository.description }}
                                            </p> -->
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>
            </template>
        </EtSplitter>

        <div class="border-t border-x3 px-3 py-2 flex justify-between items-start gap-15">
            <div class="flex-1 flex items-center gap-1">
                <label class="text-xs font-medium whitespace-nowrap text-white" for="clone-parent-directory">Local Path: </label>
                <input
                    id="clone-parent-directory"
                    v-model="parentDirectory"
                    type="text"
                    class="min-w-[60%] rounded-lg border border-x6 bg-x0 px-3 py-1.5 text-xs text-white outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                />
                <Button severity="secondary" smaller @click="chooseCloneDirectory">
                    <Icon icon="icon-[mdi--folder-open]" />
                </Button>
                <i class="flex-1"></i>
            </div>
            <div class="flex items-center gap-1">
                <label class="text-xs font-medium text-white" for="clone-group-select">Group:</label>
                <label class="relative text-xs rounded border border-x6 bg-x0 flex items-center">
                    <select v-model="selectedGroupId" class="opacity-0 w-full border px-2 py-1.5 text-xs outline-none">
                        <option :value="undefined">-</option>
                        <option v-for="group in repos.repoGroups" :key="group.id" :value="group.id">
                            {{ group.name }}
                        </option>
                    </select>
                    <div class="absolute pl-2 pr-1 py-1.5 flex justify-center items-center w-full pointer-events-none whitespace-nowrap">
                        <span class="flex-1 truncate">{{ selectedGroupId ? repos.repoGroups.find((g) => g.id === selectedGroupId)?.name : '-' }}</span>
                        <Icon icon="icon-[mdi--chevron-down] ml-auto" />
                    </div>
                </label>
            </div>
        </div>
        <p v-if="destinationPathPreview" class="text-xs px-6 -mt-2 opacity-60">
            Repository will be cloned to <span class="text-white font-bold tracking-tight">{{ destinationPathPreview }}</span>
        </p>

        <div class="flex items-center justify-end gap-3 px-3 pb-3">
            <Button severity="light" @click="repos.isCloneRepoModalOpen = false"> Cancel </Button>
            <Button severity="primary" :disabled="!canClone" v-loading="isCloneRunning" @click="submitClone"> Clone </Button>
        </div>
    </CenteredModal>
</template>
