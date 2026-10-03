export type DiffIgnoreOptions = {
    sortModuleImports?: boolean;
};

const moduleImportExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

const preludeCommentPattern = /^(?:\/\/|\/\*|\*)/u;
const preludeDirectivePattern = /^(?:#!|(['"])use [a-z-]+\1;?$)/u;
const importStatementPattern = /^(?:import\b|export\s*(?:\*|type\s*\{|\{))/u;
const sideEffectImportPattern = /^import\s*['"]/u;

export function normalizeDiffIgnoredChars(value: string | undefined) {
    return Array.from(new Set((value ?? '').replace(/\s+/gu, '').slice(0, 64))).join('');
}

export function isJavaScriptTypeScriptPath(path: string) {
    const extensionIndex = path.lastIndexOf('.');

    return extensionIndex > 0 && moduleImportExtensions.has(path.slice(extensionIndex).toLowerCase());
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

function bracketDepthDelta(line: string) {
    let depth = 0;
    let quote: string | undefined;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]!;

        if (quote !== undefined) {
            if (char === '\\') {
                index += 1;
            } else if (char === quote) {
                quote = undefined;
            }

            continue;
        }

        if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if (char === '{' || char === '(' || char === '[') {
            depth += 1;
        } else if (char === '}' || char === ')' || char === ']') {
            depth -= 1;
        }
    }

    return depth;
}

/**
 * Canonicalizes the import statements of a file preamble so formatters that only rearrange them do
 * not register as an actual change. Non-import preamble lines keep their position, and side-effect
 * imports stay pinned because their order can matter at runtime.
 */
export function orderModulePreludeLines(lines: string[]) {
    const entries: Array<{ text: string; reorderable: boolean }> = [];
    let index = 0;

    for (; index < lines.length; index += 1) {
        const line = lines[index]!;
        const trimmed = line.trim();

        if (trimmed === '' || preludeCommentPattern.test(trimmed) || preludeDirectivePattern.test(trimmed)) {
            entries.push({ text: line, reorderable: false });
            continue;
        }

        if (!importStatementPattern.test(trimmed)) {
            break;
        }

        const statement = [line];
        let depth = bracketDepthDelta(line);

        while (depth > 0 && index + 1 < lines.length) {
            index += 1;
            statement.push(lines[index]!);
            depth += bracketDepthDelta(lines[index]!);
        }

        entries.push({ text: statement.join('\n'), reorderable: !sideEffectImportPattern.test(trimmed) });
    }

    const reorderableTexts = entries.filter((entry) => entry.reorderable).map((entry) => entry.text);
    if (reorderableTexts.length < 2) {
        return lines;
    }

    reorderableTexts.sort();

    let nextText = 0;
    const ordered = entries.flatMap((entry) => {
        const text = entry.reorderable ? reorderableTexts[nextText++]! : entry.text;

        return text.split('\n');
    });

    return [...ordered, ...lines.slice(index)];
}

export function normalizeComparableDiffText(value: string, ignoredChars: string, hideWhitespace: boolean, options: DiffIgnoreOptions = {}) {
    const ignored = new Set(normalizeDiffIgnoredChars(ignoredChars).split(''));
    const lines = options.sortModuleImports === true ? orderModulePreludeLines(value.split('\n')) : value.split('\n');

    return lines
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

export function areEquivalentIgnoringDiffChars(original: string, modified: string, ignoredChars: string, hideWhitespace: boolean, options: DiffIgnoreOptions = {}) {
    const normalizedOriginal = normalizeComparableDiffText(original, ignoredChars, hideWhitespace, options);
    const normalizedModified = normalizeComparableDiffText(modified, ignoredChars, hideWhitespace, options);

    return hideWhitespace ? collapseAllDiffWhitespace(normalizedOriginal) === collapseAllDiffWhitespace(normalizedModified) : normalizedOriginal === normalizedModified;
}
