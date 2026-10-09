import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive } from 'vue';
import RepHistoryView from '../../components/RepHistoryView.vue';
import type { useRepos } from '../../composables/useRepos';
import type { tasks as tasksType } from '../../composables/useTasks';
import type { ContextMenuEntry, ContextMenuItem, useContextMenu } from '../../directives';
import { useContextMenu as useContextMenuRuntime } from '../../directives/useContextMenu';
import type { CommitSummary } from '../../../shared/types.ts';

type ReposState = ReturnType<typeof useRepos>;
type ContextMenuState = ReturnType<typeof useContextMenu>;
type TasksState = typeof tasksType;

let selectedRepo: any;
let mockContextMenu: Pick<ContextMenuState, 'openAtEvent' | 'open' | 'elementRect'>;
let mockTasks: Pick<TasksState, 'isOperationRunning'>;
let mockOpenFileHistory: ReturnType<typeof vi.fn>;

vi.mock('../../composables/useRepos', () => ({
    useRepos: () =>
        ({
            getSelectedRepo: () => selectedRepo,
        }) as unknown as ReposState,
}));

vi.mock('../../composables/useFileHistory', () => ({
    useFileHistory: () => ({
        openFileHistory: mockOpenFileHistory,
    }),
}));

vi.mock('../../directives/useContextMenu', () => ({
    useContextMenu: () => mockContextMenu as ContextMenuState,
}));

vi.mock('../../composables/useDiffViewer', () => ({
    useDiffViewer: () => ({}) as any,
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: new Proxy(
        {},
        {
            get(_target, propertyKey) {
                return mockTasks[propertyKey as keyof typeof mockTasks];
            },
        }
    ),
}));

const etSplitterStub = defineComponent({
    name: 'EtSplitter',
    template: '<div><slot name="left" /><slot name="right" /></div>',
});

const diffViewerStub = defineComponent({
    name: 'DiffViewer',
    template: '<div />',
});

const changesFileTreeStub = defineComponent({
    name: 'ChangesFileTree',
    props: {
        item: {
            type: Object,
            required: true,
        },
        getContextMenuItems: {
            type: Function,
            default: undefined,
        },
    },
    template: `
        <section>
            <button
                v-for="child in item.children"
                :key="child.id"
                type="button"
                :data-testid="'history-file-' + child.path"
                @contextmenu.prevent="useContextMenuRuntime().openAtEvent($event, getContextMenuItems?.(child) ?? [])"
            >
                {{ child.title }}
            </button>
        </section>
    `,
    setup() {
        return {
            useContextMenuRuntime,
        };
    },
});

const centeredInputModalStub = defineComponent({
    name: 'CenteredInputModal',
    template: '<div />',
});

const createTagModalStub = defineComponent({
    name: 'CreateTagModal',
    props: {
        open: { type: Boolean, default: false },
        targetLabel: { type: String, default: '' },
    },
    template: '<div v-if="open" data-testid="create-tag-modal">{{ targetLabel }}</div>',
});

const iconButtonStub = defineComponent({
    name: 'IconButton',
    props: {
        icon: {
            type: String,
            default: undefined,
        },
    },
    emits: ['click'],
    template: '<button type="button" :data-icon="icon" @click="$emit(\'click\')"><slot /></button>',
});

const fileTreeStub = defineComponent({
    name: 'FileTree',
    props: {
        item: {
            type: Object,
            required: true,
        },
        emptyText: {
            type: String,
            default: undefined,
        },
        getContextMenuItems: {
            type: Function,
            default: undefined,
        },
        onSelect: {
            type: Function,
            default: undefined,
        },
    },
    template: `
        <section>
            <div v-if="!item.children.length" data-testid="history-empty">{{ emptyText }}</div>
            <button
                v-for="child in item.children"
                :key="child.id"
                type="button"
                :data-testid="'history-item-' + child.id"
                @click="onSelect?.(child)"
                @contextmenu.prevent="useContextMenuRuntime().openAtEvent($event, getContextMenuItems?.(child) ?? [])"
            >
                {{ child.title }}
                <slot name="item-rightIcon" :item="child" />
            </button>
            <slot name="footer" />
        </section>
    `,
    setup() {
        return {
            useContextMenuRuntime,
        };
    },
});

