export function normalizeDiffIgnoredChars(value: string | undefined) {
    return Array.from(new Set((value ?? '').replace(/\s+/gu, '').slice(0, 64))).join('');
}

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

export function normalizeComparableDiffText(value: string, ignoredChars: string, hideWhitespace: boolean) {
    const ignored = new Set(normalizeDiffIgnoredChars(ignoredChars).split(''));

    return value
        .split('\n')
        .map((line) => {
            const normalizedChars: string[] = [];

            for (let index = 0; index < line.length; index += 1) {
                const char = line[index]!;

                if (ignored.has(char)) {
                    continue;
                }

                if (/\s/u.test(char) && (hideWhitespace || isIncidentalIgnoredWhitespace(line, index, ignored))) {
                    continue;
                }

                normalizedChars.push(char);
            }

            return normalizedChars.join('');
        })
        .join('\n');
}

export function collapseAllDiffWhitespace(value: string) {
    return value.replace(/\s+/gu, '');
}

export function areEquivalentIgnoringDiffChars(original: string, modified: string, ignoredChars: string, hideWhitespace: boolean) {
    const normalizedOriginal = normalizeComparableDiffText(original, ignoredChars, hideWhitespace);
    const normalizedModified = normalizeComparableDiffText(modified, ignoredChars, hideWhitespace);

    return hideWhitespace ? collapseAllDiffWhitespace(normalizedOriginal) === collapseAllDiffWhitespace(normalizedModified) : normalizedOriginal === normalizedModified;
}
