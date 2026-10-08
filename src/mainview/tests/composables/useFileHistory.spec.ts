import { beforeEach, describe, expect, it, vi } from 'vitest';

const { beginFileHistory, loadFileHistory, setActiveView, settingsState, reposState } = vi.hoisted(() => ({
    beginFileHistory: vi.fn(),
    loadFileHistory: vi.fn(async () => undefined),
    setActiveView: vi.fn(async () => undefined),
    settingsState: { activeView: 'changes' } as { activeView: string },
    reposState: { repo: undefined as unknown },
}));

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => ({
        getSelectedRepo: () => reposState.repo,
    }),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: settingsState,
        setActiveView,
    }),
}));

import { useFileHistory } from '../../composables/useFileHistory';

describe('useFileHistory', () => {
    beforeEach(() => {
        beginFileHistory.mockReset();
        loadFileHistory.mockClear();
        setActiveView.mockClear();
        settingsState.activeView = 'changes';
        reposState.repo = { beginFileHistory, loadFileHistory };
    });

    it('pins the path and switches to the history view', async () => {
        await useFileHistory().openFileHistory('src/app.ts');

        expect(beginFileHistory).toHaveBeenCalledWith('src/app.ts');
        expect(setActiveView).toHaveBeenCalledWith('history');
        // The view change triggers the load, so it must not run twice.
        expect(loadFileHistory).not.toHaveBeenCalled();
    });

    it('loads immediately when the history view is already open', async () => {
        settingsState.activeView = 'history';

        await useFileHistory().openFileHistory('src/app.ts');

        expect(setActiveView).toHaveBeenCalledWith('history');
        expect(loadFileHistory).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no repository is selected', async () => {
        reposState.repo = undefined;

        await useFileHistory().openFileHistory('src/app.ts');

        expect(beginFileHistory).not.toHaveBeenCalled();
        expect(setActiveView).not.toHaveBeenCalled();
        expect(loadFileHistory).not.toHaveBeenCalled();
    });
});
