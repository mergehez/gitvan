import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import RepTagsView from '../../components/RepTagsView.vue';
import type { ContextMenuEntry, ContextMenuItem } from '../../directives';
import { useContextMenu as useContextMenuRuntime } from '../../directives/useContextMenu';

let selectedRepo: any;
let mockContextMenu: { openAtEvent: ReturnType<typeof vi.fn> };
const { mockWriteClipboardText } = vi.hoisted(() => ({ mockWriteClipboardText: vi.fn(async () => undefined) }));

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => ({ getSelectedRepo: () => selectedRepo }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: { isBusy: false, isOperationRunning: vi.fn(() => false) },
}));

vi.mock('../../composables/useToast', () => ({
    toast: { showSuccessToast: vi.fn(), showErrorToast: vi.fn() },
}));

vi.mock('../../lib/nativePaths', () => ({
    writeClipboardText: mockWriteClipboardText,
}));

vi.mock('../../directives/useContextMenu', () => ({
    useContextMenu: () => mockContextMenu,
}));

const etSplitterStub = defineComponent({
    name: 'EtSplitter',
    template: '<div><slot name="left" /><slot name="right" /></div>',
});

const fileTreeStub = defineComponent({
    name: 'FileTree',
    props: {
        item: { type: Object, required: true },
        emptyText: { type: String, default: undefined },
        getContextMenuItems: { type: Function, default: undefined },
        getHeaderContextMenuItems: { type: Function, default: undefined },
        onSelect: { type: Function, default: undefined },
    },
    template: `
        <section>
            <div data-testid="tags-header-actions"><slot name="header-actions" /></div>
            <button data-testid="tags-header-menu" @click="useContextMenuRuntime().openAtEvent($event, getHeaderContextMenuItems?.(item) ?? [])">menu</button>
            <div v-if="!item.children.length" data-testid="tags-empty">{{ emptyText }}</div>
            <button
                v-for="child in item.children"
                :key="child.id"
                type="button"
                :data-testid="'tag-row-' + child.id"
                @click="onSelect?.(child)"
                @contextmenu.prevent="useContextMenuRuntime().openAtEvent($event, getContextMenuItems?.(child) ?? [])"
            >
                <slot name="item-title" :item="child" />
                <slot name="item-rightIcon" :item="child" />
            </button>
        </section>
    `,
    setup() {
        return { useContextMenuRuntime };
    },
});

const commitInspectStub = defineComponent({
    name: 'CommitInspectPane',
    props: { commit: { type: Object, default: undefined } },
    template: '<div data-testid="commit-inspect">{{ commit?.summary ?? "" }}</div>',
});

const createTagModalStub = defineComponent({
    name: 'CreateTagModal',
    props: {
        open: { type: Boolean, default: false },
        targetLabel: { type: String, default: '' },
    },
    template: '<div v-if="open" data-testid="create-tag-modal">{{ targetLabel }}</div>',
});

const centeredInputModalStub = defineComponent({
    name: 'CenteredInputModal',
    props: { open: { type: Boolean, default: false } },
    template: '<div v-if="open" data-testid="rename-tag-modal" />',
});

const iconButtonStub = defineComponent({
    name: 'IconButton',
    props: { icon: { type: String, default: undefined } },
    emits: ['click'],
    template: '<button type="button" :data-icon="icon" @click="$emit(\'click\')"><slot /></button>',
});

function createTag(overrides: Record<string, unknown> & { name: string }) {
    return {
        commitSha: 'a'.repeat(40),
        shortSha: 'aaaaaaa',
        commitSummary: `Commit for ${overrides.name}`,
        createdAt: '2026-02-01T10:00:00.000Z',
        isAnnotated: false,
        isTargetUnpushed: false,
        ...overrides,
    };
}

