// import type { MonacoEditor } from '@guolao/vue-monaco-editor';
import type * as MonacoEditorModule from 'monaco-editor';
import { fileIconAndLanguageByPath } from './utils';

type MonacoModule = typeof MonacoEditorModule;
type MonacoWorkerFactory = () => Worker;

let monacoConfigured = false;
let monacoEnvironmentConfigured = false;
let monacoModulePromise: Promise<MonacoModule> | undefined = undefined;

export function configureMonacoEnvironment() {
    if (monacoEnvironmentConfigured || typeof globalThis === 'undefined') {
        return;
    }

    const workerFactories: Record<string, MonacoWorkerFactory> = {
        json: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url), { type: 'module' }),
        css: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), { type: 'module' }),
        scss: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), { type: 'module' }),
        less: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), { type: 'module' }),
        html: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), { type: 'module' }),
        handlebars: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), { type: 'module' }),
        razor: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), { type: 'module' }),
        typescript: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url), { type: 'module' }),
        javascript: () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url), { type: 'module' }),
    };

    const createEditorWorker = () => new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' });

    Object.assign(globalThis, {
        MonacoEnvironment: {
            getWorker(_workerId: string, label: string) {
                const WorkerFactory = workerFactories[label] ?? createEditorWorker;

                return WorkerFactory();
            },
        },
    });

    monacoEnvironmentConfigured = true;
}

export async function getMonacoModule() {
    configureMonacoEnvironment();

    if (!monacoModulePromise) {
        monacoModulePromise = import('monaco-editor');
    }

    return await monacoModulePromise;
}

// monaco: MonacoEditor | MonacoModule
export function configureMonaco(monaco: any) {
    if (monacoConfigured) {
        return;
    }

    monacoConfigured = true;

    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2015,
        allowNonTsExtensions: true,
    });

    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true,
        schemaValidation: 'error',
    });
}

export function getMonacoLanguage(language: string | undefined, pathForLanguage: string | undefined) {
    if (!pathForLanguage) {
        return language ?? 'plaintext';
    }

    return fileIconAndLanguageByPath(pathForLanguage.toLowerCase()).lang;
}

export function createMonacoOptions(params: { readonly?: boolean; fontSize?: number }): MonacoEditorModule.editor.IStandaloneEditorConstructionOptions {
    return {
        automaticLayout: true,
        formatOnType: true,
        formatOnPaste: true,
        readOnly: params.readonly ?? false,
        fontSize: params.fontSize ?? 12,
        codeLens: false,
        minimap: {
            enabled: false,
        },
        glyphMargin: false,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineNumbersMinChars: 3,
        showFoldingControls: 'always',
        fixedOverflowWidgets: true,
    };
}
