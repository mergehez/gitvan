import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import RepExplorerView from '../../components/RepExplorerView.vue';
import type { useRepos } from '../../composables/useRepos';

type ReposState = ReturnType<typeof useRepos>;

let selectedRepo: any;

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => ({ getSelectedRepo: () => selectedRepo }) as unknown as ReposState,
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({ state: { diffFontSize: 12 } }),
}));

vi.mock('../../lib/monaco', () => ({
    configureMonacoEnvironment: vi.fn(),
    configureMonaco: vi.fn(),
    createMonacoOptions: () => ({ automaticLayout: true }),
    getMonacoLanguage: () => 'plaintext',
    getMonacoModule: async () => ({}),
}));

const etSplitterStub = defineComponent({
    name: 'EtSplitter',
    props: {
        localStorageKey: { type: String, default: undefined },
    },
    template: '<div data-testid="explorer-splitter" :data-storage-key="localStorageKey"><slot name="left" /><slot name="right" /></div>',
});

const fileTreeStub = defineComponent({
    name: 'FileTree',
    props: {
        item: { type: Object, required: true },
        emptyText: { type: String, default: undefined },
        selection: { type: String, default: undefined },
        virtualize: { type: Boolean, default: false },
        noActions: { type: Boolean, default: false },
        onSelect: { type: Function, default: undefined },
    },
    template: `
        <section data-testid="explorer-tree">
            <p data-testid="explorer-tree-count">{{ item.count }}</p>
            <p v-if="!item.children.length" data-testid="explorer-tree-empty">{{ emptyText }}</p>
            <button
                v-for="child in item.children"
                :key="child.id"
                type="button"
                :data-kind="child.kind"
                :data-path="child.path"
                :data-selected="String(child.path === selection)"
                @click="onSelect?.(child)"
            >
                {{ child.title }}
            </button>
        </section>
    `,
});

const monacoEditorStub = defineComponent({
    name: 'MonacoEditor',
    props: {
        modelValue: { type: String, default: undefined },
        pathForLanguage: { type: String, default: undefined },
        readonly: { type: Boolean, default: false },
        noHead: { type: Boolean, default: false },
    },
    template: '<pre data-testid="explorer-monaco-file" :data-path="pathForLanguage">{{ modelValue }}</pre>',
});

const monacoEditorSettingsButtonStub = defineComponent({
    name: 'MonacoEditorSettingsButton',
    props: {
        hideDiffOptions: { type: Boolean, default: false },
    },
    template: '<button type="button" data-testid="explorer-editor-settings" />',
});

function commit(sha: string, summary: string) {
    return {
        sha,
        shortSha: sha,
        summary,
        authorName: 'Mazlum',
        authorEmail: 'mazlum@example.com',
        authoredAt: '2026-04-09T10:00:00.000Z',
        refs: [],
        tags: [],
        isUnpushed: false,
    };
}

function createRepo() {
    return reactive({
        committedTree: {
            commitSha: 'tree1234',
            files: [
                { path: 'src/a.ts', sizeBytes: 10 },
                { path: 'README.md', sizeBytes: 5 },
            ],
        } as { commitSha: string | undefined; files: Array<{ path: string; sizeBytes: number }> },
        explorerHistory: {
            commits: [commit('sha1', 'First snapshot'), commit('sha2', 'Second snapshot')],
            hasMore: false,
        },
        explorerCommitSha: 'sha1' as string | undefined,
        currCommittedFilePath: undefined as string | undefined,
        currCommittedFile: undefined as any,
        isLoadingMoreExplorerHistory: false,
        selectExplorerCommit: vi.fn(async () => undefined),
        loadMoreExplorerCommits: vi.fn(async () => undefined),
        selectCommittedFile: vi.fn(async () => undefined),
    });
}

function mountExplorer() {
    return mount(RepExplorerView, {
        global: {
            stubs: {
                EtSplitter: etSplitterStub,
                FileTree: fileTreeStub,
                MonacoEditor: monacoEditorStub,
                MonacoEditorSettingsButton: monacoEditorSettingsButtonStub,
            },
        },
    });
}

beforeEach(() => {
    selectedRepo = createRepo();
});

