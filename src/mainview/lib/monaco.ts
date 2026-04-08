// import type { MonacoEditor } from '@guolao/vue-monaco-editor';
import type * as MonacoEditorModule from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { fileIconAndLanguageByPath } from './utils';

let monacoConfigured = false;
let monacoEnvironmentConfigured = false;
let monacoModulePromise: Promise<MonacoModule> | undefined = undefined;

type MonacoModule = typeof import('monaco-editor');
type MonacoWorkerFactory = new () => Worker;

export function configureMonacoEnvironment() {
    if (monacoEnvironmentConfigured || typeof globalThis === 'undefined') {
        return;
    }

    const workerFactories: Record<string, MonacoWorkerFactory> = {
        json: jsonWorker,
        css: cssWorker,
        scss: cssWorker,
        less: cssWorker,
        html: htmlWorker,
        handlebars: htmlWorker,
        razor: htmlWorker,
        typescript: tsWorker,
        javascript: tsWorker,
    };

    Object.assign(globalThis, {
        MonacoEnvironment: {
            getWorker(_workerId: string, label: string) {
                const WorkerFactory = workerFactories[label] ?? editorWorker;

                return new WorkerFactory();
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
