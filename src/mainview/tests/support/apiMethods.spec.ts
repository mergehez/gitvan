import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { app } from '../../../backend/services/app.js';
import { extractApiMethods } from '../../../electronUtils/vite-plugin.ts';
import { apiMethods } from '../../../shared/apiMethods';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('apiMethods', () => {
    it('lists exactly the handlers declared in app.ts and main.ts', () => {
        const appSource = readFileSync(join(repoRoot, 'src/backend/services/app.ts'), 'utf8');
        const mainSource = readFileSync(join(repoRoot, 'src/electron/main.ts'), 'utf8');

        // A handler that stops matching the generator's pattern would silently vanish from the
        // renderer's task table; this regenerates the list the way the plugin does.
        expect([...apiMethods]).toEqual(extractApiMethods(appSource, mainSource));
    });

    it('keeps every runtime app handler in the renderer task list', () => {
        const listed = new Set<string>(apiMethods);
        const missing = Object.keys(app).filter((name) => !listed.has(name));

        expect(missing).toEqual([]);
    });

    it('extracts backend and native handlers but not IIFE getters', () => {
        const appSource = ['export const app = {', '    getChanges: async (ps: { repoId: number }) => {', '    },', '    groups: (() => () => [])(),', '};'].join('\n');
        const mainSource = [
            '    getNativeMethods: (mainWindow, apiPost) => ({',
            '        pickDirectory: async () => undefined,',
            '        openExternalUrl: async () => undefined,',
            '    }),',
        ].join('\n');

        expect(extractApiMethods(appSource, mainSource)).toEqual(['getChanges', 'openExternalUrl', 'pickDirectory']);
    });
});