describe('RepExplorerView', () => {
    it('lists the loaded snapshots and marks the current one as selected', () => {
        const wrapper = mountExplorer();
        const options = wrapper.findAll('[data-testid="explorer-commit-select"] option');

        expect(options).toHaveLength(2);
        expect(options[1]!.text()).toContain('sha2');
        expect(options[1]!.text()).toContain('Second snapshot');
        expect((wrapper.get('[data-testid="explorer-commit-select"]').element as HTMLSelectElement).value).toBe('sha1');
        expect(wrapper.text()).toContain('Showing repository files as of commit sha1');
    });

    it('loads the chosen snapshot and ignores re-selecting the current one', async () => {
        const wrapper = mountExplorer();
        const select = wrapper.get('[data-testid="explorer-commit-select"]');

        await select.setValue('sha2');
        expect(selectedRepo.selectExplorerCommit).toHaveBeenCalledWith('sha2');

        selectedRepo.selectExplorerCommit.mockClear();

        await select.setValue('sha1');
        expect(selectedRepo.selectExplorerCommit).not.toHaveBeenCalled();
    });

    it('pages in older snapshots from the header button', async () => {
        selectedRepo.explorerHistory.hasMore = true;

        const wrapper = mountExplorer();
        const button = wrapper.get('[data-testid="explorer-load-more-snapshots"]');

        expect(button.text()).toBe('Older snapshots');
        expect(button.attributes('disabled')).toBeUndefined();

        await button.trigger('click');

        expect(selectedRepo.loadMoreExplorerCommits).toHaveBeenCalledTimes(1);
    });

    it('disables the paging button while older snapshots load', () => {
        selectedRepo.isLoadingMoreExplorerHistory = true;

        const wrapper = mountExplorer();
        const button = wrapper.get('[data-testid="explorer-load-more-snapshots"]');

        expect(button.text()).toBe('Loading...');
        expect(button.attributes('disabled')).toBeDefined();
    });

    it('nests committed files under directories sorted before files', () => {
        selectedRepo.committedTree.files = [
            { path: 'src/b.ts', sizeBytes: 20 },
            { path: 'README.md', sizeBytes: 5 },
            { path: 'src/a.ts', sizeBytes: 10 },
        ];

        const wrapper = mountExplorer();
        const tree = wrapper.getComponent(fileTreeStub).props('item') as any;

        expect(tree.count).toBe(3);
        expect(tree.children.map((child: any) => child.title)).toEqual(['src', 'README.md']);
        expect(tree.children[0].kind).toBe('directory');
        expect(tree.children[0].children.map((child: any) => child.title)).toEqual(['a.ts', 'b.ts']);
        expect(tree.children[1].path).toBe('README.md');
    });

    it('selects committed files but ignores directory clicks', async () => {
        selectedRepo.committedTree.files = [
            { path: 'src/a.ts', sizeBytes: 10 },
            { path: 'README.md', sizeBytes: 5 },
        ];

        const wrapper = mountExplorer();

        await wrapper.get('[data-testid="explorer-tree"] button[data-path="src"]').trigger('click');
        expect(selectedRepo.selectCommittedFile).not.toHaveBeenCalled();

        await wrapper.get('[data-testid="explorer-tree"] button[data-path="README.md"]').trigger('click');
        expect(selectedRepo.selectCommittedFile).toHaveBeenCalledWith('README.md');
    });

    it('marks the selected committed file and passes the sidebar width key to the splitter', () => {
        selectedRepo.currCommittedFilePath = 'README.md';

        const wrapper = mountExplorer();

        expect(wrapper.get('button[data-path="README.md"]').attributes('data-selected')).toBe('true');
        expect(wrapper.get('[data-testid="explorer-splitter"]').attributes('data-storage-key')).toBe('explorerSidebarWidth');
    });

    it('explains when the snapshot has no commits', () => {
        selectedRepo.explorerHistory = { commits: [], hasMore: false };

        const wrapper = mountExplorer();

        expect(wrapper.text()).toContain('No commits found.');
        expect(wrapper.find('[data-testid="explorer-monaco-file"]').exists()).toBe(false);
    });

    it('explains when the snapshot has no committed files', () => {
        selectedRepo.committedTree.files = [];

        const wrapper = mountExplorer();

        expect(wrapper.text()).toContain('No committed files found in this snapshot.');
        expect(wrapper.get('[data-testid="explorer-tree-empty"]').text()).toBe('No committed files found');
    });

    it('asks for a file selection when none is current', () => {
        const wrapper = mountExplorer();

        expect(wrapper.text()).toContain('Select a file to inspect the committed contents.');
        expect(wrapper.find('[data-testid="explorer-monaco-file"]').exists()).toBe(false);
    });

    it('renders the current committed file with its content and size', () => {
        selectedRepo.currCommittedFilePath = 'README.md';
        selectedRepo.currCommittedFile = {
            commitSha: 'sha1',
            path: 'README.md',
            sizeBytes: 2048,
            content: '# Title\n',
        };

        const wrapper = mountExplorer();
        const editor = wrapper.get('[data-testid="explorer-monaco-file"]');

        expect(wrapper.get('[data-testid="explorer-file-title"]').text()).toBe('README.md');
        expect(wrapper.text()).toContain('2.0 KB');
        expect(editor.element.textContent).toBe('# Title\n');
        expect(editor.attributes('data-path')).toBe('README.md');
        expect(wrapper.find('[data-testid="explorer-editor-settings"]').exists()).toBe(true);
    });

    it('shows a preview message instead of the editor and its settings', () => {
        selectedRepo.currCommittedFile = {
            commitSha: 'sha1',
            path: 'logo.png',
            sizeBytes: 4096,
            content: '',
            previewMessage: 'Binary file preview is not available.',
        };

        const wrapper = mountExplorer();

        expect(wrapper.text()).toContain('Binary file preview is not available.');
        expect(wrapper.find('[data-testid="explorer-monaco-file"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="explorer-editor-settings"]').exists()).toBe(false);
    });

    it('renders an image preview for image files', () => {
        selectedRepo.currCommittedFile = {
            commitSha: 'sha1',
            path: 'assets/logo.png',
            sizeBytes: 4096,
            content: '',
            preview: { kind: 'image', src: 'data:image/png;base64,AAAA' },
        };

        const wrapper = mountExplorer();

        expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,AAAA');
        expect(wrapper.get('img').attributes('alt')).toBe('assets/logo.png');
        expect(wrapper.find('[data-testid="explorer-monaco-file"]').exists()).toBe(false);
    });

    it('falls back to the tree commit sha when the snapshot is not in the loaded page', () => {
        selectedRepo.explorerCommitSha = 'not-loaded';
        selectedRepo.explorerHistory.commits = [commit('sha1', 'First snapshot')];
        selectedRepo.committedTree.commitSha = 'abcdef1234567';

        const wrapper = mountExplorer();

        expect(wrapper.text()).toContain('Showing repository files as of commit abcdef1');
    });
});
