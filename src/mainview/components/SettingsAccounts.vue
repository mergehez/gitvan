<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useSettings } from '../composables/useSettings';
import { tasks } from '../composables/useTasks';
import Button from './Button.vue';
import DraggableList from './DraggableList.vue';
import IconButton from './IconButton.vue';

const auth = useAuth();
const settings = useSettings();

const selAccountId = ref<'create' | `account:${string}`>();
const selectedAccount = computed(() => {
    if (selAccountId.value === 'create') {
        return undefined;
    }

    const accountId = selAccountId.value?.replace('account:', '');
    return auth.accounts.find((account) => String(account.id) === accountId);
});

const providerSettingsForm = reactive({
    githubClientId: '',
    gitlabClientId: '',
    gitlabHost: 'gitlab.com',
});

const selectedAccountForm = reactive({
    label: '',
    username: '',
    host: '',
    accessToken: '',
    setAsDefault: false,
});

const createAccountForm = reactive({
    label: '',
    provider: 'github',
    authKind: 'https-token',
    username: '',
    host: 'github.com',
    accessToken: '',
    setAsDefault: false,
});

const usesTokenAuth = computed(() => createAccountForm.authKind === 'https-token');
const usesOAuthAuth = computed(() => createAccountForm.authKind === 'oauth');
const requiresCustomHost = computed(() => createAccountForm.provider === 'custom' && usesTokenAuth.value);
const canCreateAccount = computed(() => {
    if (usesOAuthAuth.value) {
        if (createAccountForm.provider === 'github') {
            return Boolean(providerSettingsForm.githubClientId.trim());
        }

        if (createAccountForm.provider === 'gitlab') {
            return Boolean(providerSettingsForm.gitlabClientId.trim() && providerSettingsForm.gitlabHost.trim());
        }

        return false;
    }

    if (!createAccountForm.label.trim()) {
        return false;
    }

    if (createAccountForm.authKind === 'system-git') {
        return true;
    }

    return Boolean(createAccountForm.accessToken.trim() && (!requiresCustomHost.value || createAccountForm.host.trim()));
});

const canSaveSelectedAccount = computed(() => {
    if (!selectedAccount.value || !selectedAccountForm.label.trim()) {
        return false;
    }

    if (selectedAccount.value.authKind !== 'https-token') {
        return true;
    }

    if (selectedAccount.value.provider === 'custom') {
        return Boolean(selectedAccountForm.username.trim() && selectedAccountForm.host.trim());
    }

    return true;
});
const accountsForList = computed(() => {
    return auth.accounts.map((account) => ({
        id: account.id,
        title: account.label,
        provider: account.provider,
        authKind: account.authKind,
        isDefault: account.isDefault,
    }));
});

function resetCreateAccountForm() {
    createAccountForm.label = '';
    createAccountForm.provider = 'github';
    createAccountForm.authKind = 'https-token';
    createAccountForm.username = '';
    createAccountForm.host = 'github.com';
    createAccountForm.accessToken = '';
    createAccountForm.setAsDefault = false;
}

watch(
    () => settings.oauthProviderSettings,
    (settings) => {
        providerSettingsForm.githubClientId = settings.githubClientId;
        providerSettingsForm.gitlabClientId = settings.gitlabClientId;
        providerSettingsForm.gitlabHost = settings.gitlabHost;
    },
    { immediate: true }
);

watch(
    selectedAccount,
    (account) => {
        selectedAccountForm.label = account?.label ?? '';
        selectedAccountForm.username = account?.username ?? '';
        selectedAccountForm.host = account?.host ?? '';
        selectedAccountForm.accessToken = '';
        selectedAccountForm.setAsDefault = account?.isDefault ?? false;
    },
    { immediate: true }
);

