import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { usePersistedFlag } from '../../composables/useUiPreferences';

describe('usePersistedFlag', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('uses the fallback when nothing is stored', () => {
        expect(usePersistedFlag('test-flag', true).value).toBe(true);
        expect(usePersistedFlag('other-flag', false).value).toBe(false);
    });

    it('persists changes', async () => {
        const flag = usePersistedFlag('test-flag', false);
        flag.value = true;
        await nextTick();

        expect(flag.value).toBe(true);
        expect(localStorage.getItem('gitvan-ui-test-flag')).toBe('true');
    });

    it('restores a persisted value', () => {
        localStorage.setItem('gitvan-ui-test-flag', 'true');

        expect(usePersistedFlag('test-flag', false).value).toBe(true);
    });

    it('falls back for unknown stored values', () => {
        localStorage.setItem('gitvan-ui-test-flag', 'bogus');

        expect(usePersistedFlag('test-flag', true).value).toBe(true);
    });
});
