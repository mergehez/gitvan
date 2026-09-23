import { describe, expect, it } from 'vitest';
import { statusClass, statusLetter } from '../../lib/utils';

describe('change status indicators', () => {
    it('shows leftover conflict markers as a conflict indicator whatever the status is', () => {
        expect(statusLetter({ status: 'modified', hasConflictMarkers: true })).toBe('!');
        expect(statusClass({ status: 'modified', hasConflictMarkers: true })).toBe('text-red-400');
    });

    it('keeps the plain status indicator when nothing is left to resolve', () => {
        expect(statusLetter({ status: 'modified' })).toBe('M');
        expect(statusClass({ status: 'modified' })).toBe('text-amber-400');
    });

    it('still marks an index-level conflict as conflicted', () => {
        expect(statusLetter({ status: 'unmerged' })).toBe('!');
        expect(statusClass({ status: 'unmerged' })).toBe('text-red-400');
    });
});