watch(
    () => createAccountForm.provider,
    (provider) => {
        if (provider === 'github') {
            createAccountForm.host = 'github.com';
            return;
        }

        if (provider === 'gitlab') {
            createAccountForm.host = providerSettingsForm.gitlabHost || 'gitlab.com';
            return;
        }

        if (provider === 'bitbucket') {
            createAccountForm.host = 'bitbucket.org';
            return;
        }

        if (provider === 'system') {
            createAccountForm.authKind = 'system-git';
            createAccountForm.host = '';
        }
    }
);

watch(
    () => createAccountForm.authKind,
    (authKind) => {
        if (authKind === 'system-git') {
            createAccountForm.provider = 'system';
            createAccountForm.username = '';
            createAccountForm.host = '';
            createAccountForm.accessToken = '';
            return;
        }

        if (createAccountForm.provider === 'system') {
            createAccountForm.provider = 'github';
            createAccountForm.host = 'github.com';
        }

        if (authKind === 'oauth') {
            createAccountForm.username = '';
            createAccountForm.accessToken = '';
        }
    }
);

watch(
    () => providerSettingsForm.gitlabHost,
    (host) => {
        if (createAccountForm.provider === 'gitlab') {
            createAccountForm.host = host;
        }
    }
);

async function saveProviderSettings() {
    await settings.saveOAuthProviderSettings({
        githubClientId: providerSettingsForm.githubClientId,
        gitlabClientId: providerSettingsForm.gitlabClientId,
        gitlabHost: providerSettingsForm.gitlabHost,
    });
}

async function saveSelectedAccount() {
    if (!selectedAccount.value) {
        return;
    }

    await auth.updateAccount({
        accountId: selectedAccount.value.id,
        label: selectedAccountForm.label,
        username: selectedAccount.value.authKind === 'https-token' ? selectedAccountForm.username || undefined : undefined,
        host: selectedAccount.value.authKind === 'https-token' ? selectedAccountForm.host || undefined : undefined,
        accessToken: selectedAccountForm.accessToken || undefined,
        setAsDefault: selectedAccountForm.setAsDefault,
    });
}

async function removeSelectedAccount() {
    if (!selectedAccount.value) {
        return;
    }

    await auth.deleteAccount(selectedAccount.value.id);
    selAccountId.value = undefined;
}

async function createAccount() {
    await auth.createAccount({
        label: createAccountForm.label,
        provider: createAccountForm.provider,
        authKind: createAccountForm.authKind,
        username: createAccountForm.username || undefined,
        host: createAccountForm.host || undefined,
        accessToken: createAccountForm.accessToken || undefined,
        setAsDefault: createAccountForm.setAsDefault,
    });

    if (createAccountForm.authKind !== 'oauth') {
        resetCreateAccountForm();
    }
}

async function reorderAccounts({ item, fromIndex, toIndex }: { item: { id: number }; fromIndex: number; toIndex: number }) {
    if (tasks.isBusy || fromIndex === toIndex) {
        return;
    }

    await auth.reorderAccount(item.id, toIndex);
}
</script>

