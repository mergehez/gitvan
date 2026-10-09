import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import RepChangesView from '../../components/RepChangesView.vue';
import { confirmDiscards } from '../../composables/useUiPreferences';
import type { ContextMenuEntry, ContextMenuItem } from '../../directives';

let selectedRepo: Record<string, unknown>;
let mockOpenFileHistory: ReturnType<typeof vi.fn>;

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => ({ getSelectedRepo: () => selectedRepo }),
}));

vi.mock('../../composables/useFileHistory', () => ({
    useFileHistory: () => ({ openFileHistory: mockOpenFileHistory }),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({
        state: { diffIgnoredChars: '', diffIgnoredCharsEnabled: false, showWhitespaceChanges: false },
        getOpenWithEditors: () => [],
        openRepoPathInEditor: vi.fn(),
    }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: { isOperationRunning: () => false },
}));

vi.mock('../../composables/useMerge', () => ({
    useMergeHelper: () => ({ openInlineMergeEditor: vi.fn() }),
}));

vi.mock('../../composables/useDiffViewer', () => ({
    useDiffViewer: () => ({}),
}));

vi.mock('../../lib/buildOpenWithEntries', () => ({
    buildOpenWithEntries: () => [],
}));

const etSplitterStub = defineComponent({
    name: 'EtSplitter',
    template: '<div><slot name="left" /><slot name="right" /></div>',
});

const diffViewerStub = defineComponent({ name: 'DiffViewer', template: '<div />' });

/** Stands in for the file trees and hands back the header menu entries the real one renders. */
const changesFileTreeStub = defineComponent({
    name: 'ChangesFileTree',
    props: {
        item: { type: Object, required: true },
        emptyText: { type: String, required: false },
        selection: { required: false },
        getContextMenuItems: { type: Function, required: false },
        getHeaderContextMenuItems: { type: Function, required: false },
        onSelect: { type: Function, required: false },
    },
    emits: ['header-menu'],
    template: `
        <section>
            <button class="header-menu" @click="$emit('header-menu', getHeaderContextMenuItems ? getHeaderContextMenuItems(item) : [])">menu</button>
            <p class="section">{{ item.title }}: {{ item.count ?? item.children.length }}</p>
            <button v-for="child in item.children" :key="child.id" class="row" :data-path="child.path">{{ child.title }}</button>
            <p v-if="!item.children.length" class="empty">{{ emptyText }}</p>
        </section>
    `,
});

function changeEntry(path: string, kind: 'staged' | 'unstaged') {
    return {
        path,
        previousPath: undefined,
        stagedStatus: kind === 'staged' ? 'modified' : 'clean',
        unstagedStatus: kind === 'unstaged' ? 'modified' : 'clean',
        displayStatus: 'Modified',
    };
}

function createRepo() {
    return {
        id: 7,
        canFetch: () => true,
        canPull: () => false,
        canPush: () => false,
        canCommit: () => false,
        isFileLocked: () => false,
        suggestedCommitSummary: () => '',
        clearSelectedRepositoryStash: vi.fn(),
        selectChange: vi.fn(async () => undefined),
        commitForm: { summary: '', description: '', amend: false },
        changes: {
            staged: [changeEntry('Data/Core/ProductAccount.cs', 'staged'), changeEntry('Portal/Services/DmsService.cs', 'staged')],
            unstaged: [changeEntry('Data/Core/ProductAccountDtos.cs', 'unstaged'), changeEntry('Portal/Utils/PortalBridge.cs', 'unstaged')],
            stagedStats: { addedLines: 3, removedLines: 1 },
            unstagedStats: { addedLines: 4, removedLines: 2 },
        },
        stashes: [],
        currStash: undefined,
        currStashRef: undefined,
        currStashDiff: undefined,
        currDiff: undefined,
        currChangeKind: undefined,
        currChangePath: undefined,
    };
}

/** Records the entry builders the real v-menu directive reads, so tests can open the toolbar menu. */
const viewMenuBindings = new WeakMap<Element, () => ContextMenuEntry[]>();

function menuDirectiveStub(el: Element, binding: { value?: unknown }) {
    if (typeof binding.value === 'function') {
        viewMenuBindings.set(el, binding.value as () => ContextMenuEntry[]);
    }
}

function mountView() {
    return mount(RepChangesView, {
        global: {
            directives: { tooltip: {}, loading: {}, menu: menuDirectiveStub },
            stubs: {
                ChangesFileTree: changesFileTreeStub,
                DiffViewer: diffViewerStub,
                EtSplitter: etSplitterStub,
            },
        },
    });
}

function changeRows(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('[data-path]').map((row) => row.attributes('data-path'));
}

function menuEntries(wrapper: ReturnType<typeof mount>, sectionIndex: number) {
    const section = wrapper.findAllComponents(changesFileTreeStub)[sectionIndex]!;
    const getEntries = section.props('getHeaderContextMenuItems') as ((item: unknown) => ContextMenuEntry[]) | undefined;

    return getEntries ? getEntries(section.props('item')) : [];
}

function menuItem(entries: ContextMenuEntry[], pattern: RegExp) {
    return entries.find((entry): entry is ContextMenuItem => 'label' in entry && pattern.test(String((entry as ContextMenuItem).label)));
}

/** Per-file menu entries for a row, straight from the section that renders it. */
function itemMenuEntries(wrapper: ReturnType<typeof mount>, path: string) {
    const section = wrapper
        .findAllComponents(changesFileTreeStub)
        .find((candidate) => ((candidate.props('item') as { children: Array<{ path: string }> }).children ?? []).some((child) => child.path === path));

    if (!section) {
        throw new Error(`Expected a file tree section containing ${path}.`);
    }

    const getEntries = section.props('getContextMenuItems') as ((item: unknown) => ContextMenuEntry[]) | undefined;
    const item = ((section.props('item') as { children: Array<{ path: string }> }).children ?? []).find((child) => child.path === path);

    return getEntries ? getEntries(item) : [];
}

async function toggleSearchBar(wrapper: ReturnType<typeof mount>) {
    const entry = menuItem(viewMenuEntries(wrapper), /(show|hide) search bar/i);

    if (!entry?.action) {
        throw new Error('Expected a Show/Hide Search Bar entry in the changes view menu.');
    }

    await entry.action();
    await wrapper.vm.$nextTick();
}

function viewMenuButton(wrapper: ReturnType<typeof mount>) {
    return wrapper.get('[data-testid="changes-view-menu"]');
}

function viewMenuEntries(wrapper: ReturnType<typeof mount>) {
    const build = viewMenuBindings.get(viewMenuButton(wrapper).element);

    if (!build) {
        throw new Error('Expected the view menu to be bound to the toolbar menu button.');
    }

    return build();
}

function sortByOption(wrapper: ReturnType<typeof mount>, label: string) {
    const sortBy = menuItem(viewMenuEntries(wrapper), /^sort by$/i);
    const option = sortBy?.children?.find((child): child is ContextMenuItem => 'label' in child && child.label === label);

    if (!option) {
        throw new Error(`Expected a ${label} option in the changes view Sort by submenu.`);
    }

    return option;
}

function fetchButton(wrapper: ReturnType<typeof mount>) {
    const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === 'Fetch');

    if (!button) {
        throw new Error('Expected a Fetch button in the changes toolbar.');
    }

    return button;
}

