import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { monaco, model, editor } = vi.hoisted(() => {
    const model = {
        value: '',
        changeHandler: undefined as (() => void) | undefined,
        getValue: vi.fn(() => model.value),
        setValue: vi.fn((next: string) => {
            model.value = next;
            model.changeHandler?.();
        }),
        getLanguageId: vi.fn(() => 'plaintext'),
        onDidChangeContent: vi.fn((handler: () => void) => {
            model.changeHandler = handler;
        }),
        dispose: vi.fn(),
    };
    const editor = {
        setModel: vi.fn(),
        updateOptions: vi.fn(),
        layout: vi.fn(),
        dispose: vi.fn(),
    };
    const monaco = {
        editor: {
            setTheme: vi.fn(),
            createModel: vi.fn(() => model),
            create: vi.fn(() => editor),
            setModelLanguage: vi.fn(),
        },
    };

    return { monaco, model, editor };
});

vi.mock('../../lib/monaco', () => ({
    configureMonacoEnvironment: vi.fn(),
    configureMonaco: vi.fn(),
    createMonacoOptions: (params: { readonly?: boolean; fontSize?: number }) => ({
        automaticLayout: true,
        readOnly: params.readonly ?? false,
        fontSize: params.fontSize ?? 12,
    }),
    getMonacoLanguage: (language?: string, pathForLanguage?: string) => pathForLanguage ?? language ?? 'plaintext',
    getMonacoModule: async () => monaco,
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({ state: { diffFontSize: 12 } }),
}));

import MonacoEditor from '../../components/MonacoEditor.vue';

let currentValue = 'hello';

function mountEditor(props: Record<string, unknown> = {}) {
    currentValue = (props.modelValue as string) ?? 'hello';

    const wrapper = mount(MonacoEditor, {
        props: {
            modelValue: currentValue,
            noHead: true,
            'onUpdate:modelValue': (next: string | undefined) => {
                currentValue = next ?? '';
                void wrapper.setProps({ modelValue: next });
            },
            ...props,
        },
    });

    return wrapper;
}

beforeEach(() => {
    model.value = 'hello';
    model.changeHandler = undefined;
    vi.clearAllMocks();
});

describe('MonacoEditor', () => {
    it('creates the model without laying out or re-applying options', async () => {
        mountEditor();
        await flushPromises();

        expect(monaco.editor.createModel).toHaveBeenCalledWith('hello', 'plaintext');
        expect(editor.setModel).toHaveBeenCalledWith(model);
        expect(editor.layout).not.toHaveBeenCalled();
        expect(editor.updateOptions).not.toHaveBeenCalled();
    });

    it('does not copy the model back when the editor changed its own content', async () => {
        const wrapper = mountEditor();
        await flushPromises();
        model.getValue.mockClear();
        model.setValue.mockClear();

        model.value = 'hello world';
        model.changeHandler?.();
        await flushPromises();

        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['hello world']);
        // Only the change handler reads the model; the sync must not read and compare it again.
        expect(model.getValue).toHaveBeenCalledTimes(1);
        expect(model.setValue).not.toHaveBeenCalled();
    });

    it('applies an external value to the model', async () => {
        const wrapper = mountEditor();
        await flushPromises();
        model.setValue.mockClear();

        await wrapper.setProps({ modelValue: 'external' });
        await flushPromises();

        expect(model.setValue).toHaveBeenCalledWith('external');
        expect(model.value).toBe('external');
    });

    it('updates the options only when the options actually change', async () => {
        const wrapper = mountEditor();
        await flushPromises();
        expect(editor.updateOptions).not.toHaveBeenCalled();

        await wrapper.setProps({ readonly: true });
        await flushPromises();

        expect(editor.updateOptions).toHaveBeenCalledTimes(1);
        expect(editor.updateOptions.mock.calls[0]?.[0]).toMatchObject({ readOnly: true });

        model.value = 'typed';
        model.changeHandler?.();
        await flushPromises();

        expect(editor.updateOptions).toHaveBeenCalledTimes(1);
        expect(editor.layout).not.toHaveBeenCalled();
    });

    it('switches the model language when the path changes', async () => {
        const wrapper = mountEditor({ pathForLanguage: 'app.ts' });
        await flushPromises();

        expect(monaco.editor.setModelLanguage).toHaveBeenCalledWith(model, 'app.ts');

        monaco.editor.setModelLanguage.mockClear();

        await wrapper.setProps({ pathForLanguage: 'app.json' });
        await flushPromises();

        expect(monaco.editor.setModelLanguage).toHaveBeenCalledWith(model, 'app.json');
    });
});
