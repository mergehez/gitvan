import { ref, watch, type Ref } from 'vue';

const STORAGE_KEY_PREFIX = 'gitvan-ui-';

function loadFlag(key: string, fallback: boolean) {
    try {
        const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${key}`);
        if (raw === 'true' || raw === 'false') {
            return raw === 'true';
        }
    } catch {
        // ignore storage errors
    }

    return fallback;
}

export function usePersistedFlag(key: string, fallback: boolean): Ref<boolean> {
    const flag = ref(loadFlag(key, fallback));

    watch(flag, (next) => {
        try {
            localStorage.setItem(`${STORAGE_KEY_PREFIX}${key}`, String(next));
        } catch {
            // ignore storage errors
        }
    });

    return flag;
}

/** Shared so the changes view menu and the repo actions read the same value. */
export const confirmDiscards = usePersistedFlag('confirm-discards', true);
