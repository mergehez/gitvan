import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import type { EditorSettings } from '../../../shared/types.ts';
import type { useSettings } from '../../composables/useSettings';
import type { HunkActionsConfig } from '../../lib/hunkActions';

type SettingsState = ReturnType<typeof useSettings>;

let mockSettings: { state: EditorSettings };
let scrollIntoView: ReturnType<typeof vi.fn>;

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => mockSettings as unknown as SettingsState,
}));

const pierre = vi.hoisted(() => {
    const state = {
        instances: [] as any[],
        unresolvedInstances: [] as any[],
        virtualizers: [] as any[],
        renderCalls: [] as any[],
        setOptionsCalls: [] as any[],
        lastOptions: undefined as any,
        editors: [] as any[],
        cleanup: vi.fn(),
        virtualizerCleanup: vi.fn(),
        diffOverride: undefined as any,
    };

    function splitLines(contents: string) {
        const lines = contents.split('\n');

        if (lines.length > 1 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        return lines;
    }

    function buildParsedDiff(original: string, modified: string) {
        const deletionLines = splitLines(original);
        const additionLines = splitLines(modified);
        const hunkContent: any[] = [];

        if (deletionLines.length === additionLines.length) {
            for (let index = 0; index < deletionLines.length; index += 1) {
                if (deletionLines[index] !== additionLines[index]) {
                    hunkContent.push({ type: 'change', deletions: 1, deletionLineIndex: index, additions: 1, additionLineIndex: index });
                }
            }
        }

        if (hunkContent.length === 0 && deletionLines.length !== additionLines.length) {
            hunkContent.push({ type: 'change', deletions: deletionLines.length, deletionLineIndex: 0, additions: additionLines.length, additionLineIndex: 0 });
        }

        return { hunks: [{ hunkContent }], deletionLines, additionLines, name: 'file.txt' };
    }

    /**
     * jsdom's selector engine scores `:scope > …` as an empty match, so the gutter answers the two
     * relative selectors the component builds with the semantics a real browser gives them.
     */
    function patchScopeSelectors(gutter: HTMLElement) {
        const children = () => Array.from(gutter.children) as HTMLElement[];

        (gutter as any).querySelectorAll = (selector: string) => {
            if (selector === ':scope > div') {
                return children().filter((child) => child.tagName === 'DIV');
            }

            return (Element.prototype.querySelectorAll as any).call(gutter, selector);
        };

        (gutter as any).querySelector = (selector: string) => {
            if (selector === ':scope > div') {
                return children().find((child) => child.tagName === 'DIV') ?? null;
            }

            const siblingMatch = /^:scope > div\[data-column-number="(.+)"\] \+ div$/.exec(selector);

            if (siblingMatch) {
                const anchor = children().find((child) => child.getAttribute('data-column-number') === siblingMatch[1]);
                const next = anchor ? children()[children().indexOf(anchor) + 1] : undefined;

                return next && next.tagName === 'DIV' ? next : null;
            }

            return (Element.prototype.querySelector as any).call(gutter, selector);
        };
    }

    /** Stands in for the renderer's real shadow DOM: one gutter row per line. */
    function renderShadowDom(containerWrapper: HTMLElement, lineCount: number) {
        const shadow = containerWrapper.shadowRoot ?? containerWrapper.attachShadow({ mode: 'open' });
        shadow.innerHTML = '';

        const pre = document.createElement('pre');
        pre.setAttribute('data-diff', '');

        const additions = document.createElement('div');
        additions.setAttribute('data-additions', '');

        const gutter = document.createElement('div');
        gutter.setAttribute('data-gutter', '');

        for (let index = 0; index < lineCount; index += 1) {
            const line = document.createElement('div');
            line.setAttribute('data-column-number', String(index));
            line.setAttribute('data-line', String(index + 1));
            line.textContent = `line ${index + 1}`;
            gutter.appendChild(line);
        }

        patchScopeSelectors(gutter);
        additions.appendChild(gutter);
        pre.appendChild(additions);
        shadow.appendChild(pre);
    }

    class MockFileDiff {
        options: any;

        constructor(options: any) {
            this.options = options;
            state.instances.push(this);
            state.lastOptions = options;
        }

        setOptions(options: any) {
            this.options = options;
            state.lastOptions = options;
            state.setOptionsCalls.push(options);
        }

        render(props: any) {
            state.renderCalls.push(props);
            renderShadowDom(props.containerWrapper, 10);
            this.options.onPostRender?.(props.containerWrapper);
        }

        cleanUp() {
            state.cleanup();
        }
    }

    class MockUnresolvedFile extends MockFileDiff {
        constructor(options: any) {
            super(options);
            state.instances.pop();
            state.unresolvedInstances.push(this);
        }
    }

    class MockVirtualizedFileDiff extends MockFileDiff {
        constructor(options: any, _virtualizer: unknown) {
            super(options);
        }
    }

    class MockVirtualizer {
        type = 'simple' as const;
        virtualizer = true;

        constructor() {
            state.virtualizers.push(this);
        }

        setup() {}
        cleanUp() {
            state.virtualizerCleanup();
        }
    }

    class MockEditor {
        type: string;
        options: any;
        instance: any;
        cleanedUp = false;

        constructor(type: string, options?: any) {
            this.type = type;
            this.options = options;
            state.editors.push(this);
        }

        edit(instance: any) {
            this.instance = instance;

            return () => this.cleanUp();
        }

        cleanUp() {
            this.cleanedUp = true;
        }
    }

    const parseDiffFromFile = vi.fn((oldFile: any, newFile: any) => state.diffOverride ?? buildParsedDiff(oldFile?.contents ?? '', newFile?.contents ?? ''));
    const resolveEditorCommandFromKeyboardEvent = vi.fn(() => undefined);

    function reset() {
        state.instances.length = 0;
        state.unresolvedInstances.length = 0;
        state.virtualizers.length = 0;
        state.renderCalls.length = 0;
        state.setOptionsCalls.length = 0;
        state.editors.length = 0;
        state.lastOptions = undefined;
        state.diffOverride = undefined;
        state.cleanup.mockClear();
        state.virtualizerCleanup.mockClear();
        parseDiffFromFile.mockClear();
    }

    function makeChangeDiff(
        hunks: Array<{ deletions: number; deletionLineIndex: number; additions: number; additionLineIndex: number }>,
        deletionLines: string[],
        additionLines: string[]
    ) {
        return {
            hunks: [{ hunkContent: hunks.map((hunk) => ({ type: 'change', ...hunk })) }],
            deletionLines,
            additionLines,
            name: 'file.txt',
        };
    }

    return {
        state,
        FileDiff: MockFileDiff,
        UnresolvedFile: MockUnresolvedFile,
        VirtualizedFileDiff: MockVirtualizedFileDiff,
        Virtualizer: MockVirtualizer,
        Editor: MockEditor,
        parseDiffFromFile,
        resolveEditorCommandFromKeyboardEvent,
        reset,
        makeChangeDiff,
    };
});

vi.mock('@pierre/diffs', () => ({
    FileDiff: pierre.FileDiff,
    UnresolvedFile: pierre.UnresolvedFile,
    VirtualizedFileDiff: pierre.VirtualizedFileDiff,
    Virtualizer: pierre.Virtualizer,
    parseDiffFromFile: pierre.parseDiffFromFile,
}));

vi.mock('@pierre/diffs/edit', () => ({
    Editor: pierre.Editor,
    resolveEditorCommandFromKeyboardEvent: pierre.resolveEditorCommandFromKeyboardEvent,
}));

import DiffsDiffEditor from '../../components/DiffsDiffEditor.vue';

const PATCH_HEADER = 'diff --git a/app.ts b/app.ts\nindex 1111111..2222222 100644\n--- a/app.ts\n+++ b/app.ts\n';
const FULL_PATCH = `${PATCH_HEADER}@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n`;

const mountedWrappers: Array<ReturnType<typeof mount>> = [];

function createMockSettings() {
    return reactive({
        state: {
            editors: [],
            defaultEditorPath: undefined,
            terminals: [],
            defaultTerminalPath: undefined,
            diffFontSize: 12,
            diffViewMode: 'full-file',
            diffIgnoredChars: '',
            diffIgnoredCharsEnabled: true,
            showWhitespaceChanges: false,
            activeView: 'changes',
            showBranches: false,
            diffViewWrap: false,
        } satisfies EditorSettings,
    });
}

function mountEditor(props: Record<string, unknown> = {}) {
    const wrapper = mount(DiffsDiffEditor, {
        props: {
            original: 'a\nb\nc\n',
            modified: 'a\nB\nc\n',
            pathForLanguage: 'app.ts',
            ...props,
        } as any,
    });

    mountedWrappers.push(wrapper);

    return wrapper;
}

function shadowOf(wrapper: ReturnType<typeof mountEditor>) {
    const host = wrapper.get('.gitvan-diffs-host').element as HTMLElement;

    return host.shadowRoot!;
}

function gutterOf(wrapper: ReturnType<typeof mountEditor>) {
    return shadowOf(wrapper).querySelector<HTMLElement>('[data-gutter]')!;
}

function hunkButtonsOf(wrapper: ReturnType<typeof mountEditor>) {
    return Array.from(shadowOf(wrapper).querySelectorAll<HTMLElement>('.gitvan-hunk-button'));
}

function hoverHunkButton(button: HTMLElement) {
    button.dispatchEvent(new MouseEvent('mouseenter'));
}

function actionsWrapperOf(wrapper: ReturnType<typeof mountEditor>) {
    return shadowOf(wrapper).querySelector<HTMLElement>('.gitvan-hunk-actions')!;
}

function actionButton(wrapper: ReturnType<typeof mountEditor>, label: string) {
    const buttons = Array.from(actionsWrapperOf(wrapper).querySelectorAll<HTMLButtonElement>('button'));
    const button = buttons.find((candidate) => candidate.textContent === label);

    if (!button) {
        throw new Error(`Missing the ${label} action button; had ${buttons.map((candidate) => candidate.textContent).join(', ')}`);
    }

    return button;
}

function hunkActionsConfig(overrides: Partial<HunkActionsConfig> = {}): HunkActionsConfig {
    return {
        kind: 'unstaged',
        oldSizeBytes: 100,
        newSizeBytes: 100,
        patch: FULL_PATCH,
        onStage: vi.fn(),
        onUnstage: vi.fn(),
        onDiscard: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    mockSettings = createMockSettings();
    scrollIntoView = vi.fn();
    (Element.prototype as any).scrollIntoView = scrollIntoView;
    pierre.reset();
    vi.clearAllMocks();
});

afterEach(() => {
    mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe('DiffsDiffEditor rendering', () => {
    it('renders the diff and reports the visible change', () => {
        const wrapper = mountEditor();

        expect(wrapper.emitted('visibleDiffChange')).toEqual([[true]]);
        expect(pierre.state.renderCalls).toHaveLength(1);

        const [renderCall] = pierre.state.renderCalls;

        expect(renderCall.forceRender).toBe(true);
        expect(renderCall.fileDiff.rawHunks.map((hunk: any) => hunk.hunkSpecs)).toEqual(['-2,1 +2,1']);
        expect(renderCall.fileDiff.additionLines).toEqual(['a', 'B', 'c']);
        expect(renderCall.fileDiff.deletionLines).toEqual(['a', 'b', 'c']);
        expect(pierre.state.instances).toHaveLength(1);
    });

    it('passes the comparable pair to the diff parser instead of normalizing again', () => {
        mountEditor({ normalizedOriginal: 'same', normalizedModified: 'same' });

        expect(pierre.parseDiffFromFile).not.toHaveBeenCalled();
        expect(pierre.state.renderCalls).toHaveLength(0);
        expect(pierre.state.lastOptions.lineDiffType).toBe('none');
        expect(pierre.state.lastOptions.diffIndicators).toBe('none');
        expect(pierre.state.lastOptions.disableBackground).toBe(true);
    });

    it('treats a whitespace-only edit as changed only when whitespace changes are shown', async () => {
        const wrapper = mountEditor({ original: 'one\nline\n', modified: 'one\nline  \n' });

        expect(pierre.state.renderCalls).toHaveLength(0);
        expect(wrapper.emitted('visibleDiffChange')).toBeUndefined();

        await wrapper.setProps({ showWhitespaceChanges: true });

        expect(pierre.state.renderCalls).toHaveLength(1);
        expect(wrapper.emitted('visibleDiffChange')?.at(-1)).toEqual([true]);
    });

    it('treats ignored characters as unchanged until they are significant', async () => {
        const wrapper = mountEditor({ original: 'value;\n', modified: 'value\n', diffIgnoredChars: ';', showWhitespaceChanges: true });

        expect(pierre.state.renderCalls).toHaveLength(0);

        await wrapper.setProps({ diffIgnoredChars: '' });

        expect(pierre.state.renderCalls).toHaveLength(1);
        expect(wrapper.emitted('visibleDiffChange')?.at(-1)).toEqual([true]);
    });

    it('keys the renderer instance and options on settings and view mode', async () => {
        const wrapper = mountEditor({ diffViewMode: 'changes' });

        expect(pierre.state.lastOptions).toMatchObject({
            theme: 'pierre-dark',
            themeType: 'dark',
            diffStyle: 'split',
            disableFileHeader: true,
            overflow: 'scroll',
            expandUnchanged: false,
            collapsedContextThreshold: 1,
            hunkSeparators: 'line-info-basic',
            useTokenTransformer: true,
        });

        mockSettings.state.diffViewWrap = true;
        await flushPromises();

        expect(pierre.state.lastOptions.overflow).toBe('wrap');

        await wrapper.setProps({ diffViewMode: 'full-file' });

        expect(pierre.state.lastOptions.expandUnchanged).toBe(true);
        // The renderer is reused across renders instead of being rebuilt.
        expect(pierre.state.instances).toHaveLength(1);
        expect(pierre.state.setOptionsCalls).toHaveLength(3);
        expect(pierre.state.renderCalls).toHaveLength(3);
    });

    it('applies the configured font size to the host element', () => {
        const wrapper = mountEditor();

        expect(wrapper.get('[data-testid="diffs-diff-editor-root"]').attributes('style')).toContain('--diffs-font-size: 12px');
    });

    it('renders conflict files through the unresolved renderer', () => {
        const wrapper = mountEditor({ conflictFile: '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\n', pathForLanguage: 'conflict.txt' });

        expect(wrapper.emitted('visibleDiffChange')).toEqual([[true]]);
        expect(pierre.state.instances).toHaveLength(0);
        expect(pierre.state.unresolvedInstances).toHaveLength(1);
        expect(pierre.state.renderCalls[0].file.contents).toContain('<<<<<<< HEAD');
        expect(pierre.state.lastOptions).toMatchObject({ mergeConflictActionsType: 'none', maxContextLines: 3 });
        // The unresolved renderer has no editable surface.
        expect(pierre.state.editors).toHaveLength(0);
    });

    it('keeps one read-only edit session per rendered diff', async () => {
        const wrapper = mountEditor({ readonly: true });

        expect(pierre.state.editors).toHaveLength(1);
        expect(pierre.state.editors[0].type).toBe('file-diff');
        expect(pierre.state.editors[0].instance).toBe(pierre.state.instances[0]);

        // A re-render reuses the renderer, so it must reuse its edit session too.
        await wrapper.setProps({ showWhitespaceChanges: true });

        expect(pierre.state.instances).toHaveLength(1);
        expect(pierre.state.editors).toHaveLength(1);

        wrapper.unmount();

        expect(pierre.state.editors[0].cleanedUp).toBe(true);
    });

    it('cleans up the renderer on unmount without building a virtualizer for a small diff', () => {
        const wrapper = mountEditor();

        expect(pierre.state.cleanup).not.toHaveBeenCalled();
        expect(pierre.state.virtualizers).toHaveLength(0);

        wrapper.unmount();

        expect(pierre.state.cleanup).toHaveBeenCalledTimes(1);
    });

    it('builds and cleans up the virtualizer only for a large diff', () => {
        const small = mountEditor();

        expect(pierre.state.instances.at(-1)).toBeInstanceOf(pierre.FileDiff);
        expect(pierre.state.virtualizers).toHaveLength(0);
        small.unmount();

        const original = Array.from({ length: 2_500 }, (_, index) => `line ${index}`).join('\n');
        const modified = original.replace('line 1', 'line one');
        const large = mountEditor({ original, modified, pathForLanguage: 'big.json' });

        // A 790 KB JSON is ~14k lines; the plain renderer would mount every one of them.
        expect(pierre.state.instances.at(-1)).toBeInstanceOf(pierre.VirtualizedFileDiff);
        expect(pierre.state.virtualizers).toHaveLength(1);

        large.unmount();

        expect(pierre.state.virtualizerCleanup).toHaveBeenCalledTimes(1);
    });
});

describe('DiffsDiffEditor hunk anchoring', () => {
    it('anchors one button per change block with its line ranges', async () => {
        const wrapper = mountEditor({ hunkActionsConfig: hunkActionsConfig() });

        await flushPromises();

        const buttons = hunkButtonsOf(wrapper);

        expect(buttons).toHaveLength(1);
        expect(buttons[0]!.textContent).toBe('⋯');
        expect(buttons[0]!.getAttribute('data-hunk-index')).toBe('0');
        expect(buttons[0]!.getAttribute('data-hunk-label')).toBe('#1 (-2,1 +2,1)');
    });

    it('anchors each hunk to the gutter row that follows its addition line', async () => {
        pierre.state.diffOverride = pierre.makeChangeDiff(
            [
                { deletions: 1, deletionLineIndex: 0, additions: 1, additionLineIndex: 0 },
                { deletions: 1, deletionLineIndex: 2, additions: 1, additionLineIndex: 2 },
            ],
            ['a', 'b', 'c'],
            ['A', 'b', 'C']
        );

        const wrapper = mountEditor({ hunkActionsConfig: hunkActionsConfig() });

        await flushPromises();

        const rows = Array.from(gutterOf(wrapper).children) as HTMLElement[];

        expect(rows[0]!.querySelector('.gitvan-hunk-button')!.getAttribute('data-hunk-label')).toBe('#1 (-1,1 +1,1)');
        expect(rows[1]!.querySelector('.gitvan-hunk-button')).toBeNull();
        expect(rows[2]!.querySelector('.gitvan-hunk-button')).toBeNull();
        expect(rows[3]!.querySelector('.gitvan-hunk-button')!.getAttribute('data-hunk-label')).toBe('#2 (-3,1 +3,1)');
        expect(hunkButtonsOf(wrapper)).toHaveLength(2);
    });

    it('rebuilds the anchors after a re-render without duplicating them', async () => {
        const wrapper = mountEditor({ hunkActionsConfig: hunkActionsConfig() });

        await flushPromises();

        expect(hunkButtonsOf(wrapper)).toHaveLength(1);
        expect(shadowOf(wrapper).querySelectorAll('.gitvan-hunk-actions')).toHaveLength(1);

        await wrapper.setProps({ modified: 'a\nB\nc\nd\n' });
        await flushPromises();

        expect(pierre.state.renderCalls).toHaveLength(2);
        expect(hunkButtonsOf(wrapper)).toHaveLength(1);
        expect(shadowOf(wrapper).querySelectorAll('.gitvan-hunk-actions')).toHaveLength(1);
    });

    it('adds no anchors without a hunk actions config or a known file size', async () => {
        const withoutConfig = mountEditor();

        await flushPromises();

        expect(hunkButtonsOf(withoutConfig)).toHaveLength(0);
        expect(shadowOf(withoutConfig).querySelector('.gitvan-hunk-actions')).toBeNull();

        const withoutSizes = mountEditor({ hunkActionsConfig: hunkActionsConfig({ oldSizeBytes: 0 }) });

        await flushPromises();

        expect(hunkButtonsOf(withoutSizes)).toHaveLength(0);
        expect(shadowOf(withoutSizes).querySelector('.gitvan-hunk-actions')).toBeNull();
    });

    it('builds the single-hunk patch from the original patch header', async () => {
        const config = hunkActionsConfig();
        const wrapper = mountEditor({ hunkActionsConfig: config });

        await flushPromises();
        hoverHunkButton(hunkButtonsOf(wrapper)[0]!);

        const actions = actionsWrapperOf(wrapper);

        expect(actions.style.display).toBe('flex');
        expect(actions.textContent).toContain('#1 (-2,1 +2,1)');

        actionButton(wrapper, 'Stage Change').click();

        const expectedHunkPatch = `${PATCH_HEADER}@@ -2,3 +2,3 @@\n a\n-b\n+B\n c\n`;

        expect(config.onStage).toHaveBeenCalledWith(expectedHunkPatch);

        actionButton(wrapper, 'Discard Change').click();

        expect(config.onDiscard).toHaveBeenCalledWith(expectedHunkPatch);
        expect(config.onUnstage).not.toHaveBeenCalled();
    });

    it('offers only unstaging for a staged hunk', async () => {
        const config = hunkActionsConfig({ kind: 'staged' });
        const wrapper = mountEditor({ hunkActionsConfig: config });

        await flushPromises();
        hoverHunkButton(hunkButtonsOf(wrapper)[0]!);

        expect(actionsWrapperOf(wrapper).querySelectorAll('button')).toHaveLength(1);

        actionButton(wrapper, 'Unstage Change').click();

        expect(config.onUnstage).toHaveBeenCalledTimes(1);
        expect(config.onUnstage).toHaveBeenCalledWith(`${PATCH_HEADER}@@ -2,3 +2,3 @@\n a\n-b\n+B\n c\n`);
        expect(config.onStage).not.toHaveBeenCalled();
        expect(config.onDiscard).not.toHaveBeenCalled();
    });
});

describe('DiffsDiffEditor revealing', () => {
    it('scrolls the requested line into view inside the rendered diff', async () => {
        const wrapper = mountEditor({ revealLine: 2 });

        await flushPromises();

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
        expect(scrollIntoView.mock.instances.length).toBeGreaterThan(0);
        expect(new Set(scrollIntoView.mock.instances.map((node) => (node as HTMLElement).getAttribute('data-line')))).toEqual(new Set(['2']));

        const callsBefore = scrollIntoView.mock.instances.length;

        await wrapper.setProps({ revealLine: 3 });
        await flushPromises();

        const newInstances = scrollIntoView.mock.instances.slice(callsBefore) as HTMLElement[];

        expect(newInstances.length).toBeGreaterThan(0);
        expect(new Set(newInstances.map((node) => node.getAttribute('data-line')))).toEqual(new Set(['3']));
    });

    it('does not scroll when no line is requested', async () => {
        mountEditor();

        await flushPromises();

        expect(scrollIntoView).not.toHaveBeenCalled();
    });
});