function isMenuItem(entry: ContextMenuEntry | undefined): entry is ContextMenuItem {
    return Boolean(entry && 'id' in entry);
}

function lastContextMenuEntries() {
    const openAtEventMock = mockContextMenu.openAtEvent as ReturnType<typeof vi.fn>;

    return (openAtEventMock.mock.calls.at(-1)?.[1] ?? []) as ContextMenuEntry[];
}

function findMenuItem(entries: ContextMenuEntry[], label: string) {
    return entries.find((entry): entry is ContextMenuItem => isMenuItem(entry) && entry.label === label);
}

function createCommitSummary(sha: string, summary: string): CommitSummary {
    return {
        sha,
        shortSha: sha,
        summary,
        authorName: 'Other Dev',
        authorEmail: 'other.dev@example.com',
        authoredAt: '2026-04-09T10:00:00.000Z',
        refs: [],
        tags: [],
        isUnpushed: false,
    };
}

function createCommitDetail(files: Array<{ path: string; previousPath?: string }>) {
    return {
        sha: 'abc123',
        shortSha: 'abc123',
        summary: 'Add release tag',
        authorName: 'Mazlum',
        authorEmail: 'mazlum@example.com',
        authoredAt: '2026-04-10T10:00:00.000Z',
        refs: [],
        tags: [],
        isUnpushed: true,
        body: '',
        files: files.map((file) => ({ path: file.path, previousPath: file.previousPath, status: 'modified' })),
        patch: '',
    };
}

function createRepo() {
    return reactive({
        history: {
            commits: [
                {
                    sha: 'abc123',
                    shortSha: 'abc123',
                    summary: 'Add release tag',
                    authorName: 'Mazlum',
                    authorEmail: 'mazlum@example.com',
                    authoredAt: '2026-04-10T10:00:00.000Z',
                    refs: ['HEAD -> main', 'tag: v0.0.3'],
                    tags: [
                        { name: 'v0.0.3', isUnpushed: true },
                        { name: 'stable', isUnpushed: false },
                    ],
                    isUnpushed: true,
                },
            ],
        },
        currCommitSha: 'abc123',
        currCommitDiff: undefined,
        currCommit: undefined,
        currCommitFilePath: undefined,
        isLoadingMoreHistory: false,
        historySearchQuery: '',
        historySearchResults: undefined,
        isSearchingHistory: false,
        isLoadingMoreHistorySearch: false,
        fileHistoryPath: undefined,
        fileHistoryFollowRenames: false,
        fileHistoryResults: undefined,
        isLoadingFileHistory: false,
        isLoadingMoreFileHistory: false,
        isIncludingFileHistoryRenames: false,
        selectCommit: vi.fn(),
        loadMoreHistory: vi.fn(async () => false),
        searchHistory: vi.fn(async () => undefined),
        refreshHistorySearch: vi.fn(async () => undefined),
        loadMoreHistorySearch: vi.fn(async () => false),
        clearHistorySearch: vi.fn(),
        loadHistory: vi.fn(async () => undefined),
        closeFileHistory: vi.fn(),
        loadMoreFileHistory: vi.fn(async () => false),
        selectFileHistoryCommit: vi.fn(),
        includeFileHistoryRenames: vi.fn(async () => undefined),
        beginAmendSelectedCommit: vi.fn(),
        undoSelectedCommit: vi.fn(),
        getCommitMessage: vi.fn(async () => ({ summary: 'Add release tag', body: 'Explains the tag.' })),
        rewordCommit: vi.fn(),
        editableTagsForCommit: (commit: any) => commit?.tags?.filter((tag: any) => tag.isUnpushed) ?? [],
        createTag: vi.fn(),
        renameTag: vi.fn(),
        deleteTag: vi.fn(),
    });
}

