import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeZone = { afterLineNumber: number; domNode: HTMLElement };

const { monaco, model, editor, zoneCalls, resetFakes } = vi.hoisted(() => {
    const zoneCalls = {
        added: [] as Array<{ id: string; zone: FakeZone }>,
        removed: [] as string[],
        layouted: [] as string[],
        nextId: 0,
    };

    const model = {
        content: '',
        changeHandler: undefined as (() => void) | undefined,
        getValue: vi.fn(() => model.content),
        setValue: vi.fn((next: string) => {
            model.content = next;
            model.changeHandler?.();
        }),
        onDidChangeContent: vi.fn((handler: () => void) => {
            model.changeHandler = handler;
        }),
        getPositionAt: vi.fn((offset: number) => {
            const before = model.content.slice(0, offset);
            return { lineNumber: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
        }),
        getLineMaxColumn: vi.fn((lineNumber: number) => (model.content.split('\n')[lineNumber - 1]?.length ?? 0) + 1),
        getFullModelRange: vi.fn(() => ({})),
        pushEditOperations: vi.fn((_selections: unknown, edits: Array<{ text: string }>) => {
            model.content = edits[0]!.text;
            model.changeHandler?.();
        }),
        getLanguageId: vi.fn(() => 'plaintext'),
        dispose: vi.fn(),
    };

    const accessor = {
        addZone: vi.fn((zone: FakeZone) => {
            const id = `zone-${(zoneCalls.nextId += 1)}`;
            zoneCalls.added.push({ id, zone });
            return id;
        }),
        removeZone: vi.fn((id: string) => {
            zoneCalls.removed.push(id);
        }),
        layoutZone: vi.fn((id: string) => {
            zoneCalls.layouted.push(id);
        }),
    };

    const editor = {
        setModel: vi.fn(),
        changeViewZones: vi.fn((callback: (accessorToUse: typeof accessor) => void) => callback(accessor)),
        deltaDecorations: vi.fn(() => []),
        updateOptions: vi.fn(),
        focus: vi.fn(),
        dispose: vi.fn(),
    };

    const monaco = {
        editor: {
            setTheme: vi.fn(),
            createModel: vi.fn((value: string) => {
                model.content = value;
                return model;
            }),
            create: vi.fn(() => editor),
            setModelLanguage: vi.fn(),
            OverviewRulerLane: { Full: 7, Left: 1, Right: 4 },
        },
        Range: class {
            constructor(..._args: unknown[]) {}
        },
    };

    function resetFakes() {
        zoneCalls.added.length = 0;
        zoneCalls.removed.length = 0;
        zoneCalls.layouted.length = 0;
        zoneCalls.nextId = 0;
        model.content = '';
        model.changeHandler = undefined;
    }

    return { monaco, model, editor, zoneCalls, resetFakes };
});

vi.mock('../../lib/monaco', () => ({
    configureMonacoEnvironment: vi.fn(),
    configureMonaco: vi.fn(),
    createMonacoOptions: () => ({ automaticLayout: true }),
    getMonacoLanguage: () => 'plaintext',
    getMonacoModule: async () => monaco,
}));

import ConflictMonacoEditor from '../../components/ConflictMonacoEditor.vue';

function conflict(mine: string, theirs: string) {
    return `<<<<<<< HEAD\n${mine}=======\n${theirs}>>>>>>> feature\n`;
}

function nextFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function mountEditor(initialValue: string) {
    const wrapper = mount(ConflictMonacoEditor, {
        props: {
            modelValue: initialValue,
            'onUpdate:modelValue': (next: string) => {
                void wrapper.setProps({ modelValue: next });
            },
        },
        global: { stubs: { DiffsDiffEditor: true } },
    });

    return wrapper;
}

function clickZoneButton(entry: { zone: FakeZone }, label: string) {
    const button = Array.from(entry.zone.domNode.querySelectorAll('button')).find((candidate) => candidate.textContent === label);

    if (!button) {
        throw new Error(`Missing the ${label} button.`);
    }

    button.click();
}

beforeEach(() => {
    resetFakes();
    vi.clearAllMocks();
});

describe('ConflictMonacoEditor chrome', () => {
    it('keeps a conflict zone when the lines above it change', async () => {
        const initial = `top\n${conflict('mine\n', 'theirs\n')}`;
        mountEditor(initial);
        await flushPromises();

        expect(zoneCalls.added).toHaveLength(1);

        model.content = `inserted\n${initial}`;
        model.changeHandler?.();
        await nextFrame();

        // The zone is reused and only its anchor moved.
        expect(zoneCalls.added).toHaveLength(1);
        expect(zoneCalls.removed).toEqual([]);
        expect(zoneCalls.layouted).toEqual([zoneCalls.added[0]!.id]);
    });

    it('resolves the conflict from the reused zone', async () => {
        const initial = conflict('mine\n', 'theirs\n');
        mountEditor(initial);
        await flushPromises();

        const zone = zoneCalls.added[0]!;

        model.content = `before\n${initial}`;
        model.changeHandler?.();
        await nextFrame();

        clickZoneButton(zone, 'Accept Incoming');
        await nextFrame();

        expect(model.content).toBe('before\ntheirs\n');
        expect(zoneCalls.removed).toEqual([zone.id]);
    });

    it('retargets the surviving zone when the first of two conflicts is resolved', async () => {
        const first = conflict('a\n', 'b\n');
        const second = conflict('c\n', 'd\n');
        mountEditor(`${first}${second}`);
        await flushPromises();

        expect(zoneCalls.added).toHaveLength(2);

        const firstZone = zoneCalls.added[0]!;
        const secondZone = zoneCalls.added[1]!;

        clickZoneButton(firstZone, 'Accept Mine');
        await nextFrame();

        expect(model.content).toBe(`a\n${second}`);
        expect(zoneCalls.removed).toEqual([firstZone.id]);
        expect(zoneCalls.added).toHaveLength(2);

        clickZoneButton(secondZone, 'Accept Incoming');
        await nextFrame();

        expect(model.content).toBe('a\nd\n');
    });

    it('syncs the chrome once per frame however many edits arrive', async () => {
        const initial = conflict('mine\n', 'theirs\n');
        mountEditor(initial);
        await flushPromises();

        const callsAfterMount = editor.changeViewZones.mock.calls.length;

        model.content = `one\n${initial}`;
        model.changeHandler?.();
        model.content = `two\n${initial}`;
        model.changeHandler?.();
        model.content = `three\n${initial}`;
        model.changeHandler?.();

        expect(editor.changeViewZones.mock.calls.length).toBe(callsAfterMount);

        await nextFrame();

        expect(editor.changeViewZones.mock.calls.length).toBe(callsAfterMount + 1);
    });
});
