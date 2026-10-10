import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The browser run creates and removes real accounts, and the macOS keychain is the one boundary it
 * cannot reset afterwards. `auth.ts` shells out to `security`, so the run gets a fake one earlier
 * on PATH that keeps its entries in a temp directory instead of the login keychain.
 *
 * Returns the directory to prepend to PATH.
 */
export function installFakeKeychain(): string {
    const binDir = mkdtempSync(join(tmpdir(), 'gitvan-fake-keychain-'));
    const storeDir = join(binDir, 'store');
    const scriptPath = join(binDir, 'security');

    mkdirSync(storeDir, { recursive: true });

    writeFileSync(
        scriptPath,
        `#!/bin/sh
# Minimal stand-in for the macOS \`security\` calls auth.ts makes.
STORE="${storeDir}"
cmd="$1"
shift

case "$cmd" in
    add-generic-password)
        account=""
        secret=""
        while [ $# -gt 0 ]; do
            case "$1" in
                -a) account="$2"; shift 2 ;;
                -w) secret="$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        [ -n "$account" ] || exit 1
        printf '%s' "$secret" > "$STORE/$account"
        ;;
    find-generic-password)
        account=""
        while [ $# -gt 0 ]; do
            case "$1" in
                -a) account="$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        [ -f "$STORE/$account" ] || { echo "The specified item could not be found in the keychain." >&2; exit 44; }
        printf '%s\\n' "$(cat "$STORE/$account")"
        ;;
    delete-generic-password)
        account=""
        while [ $# -gt 0 ]; do
            case "$1" in
                -a) account="$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        rm -f "$STORE/$account"
        ;;
    *)
        exit 1
        ;;
esac

exit 0
`,
        'utf8'
    );
    chmodSync(scriptPath, 0o755);

    return binDir;
}
