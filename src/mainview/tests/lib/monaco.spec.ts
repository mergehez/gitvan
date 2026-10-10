import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('monaco-editor', () => ({ languages: { marker: 'stub-monaco' } }));

import { createMonacoOptions, getMonacoLanguage } from '../../lib/monaco';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('getMonacoLanguage', () => {
    it('takes the language from the path when there is one', () => {
        expect(getMonacoLanguage(undefined, 'src/app.ts')).toBe('typescript');
        expect(getMonacoLanguage('python', 'src/app.ts')).toBe('typescript');
        expect(getMonacoLanguage(undefined, 'README.md')).toBe('markdown');
        expect(getMonacoLanguage(undefined, 'notes.txt')).toBe('plaintext');
    });

    it('uses the explicit language when no path is given', () => {
        expect(getMonacoLanguage('yaml', undefined)).toBe('yaml');
        expect(getMonacoLanguage(undefined, undefined)).toBe('plaintext');
        expect(getMonacoLanguage(undefined, '')).toBe('plaintext');
    });
});

describe('createMonacoOptions', () => {
    it('builds the editor options the app renders with', () => {
        expect(createMonacoOptions({})).toEqual({
            automaticLayout: true,
            formatOnType: true,
            formatOnPaste: true,
            readOnly: false,
            fontSize: 12,
            codeLens: false,
            minimap: { enabled: false },
            glyphMargin: false,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            lineNumbersMinChars: 3,
            showFoldingControls: 'always',
            fixedOverflowWidgets: true,
        });
    });

    it('takes the read-only flag and the font size it is given', () => {
        expect(createMonacoOptions({ readonly: true, fontSize: 18 })).toMatchObject({ readOnly: true, fontSize: 18 });
    });
});

describe('configureMonacoEnvironment', () => {
    it('installs one environment whose factory picks the worker for the label', async () => {
        class FakeWorker {
            constructor(
                public url: unknown,
                public options?: unknown
            ) {}
        }

        vi.stubGlobal('Worker', FakeWorker);
        vi.resetModules();

        const { configureMonacoEnvironment } = await import('../../lib/monaco');
        configureMonacoEnvironment();

        const environment = (globalThis as { MonacoEnvironment?: { getWorker: (id: string, label: string) => FakeWorker } }).MonacoEnvironment;
        expect(environment).toBeDefined();

        const jsonWorker = environment!.getWorker('', 'json');
        expect(jsonWorker).toBeInstanceOf(FakeWorker);
        expect(String(jsonWorker.url)).toContain('json.worker.js');
        expect(jsonWorker.options).toEqual({ type: 'module' });

        // The sharing groups the language services reuse.
        expect(String(environment!.getWorker('', 'scss').url)).toContain('css.worker.js');
        expect(String(environment!.getWorker('', 'razor').url)).toContain('html.worker.js');
        expect(String(environment!.getWorker('', 'javascript').url)).toContain('ts.worker.js');
        // Anything without a language service still gets the base editor worker.
        expect(String(environment!.getWorker('', 'plaintext').url)).toContain('editor.worker.js');
    });

    it('only installs the environment once', async () => {
        class FakeWorker {}
        vi.stubGlobal('Worker', FakeWorker);
        vi.resetModules();

        const { configureMonacoEnvironment } = await import('../../lib/monaco');
        configureMonacoEnvironment();
        const installed = (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment;

        configureMonacoEnvironment();

        expect((globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment).toBe(installed);
    });
});

describe('configureMonaco', () => {
    function fakeMonaco() {
        return {
            languages: {
                typescript: {
                    ScriptTarget: { ES2015: 2 },
                    javascriptDefaults: { setDiagnosticsOptions: vi.fn(), setCompilerOptions: vi.fn() },
                },
                json: { jsonDefaults: { setDiagnosticsOptions: vi.fn() } },
            },
        };
    }

    it('relaxes the typescript and json diagnostics', async () => {
        vi.resetModules();
        const { configureMonaco } = await import('../../lib/monaco');
        const monaco = fakeMonaco();

        configureMonaco(monaco);

        expect(monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
            noSemanticValidation: true,
            noSyntaxValidation: false,
        });
        expect(monaco.languages.typescript.javascriptDefaults.setCompilerOptions).toHaveBeenCalledWith({
            target: 2,
            allowNonTsExtensions: true,
        });
        expect(monaco.languages.json.jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
            validate: true,
            allowComments: true,
            schemaValidation: 'error',
        });
    });

    it('configures the language services once', async () => {
        vi.resetModules();
        const { configureMonaco } = await import('../../lib/monaco');
        const first = fakeMonaco();
        const second = fakeMonaco();

        configureMonaco(first);
        configureMonaco(second);

        expect(first.languages.json.jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledTimes(1);
        expect(second.languages.json.jsonDefaults.setDiagnosticsOptions).not.toHaveBeenCalled();
    });

    it('still works when the optional language services are missing', async () => {
        vi.resetModules();
        const { configureMonaco } = await import('../../lib/monaco');
        const monaco = { languages: {} };

        expect(() => configureMonaco(monaco)).not.toThrow();
    });
});

describe('getMonacoModule', () => {
    it('loads the module once and hands back the same one', async () => {
        vi.resetModules();
        const { getMonacoModule } = await import('../../lib/monaco');

        const first = await getMonacoModule();
        const second = await getMonacoModule();

        expect(first).toBe(second);
        expect(first).toMatchObject({ languages: { marker: 'stub-monaco' } });
    });
});
