import { beforeEach, describe, expect, it } from 'vitest';
import { useFileSort } from '../../composables/useFileSort';

describe('useFileSort', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to default mode', () => {
        const sort = useFileSort('test');
        expect(sort.mode.value).toBe('default');
    });

    it('persists the selected mode', () => {
        const sort = useFileSort('test');
        sort.setMode('type-a-z');
        expect(sort.mode.value).toBe('type-a-z');
        expect(localStorage.getItem('gitvan-file-sort-test')).toBe('type-a-z');
    });

    it('restores a persisted mode', () => {
        localStorage.setItem('gitvan-file-sort-test', 'z-a');
        const sort = useFileSort('test');
        expect(sort.mode.value).toBe('z-a');
    });

    it('falls back to default for unknown stored values', () => {
        localStorage.setItem('gitvan-file-sort-test', 'bogus');
        const sort = useFileSort('test');
        expect(sort.mode.value).toBe('default');
    });
});
