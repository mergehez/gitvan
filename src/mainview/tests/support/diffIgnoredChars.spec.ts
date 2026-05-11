import { describe, expect, it } from 'vitest';
import { areEquivalentIgnoringDiffChars as areEquivalentIgnoringDiffCharsShared } from '../../../shared/diffIgnoredChars';
import { areEquivalentIgnoringDiffChars, stripIgnoredCharsWithMaps } from '../../lib/diffIgnoredChars';

const sectionFixtureOld = '{ key: "val" };\n{ num: \'42\' },';
const sectionFixtureNew = '{key:\'val\'},{num:"42"};';

describe('diffIgnoredChars', () => {
    it('removes ignored punctuation from shadow diff text for the user example', () => {
        const original = stripIgnoredCharsWithMaps('role: "admin";', ',;"\'');
        const modified = stripIgnoredCharsWithMaps("role:'admin',", ',;"\'');

        expect(original.text).toBe('role:admin');
        expect(modified.text).toBe('role:admin');
    });

    it('treats the user example as equivalent when ignored punctuation is removed', () => {
        expect(areEquivalentIgnoringDiffChars('role: "admin";', "role:'admin',", ',;"\'', false)).toBe(true);
    });

    it('treats punctuation-and-whitespace-only chunks as equivalent when both filters apply', () => {
        expect(areEquivalentIgnoringDiffChars('role: "admin";', "role:'admin',", ',;"\'', true)).toBe(true);
    });

    it('keeps explicit whitespace significant when whitespace changes are visible', () => {
        expect(areEquivalentIgnoringDiffChars('role: admin', 'role:admin', '', false)).toBe(false);
    });

    it('treats inline fixtures as equivalent with the shared helper when whitespace is hidden', () => {
        expect(areEquivalentIgnoringDiffCharsShared(sectionFixtureOld, sectionFixtureNew, ',;"\'', true)).toBe(true);
    });

    it('keeps inline fixtures line-sensitive in the Monaco diff helper', () => {
        expect(areEquivalentIgnoringDiffChars(sectionFixtureOld, sectionFixtureNew, ',;"\'', true)).toBe(false);
    });

    it('preserves line structure while stripping whitespace from shadow diff text', () => {
        const stripped = stripIgnoredCharsWithMaps('a \n b\t', '', true);

        expect(stripped.text).toBe('a\nb');
        expect(stripped.lineMaps).toEqual([
            [1, 2],
            [2, 3],
        ]);
    });
});
