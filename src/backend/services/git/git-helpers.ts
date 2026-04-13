import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import type { ChangeStatus, CommitFileEntry, FileDiffHunk } from '../../../shared/gitClient.js';
import { runGit, runGitBuffer, runGitWithInput } from './git-common.js';

const previewByteLimit = 1024 * 1024;
export const fileTooBigPreviewMessage = 'File too big to preview';

const imageMimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    webp: 'image/webp',
};

export function normalizeGitIgnoreEntry(entry: string, mode: 'file' | 'directory' | 'pattern') {
    const normalizedEntry = entry.trim().replace(/^\.\//, '').replace(/^\//, '').replace(/\\/g, '/');
    if (!normalizedEntry) {
        throw new Error('A path is required.');
    }

    if (mode === 'pattern') {
        return normalizedEntry;
    }

    return mode === 'directory' ? `${normalizedEntry.replace(/\/+$/u, '')}/` : normalizedEntry.replace(/\/+$/u, '');
}

export function appendGitIgnoreEntry(repoPath: string, entry: string) {
    const gitIgnorePath = join(repoPath, '.gitignore');
    const existingContent = existsSync(gitIgnorePath) ? readFileSync(gitIgnorePath, 'utf8') : '';
    const existingEntries = new Set(
        existingContent
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter(Boolean)
    );

    if (existingEntries.has(entry)) {
        return;
    }

    const nextContent = existingContent.length === 0 ? `${entry}\n` : `${existingContent.replace(/\s*$/u, '')}\n${entry}\n`;
    writeFileSync(gitIgnorePath, nextContent, 'utf8');
}

export async function readGitRevisionFile(repoPath: string, revisionPath: string) {
    return await runGit(['show', revisionPath], repoPath, [0, 128], false);
}

export async function readGitRevisionFileBuffer(repoPath: string, revisionPath: string) {
    const result = await runGitBuffer(['show', revisionPath], repoPath, [0, 128]);
    return result.length > 0 ? result : undefined;
}

export async function readGitRevisionFileSize(repoPath: string, revisionPath: string) {
    const rawSize = await runGit(['cat-file', '-s', revisionPath], repoPath, [0, 128]);
    const parsedSize = Number.parseInt(rawSize, 10);
    return Number.isFinite(parsedSize) ? parsedSize : undefined;
}

export function readWorkingTreeFile(absolutePath: string) {
    if (!existsSync(absolutePath)) {
        return '';
    }

    try {
        return readFileSync(absolutePath, 'utf8');
    } catch {
        return '';
    }
}

export function readWorkingTreeFileBuffer(absolutePath: string) {
    if (!existsSync(absolutePath)) {
        return undefined;
    }

    try {
        const result = readFileSync(absolutePath);
        return result.length > 0 ? result : undefined;
    } catch {
        return undefined;
    }
}

export function readWorkingTreeFileSize(absolutePath: string) {
    if (!existsSync(absolutePath)) {
        return undefined;
    }

    try {
        return statSync(absolutePath).size;
    } catch {
        return undefined;
    }
}

export function isImagePath(path: string) {
    return imageFileExtension(path) !== undefined;
}

export function buildImagePreview(path: string, original: Buffer | undefined, modified: Buffer | undefined) {
    const extension = imageFileExtension(path);
    if (!extension) {
        return undefined;
    }

    const mimeType = imageMimeTypes[extension];

    return {
        kind: 'image' as const,
        originalSrc: original ? bufferToDataUrl(original, mimeType) : undefined,
        modifiedSrc: modified ? bufferToDataUrl(modified, mimeType) : undefined,
    };
}

export function isPreviewTooLarge(...sizes: Array<number | undefined>) {
    return sizes.some((size) => size !== undefined && size > previewByteLimit);
}

export function textByteSize(value: string) {
    return Buffer.byteLength(value, 'utf8');
}

export function buildDiffStats(patch: string, oldSizeBytes: number | undefined, newSizeBytes: number | undefined) {
    const lineChanges = countPatchLineChanges(patch);

    return {
        oldSizeBytes: oldSizeBytes ?? 0,
        newSizeBytes: newSizeBytes ?? 0,
        addedLines: lineChanges.addedLines,
        removedLines: lineChanges.removedLines,
    };
}

type ParsedPatchHunk = FileDiffHunk & {
    lines: string[];
};

type ParsedUnifiedPatch = {
    headerLines: string[];
    hunks: ParsedPatchHunk[];
};

export function parseUnifiedDiffHunks(patch: string): FileDiffHunk[] {
    return parseUnifiedPatch(patch).hunks.map(({ lines: _lines, ...hunk }) => hunk);
}

export function buildPartialFilePatch(patch: string, hunkIds: string[], mode: 'stage' | 'unstage' | 'discard') {
    const parsedPatch = parseUnifiedPatch(patch);
    const selectedIds = new Set(hunkIds);
    const selectedHunks = parsedPatch.hunks.filter((hunk) => selectedIds.has(hunk.id));

    if (selectedHunks.length !== selectedIds.size) {
        throw new Error('The selected file changes could not be found in the current diff.');
    }

    if (selectedHunks.length === 0) {
        throw new Error('At least one file change must be selected.');
    }

    let cumulativeAllDelta = 0;
    let cumulativeSelectedDelta = 0;
    const rebasedHunks = parsedPatch.hunks.flatMap((hunk) => {
        const delta = hunk.newLines - hunk.oldLines;
        const isSelected = selectedIds.has(hunk.id);

        if (!isSelected) {
            cumulativeAllDelta += delta;
            return [];
        }

        const rebasedHeader =
            mode === 'unstage'
                ? formatHunkHeader(Math.max(0, hunk.oldStart + (cumulativeAllDelta - cumulativeSelectedDelta)), hunk.oldLines, hunk.newStart, hunk.newLines)
                : formatHunkHeader(hunk.oldStart, hunk.oldLines, Math.max(0, hunk.newStart - (cumulativeAllDelta - cumulativeSelectedDelta)), hunk.newLines);

        cumulativeAllDelta += delta;
        cumulativeSelectedDelta += delta;

        return [rebasedHeader, ...hunk.lines];
    });

    return `${[...parsedPatch.headerLines, ...rebasedHunks].join('\n')}\n`;
}

export async function applyPartialFilePatch(repoPath: string, patch: string, mode: 'stage' | 'unstage' | 'discard') {
    const args = ['apply', '--recount', '--unidiff-zero', '--whitespace=nowarn'];

    if (mode === 'stage' || mode === 'unstage') {
        args.push('--cached');
    }

    if (mode === 'unstage' || mode === 'discard') {
        args.push('-R');
    }

    args.push('-');
    await runGitWithInput(args, repoPath, patch, [0], false);
}

export async function readGitMetadataFile(repoPath: string, gitPathName: string) {
    const relativePath = await runGit(['rev-parse', '--git-path', gitPathName], repoPath, [0, 128]);
    if (!relativePath) {
        return undefined;
    }

    const absolutePath = isAbsolute(relativePath) ? relativePath : join(repoPath, relativePath);
    if (!existsSync(absolutePath)) {
        return undefined;
    }

    try {
        return readFileSync(absolutePath, 'utf8');
    } catch {
        return undefined;
    }
}

export async function readGitIndexStageFile(repoPath: string, stage: 1 | 2 | 3, path: string) {
    return await runGit(['show', `:${stage}:${path}`], repoPath, [0, 128], false);
}

export function parseIncomingBranchFromMergeMessage(message: string | undefined) {
    if (!message) {
        return undefined;
    }

    const firstLine = message.split('\n')[0]?.trim() ?? '';
    const branchMatch = firstLine.match(/Merge (?:remote-tracking )?branch '([^']+)'/i);
    if (branchMatch?.[1]) {
        return branchMatch[1];
    }

    const pullRequestMatch = firstLine.match(/Merge pull request .* from\s+(.+)$/i);
    if (pullRequestMatch?.[1]) {
        return pullRequestMatch[1].trim();
    }

    return undefined;
}

