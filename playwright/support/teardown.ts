import { rmSync } from 'fs';

/** Removes the throwaway database the run created, so temp dirs do not pile up. */
export default function globalTeardown() {
    const dataDir = process.env.GITVAN_E2E_DATA_DIR;

    // A caller-supplied directory is theirs to keep and to inspect after a failure.
    if (!dataDir || process.env.PLAYWRIGHT_APP_DATA_DIR) {
        return;
    }

    rmSync(dataDir, { recursive: true, force: true });
}
