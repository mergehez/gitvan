import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import type { ChangeStatus, CommitFileEntry } from '../../../shared/types.js';
import { runGit, runGitBuffer, runGitBufferWithInput, runGitWithInput } from './git-common.js';

const previewByteLimit = 1024 * 1024;
export const fileTooBigPreviewMessage = 'File too big to preview';
export const diffTooLargePreviewMessage = 'Diff too large to display';

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

/**
 * Sizes for many blobs through one `cat-file --batch-check` process, so a per-file
 * cosmetic check costs no more processes than a single-file one.
 */
export async function readGitObjectSizes(repoPath: string, shas: string[]): Promise<Map<string, number | undefined>> {
    const sizes = new Map<string, number | undefined>();
    if (!shas.length) {
        return sizes;
    }

    const output = await runGitWithInput(['cat-file', '--batch-check'], repoPath, `${shas.join('\n')}\n`, [0, 128]);
    const lines = output.split('\n');

    shas.forEach((sha, index) => {
        const line = lines[index]?.trim() ?? '';
        if (!line || line.endsWith(' missing') || line.endsWith(' ambiguous')) {
            sizes.set(sha, undefined);
            return;
        }

        const size = Number.parseInt(line.split(' ').pop() ?? '', 10);
        sizes.set(sha, Number.isFinite(size) ? size : undefined);
    });

    return sizes;
}

/** Contents for many blobs through one `cat-file --batch` process. */
export async function readGitObjectContents(repoPath: string, shas: string[]): Promise<Map<string, string>> {
    const contents = new Map<string, string>();
    if (!shas.length) {
        return contents;
    }

    // The batch header carries a byte size, so the records have to be sliced on bytes
    // rather than on a decoded string, which miscounts every multibyte character.
    const output = await runGitBufferWithInput(['cat-file', '--batch'], repoPath, `${shas.join('\n')}\n`, [0, 128]);
    let cursor = 0;

    for (const sha of shas) {
        const headerEnd = output.indexOf(0x0a, cursor);
        if (headerEnd === -1) {
            contents.set(sha, '');
            continue;
        }

        const header = output.subarray(cursor, headerEnd).toString('utf8');
        cursor = headerEnd + 1;
        const fields = header.split(' ');

        // Missing and ambiguous objects are reported in place of the object header.
        if (fields.length < 3 || header.endsWith(' missing') || header.endsWith(' ambiguous')) {
            contents.set(sha, '');
            continue;
        }

        const size = Number.parseInt(fields[2] ?? '', 10) || 0;
        contents.set(sha, output.subarray(cursor, cursor + size).toString('utf8'));
        // `--batch` appends a newline after the object contents.
        cursor += size + 1;
    }

    return contents;
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

/** Cheap content identity of a working-tree file, mirroring git's own stat cache. */
export function readWorkingTreeFileSignature(absolutePath: string) {
    try {
        const stats = statSync(absolutePath);
        return `${stats.mtimeMs}:${stats.size}`;
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

export async function applyPartialFilePatch(repoPath: string, patch: string, mode: 'stage' | 'unstage' | 'discard') {
    // Ensure patch ends with a newline (git apply requires it)
    const normalizedPatch = patch.endsWith('\n') ? patch : patch + '\n';
    const args = ['apply', '--recount', '--unidiff-zero', '--whitespace=nowarn'];

    if (mode === 'stage' || mode === 'unstage') {
        args.push('--cached');
    }

    if (mode === 'unstage' || mode === 'discard') {
        args.push('-R');
    }

    args.push('-');
    await runGitWithInput(args, repoPath, normalizedPatch, [0], false);
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

export function parseConflictMarkerPaths(checkOutput: string) {
    const suffix = ': leftover conflict marker';
    const paths = new Set<string>();

    for (const line of checkOutput.split('\n')) {
        if (!line.endsWith(suffix)) {
            continue;
        }

        const path = line.slice(0, -suffix.length).replace(/:\d+$/, '');
        if (path) {
            paths.add(path);
        }
    }

    return paths;
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

        const isUnmerged = line.startsWith('u ');
        if (!isUnmerged && !line.startsWith('1 ')) {
            continue;
        }

        const parts = line.split(' ');
        const xy = parts[1] ?? '..';
        // `u ` records carry the three stage hashes before the path; `1 ` records carry two.
        const path = parts.slice(isUnmerged ? 10 : 8).join(' ');

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

export type RawDiffEntry = {
    path: string;
    previousPath: string | undefined;
    status: ChangeStatus;
    /** Blob on the left side of the diff (`HEAD` for staged, the index for unstaged). */
    oldSha: string | undefined;
    /** Blob on the right side; absent when the right side is the working tree. */
    newSha: string | undefined;
};

/**
 * Parses `git diff --raw -z` records, which carry the blob shas the cosmetic
 * comparison needs in the same pass that lists the paths.
 */
export function parseRawDiffOutput(output: string) {
    const parts = output.split('\0');
    const entries: RawDiffEntry[] = [];
    let index = 0;

    while (index < parts.length) {
        const header = parts[index++];
        if (!header) {
            continue;
        }

        // :<old_mode> <new_mode> <old_sha> <new_sha> <status>
        const fields = header.split(' ');
        if (fields.length < 5) {
            continue;
        }

        const status = mapNameStatusCode(fields[4]);
        const renamesOrCopies = status === 'renamed' || status === 'copied';
        const firstPath = parts[index++] ?? '';
        const path = renamesOrCopies ? (parts[index++] ?? '') : firstPath;

        if (!path) {
            continue;
        }

        entries.push({
            path,
            previousPath: renamesOrCopies ? firstPath || undefined : undefined,
            status,
            oldSha: normalizeRawSha(fields[2]),
            newSha: normalizeRawSha(fields[3]),
        });
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

function splitRefs(rawRefs: string) {
    return rawRefs
        .replace(/^\s*\(/, '')
        .replace(/\)\s*$/, '')
        .split(',')
        .map((ref) => ref.trim())
        .filter(Boolean);
}

export function parseRefs(rawRefs: string) {
    return splitRefs(rawRefs);
}

export function parseCommitTags(rawRefs: string, isUnpushed: boolean) {
    return splitRefs(rawRefs)
        .flatMap((ref) => {
            const match = ref.match(/^tag:\s*(.+)$/i);
            return match?.[1]
                ? [
                      {
                          name: match[1].trim(),
                          isUnpushed,
                      },
                  ]
                : [];
        })
        .filter((tag, index, tags) => tags.findIndex((entry) => entry.name === tag.name) === index);
}

/** Commits reachable from HEAD that no remote has, optionally capped to the newest ones. */
export async function getUnpushedCommitSet(repoPath: string, maxCount?: number) {
    const args = ['rev-list'];

    if (maxCount) {
        args.push('--max-count', String(maxCount));
    }

    args.push('HEAD', '--not', '--remotes');

    const output = await runGit(args, repoPath, [0, 128]);

    return new Set(
        output
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
    );
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

function normalizeRawSha(sha: string | undefined) {
    if (!sha || /^0+$/.test(sha)) {
        return undefined;
    }

    return sha;
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
