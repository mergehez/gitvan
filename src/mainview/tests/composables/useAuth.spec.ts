import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _useAccounts } from '../../composables/useAuth';

const { mockTasks, mockToast, mockCoreState, mockContextMenu } = vi.hoisted(() => ({
    mockTasks: {
        startOAuthDeviceFlow: {
            run: vi.fn(),
        },
        openExternalUrl: {
            run: vi.fn(),
        },
        pollOAuthDeviceFlow: {
            run: vi.fn(),
        },
        createAccount: {
            run: vi.fn(),
        },
        reorderAccount: {
            run: vi.fn(),
        },
        updateAccount: {
            run: vi.fn(),
        },
        deleteAccount: {
            run: vi.fn(),
        },
        assignRepoAccount: {
            run: vi.fn(),
        },
    },
    mockToast: {
        showSuccessToast: vi.fn(),
    },
    mockCoreState: {
        accounts: [],
        selectedRepoId: undefined,
        applyBootstrap: vi.fn(),
    },
    mockContextMenu: {
        openAtEvent: vi.fn(),
        openAtViewportCenter: vi.fn(),
    },
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: mockTasks,
}));

vi.mock('../../composables/coreState', () => ({
    _coreState: mockCoreState,
}));

vi.mock('../../composables/useToast', () => ({
    toast: mockToast,
}));

vi.mock('../../composables/useContextMenu', () => ({
    useContextMenu: () => mockContextMenu,
}));

vi.mock('../../lib/utils', () => ({
    confirmAction: vi.fn(async () => true),
}));

describe('useAuth startOAuthDeviceFlow', () => {
    beforeEach(() => {
        mockTasks.startOAuthDeviceFlow.run.mockReset();
        mockTasks.openExternalUrl.run.mockReset();
        mockTasks.pollOAuthDeviceFlow.run.mockReset();
        mockToast.showSuccessToast.mockReset();
        mockCoreState.applyBootstrap.mockReset();
        mockCoreState.accounts = [];
        mockCoreState.selectedRepoId = undefined;
    });

    it('opens the verification URL after starting the device flow', async () => {
        const auth = _useAccounts();

        mockTasks.startOAuthDeviceFlow.run.mockResolvedValue({
            sessionId: 'session-1',
            provider: 'github',
            verificationUri: 'https://github.com/login/device',
            verificationUriComplete: 'https://github.com/login/device?user_code=ABCD-EFGH',
            userCode: 'ABCD-EFGH',
            intervalSeconds: 5,
            expiresAt: '2026-04-13T12:00:00.000Z',
        });
        mockTasks.openExternalUrl.run.mockResolvedValue(undefined);
        mockTasks.pollOAuthDeviceFlow.run.mockResolvedValue({ status: 'pending' });

        await auth.startOAuthDeviceFlow('github', { label: 'GitHub', setAsDefault: true });

        expect(mockTasks.openExternalUrl.run).toHaveBeenCalledWith({ url: 'https://github.com/login/device?user_code=ABCD-EFGH' });
        expect(auth.oauthDeviceFlow?.sessionId).toBe('session-1');
    });

    it('clears device-flow state when opening the verification URL fails', async () => {
        const auth = _useAccounts();

        mockTasks.startOAuthDeviceFlow.run.mockResolvedValue({
            sessionId: 'session-2',
            provider: 'gitlab',
            verificationUri: 'https://gitlab.com/oauth/device',
            verificationUriComplete: undefined,
            userCode: 'ZXCV-BNMK',
            intervalSeconds: 5,
            expiresAt: '2026-04-13T12:00:00.000Z',
        });
        mockTasks.openExternalUrl.run.mockRejectedValue(new Error('Unable to open browser.'));

        await expect(auth.startOAuthDeviceFlow('gitlab', { label: 'GitLab', setAsDefault: false })).rejects.toThrow('Unable to open browser.');

        expect(auth.oauthDeviceFlow).toBeUndefined();
    });
});