function mountHistoryView() {
    return mount(RepHistoryView, {
        global: {
            stubs: {
                EtSplitter: etSplitterStub,
                FileTree: fileTreeStub,
                DiffViewer: diffViewerStub,
                ChangesFileTree: changesFileTreeStub,
                CenteredInputModal: centeredInputModalStub,
                CreateTagModal: createTagModalStub,
                IconButton: iconButtonStub,
            },
            directives: {
                tooltip: {},
            },
        },
    });
}

describe('RepHistoryView', () => {
    beforeEach(() => {
        selectedRepo = createRepo();
        mockContextMenu = reactive({
            openAtEvent: vi.fn(),
            open: false,
            elementRect: undefined as DOMRect | undefined,
        });
        mockTasks = {
            isOperationRunning: vi.fn(() => false),
        };
        mockOpenFileHistory = vi.fn(async () => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders commit tags on the right side of the commit row', () => {
        const wrapper = mountHistoryView();

        expect(wrapper.text()).toContain('v0.0.3');
        expect(wrapper.text()).toContain('stable');
    });

    it('opens tag actions from a commit row context menu', async () => {
        selectedRepo.currCommitSha = undefined;

        const wrapper = mountHistoryView();

        await wrapper.get('[data-testid="history-item-abc123"]').trigger('contextmenu');

        expect(selectedRepo.selectCommit).not.toHaveBeenCalled();
        expect(mockContextMenu.openAtEvent).toHaveBeenCalledTimes(1);

        const openAtEventMock = mockContextMenu.openAtEvent as ReturnType<typeof vi.fn>;
        const entries = openAtEventMock.mock.calls[0]?.[1] as ContextMenuEntry[];

        expect(entries.some((entry) => isMenuItem(entry) && entry.label === 'Add Tag...')).toBe(true);
        expect(entries.some((entry) => isMenuItem(entry) && entry.label === 'Rename Tag...')).toBe(true);
        expect(entries.some((entry) => isMenuItem(entry) && entry.label === 'Delete Tag')).toBe(true);
    });

    it('offers Add Tag for a commit that has already been pushed', async () => {
        selectedRepo.currCommitSha = undefined;
        selectedRepo.history.commits = [{ ...createCommitSummary('def456', 'Fix login bug'), isUnpushed: false, tags: [] }];

        const wrapper = mountHistoryView();
        await wrapper.get('[data-testid="history-item-def456"]').trigger('contextmenu');

        const openAtEventMock = mockContextMenu.openAtEvent as ReturnType<typeof vi.fn>;
        const entries = openAtEventMock.mock.calls[0]?.[1] as ContextMenuEntry[];
        const addTag = entries.find((entry): entry is ContextMenuItem => isMenuItem(entry) && entry.label === 'Add Tag...');

        expect(addTag).toBeTruthy();

        addTag!.action?.();
        await nextTick();

        expect(wrapper.get('[data-testid="create-tag-modal"]').text()).toContain('def456');
    });

    it('offers message and description editing for an unpushed commit', async () => {
        const wrapper = mountHistoryView();
        await wrapper.get('[data-testid="history-item-abc123"]').trigger('contextmenu');

        const entries = lastContextMenuEntries();

        expect(findMenuItem(entries, 'Edit Commit Message...')).toBeTruthy();
        expect(findMenuItem(entries, 'Edit Commit Description...')).toBeTruthy();

        wrapper.unmount();
    });

    it('hides the reword entries for a commit that has already been pushed', async () => {
        selectedRepo.history.commits = [{ ...createCommitSummary('def456', 'Fix login bug'), isUnpushed: false, tags: [] }];

        const wrapper = mountHistoryView();
        await wrapper.get('[data-testid="history-item-def456"]').trigger('contextmenu');

        const entries = lastContextMenuEntries();

        expect(findMenuItem(entries, 'Edit Commit Message...')).toBeUndefined();
        expect(findMenuItem(entries, 'Edit Commit Description...')).toBeUndefined();
        expect(findMenuItem(entries, 'Add Tag...')).toBeTruthy();

        wrapper.unmount();
    });

    it('edits the commit message in a popover anchored to the row', async () => {
        const wrapper = mountHistoryView();
        // The menu remembers the row it opened on, which is where the popover sits.
        mockContextMenu.open = true;
        mockContextMenu.elementRect = { right: 250, top: 40 } as DOMRect;
        await nextTick();

        await wrapper.get('[data-testid="history-item-abc123"]').trigger('contextmenu');
        await findMenuItem(lastContextMenuEntries(), 'Edit Commit Message...')!.action?.();
        await flushPromises();

        const popover = document.querySelector<HTMLElement>('[data-testid="commit-message-popover"]');
        expect(popover?.style.left).toBe('256px');
        expect(popover?.style.top).toBe('46px');
        expect(document.querySelector<HTMLInputElement>('[data-testid="commit-message-input"]')?.value).toBe('Add release tag');

        const input = document.querySelector<HTMLInputElement>('[data-testid="commit-message-input"]')!;
        input.value = 'Reworded subject';
        input.dispatchEvent(new Event('input'));
        await nextTick();

        document.querySelector<HTMLElement>('[data-testid="commit-message-save"]')!.click();
        await flushPromises();

        expect(selectedRepo.rewordCommit).toHaveBeenCalledWith({
            commitSha: 'abc123',
            summary: 'Reworded subject',
            description: 'Explains the tag.',
        });
        expect(document.querySelector('[data-testid="commit-message-popover"]')).toBeNull();

        wrapper.unmount();
    });

    it('edits the commit description in a popover anchored to the row', async () => {
        const wrapper = mountHistoryView();
        await wrapper.get('[data-testid="history-item-abc123"]').trigger('contextmenu');
        await findMenuItem(lastContextMenuEntries(), 'Edit Commit Description...')!.action?.();
        await flushPromises();

        const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="commit-description-input"]')!;
        expect(textarea.value).toBe('Explains the tag.');

        textarea.value = 'A rewritten body';
        textarea.dispatchEvent(new Event('input'));
        await nextTick();

        document.querySelector<HTMLElement>('[data-testid="commit-message-save"]')!.click();
        await flushPromises();

        expect(selectedRepo.rewordCommit).toHaveBeenCalledWith({
            commitSha: 'abc123',
            summary: 'Add release tag',
            description: 'A rewritten body',
        });

        wrapper.unmount();
    });

    it('loads older commits from the load-more button', async () => {
        selectedRepo.history.hasMore = true;

        const wrapper = mountHistoryView();
        const footer = wrapper.get('[data-testid="history-load-more"]');

        expect(footer.text()).toContain('Load more commits');

        await footer.get('button').trigger('click');

        expect(selectedRepo.loadMoreHistory).toHaveBeenCalledTimes(1);
    });

    it('shows a loading label on the load-more button while a page is being fetched', () => {
        selectedRepo.history.hasMore = true;
        selectedRepo.isLoadingMoreHistory = true;

        const wrapper = mountHistoryView();

        expect(wrapper.get('[data-testid="history-load-more"]').text()).toContain('Loading...');
    });

    it('hides the load-more button once the history is exhausted', () => {
        selectedRepo.history.hasMore = false;

        const wrapper = mountHistoryView();

        expect(wrapper.find('[data-testid="history-load-more"]').exists()).toBe(false);
    });

    it('debounces the search request instead of querying on every keystroke', async () => {
        vi.useFakeTimers();

        const wrapper = mountHistoryView();

        await wrapper.get('[data-testid="history-search"]').setValue('release');
        expect(selectedRepo.searchHistory).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);

        expect(selectedRepo.searchHistory).toHaveBeenCalledTimes(1);
        expect(selectedRepo.searchHistory).toHaveBeenCalledWith('release');
    });

    it('renders the matched commits returned by the history search', () => {
        selectedRepo.historySearchQuery = 'login';
        selectedRepo.historySearchResults = {
            commits: [createCommitSummary('def456', 'Fix login bug')],
            hasMore: false,
        };

        const wrapper = mountHistoryView();

        expect((wrapper.get('[data-testid="history-search"]').element as HTMLInputElement).value).toBe('login');
        expect(wrapper.find('[data-testid="history-item-def456"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="history-item-abc123"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('1 result');
    });

    it('shows a searching state while the query is still running', () => {
        selectedRepo.historySearchQuery = 'login';
        selectedRepo.isSearchingHistory = true;

        const wrapper = mountHistoryView();

        expect(wrapper.get('[data-testid="history-empty"]').text()).toBe('Searching...');
    });

    it('shows an empty state when the search returns no commits', () => {
        selectedRepo.historySearchQuery = 'login';
        selectedRepo.historySearchResults = { commits: [], hasMore: false };

        const wrapper = mountHistoryView();

        expect(wrapper.get('[data-testid="history-empty"]').text()).toBe('No commits match your search');
        expect(wrapper.find('[data-testid="history-load-more"]').exists()).toBe(false);
    });

    it('loads more search results from the load-more button', async () => {
        selectedRepo.historySearchQuery = 'login';
        selectedRepo.historySearchResults = {
            commits: [createCommitSummary('def456', 'Fix login bug')],
            hasMore: true,
        };

        const wrapper = mountHistoryView();
        const footer = wrapper.get('[data-testid="history-load-more"]');

        expect(footer.text()).toContain('Load more results');
        expect(wrapper.text()).toContain('1+ results');

        await footer.get('button').trigger('click');

        expect(selectedRepo.loadMoreHistorySearch).toHaveBeenCalledTimes(1);
    });

    it('clears the search and reloads the recent commits when the query is emptied', async () => {
        selectedRepo.historySearchQuery = 'login';
        selectedRepo.historySearchResults = {
            commits: [createCommitSummary('def456', 'Fix login bug')],
            hasMore: false,
        };

        const wrapper = mountHistoryView();

        await wrapper.get('[data-testid="history-search"]').setValue('');

        expect(selectedRepo.clearHistorySearch).toHaveBeenCalledTimes(1);
        expect(selectedRepo.loadHistory).toHaveBeenCalledTimes(1);
    });

    it('shows the pinned file history instead of the search bar', async () => {
        selectedRepo.fileHistoryPath = 'src/app.ts';
        selectedRepo.fileHistoryResults = { commits: [createCommitSummary('def456', 'Fix login bug')], hasMore: true };

        const wrapper = mountHistoryView();
        const header = wrapper.get('[data-testid="file-history-header"]');

        expect(wrapper.find('[data-testid="history-search"]').exists()).toBe(false);
        expect(header.text()).toContain('src/app.ts');
        expect(wrapper.find('[data-testid="history-item-def456"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="history-item-abc123"]').exists()).toBe(false);

        await wrapper.get('[data-testid="history-item-def456"]').trigger('click');
        expect(selectedRepo.selectFileHistoryCommit).toHaveBeenCalledWith('def456');

        await wrapper.get('[data-testid="history-load-more"] button').trigger('click');
        expect(selectedRepo.loadMoreFileHistory).toHaveBeenCalledTimes(1);
        expect(selectedRepo.loadMoreHistory).not.toHaveBeenCalled();
    });

    it('offers to include renames until they are included', async () => {
        selectedRepo.fileHistoryPath = 'src/app.ts';
        selectedRepo.fileHistoryResults = { commits: [createCommitSummary('def456', 'Fix login bug')], hasMore: false };

        const wrapper = mountHistoryView();

        expect(wrapper.find('[data-testid="file-history-include-renames"]').exists()).toBe(true);

        await wrapper.get('[data-testid="file-history-include-renames"]').trigger('click');

        expect(selectedRepo.includeFileHistoryRenames).toHaveBeenCalledTimes(1);
    });

    it('replaces the include-renames button with a renames badge', () => {
        selectedRepo.fileHistoryPath = 'src/app.ts';
        selectedRepo.fileHistoryFollowRenames = true;
        selectedRepo.fileHistoryResults = { commits: [createCommitSummary('def456', 'Fix login bug')], hasMore: false };

        const wrapper = mountHistoryView();

        expect(wrapper.find('[data-testid="file-history-include-renames"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="file-history-header"]').text()).toContain('renames');
    });

    it('keeps the button busy while renames are being included', () => {
        selectedRepo.fileHistoryPath = 'src/app.ts';
        selectedRepo.fileHistoryFollowRenames = true;
        selectedRepo.isIncludingFileHistoryRenames = true;
        selectedRepo.fileHistoryResults = { commits: [createCommitSummary('def456', 'Fix login bug')], hasMore: false };

        const wrapper = mountHistoryView();
        const button = wrapper.get('[data-testid="file-history-include-renames"]');

        expect(button.text()).toContain('Including renames...');
        expect(button.attributes('disabled')).toBeDefined();
    });

    it('reports an empty file history once loading finishes', () => {
        selectedRepo.fileHistoryPath = 'src/app.ts';
        selectedRepo.fileHistoryResults = { commits: [], hasMore: false };

        const wrapper = mountHistoryView();

        expect(wrapper.get('[data-testid="history-empty"]').text()).toBe('No commits touched this file');
    });

    it('returns to the recent commits from the file history header', async () => {
        selectedRepo.fileHistoryPath = 'src/app.ts';
        selectedRepo.fileHistoryResults = { commits: [createCommitSummary('def456', 'Fix login bug')], hasMore: false };

        const wrapper = mountHistoryView();
        await wrapper.get('[data-testid="file-history-back"]').trigger('click');

        expect(selectedRepo.closeFileHistory).toHaveBeenCalledTimes(1);
        expect(selectedRepo.loadHistory).toHaveBeenCalledTimes(1);
    });

    it('colours commit rows per author', () => {
        selectedRepo.history.commits = [
            { ...createCommitSummary('a1', 'First'), authorName: 'Mazlum', authorEmail: 'mazlum@example.com' },
            { ...createCommitSummary('b2', 'Second'), authorName: 'Other Dev', authorEmail: 'other.dev@example.com' },
            { ...createCommitSummary('c3', 'Third'), authorName: 'Mazlum', authorEmail: 'mazlum@example.com' },
        ];

        const wrapper = mountHistoryView();
        const children = (wrapper.findComponent(fileTreeStub).props('item') as { children: Array<{ id: string; authorColor: string }> }).children;
        const colorsById = Object.fromEntries(children.map((child) => [child.id, child.authorColor]));

        expect(colorsById.a1).toMatch(/^#[0-9a-f]{6}$/);
        expect(colorsById.a1).toBe(colorsById.c3);
        expect(colorsById.a1).not.toBe(colorsById.b2);
    });

    it('offers File History from a committed file row', async () => {
        selectedRepo.currCommit = createCommitDetail([{ path: 'src/app.ts' }]);

        const wrapper = mountHistoryView();
        await wrapper.get('[data-testid="history-file-src/app.ts"]').trigger('contextmenu');

        const openAtEventMock = mockContextMenu.openAtEvent as ReturnType<typeof vi.fn>;
        const entries = openAtEventMock.mock.calls[0]?.[1] as ContextMenuEntry[];
        const entry = entries.find((candidate): candidate is ContextMenuItem => isMenuItem(candidate) && candidate.label === 'File History');

        expect(entry).toBeTruthy();

        await entry!.action?.();

        expect(mockOpenFileHistory).toHaveBeenCalledWith('src/app.ts');
    });
});
