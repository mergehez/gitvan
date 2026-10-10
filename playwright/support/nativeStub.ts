import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The pickers have no native host in browser dev mode, so the dev server answers them from this
 * file. A spec writes the value it wants chosen and the next click reads it.
 */
export type NativePickerStub = {
    directory?: string;
    editor?: { path: string; label?: string };
    terminal?: { path: string; label?: string; locked?: boolean };
};

const nativeStubFile = process.env.PLAYWRIGHT_NATIVE_STUB_FILE;

export function setNativePickerStub(stub: NativePickerStub): void {
    if (!nativeStubFile) {
        throw new Error('The browser run did not provide a native picker stub file.');
    }

    writeFileSync(nativeStubFile, JSON.stringify(stub), 'utf8');
}

/** Puts every picker back to "the dialog was cancelled". */
export function resetNativePickerStub(): void {
    if (!nativeStubFile) {
        return;
    }

    setNativePickerStub({});
}

/** A real repository on disk for a spec to pick, so adding one goes through actual git. */
export function createTempGitRepo(fileName = 'README.md') {
    const repoPath = mkdtempSync(join(tmpdir(), 'gitvan-picked-repo-'));

    function git(args: string[]) {
        execFileSync('git', args, { cwd: repoPath, stdio: 'ignore' });
    }

    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Gitvan Picker Lab']);
    git(['config', 'user.email', 'picker-lab@example.com']);
    writeFileSync(join(repoPath, fileName), '# Picked repository\n', 'utf8');
    git(['add', '.']);
    git(['commit', '-m', 'Initial baseline']);

    return {
        path: repoPath,
        name: repoPath.split('/').pop()!,
        remove: () => rmSync(repoPath, { recursive: true, force: true }),
    };
}