export function countConflictMarkers(fileContent: string) {
    return fileContent.match(/^<<<<<<< /gm)?.length ?? 0;
}

export function labelForStatus(status: ChangeStatus) {
    switch (status) {
        case 'modified':
            return 'Modified';
        case 'added':
            return 'Added';
        case 'deleted':
            return 'Deleted';
        case 'renamed':
            return 'Renamed';
        case 'copied':
            return 'Copied';
        case 'untracked':
            return 'Untracked';
        case 'unmerged':
            return 'Conflicted';
        case 'type-changed':
            return 'Type changed';
        default:
            return 'Clean';
    }
}

export function parseTrackCounts(track: string) {
    let ahead = 0;
    let behind = 0;

    if (!track) {
        return { ahead, behind };
    }

    const normalized = track.replace(/^\[/, '').replace(/\]$/, '');
    for (const part of normalized.split(',')) {
        const trimmed = part.trim();
        if (trimmed.startsWith('ahead ')) {
            ahead = Number.parseInt(trimmed.replace('ahead ', ''), 10) || 0;
        }
        if (trimmed.startsWith('behind ')) {
            behind = Number.parseInt(trimmed.replace('behind ', ''), 10) || 0;
        }
    }

    return { ahead, behind };
}

export function normalizeBranchName(name: string) {
    let normalized = name.trim();

    while (normalized.startsWith('refs/heads/')) {
        normalized = normalized.slice('refs/heads/'.length);
    }

    while (normalized.startsWith('refs/remotes/')) {
        normalized = normalized.slice('refs/remotes/'.length);
    }

    return normalized;
}

