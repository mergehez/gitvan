import { describe, expect, it } from 'vitest';
import { areEquivalentIgnoringDiffChars as areEquivalentIgnoringDiffCharsShared, isJavaScriptTypeScriptPath } from '../../../shared/diffIgnoredChars';
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

describe('module import ordering', () => {
    const reorderedImports = {
        original: "import { b } from './b';\nimport { a } from './a';\n\nconst total = a + b;\n",
        modified: "import { a } from './a';\nimport { b } from './b';\n\nconst total = a + b;\n",
    };

    it('treats reordered module imports as equivalent for the shared helper', () => {
        expect(areEquivalentIgnoringDiffCharsShared(reorderedImports.original, reorderedImports.modified, '', true, { sortModuleImports: true })).toBe(true);
    });

    it('keeps module import order significant when import sorting is off', () => {
        expect(areEquivalentIgnoringDiffCharsShared(reorderedImports.original, reorderedImports.modified, '', true)).toBe(false);
    });

    it('treats reordered module imports as equivalent for the diff editor helper', () => {
        expect(areEquivalentIgnoringDiffChars(reorderedImports.original, reorderedImports.modified, '', false, { sortModuleImports: true })).toBe(true);
    });

    it('ignores reordered multi-line import statements', () => {
        const original = "import {\n  b,\n  c,\n} from './bc';\nimport { a } from './a';\n\nconst total = a + b + c;\n";
        const modified = "import { a } from './a';\nimport {\n  b,\n  c,\n} from './bc';\n\nconst total = a + b + c;\n";

        expect(areEquivalentIgnoringDiffCharsShared(original, modified, '', true, { sortModuleImports: true })).toBe(true);
    });

    it('keeps side-effect import order significant', () => {
        const original = "import './polyfill';\nimport { b } from './b';\nimport { a } from './a';\n";
        const modified = "import { a } from './a';\nimport { b } from './b';\nimport './polyfill';\n";

        expect(areEquivalentIgnoringDiffCharsShared(original, modified, '', true, { sortModuleImports: true })).toBe(false);
    });

    it('still reports real import edits', () => {
        const original = "import { b } from './b';\nimport { a } from './a';\n";
        const modified = "import { a } from './a';\nimport { c } from './c';\n";

        expect(areEquivalentIgnoringDiffCharsShared(original, modified, '', true, { sortModuleImports: true })).toBe(false);
    });

    it('keeps shadow diff maps aligned with the reordered lines', () => {
        const stripped = stripIgnoredCharsWithMaps("import { b } from './b';\nimport { a } from './a';\n", '', false, { sortModuleImports: true });

        expect(stripped.text).toBe("import { a } from './a';\nimport { b } from './b';\n");
        expect(stripped.lineMaps).toHaveLength(stripped.text.split('\n').length);
    });

    it('does not reorder statements outside the import preamble', () => {
        const original = 'const first = 1;\nconst second = 2;\n';
        const modified = 'const second = 2;\nconst first = 1;\n';

        expect(areEquivalentIgnoringDiffCharsShared(original, modified, '', true, { sortModuleImports: true })).toBe(false);
    });

    it('only enables module import sorting for script paths', () => {
        expect(isJavaScriptTypeScriptPath('src/values.ts')).toBe(true);
        expect(isJavaScriptTypeScriptPath('src/values.TSX')).toBe(true);
        expect(isJavaScriptTypeScriptPath('src/values.mjs')).toBe(true);
        expect(isJavaScriptTypeScriptPath('story.txt')).toBe(false);
        expect(isJavaScriptTypeScriptPath('.gitignore')).toBe(false);
    });
});
