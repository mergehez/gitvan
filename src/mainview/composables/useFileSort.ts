import { ref } from 'vue';
import { FILE_SORT_MODE_VALUES, type FileSortMode } from '../lib/fileSort';

const STORAGE_KEY_PREFIX = 'gitvan-file-sort-';

function loadSortMode(key: string): FileSortMode {
    try {
        const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${key}`);
        if (raw && (FILE_SORT_MODE_VALUES as readonly string[]).includes(raw)) {
            return raw as FileSortMode;
        }
    } catch {
        // ignore storage errors
    }

    return 'default';
}

export function useFileSort(key: string) {
    const mode = ref<FileSortMode>(loadSortMode(key));

    function setMode(next: FileSortMode) {
        mode.value = next;

        try {
            localStorage.setItem(`${STORAGE_KEY_PREFIX}${key}`, next);
        } catch {
            // ignore storage errors
        }
    }

    return {
        mode,
        setMode,
    };
}