export function parsePorcelainTrackedEntries(output: string) {
    const entries: Array<{ path: string; stagedStatus: ChangeStatus; unstagedStatus: ChangeStatus }> = [];

    for (const line of output.split('\n')) {
        if (!line || line.startsWith('# ') || line.startsWith('? ') || line.startsWith('! ')) {
            continue;
        }

        if (!line.startsWith('1 ') && !line.startsWith('u ')) {
            continue;
        }

        const parts = line.split(' ', 9);
        const xy = parts[1] ?? '..';
        const path = parts[8]?.trim();

        if (!path || !hasVisiblePorcelainChange(xy)) {
            continue;
        }

        entries.push({
            path,
            stagedStatus: mapPorcelainStatus(xy[0]),
            unstagedStatus: mapPorcelainStatus(xy[1]),
        });
    }

    return entries;
}

export function parseNameStatusOutput(output: string) {
    const parts = output.split('\0');
    const entries: Array<{ path: string; previousPath: string | undefined; status: ChangeStatus }> = [];
    let index = 0;

    while (index < parts.length) {
        const token = parts[index++];
        if (!token) {
            continue;
        }

        const code = token[0] ?? '';
        if (code === 'R' || code === 'C') {
            const previousPath = parts[index++] ?? '';
            const path = parts[index++] ?? '';
            if (path) {
                entries.push({
                    path,
                    previousPath: previousPath || undefined,
                    status: mapNameStatusCode(token),
                });
            }
            continue;
        }

        const path = parts[index++] ?? '';
        if (path) {
            entries.push({
                path,
                previousPath: undefined,
                status: mapNameStatusCode(token),
            });
        }
    }

    return entries;
}

export function parseCommitFilesWithConflicts(output: string, conflictedPaths: ReadonlySet<string>) {
    const lines = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    return lines.map((line) => {
        const parts = line.split('\t');
        const rawStatus = parts[0] ?? '';
        const status = mapNameStatusCode(rawStatus);

        if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
            const path = parts[2] ?? parts[1] ?? '';
            return {
                previousPath: parts[1] ?? undefined,
                path,
                status,
                hadConflict: conflictedPaths.has(path),
            } satisfies CommitFileEntry;
        }

        const path = parts[1] ?? '';
        return {
            previousPath: undefined,
            path,
            status,
            hadConflict: conflictedPaths.has(path),
        } satisfies CommitFileEntry;
    });
}

