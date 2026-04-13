import { reactive } from 'vue';
import type { OAuthDeviceStartResult, OAuthProvider } from '../../shared/gitClient';
import type { ContextMenuEntry } from '../components/contextMenuTypes';
import { confirmAction } from '../lib/utils';
import { _coreState } from './coreState';
import { useContextMenu } from './useContextMenu';
import { RepositoryState } from './useRepo';
import { tasks } from './useTasks';
import { toast } from './useToast';

export type CreateAccountParams = {
    label: string;
    provider: string;
    authKind: string;
    username: string | undefined;
    host: string | undefined;
    accessToken: string | undefined;
    setAsDefault: boolean;
};

export function _useAccounts() {
    let oauthPollingHandle: number | undefined = undefined;
    const contextMenu = useContextMenu();

    function clearOAuthPolling() {
        if (oauthPollingHandle !== undefined) {
            window.clearTimeout(oauthPollingHandle);
            oauthPollingHandle = undefined;
        }
    }

    return reactive({
        get accounts() {
            return _coreState.accounts;
        },
        oauthDeviceFlow: undefined as OAuthDeviceStartResult | undefined,

        async _pollOAuthDeviceFlow(sessionId: string, intervalSeconds: number, provider: OAuthProvider) {
            const result = await tasks.pollOAuthDeviceFlow.run({ sessionId });

            if (result.status === 'completed') {
                clearOAuthPolling();
                this.oauthDeviceFlow = undefined;
                _coreState.applyBootstrap(result.bootstrap);
                toast.showSuccessToast(`${provider === 'github' ? 'GitHub' : 'GitLab'} account connected.`);
                return;
            }

            oauthPollingHandle = window.setTimeout(() => {
                void this._pollOAuthDeviceFlow(sessionId, intervalSeconds, provider).catch(() => {
                    clearOAuthPolling();
                    this.oauthDeviceFlow = undefined;
                });
            }, intervalSeconds * 1000);
        },

        async startOAuthDeviceFlow(provider: OAuthProvider, params: { label: string; setAsDefault: boolean }) {
            clearOAuthPolling();

            try {
                const result = await tasks.startOAuthDeviceFlow.run({
                    provider,
                    label: params.label,
                    setAsDefault: params.setAsDefault,
                });

                await tasks.openExternalUrl.run({ url: result.verificationUriComplete ?? result.verificationUri });
                this.oauthDeviceFlow = result;
                await this._pollOAuthDeviceFlow(result.sessionId, result.intervalSeconds, provider);
            } catch (error) {
                clearOAuthPolling();
                this.oauthDeviceFlow = undefined;
                throw error;
            }
        },
        async promptRepoAccountAssignment(selectedRepo: RepositoryState, event?: MouseEvent) {
            const items: ContextMenuEntry[] = [
                {
                    id: `assign-account:none:${selectedRepo.id}`,
                    label: 'Unassigned',
                    checked: selectedRepo.accountId === undefined,
                    disabled: selectedRepo.accountId === undefined,
                    action: async () => {
                        await this.assignAccountToRepo(selectedRepo.id, undefined);
                    },
                },
                ...(this.accounts.length > 0 ? ([{ type: 'separator' as const, id: `assign-account-separator:${selectedRepo.id}` }] as ContextMenuEntry[]) : []),
                ...this.accounts.map((account) => ({
                    id: `assign-account:${selectedRepo.id}:${account.id}`,
                    label: `${account.label}${account.host && account.host !== 'github.com' ? ` (${account.host})` : ''}`,
                    checked: selectedRepo.accountId === account.id,
                    disabled: selectedRepo.accountId === account.id,
                    action: async () => {
                        await this.assignAccountToRepo(selectedRepo.id, account.id);
                    },
                })),
            ];

            if (event) {
                contextMenu.openAtEvent(event, items);
                return;
            }

            contextMenu.openAtViewportCenter(items);
        },
        async createAccount(params: CreateAccountParams) {
            if (params.authKind === 'oauth') {
                await this.startOAuthDeviceFlow(params.provider as OAuthProvider, {
                    label: params.label,
                    setAsDefault: params.setAsDefault,
                });
                return;
            }

            const nextBootstrap = await tasks.createAccount.run({
                label: params.label,
                provider: params.provider,
                authKind: params.authKind,
                username: params.username,
                host: params.host,
                accessToken: params.accessToken,
                setAsDefault: params.setAsDefault,
            });

            _coreState.applyBootstrap(nextBootstrap);
            toast.showSuccessToast('Account created.');
        },
        async reorderAccount(accountId: number, toIndex: number) {
            const nextBootstrap = await tasks.reorderAccount.run({ accountId, toIndex });

            _coreState.applyBootstrap(nextBootstrap);
        },
        async updateAccount(params: {
            accountId: number;
            label: string;
            username: string | undefined;
            host: string | undefined;
            accessToken: string | undefined;
            setAsDefault: boolean;
        }) {
            const nextBootstrap = await tasks.updateAccount.run(params);

            _coreState.applyBootstrap(nextBootstrap);
            toast.showSuccessToast('Account updated.');
        },
        async deleteAccount(accountId: number) {
            const account = this.accounts.find((entry) => entry.id === accountId);
            const confirmed = await confirmAction({
                title: 'Delete account',
                message: `Delete ${account?.label ?? 'this account'}?`,
                detail: 'This removes the saved account from Gitvan and deletes its stored secret.',
                confirmLabel: 'Delete account',
            });

            if (!confirmed) {
                return;
            }

            const nextBootstrap = await tasks.deleteAccount.run({ accountId });

            _coreState.applyBootstrap(nextBootstrap);
            toast.showSuccessToast('Account deleted.');
        },
        async assignRepoAccount(accountId: number | undefined) {
            if (!_coreState.selectedRepoId) {
                return;
            }

            await this.assignAccountToRepo(_coreState.selectedRepoId, accountId);
        },
        async assignAccountToRepo(repoId: number, accountId: number | undefined) {
            const nextBootstrap = await tasks.assignRepoAccount.run({
                repoId,
                accountId,
            });

            _coreState.applyBootstrap(nextBootstrap);
            // toast.showSuccessToast(accountId === undefined ? 'Repository account cleared.' : 'Repository account assigned.');
        },
    });
}

let accountsSingleton: ReturnType<typeof _useAccounts> | undefined = undefined;
export function useAuth() {
    if (!accountsSingleton) {
        accountsSingleton = _useAccounts();
    }
    return accountsSingleton!;
}