function createRepo() {
    return reactive({
        status: { branch: 'main', hasRemote: true },
        tags: { tags: [] as ReturnType<typeof createTag>[] },
        selectedTagName: undefined as string | undefined,
        isLoadingTags: false,
        currCommit: undefined,
        currCommitDiff: undefined,
        currCommitFilePath: undefined,
        selectedTag() {
            return this.tags?.tags.find((tag) => tag.name === this.selectedTagName);
        },
        loadTags: vi.fn(),
        selectTag: vi.fn(),
        pushTag: vi.fn(),
        pushAllTags: vi.fn(),
        deleteTag: vi.fn(),
        deleteRemoteTag: vi.fn(),
        renameTag: vi.fn(),
        createTag: vi.fn(),
        selectCommitFile: vi.fn(),
    });
}

function mountView() {
    return mount(RepTagsView, {
        global: {
            stubs: {
                EtSplitter: etSplitterStub,
                FileTree: fileTreeStub,
                CommitInspectPane: commitInspectStub,
                CreateTagModal: createTagModalStub,
                CenteredInputModal: centeredInputModalStub,
                IconButton: iconButtonStub,
            },
            directives: { tooltip: {}, loading: {} },
        },
    });
}

function menuItem(entries: ContextMenuEntry[], pattern: RegExp) {
    return entries.find((entry): entry is ContextMenuItem => 'label' in entry && pattern.test(String((entry as ContextMenuItem).label)));
}

function rowMenuEntries() {
    return (mockContextMenu.openAtEvent.mock.calls[0]?.[1] ?? []) as ContextMenuEntry[];
}

function headerMenuEntries() {
    return (mockContextMenu.openAtEvent.mock.calls[0]?.[1] ?? []) as ContextMenuEntry[];
}