export function extractConflictPathsFromCommitBody(body: string) {
    const lines = body.split('\n');
    const nextBodyLines: string[] = [];
    const conflictPaths = new Set<string>();
    let index = 0;

    while (index < lines.length) {
        const currentLine = lines[index] ?? '';
        const trimmed = currentLine.trim();

        if (trimmed === '# Conflicts:' || trimmed === 'Conflicts:') {
            index++;

            while (index < lines.length) {
                const conflictLine = lines[index] ?? '';
                const normalizedConflictLine = conflictLine.trim();

                if (!normalizedConflictLine) {
                    index++;
                    continue;
                }

                const conflictMatch = normalizedConflictLine.match(/^#\s+(.*)$/);
                if (!conflictMatch?.[1]) {
                    break;
                }

                conflictPaths.add(conflictMatch[1].trim());
                index++;
            }

            continue;
        }

        nextBodyLines.push(currentLine);
        index++;
    }

    while (nextBodyLines.length > 0 && !nextBodyLines[0]?.trim()) {
        nextBodyLines.shift();
    }

    while (nextBodyLines.length > 0 && !nextBodyLines[nextBodyLines.length - 1]?.trim()) {
        nextBodyLines.pop();
    }

    return {
        body: nextBodyLines.join('\n'),
        conflictPaths,
    };
}

export function parseRefs(rawRefs: string) {
    return rawRefs
        .replace(/^\s*\(/, '')
        .replace(/\)\s*$/, '')
        .split(',')
        .map((ref) => ref.trim())
        .filter(Boolean);
}

function imageFileExtension(path: string) {
    const normalized = path.toLowerCase().split('/').pop() ?? path.toLowerCase();
    const extension = normalized.split('.').pop();
    return extension && extension in imageMimeTypes ? extension : undefined;
}

function bufferToDataUrl(buffer: Buffer, mimeType: string) {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function countPatchLineChanges(patch: string) {
    let addedLines = 0;
    let removedLines = 0;

    for (const line of patch.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) {
            continue;
        }

        if (line.startsWith('+')) {
            addedLines += 1;
            continue;
        }

        if (line.startsWith('-')) {
            removedLines += 1;
        }
    }

    return {
        addedLines,
        removedLines,
    };
}

function parseUnifiedPatch(patch: string): ParsedUnifiedPatch {
    const lines = patch.split('\n');
    const headerLines: string[] = [];
    const hunks: ParsedPatchHunk[] = [];
    let index = 0;

    while (index < lines.length && !lines[index]?.startsWith('@@ ')) {
        const line = lines[index++];
        if (line === undefined) {
            break;
        }

        if (!headerLines.length && !line.trim()) {
            continue;
        }

        headerLines.push(line);
    }

    while (index < lines.length) {
        const header = lines[index];
        if (!header?.startsWith('@@ ')) {
            index += 1;
            continue;
        }

        index += 1;
        const hunkLines: string[] = [];
        while (index < lines.length && !lines[index]?.startsWith('@@ ')) {
            hunkLines.push(lines[index] ?? '');
            index += 1;
        }

        const parsedHeader = parseHunkHeader(header);
        let addedLines = 0;
        let removedLines = 0;
        let contextLines = 0;

        for (const line of hunkLines) {
            if (line.startsWith('+')) {
                addedLines += 1;
                continue;
            }

            if (line.startsWith('-')) {
                removedLines += 1;
                continue;
            }

            if (line.startsWith(' ')) {
                contextLines += 1;
            }
        }

        hunks.push({
            id: `hunk-${hunks.length + 1}`,
            header,
            oldStart: parsedHeader.oldStart,
            oldLines: parsedHeader.oldLines,
            newStart: parsedHeader.newStart,
            newLines: parsedHeader.newLines,
            addedLines,
            removedLines,
            contextLines,
            lines: hunkLines,
        });
    }

    return {
        headerLines,
        hunks,
    };
}

function parseHunkHeader(header: string) {
    const match = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!match) {
        throw new Error(`Failed to parse diff hunk header: ${header}`);
    }

    return {
        oldStart: Number.parseInt(match[1] ?? '0', 10),
        oldLines: Number.parseInt(match[2] ?? '1', 10),
        newStart: Number.parseInt(match[3] ?? '0', 10),
        newLines: Number.parseInt(match[4] ?? '1', 10),
    };
}

function formatHunkHeader(oldStart: number, oldLines: number, newStart: number, newLines: number) {
    return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
}

function mapNameStatusCode(code: string | undefined): ChangeStatus {
    switch (code?.[0]) {
        case 'M':
            return 'modified';
        case 'A':
            return 'added';
        case 'D':
            return 'deleted';
        case 'R':
            return 'renamed';
        case 'C':
            return 'copied';
        case 'U':
            return 'unmerged';
        case 'T':
            return 'type-changed';
        default:
            return 'clean';
    }
}

function hasVisiblePorcelainChange(xy: string) {
    return (xy[0] && xy[0] !== '.') || (xy[1] && xy[1] !== '.');
}

function mapPorcelainStatus(code: string | undefined): ChangeStatus {
    switch (code) {
        case 'M':
            return 'modified';
        case 'A':
            return 'added';
        case 'D':
            return 'deleted';
        case 'R':
            return 'renamed';
        case 'C':
            return 'copied';
        case 'U':
            return 'unmerged';
        case 'T':
            return 'type-changed';
        default:
            return 'clean';
    }
}
