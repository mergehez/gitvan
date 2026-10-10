import { describe, expect, it } from 'vitest';
import {
    areEquivalentComparableDiffText,
    isJavaScriptTypeScriptPath,
    normalizeComparableDiffPair,
    normalizeComparableDiffText,
    normalizeDiffIgnoredChars,
} from '../../../shared/diffIgnoredChars';

const sectionFixtureOld = '{ key: "val" };\n{ num: \'42\' },';
const sectionFixtureNew = '{key:\'val\'},{num:"42"};';

describe('diffIgnoredChars', () => {
    it('removes ignored punctuation from the comparable diff text for the user example', () => {
        const original = normalizeComparableDiffText('role: "admin";', ',;"\'', false);
        const modified = normalizeComparableDiffText("role:'admin',", ',;"\'', false);

        expect(original).toBe('role:admin');
        expect(modified).toBe('role:admin');
    });

    it('treats the user example as equivalent when ignored punctuation is removed', () => {
        expect(areEquivalentComparableDiffText('role: "admin";', "role:'admin',", ',;"\'', false)).toBe(true);
    });

    it('treats punctuation-and-whitespace-only chunks as equivalent when both filters apply', () => {
        expect(areEquivalentComparableDiffText('role: "admin";', "role:'admin',", ',;"\'', true)).toBe(true);
    });

    it('keeps explicit whitespace significant when whitespace changes are visible', () => {
        expect(areEquivalentComparableDiffText('role: admin', 'role:admin', '', false)).toBe(false);
    });

    it('treats inline fixtures as equivalent with the shared helper while whitespace is hidden', () => {
        expect(areEquivalentComparableDiffText(sectionFixtureOld, sectionFixtureNew, ',;"\'', true)).toBe(true);
    });

    it('keeps inline fixtures whitespace-sensitive when whitespace is visible', () => {
        expect(areEquivalentComparableDiffText(sectionFixtureOld, sectionFixtureNew, ',;"\'', false)).toBe(false);
    });

    it('preserves line structure while stripping whitespace from the comparable diff text', () => {
        expect(normalizeComparableDiffText('a \n b\t', '', true)).toBe('a\nb');
    });
});

describe('comparable diff pair', () => {
    it('reports both normalized sides from one pass', () => {
        const pair = normalizeComparableDiffPair('role: "admin";', "role:'admin',", true, { ignoredChars: ',;"\'' });

        expect(pair.original).toBe('role:admin');
        expect(pair.modified).toBe('role:admin');
        expect(pair.hasVisibleChanges).toBe(false);
    });

    it('keeps a real content change visible', () => {
        expect(normalizeComparableDiffPair('one\nline\n', 'one\nchanged\n', true).hasVisibleChanges).toBe(true);
    });

    it('counts the conflict markers on the modified side', () => {
        const pair = normalizeComparableDiffPair('ours\n', '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n', false);

        expect(pair.conflictMarkerCount).toBe(1);
        expect(pair.hasVisibleChanges).toBe(true);
    });

    it('counts conflict markers with whitespace stripping on', () => {
        expect(normalizeComparableDiffPair('ours\n', '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n', true).conflictMarkerCount).toBe(1);
    });

    it('reports no conflict markers for a clean file', () => {
        expect(normalizeComparableDiffPair('a\n', 'b\n', true).conflictMarkerCount).toBe(0);
    });
});

describe('normalizer fast path', () => {
    it('returns the input untouched when nothing can be stripped', () => {
        const text = 'const value = 1;\n';

        expect(normalizeComparableDiffText(text, '', false)).toBe(text);
    });

    it('still strips whitespace when whitespace hiding is on', () => {
        expect(normalizeComparableDiffText('a \n b\t', '', true)).toBe('a\nb');
    });

    it('still strips ignored characters when whitespace hiding is off', () => {
        expect(normalizeComparableDiffText('role: "admin";', ',;"\'', false)).toBe('role:admin');
    });

    it('reduces an ignored-character setting to its usable characters', () => {
        expect(normalizeDiffIgnoredChars(' , ,"')).toBe(',"');
    });
});

describe('module import ordering', () => {
    const reorderedImports = {
        original: "import { b } from './b';\nimport { a } from './a';\n\nconst total = a + b;\n",
        modified: "import { a } from './a';\nimport { b } from './b';\n\nconst total = a + b;\n",
    };

    it('treats reordered module imports as equivalent for the shared helper', () => {
        expect(areEquivalentComparableDiffText(reorderedImports.original, reorderedImports.modified, '', true, { sortModuleImports: true })).toBe(true);
    });

    it('keeps module import order significant when import sorting is off', () => {
        expect(areEquivalentComparableDiffText(reorderedImports.original, reorderedImports.modified, '', true)).toBe(false);
    });

    it('treats reordered module imports as equivalent when whitespace is visible too', () => {
        expect(areEquivalentComparableDiffText(reorderedImports.original, reorderedImports.modified, '', false, { sortModuleImports: true })).toBe(true);
    });

    it('ignores reordered multi-line import statements', () => {
        const original = "import {\n  b,\n  c,\n} from './bc';\nimport { a } from './a';\n\nconst total = a + b + c;\n";
        const modified = "import { a } from './a';\nimport {\n  b,\n  c,\n} from './bc';\n\nconst total = a + b + c;\n";

        expect(areEquivalentComparableDiffText(original, modified, '', true, { sortModuleImports: true })).toBe(true);
    });

    it('keeps side-effect import order significant', () => {
        const original = "import './polyfill';\nimport { b } from './b';\nimport { a } from './a';\n";
        const modified = "import { a } from './a';\nimport { b } from './b';\nimport './polyfill';\n";

        expect(areEquivalentComparableDiffText(original, modified, '', true, { sortModuleImports: true })).toBe(false);
    });

    it('still reports real import edits', () => {
        const original = "import { b } from './b';\nimport { a } from './a';\n";
        const modified = "import { a } from './a';\nimport { c } from './c';\n";

        expect(areEquivalentComparableDiffText(original, modified, '', true, { sortModuleImports: true })).toBe(false);
    });

    it('reorders the comparable text into the canonical import order', () => {
        const normalized = normalizeComparableDiffText("import { b } from './b';\nimport { a } from './a';\n", '', false, { sortModuleImports: true });

        expect(normalized).toBe("import { a } from './a';\nimport { b } from './b';\n");
    });

    it('does not reorder statements outside the import preamble', () => {
        const original = 'const first = 1;\nconst second = 2;\n';
        const modified = 'const second = 2;\nconst first = 1;\n';

        expect(areEquivalentComparableDiffText(original, modified, '', true, { sortModuleImports: true })).toBe(false);
    });

    it('only enables module import sorting for script paths', () => {
        expect(isJavaScriptTypeScriptPath('src/values.ts')).toBe(true);
        expect(isJavaScriptTypeScriptPath('src/values.TSX')).toBe(true);
        expect(isJavaScriptTypeScriptPath('src/values.mjs')).toBe(true);
        expect(isJavaScriptTypeScriptPath('story.txt')).toBe(false);
        expect(isJavaScriptTypeScriptPath('.gitignore')).toBe(false);
    });
});