describe('RepTagsView', () => {
    beforeEach(() => {
        selectedRepo = createRepo();
        mockContextMenu = { openAtEvent: vi.fn() };
        mockWriteClipboardText.mockClear();
    });

    it('lists tags with their target commit and badges', () => {
        selectedRepo.tags.tags = [createTag({ name: 'v2.0.0', isAnnotated: true, isTargetUnpushed: true, commitSummary: 'Release the thing' }), createTag({ name: 'v1.0.0' })];

        const wrapper = mountView();
        const row = wrapper.get('[data-testid="tag-row-v2.0.0"]');

        expect(row.text()).toContain('v2.0.0');
        expect(row.text()).toContain('aaaaaaa');
        expect(row.text()).toContain('Release the thing');
        expect(row.text()).toContain('annotated');
        expect(row.text()).toContain('unpushed');
        expect(wrapper.get('[data-testid="tag-row-v1.0.0"]').text()).not.toContain('annotated');
    });

    it('filters tags by name, commit subject and sha', async () => {
        selectedRepo.tags.tags = [createTag({ name: 'v2.0.0', commitSummary: 'Release the thing' }), createTag({ name: 'v1.0.0', shortSha: 'bbb1234' })];

        const wrapper = mountView();
        const search = wrapper.get('[data-testid="tags-search"]');

        await search.setValue('release');
        expect(wrapper.find('[data-testid="tag-row-v2.0.0"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="tag-row-v1.0.0"]').exists()).toBe(false);

        await search.setValue('bbb1234');
        expect(wrapper.find('[data-testid="tag-row-v1.0.0"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="tag-row-v2.0.0"]').exists()).toBe(false);

        await search.setValue('nope');
        expect(wrapper.find('[data-testid="tags-empty"]').text()).toBe('No tags match your search');
    });

    it('sorts tags by name from the header menu', async () => {
        selectedRepo.tags.tags = [createTag({ name: 'v2.0.0' }), createTag({ name: 'v1.0.0' })];

        const wrapper = mountView();

        await wrapper.get('[data-testid="tags-header-menu"]').trigger('click');
        const sortByName = menuItem(headerMenuEntries(), /sort by name/i);

        expect(sortByName).toBeTruthy();
        await sortByName!.action?.();

        expect(wrapper.findAll('[data-testid^="tag-row-"]').map((row) => row.attributes('data-testid'))).toEqual(['tag-row-v1.0.0', 'tag-row-v2.0.0']);
    });

    it('selects a tag when its row is clicked', async () => {
        selectedRepo.tags.tags = [createTag({ name: 'v1.0.0' })];

        const wrapper = mountView();
        await wrapper.get('[data-testid="tag-row-v1.0.0"]').trigger('click');

        expect(selectedRepo.selectTag).toHaveBeenCalledWith('v1.0.0');
    });

    it('offers remote and local tag actions in the row menu', async () => {
        selectedRepo.tags.tags = [createTag({ name: 'v1.0.0' })];

        const wrapper = mountView();
        await wrapper.get('[data-testid="tag-row-v1.0.0"]').trigger('contextmenu');

        const entries = rowMenuEntries();
        expect(menuItem(entries, /^push tag$/i)).toBeTruthy();
        expect(menuItem(entries, /^delete tag on remote$/i)).toBeTruthy();
        expect(menuItem(entries, /^rename tag/i)).toBeTruthy();
        expect(menuItem(entries, /^delete tag$/i)).toBeTruthy();

        await menuItem(entries, /^push tag$/i)!.action?.();
        await menuItem(entries, /^delete tag$/i)!.action?.();
        await menuItem(entries, /^rename tag/i)!.action?.();

        expect(selectedRepo.pushTag).toHaveBeenCalledWith('v1.0.0');
        expect(selectedRepo.deleteTag).toHaveBeenCalledWith('v1.0.0');
        expect(wrapper.find('[data-testid="rename-tag-modal"]').exists()).toBe(true);
    });

    it('disables remote actions when the repository has no remote', async () => {
        selectedRepo.status.hasRemote = false;
        selectedRepo.tags.tags = [createTag({ name: 'v1.0.0' })];

        const wrapper = mountView();
        await wrapper.get('[data-testid="tag-row-v1.0.0"]').trigger('contextmenu');

        expect(menuItem(rowMenuEntries(), /^push tag$/i)?.disabled).toBe(true);
        expect(menuItem(rowMenuEntries(), /^delete tag on remote$/i)?.disabled).toBe(true);
    });

    it('copies the tag name', async () => {
        selectedRepo.tags.tags = [createTag({ name: 'v1.0.0' })];

        const wrapper = mountView();
        await wrapper.get('[data-testid="tag-row-v1.0.0"]').trigger('contextmenu');
        await menuItem(rowMenuEntries(), /^copy tag name$/i)!.action?.();

        expect(mockWriteClipboardText).toHaveBeenCalledWith('v1.0.0');
    });

    it('opens the create-tag modal targeted at HEAD', async () => {
        const wrapper = mountView();

        await wrapper.get('[data-testid="tags-create"]').trigger('click');

        const modal = wrapper.get('[data-testid="create-tag-modal"]');
        expect(modal.text()).toContain('HEAD');
        expect(modal.text()).toContain('main');
    });

    it('shows the selected tag and its commit in the right pane', () => {
        const tag = createTag({ name: 'v1.0.0', isAnnotated: true, message: 'Release notes' });
        selectedRepo.tags.tags = [tag];
        selectedRepo.selectedTagName = 'v1.0.0';
        selectedRepo.currCommit = { summary: 'Tagged commit' };

        const wrapper = mountView();

        expect(wrapper.get('[data-testid="selected-tag-name"]').text()).toBe('v1.0.0');
        expect(wrapper.text()).toContain('Release notes');
        expect(wrapper.get('[data-testid="commit-inspect"]').text()).toContain('Tagged commit');
    });

    it('reports an empty tag list', () => {
        const wrapper = mountView();

        expect(wrapper.get('[data-testid="tags-empty"]').text()).toBe('No tags yet');
    });
});