describe('RepChangesView file filter', () => {
    beforeEach(() => {
        selectedRepo = createRepo();
        mockOpenFileHistory = vi.fn(async () => undefined);
        localStorage.clear();
        confirmDiscards.value = true;
    });

    it('shows no search bar until the view menu asks for one', () => {
        const wrapper = mountView();

        expect(wrapper.find('input[type="search"]').exists()).toBe(false);
        expect(changeRows(wrapper)).toEqual(['Data/Core/ProductAccount.cs', 'Portal/Services/DmsService.cs', 'Data/Core/ProductAccountDtos.cs', 'Portal/Utils/PortalBridge.cs']);
    });

    it('offers Show Search Bar and Hide Search Bar in the toolbar view menu', async () => {
        const wrapper = mountView();

        expect(menuItem(viewMenuEntries(wrapper), /show search bar/i)?.action).toBeTruthy();

        await toggleSearchBar(wrapper);
        expect(wrapper.find('input[type="search"]').exists()).toBe(true);
        expect(menuItem(viewMenuEntries(wrapper), /hide search bar/i)?.action).toBeTruthy();
    });

    it('narrows both sections to the query and reports matches per section', async () => {
        const wrapper = mountView();
        await toggleSearchBar(wrapper);

        await wrapper.get('input[type="search"]').setValue('product');

        expect(changeRows(wrapper)).toEqual(['Data/Core/ProductAccount.cs', 'Data/Core/ProductAccountDtos.cs']);
        expect(wrapper.text()).toContain('Staged Changes: 1/2');
        expect(wrapper.text()).toContain('Changes: 1/2');
    });

    it('reports an empty section when nothing matches', async () => {
        const wrapper = mountView();
        await toggleSearchBar(wrapper);

        await wrapper.get('input[type="search"]').setValue('nothing-matches');

        expect(changeRows(wrapper)).toEqual([]);
        expect(wrapper.text()).toContain('No files match the search');
    });

    it('hides the search bar and resets the query from the view menu', async () => {
        const wrapper = mountView();
        await toggleSearchBar(wrapper);
        await wrapper.get('input[type="search"]').setValue('product');

        expect(changeRows(wrapper)).toHaveLength(2);

        await toggleSearchBar(wrapper);

        expect(wrapper.find('input[type="search"]').exists()).toBe(false);
        expect(changeRows(wrapper)).toHaveLength(4);

        await toggleSearchBar(wrapper);

        expect((wrapper.get('input[type="search"]').element as HTMLInputElement).value).toBe('');
    });

    it('clears the query on the first escape and hides the bar on the second', async () => {
        const wrapper = mountView();
        await toggleSearchBar(wrapper);
        await wrapper.get('input[type="search"]').setValue('product');

        await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Escape' });

        expect(changeRows(wrapper)).toHaveLength(4);
        expect(wrapper.find('input[type="search"]').exists()).toBe(true);

        await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Escape' });

        expect(wrapper.find('input[type="search"]').exists()).toBe(false);
        expect(changeRows(wrapper)).toHaveLength(4);
    });

    it('opens the bar with the keyboard shortcut', async () => {
        const wrapper = mountView();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
        await wrapper.vm.$nextTick();

        expect(wrapper.find('input[type="search"]').exists()).toBe(true);
    });

    it('sits next to the remote action buttons without a direct search toggle', () => {
        const wrapper = mountView();
        const row = fetchButton(wrapper).element.parentElement;

        expect(row?.contains(viewMenuButton(wrapper).element)).toBe(true);
        expect(row?.textContent).toContain('Pull');
        expect(row?.textContent).toContain('Push');
        expect(row?.querySelectorAll('button')).toHaveLength(4);
    });

    it('toggles and resets the query from the view menu', async () => {
        const wrapper = mountView();

        await toggleSearchBar(wrapper);
        await wrapper.get('input[type="search"]').setValue('product');
        expect(changeRows(wrapper)).toHaveLength(2);

        await toggleSearchBar(wrapper);

        expect(wrapper.find('input[type="search"]').exists()).toBe(false);
        expect(changeRows(wrapper)).toHaveLength(4);

        await toggleSearchBar(wrapper);

        expect((wrapper.get('input[type="search"]').element as HTMLInputElement).value).toBe('');
    });

    it('applies Sort by from the view menu to every section', async () => {
        const wrapper = mountView();
        const ascending = sortByOption(wrapper, 'A-Z');

        await ascending.action?.();
        await wrapper.vm.$nextTick();

        expect(changeRows(wrapper)).toEqual(['Portal/Services/DmsService.cs', 'Data/Core/ProductAccount.cs', 'Portal/Utils/PortalBridge.cs', 'Data/Core/ProductAccountDtos.cs']);
        expect(sortByOption(wrapper, 'A-Z').checked).toBe(true);
    });

    it('no longer offers sort or search in the section header menus', () => {
        const wrapper = mountView();

        expect(menuEntries(wrapper, 0)).toHaveLength(0);
        expect(menuEntries(wrapper, 1).map((entry) => ('label' in entry ? String(entry.label) : ''))).toEqual([
            'Discard All Cosmetic Changes',
            'Stage All Cosmetic Changes',
            'Stage All Real Changes',
        ]);
    });

    it('disables the search entry when there is nothing to search', () => {
        selectedRepo = { ...createRepo(), changes: { staged: [], unstaged: [] } };
        const wrapper = mountView();

        expect(menuItem(viewMenuEntries(wrapper), /show search bar/i)?.disabled).toBe(true);
    });

    it('toggles the discard confirmation from the view menu and persists it', async () => {
        const wrapper = mountView();

        expect(menuItem(viewMenuEntries(wrapper), /confirm discards/i)?.checked).toBe(true);

        await menuItem(viewMenuEntries(wrapper), /confirm discards/i)?.action?.();
        await wrapper.vm.$nextTick();

        expect(menuItem(viewMenuEntries(wrapper), /confirm discards/i)?.checked).toBe(false);
        expect(confirmDiscards.value).toBe(false);
        expect(localStorage.getItem('gitvan-ui-confirm-discards')).toBe('false');
    });

    it('restores the persisted search bar state', () => {
        localStorage.setItem('gitvan-ui-search-bar-open', 'true');
        const wrapper = mountView();

        expect(wrapper.find('input[type="search"]').exists()).toBe(true);
    });

    it('persists the search bar state', async () => {
        const wrapper = mountView();

        await toggleSearchBar(wrapper);

        expect(localStorage.getItem('gitvan-ui-search-bar-open')).toBe('true');
    });

    it('offers File History for a tracked file', async () => {
        const wrapper = mountView();

        const entry = menuItem(itemMenuEntries(wrapper, 'Data/Core/ProductAccount.cs'), /^file history$/i);

        expect(entry).toBeTruthy();

        await entry!.action?.();

        expect(mockOpenFileHistory).toHaveBeenCalledWith('Data/Core/ProductAccount.cs');
    });

    it('does not offer File History for a file that was never committed', () => {
        (selectedRepo.changes as { unstaged: unknown[] }).unstaged = [
            { path: 'brand-new.txt', previousPath: undefined, stagedStatus: 'clean', unstagedStatus: 'untracked', displayStatus: 'Untracked' },
        ];

        const wrapper = mountView();

        expect(menuItem(itemMenuEntries(wrapper, 'brand-new.txt'), /^file history$/i)).toBeFalsy();
    });
});

