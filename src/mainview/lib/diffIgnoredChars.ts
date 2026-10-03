import { normalizeDiffIgnoredChars, orderModulePreludeLines, type DiffIgnoreOptions } from '../../shared/diffIgnoredChars';

function isIncidentalIgnoredWhitespace(line: string, index: number, ignored: Set<string>) {
    let previousIndex = index - 1;
    while (previousIndex >= 0 && /\s/u.test(line[previousIndex]!)) {
        previousIndex -= 1;
    }

    let nextIndex = index + 1;
    while (nextIndex < line.length && /\s/u.test(line[nextIndex]!)) {
        nextIndex += 1;
    }

    return (previousIndex >= 0 && ignored.has(line[previousIndex]!)) || (nextIndex < line.length && ignored.has(line[nextIndex]!));
}

export function normalizeComparableDiffText(value: string, ignoredChars: string, hideWhitespace: boolean, options: DiffIgnoreOptions = {}) {
    return stripIgnoredCharsWithMaps(value, ignoredChars, hideWhitespace, options).text;
}

export function areEquivalentIgnoringDiffChars(original: string, modified: string, ignoredChars: string, hideWhitespace: boolean, options: DiffIgnoreOptions = {}) {
    return normalizeComparableDiffText(original, ignoredChars, hideWhitespace, options) === normalizeComparableDiffText(modified, ignoredChars, hideWhitespace, options);
}

export function stripIgnoredCharsWithMaps(text: string, ignoredChars: string, hideWhitespace = false, options: DiffIgnoreOptions = {}) {
    const ignored = new Set(normalizeDiffIgnoredChars(ignoredChars).split(''));
    const lines = options.sortModuleImports === true ? orderModulePreludeLines(text.split('\n')) : text.split('\n');
    const lineMaps: number[][] = [];

    const normalizedText = lines
        .map((line) => {
            const normalizedChars: string[] = [];
            const boundaryColumns: number[] = [];
            let lastKeptColumnEnd = 1;

            for (let index = 0; index < line.length; index += 1) {
                const char = line[index]!;

                if (ignored.has(char)) {
                    continue;
                }

                if (/\s/u.test(char) && (hideWhitespace || isIncidentalIgnoredWhitespace(line, index, ignored))) {
                    continue;
                }

                normalizedChars.push(char);
                boundaryColumns.push(index + 1);
                lastKeptColumnEnd = index + 2;
            }

            lineMaps.push(boundaryColumns.length > 0 ? [...boundaryColumns, lastKeptColumnEnd] : [1]);

            return normalizedChars.join('');
        })
        .join('\n');

    return {
        text: normalizedText,
        lineMaps,
    };
}
