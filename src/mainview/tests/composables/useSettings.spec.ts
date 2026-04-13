import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _useSettings } from '../../composables/useSettings';

const { mockTasks, mockToast } = vi.hoisted(() => ({
    mockTasks: {
        pickEditorApplication: {
            run: vi.fn(),
        },
        pickTerminalApplication: {
            run: vi.fn(),
        },
        openFileInEditor: {
            run: vi.fn(),
        },
        updateEditorSettings: {
            run: vi.fn(),
        },
        updateOAuthProviderSettings: {
            run: vi.fn(),
        },
    },
    mockToast: {
        showSuccessToast: vi.fn(),
    },
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: mockTasks,
}));

vi.mock('../../composables/useToast', () => ({
    toast: mockToast,
}));

describe('useSettings openRepoPathInEditor', () => {
    beforeEach(() => {
        mockTasks.pickEditorApplication.run.mockReset();
        mockTasks.pickTerminalApplication.run.mockReset();
        mockTasks.openFileInEditor.run.mockReset();
        mockTasks.updateEditorSettings.run.mockReset();
        mockTasks.updateOAuthProviderSettings.run.mockReset();
        mockToast.showSuccessToast.mockReset();
    });

    it('retries with the picker when the default editor no longer exists on disk', async () => {
        const settings = _useSettings();
        settings.state.defaultEditorPath = '/Applications/Missing.app';

        mockTasks.openFileInEditor.run.mockRejectedValueOnce(new Error('The selected editor no longer exists on disk.')).mockResolvedValueOnce(undefined);
        mockTasks.pickEditorApplication.run.mockResolvedValue({
            path: '/Applications/Visual Studio Code.app',
            label: 'Visual Studio Code',
        });

        await settings.openRepoPathInEditor({ repoId: 7, path: 'README.md' });

        expect(mockTasks.openFileInEditor.run).toHaveBeenNthCalledWith(
            1,
            {
                repoId: 7,
                path: 'README.md',
                editorPath: '/Applications/Missing.app',
            },
            undefined
        );
        expect(mockTasks.pickEditorApplication.run).toHaveBeenCalledWith(undefined);
        expect(mockTasks.openFileInEditor.run).toHaveBeenNthCalledWith(
            2,
            {
                repoId: 7,
                path: 'README.md',
                editorPath: '/Applications/Visual Studio Code.app',
            },
            undefined
        );
    });

    it('stops cleanly when the picker is canceled after a stale default editor failure', async () => {
        const settings = _useSettings();
        settings.state.defaultEditorPath = '/Applications/Missing.app';

        mockTasks.openFileInEditor.run.mockRejectedValueOnce(new Error('The selected editor no longer exists on disk.'));
        mockTasks.pickEditorApplication.run.mockResolvedValue(undefined);

        await settings.openRepoPathInEditor({ repoId: 7, path: 'README.md' });

        expect(mockTasks.openFileInEditor.run).toHaveBeenCalledTimes(1);
        expect(mockTasks.pickEditorApplication.run).toHaveBeenCalledTimes(1);
    });
});
