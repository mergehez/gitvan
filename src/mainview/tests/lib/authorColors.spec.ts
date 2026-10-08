import { describe, expect, it } from 'vitest';
import { AUTHOR_COLORS, authorColor, authorColorIndex } from '../../lib/authorColors';

describe('authorColors', () => {
    it('returns the same colour for the same author regardless of case or padding', () => {
        expect(authorColor('  John@Example.com ')).toBe(authorColor('john@example.com'));
    });

    it('always maps into the muted palette', () => {
        for (const key of ['mazlum@example.com', 'someone@else.dev', 'a', '']) {
            expect(AUTHOR_COLORS).toContain(authorColor(key));
            expect(authorColorIndex(key)).toBeGreaterThanOrEqual(0);
            expect(authorColorIndex(key)).toBeLessThan(AUTHOR_COLORS.length);
        }
    });

    it('gives different authors different colours', () => {
        expect(authorColor('mazlum@example.com')).not.toBe(authorColor('other.dev@example.com'));
    });

    it('falls back to the first colour for an empty key', () => {
        expect(authorColor('')).toBe(AUTHOR_COLORS[0]);
    });
});
