import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import CommitInspectPane from '../../components/CommitInspectPane.vue';
import type { ContextMenuEntry, ContextMenuItem } from '../../directives';

let mockOpenFileHistory: ReturnType<typeof vi.fn>;
let mockDiffViewerState: Record<string, unknown>;
let lastDiffArgument: { value?: unknown } | undefined;

vi.mock('../../composables/useFileHistory', () => ({
    useFileHistory: () => ({ openFileHistory: mockOpenFileHistory }),
}));

vi.mock('../../composables/useDiffViewer', () => ({
    useDiffViewer: (diff: { value?: unknown }) => {
        lastDiffArgument = diff;

        return mockDiffViewerState;
    },
}));

const etSplitterStub = defineComponent({
    name: 'EtSplitter',
    props: {
        baseSide: { type: String, default: undefined },
        defaultWidth: { type: String, default: undefined },
        minWidth: { type: String, default: undefined },
        maxWidth: { type: String, default: undefined },
        localStorageKey: { type: String, default: undefined },
    },
    template:
        '<div data-testid="commit-splitter" :data-storage-key="localStorageKey" :data-base-side="baseSide" :data-default-width="defaultWidth"><slot name="left" /><slot name="right" /></div>',
});

const changesFileTreeStub = defineComponent({
    name: 'ChangesFileTree',
    props: {
        item: { type: Object, required: true },
        emptyText: { type: String, default: undefined },
        selection: { type: String, default: undefined },
        noActions: { type: Boolean, default: false },
        virtualize: { type: Boolean, default: false },
        showPathTooltip: { type: Boolean, default: false },
        onSelect: { type: Function, default: undefined },
        getContextMenuItems: { type: Function, default: undefined },
        getHeaderContextMenuItems: { type: Function, default: undefined },
    },
    template: `
        <section data-testid="commit-files-tree">
            <p data-testid="commit-files-tree-title">{{ item.title }}</p>
            <p v-if="!item.children.length" data-testid="commit-files-tree-empty">{{ emptyText }}</p>
            <button
                v-for="child in item.children"
                :key="child.id"
                type="button"
                :data-path="child.path"
                :data-status="child.status"
                :data-selected="String(child.path === selection)"
                @click="onSelect?.(child)"
            >
                {{ child.title }}
                <slot name="before-status" :item="child" />
            </button>
        </section>
    `,
});

const diffViewerStub = defineComponent({
    name: 'DiffViewer',
    props: {
        state: { type: Object, default: undefined },
    },
    template: '<div data-testid="commit-diff-viewer" />',
});

function createCommit(files: Array<{ path: string; status?: string; previousPath?: string; hadConflict?: boolean }>) {
    return {
        sha: 'abc123',
        shortSha: 'abc123',
        summary: 'Add release tag',
        authorName: 'Mazlum',
        authorEmail: 'mazlum@example.com',
        authoredAt: '2026-04-10T10:00:00.000Z',
        refs: [],
        tags: [],
        isUnpushed: false,
        body: '',
        files: files.map((file) => ({
            path: file.path,
            previousPath: file.previousPath,
            status: file.status ?? 'modified',
            hadConflict: file.hadConflict,
        })),
    };
}

function mountPane(props: Record<string, unknown> = {}) {
    return mount(CommitInspectPane, {
        props: {
            commit: createCommit([{ path: 'b.ts' }, { path: 'a.ts' }]),
            diff: undefined,
            selectedFilePath: undefined,
            sortStorageKey: 'commit-files',
            localStorageKeyPrefix: 'commit-',
            emptyText: 'Select a commit to inspect.',
            onSelectFile: vi.fn(),
            ...props,
        } as any,
        global: {
            directives: { tooltip: {} },
            stubs: {
                EtSplitter: etSplitterStub,
                ChangesFileTree: changesFileTreeStub,
                DiffViewer: diffViewerStub,
            },
        },
    });
}

function isMenuItem(entry: ContextMenuEntry | undefined): entry is ContextMenuItem {
    return Boolean(entry && 'id' in entry);
}

function treeItem(wrapper: ReturnType<typeof mountPane>) {
    return wrapper.getComponent(changesFileTreeStub).props('item') as any;
}

function headerMenuEntries(wrapper: ReturnType<typeof mountPane>) {
    const tree = wrapper.getComponent(changesFileTreeStub);
    const build = tree.props('getHeaderContextMenuItems') as ((item: unknown) => ContextMenuEntry[]) | undefined;

    return build ? build(tree.props('item')) : [];
}

function fileMenuEntries(wrapper: ReturnType<typeof mountPane>, file: unknown) {
    const tree = wrapper.getComponent(changesFileTreeStub);
    const build = tree.props('getContextMenuItems') as ((item: unknown) => ContextMenuEntry[]) | undefined;

    return build ? build(file) : [];
}

beforeEach(() => {
    localStorage.clear();
    mockOpenFileHistory = vi.fn(async () => undefined);
    mockDiffViewerState = { title: 'a.ts' };
    lastDiffArgument = undefined;
});

