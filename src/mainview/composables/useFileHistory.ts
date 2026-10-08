import { useRepos } from './useRepos';
import { useSettings } from './useSettings';

/**
 * Opens a file's commit history in the History view. Renames are left out by default;
 * the pinned header offers to fold them back in.
 */
export function useFileHistory() {
    const repos = useRepos();
    const settings = useSettings();

    async function openFileHistory(path: string) {
        const repo = repos.getSelectedRepo();
        if (!repo) {
            return;
        }

        // Pin the path before switching views so the view-change refresh loads the file
        // history instead of the recent-commit page.
        repo.beginFileHistory(path);
        const wasOnHistoryView = settings.state.activeView === 'history';
        await settings.setActiveView('history');

        // Switching views already triggers a load for the target view; only load here
        // when we were on it already and no view-change refresh will happen.
        if (wasOnHistoryView) {
            await repo.loadFileHistory();
        }
    }

    return { openFileHistory };
}