describe('RepChangesView multi-selection', () => {
    beforeEach(() => {
        selectedRepo = createRepo();
        localStorage.clear();
        confirmDiscards.value = true;
    });

    /** The unstaged section is the second tree; its stub exposes the parent's select handler. */
    function unstagedSection(wrapper: ReturnType<typeof mount>) {
        const section = wrapper.findAllComponents(changesFileTreeStub)[1]!;

        return {
            children: (section.props('item') as { children: Array<{ id: string }> }).children,
            onSelect: section.props('onSelect') as (child: unknown, event?: unknown) => Promise<void>,
            selection: () => section.props('selection') as string[] | undefined,
        };
    }

    it('selects a clicked file on its own', async () => {
        const wrapper = mountView();
        const section = unstagedSection(wrapper);

        await section.onSelect(section.children[1]);
        await wrapper.vm.$nextTick();

        expect(section.selection()).toEqual([section.children[1]!.id]);
    });

    it('extends the selection to a contiguous range on shift-click', async () => {
        const wrapper = mountView();
        const section = unstagedSection(wrapper);

        await section.onSelect(section.children[0]);
        await section.onSelect(section.children[1], { shiftKey: true });
        await wrapper.vm.$nextTick();

        expect(section.selection()).toEqual([section.children[0]!.id, section.children[1]!.id]);
    });

    it('orders a toggled selection by the tree order', async () => {
        const wrapper = mountView();
        const section = unstagedSection(wrapper);

        await section.onSelect(section.children[1]);
        await section.onSelect(section.children[0], { metaKey: true });
        await wrapper.vm.$nextTick();

        expect(section.selection()).toEqual([section.children[0]!.id, section.children[1]!.id]);

        await section.onSelect(section.children[1], { metaKey: true });
        await wrapper.vm.$nextTick();

        expect(section.selection()).toEqual([section.children[0]!.id]);
    });
});