<template>
    <div class="grid grid-cols-[250px_minmax(0,1fr)] bg-x1">
        <aside class="flex flex-col py-4">
            <div class="flex items-center gap-3 pb-3">
                <h1 class="text-xl font-semibold text-white">Accounts</h1>
                <IconButton severity="secondary" @click="selAccountId = 'create'" icon="icon-[mdi--plus]" />
            </div>

            <p v-if="auth.accounts.length === 0" class="px-3 py-2 text-sm text-x7">No accounts created yet.</p>
            <DraggableList
                v-else
                class="min-h-0 overflow-auto border border-x3"
                :items="accountsForList"
                :selection="selectedAccount?.id"
                item-class="border-b border-white/10 last:border-0"
                :disabled="tasks.isBusy"
                :onSelect="(account) => (selAccountId = `account:${account.id}`)"
                :onReorder="reorderAccounts"
            >
                <template #item-title="{ item }">
                    <div class="flex min-w-0 flex-col items-start">
                        <p class="truncate text-sm font-medium text-white">{{ item.title }}</p>
                        <p class="mt-1 text-xs tracking-[0.12em] opacity-30">{{ item.provider }} · {{ item.authKind }}</p>
                    </div>
                </template>
                <template #item-rightIcon="{ item }">
                    <span v-if="item.isDefault" class="rounded-full border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-2xs uppercase tracking-[0.16em] text-sky-200">
                        Default
                    </span>
                </template>
            </DraggableList>
        </aside>

        <main class="overflow-auto p-6">
            <div class="mx-auto max-w-3xl space-y-6">
                <section v-if="selAccountId === 'create' && usesOAuthAuth" class="rounded-[20px] border border-white/10 bg-white/4 p-5">
                    <p class="text-xs font-semibold uppercase tracking-[0.22em] text-x7">OAuth setup</p>
                    <div class="mt-4 grid gap-3 sm:grid-cols-2">
                        <input
                            v-model="providerSettingsForm.githubClientId"
                            type="text"
                            placeholder="GitHub OAuth client ID"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7 sm:col-span-2"
                        />
                        <input
                            v-model="providerSettingsForm.gitlabHost"
                            type="text"
                            placeholder="GitLab host"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7"
                        />
                        <input
                            v-model="providerSettingsForm.gitlabClientId"
                            type="text"
                            placeholder="GitLab OAuth client ID"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7"
                        />
                    </div>
                    <p class="mt-4 text-sm text-x7">
                        OAuth device sign-in requires provider app registration. GitHub needs a client ID with device flow enabled. GitLab needs a host and client ID.
                    </p>
                    <Button class="mt-4" severity="secondary" :disabled="tasks.isBusy" @click="saveProviderSettings"> Save OAuth settings </Button>
                </section>

                <section v-if="selectedAccount" class="rounded-[20px] border border-white/10 bg-white/4 p-5">
                    <p class="text-xs font-semibold uppercase tracking-[0.22em] text-x7">Edit account</p>
                    <div class="mt-4 grid gap-3 sm:grid-cols-2">
                        <input
                            v-model="selectedAccountForm.label"
                            type="text"
                            placeholder="Account label"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7 sm:col-span-2"
                        />
                        <div class="rounded-xl border border-white/10 bg-x0/60 p-4">
                            <p class="text-xs uppercase tracking-[0.18em] text-x7">Provider</p>
                            <p class="mt-2 text-sm text-white">{{ selectedAccount.provider }}</p>
                        </div>
                        <div class="rounded-xl border border-white/10 bg-x0/60 p-4">
                            <p class="text-xs uppercase tracking-[0.18em] text-x7">Auth kind</p>
                            <p class="mt-2 text-sm text-white">{{ selectedAccount.authKind }}</p>
                        </div>
                        <input
                            v-if="selectedAccount.authKind === 'https-token'"
                            v-model="selectedAccountForm.username"
                            type="text"
                            placeholder="Remote username"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7"
                        />
                        <input
                            v-if="selectedAccount.authKind === 'https-token'"
                            v-model="selectedAccountForm.host"
                            type="text"
                            placeholder="Git host"
                            :disabled="selectedAccount.provider !== 'custom'"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <input
                            v-if="selectedAccount.authKind === 'https-token'"
                            v-model="selectedAccountForm.accessToken"
                            type="password"
                            placeholder="Replace stored token"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7 sm:col-span-2"
                        />
                        <div class="rounded-xl border border-white/10 bg-x0/60 p-4 sm:col-span-2">
                            <p class="text-xs uppercase tracking-[0.18em] text-x7">Stored secret</p>
                            <p class="mt-2 text-sm text-white">{{ selectedAccount.hasSecret ? 'Saved in macOS Keychain' : 'Not used' }}</p>
                        </div>
                    </div>

                    <label class="mt-4 flex items-center gap-3 text-sm text-default">
                        <input v-model="selectedAccountForm.setAsDefault" type="checkbox" class="h-4 w-4 rounded border-white/20 bg-x0/80" />
                        Set as default account
                    </label>

                    <div class="mt-4 flex gap-3">
                        <Button severity="secondary" :disabled="tasks.isBusy || !canSaveSelectedAccount" @click="saveSelectedAccount"> Save account </Button>
                        <Button severity="danger" :disabled="tasks.isBusy" @click="removeSelectedAccount"> Delete account </Button>
                    </div>
                </section>

                <section v-else-if="selAccountId === 'create'" class="rounded-[20px] border border-white/10 bg-white/4 p-5">
                    <p class="text-xs font-semibold uppercase tracking-[0.22em] text-x7">Create account</p>
                    <div class="mt-4 grid gap-3">
                        <input
                            v-model="createAccountForm.label"
                            type="text"
                            placeholder="Account label"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7"
                        />
                        <select v-model="createAccountForm.provider" class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none">
                            <option value="github">GitHub</option>
                            <option value="gitlab">GitLab</option>
                            <option value="bitbucket">Bitbucket</option>
                            <option value="custom">Custom</option>
                            <option value="system">System</option>
                        </select>
                        <select v-model="createAccountForm.authKind" class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none">
                            <option value="system-git">System Git</option>
                            <option value="https-token">HTTPS Token</option>
                            <option value="oauth" :disabled="!['github', 'gitlab'].includes(createAccountForm.provider)">OAuth device sign-in</option>
                        </select>
                        <input
                            v-if="usesTokenAuth"
                            v-model="createAccountForm.username"
                            type="text"
                            placeholder="Remote username (optional for supported providers)"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7"
                        />
                        <input
                            v-if="usesTokenAuth"
                            v-model="createAccountForm.host"
                            type="text"
                            :placeholder="requiresCustomHost ? 'Git host (for example git.example.com)' : 'Git host'"
                            :disabled="createAccountForm.provider !== 'custom'"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <input
                            v-if="usesTokenAuth"
                            v-model="createAccountForm.accessToken"
                            type="password"
                            placeholder="Personal access token"
                            class="w-full rounded-lg border border-white/10 bg-x0/80 px-4 py-3 text-sm text-white outline-none placeholder:text-x7"
                        />
                    </div>

                    <p v-if="usesTokenAuth" class="mt-4 text-sm text-x7">
                        Supported providers verify the token before the account is saved. Tokens are stored in macOS Keychain and used for HTTPS remote operations.
                    </p>
                    <p v-else-if="usesOAuthAuth" class="mt-4 text-sm text-x7">
                        Device sign-in opens the provider in your browser and polls until authorization completes. GitHub and GitLab only.
                    </p>

                    <div v-if="auth.oauthDeviceFlow" class="mt-4 rounded-xl border border-white/10 bg-x0/60 p-4 text-sm text-white">
                        <p class="font-medium">Waiting for {{ auth.oauthDeviceFlow.provider }} authorization</p>
                        <p class="mt-2 text-x7">Code: {{ auth.oauthDeviceFlow.userCode }}</p>
                        <p class="mt-1 text-x7">URL: {{ auth.oauthDeviceFlow.verificationUriComplete || auth.oauthDeviceFlow.verificationUri }}</p>
                    </div>

                    <label class="mt-4 flex items-center gap-3 text-sm text-default">
                        <input v-model="createAccountForm.setAsDefault" type="checkbox" class="h-4 w-4 rounded border-white/20 bg-x0/80" />
                        Set as default account
                    </label>

                    <Button class="mt-4" :disabled="tasks.isBusy || !canCreateAccount" @click="createAccount()">
                        {{ usesOAuthAuth ? 'Start sign-in' : 'Create account' }}
                    </Button>
                </section>

                <section v-else class="p-5">
                    <p class="text-xs font-semibold uppercase tracking-[0.22em] text-x7">No account selected</p>
                </section>
            </div>
        </main>
    </div>
</template>