describe('CommitInspectPane', () => {
    it('shows the empty text and no tree while no commit is selected', () => {
        const wrapper = mountPane({ commit: undefined });

        expect(wrapper.text()).toContain('Select a commit to inspect.');
        expect(wrapper.findComponent(changesFileTreeStub).exists()).toBe(false);
        expect(wrapper.find('[data-testid="commit-diff-viewer"]').exists()).toBe(false);
    });

    it('renders the commit header and body', () => {
        const wrapper = mountPane({ commit: { ...createCommit([{ path: 'a.ts' }]), body: 'Explains the tag.' } });

        expect(wrapper.text()).toContain('Add release tag');
        expect(wrapper.text()).toContain('abc123');
        expect(wrapper.text()).toContain('Mazlum');
        expect(wrapper.text()).toContain('mazlum@example.com');
        expect(wrapper.text()).toContain('Explains the tag.');
    });

    it('omits the body block when the commit has no body', () => {
        const wrapper = mountPane();

        expect(wrapper.text()).not.toContain('Explains the tag.');
    });

    it('hands the commit files to the tree with their status and selection', () => {
        const wrapper = mountPane({
            commit: createCommit([
                { path: 'src/a.ts', status: 'added' },
                { path: 'old/b.ts', status: 'renamed', previousPath: 'b.ts' },
            ]),
            selectedFilePath: 'src/a.ts',
        });
        const item = treeItem(wrapper);

        expect(wrapper.get('[data-testid="commit-files-tree-title"]').text()).toBe('Files');
        expect(item.id).toBe('abc123');
        expect(item.children.map((child: any) => child.path)).toEqual(['src/a.ts', 'old/b.ts']);
        expect(item.children[0].status).toBe('added');
        expect(item.children[1].subtitle).toBe('b.ts');
        expect(wrapper.get('button[data-path="src/a.ts"]').attributes('data-selected')).toBe('true');

        const tree = wrapper.getComponent(changesFileTreeStub);

        expect(tree.props('emptyText')).toBe('No files');
        expect(tree.props('noActions')).toBe(true);
        expect(tree.props('virtualize')).toBe(true);
        expect(tree.props('showPathTooltip')).toBe(true);
    });

    it('renders the conflict marker for files that had merge conflicts', () => {
        const wrapper = mountPane({ commit: createCommit([{ path: 'a.ts', hadConflict: true }, { path: 'b.ts' }]) });

        expect(wrapper.get('button[data-path="a.ts"] span').classes()).toContain('icon-[mingcute--git-merge-fill]');
        expect(wrapper.find('button[data-path="b.ts"] span').exists()).toBe(false);
    });

    it('selects a file through the tree callback', async () => {
        const onSelectFile = vi.fn();
        const wrapper = mountPane({ onSelectFile });

        await wrapper.get('button[data-path="a.ts"]').trigger('click');

        expect(onSelectFile).toHaveBeenCalledWith('a.ts');
    });

    it('keeps the commit order until a different sort mode is chosen', async () => {
        const wrapper = mountPane();

        expect(treeItem(wrapper).children.map((child: any) => child.title)).toEqual(['b.ts', 'a.ts']);

        const sortBy = headerMenuEntries(wrapper).find((entry) => isMenuItem(entry) && entry.label === 'Sort by');

        expect(sortBy).toBeTruthy();

        const azEntry = (sortBy as ContextMenuItem).children!.find((entry) => isMenuItem(entry) && entry.label === 'A-Z') as ContextMenuItem;

        await azEntry.action?.();
        await flushPromises();

        expect(treeItem(wrapper).children.map((child: any) => child.title)).toEqual(['a.ts', 'b.ts']);
    });

    it('marks the active sort mode on the header menu and namespaces the entries per view', () => {
        const wrapper = mountPane();
        const entries = headerMenuEntries(wrapper);
        const sortBy = entries.find((entry) => isMenuItem(entry) && entry.label === 'Sort by') as ContextMenuItem;

        expect(sortBy.id).toBe('commit-files-sort-sort-by');
        expect(sortBy.children!.map((child) => (child as ContextMenuItem).label)).toEqual(['Default', 'A-Z', 'Z-A', 'File Type A-Z', 'File Type Z-A']);
        expect((sortBy.children!.find((child) => isMenuItem(child) && child.label === 'Default') as ContextMenuItem).checked).toBe(true);
        expect((sortBy.children!.find((child) => isMenuItem(child) && child.label === 'A-Z') as ContextMenuItem).checked).toBe(false);
    });

    it('opens the file history from a file context menu', async () => {
        const wrapper = mountPane();
        const entry = fileMenuEntries(wrapper, { path: 'src/a.ts', title: 'a.ts' }).find(
            (candidate) => isMenuItem(candidate) && candidate.label === 'File History'
        ) as ContextMenuItem;

        expect(entry.id).toBe('commit-file-history:src/a.ts');

        await entry.action?.();
        await flushPromises();

        expect(mockOpenFileHistory).toHaveBeenCalledWith('src/a.ts');
    });

    it('renders the diff viewer only once a diff is available', async () => {
        const wrapper = mountPane();
        const diff = { path: 'a.ts', entry: { status: 'modified' } };

        expect(wrapper.find('[data-testid="commit-diff-viewer"]').exists()).toBe(false);

        await wrapper.setProps({ diff } as any);

        expect(wrapper.getComponent(diffViewerStub).props('state')).toBe(mockDiffViewerState);
        expect(lastDiffArgument?.value).toStrictEqual(diff);
    });

    it('namespaces the sidebar width per view', () => {
        const wrapper = mountPane({ localStorageKeyPrefix: 'history-' });
        const splitter = wrapper.get('[data-testid="commit-splitter"]');

        expect(splitter.attributes('data-storage-key')).toBe('history-CommitFilesSidebarWidth');
        expect(splitter.attributes('data-base-side')).toBe('left');
        expect(splitter.attributes('data-default-width')).toBe('250px');
    });
});
