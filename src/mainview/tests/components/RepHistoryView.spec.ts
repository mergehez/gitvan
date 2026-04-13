import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import type { ContextMenuEntry, ContextMenuItem } from '../../components/contextMenuTypes';
import RepHistoryView from '../../components/RepHistoryView.vue';
import type { useContextMenu } from '../../composables/useContextMenu';
import type { useRepos } from '../../composables/useRepos';
import type { tasks as tasksType } from '../../composables/useTasks';

type ReposState = ReturnType<typeof useRepos>;
type ContextMenuState = ReturnType<typeof useContextMenu>;
type TasksState = typeof tasksType;

let selectedRepo: any;
let mockContextMenu: Pick<ContextMenuState, 'openAtEvent'>;
let mockTasks: Pick<TasksState, 'isOperationRunning'>;

vi.mock('../../composables/useRepos', () => ({
    useRepos: () =>
        ({
            getSelectedRepo: () => selectedRepo,
        }) as unknown as ReposState,
}));

vi.mock('../../composables/useContextMenu', () => ({
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
    template: '<div />',
});

const centeredInputModalStub = defineComponent({
    name: 'CenteredInputModal',
    template: '<div />',
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
        onContextMenu: {
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
                :data-testid="'history-item-' + child.id"
                @contextmenu.prevent="onContextMenu?.(child, $event)"
            >
                {{ child.title }}
                <slot name="item-rightIcon" :item="child" />
            </button>
        </section>
    `,
});

function isMenuItem(entry: ContextMenuEntry | undefined): entry is ContextMenuItem {
    return Boolean(entry && 'id' in entry);
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
        selectCommit: vi.fn(),
        beginAmendSelectedCommit: vi.fn(),
        undoSelectedCommit: vi.fn(),
        editableTagsForCommit: (commit: any) => commit?.tags?.filter((tag: any) => tag.isUnpushed) ?? [],
        createTag: vi.fn(),
        renameTag: vi.fn(),
        deleteTag: vi.fn(),
    });
}

describe('RepHistoryView', () => {
    beforeEach(() => {
        selectedRepo = createRepo();
        mockContextMenu = {
            openAtEvent: vi.fn(),
        };
        mockTasks = {
            isOperationRunning: vi.fn(() => false),
        };
    });

    it('renders commit tags on the right side of the commit row', () => {
        const wrapper = mount(RepHistoryView, {
            global: {
                stubs: {
                    EtSplitter: etSplitterStub,
                    FileTree: fileTreeStub,
                    DiffViewer: diffViewerStub,
                    ChangesFileTree: changesFileTreeStub,
                    CenteredInputModal: centeredInputModalStub,
                    IconButton: iconButtonStub,
                },
                directives: {
                    tooltip: {},
                },
            },
        });

        expect(wrapper.text()).toContain('v0.0.3');
        expect(wrapper.text()).toContain('stable');
    });

    it('opens tag actions from a commit row context menu', async () => {
        selectedRepo.currCommitSha = undefined;

        const wrapper = mount(RepHistoryView, {
            global: {
                stubs: {
                    EtSplitter: etSplitterStub,
                    FileTree: fileTreeStub,
                    DiffViewer: diffViewerStub,
                    ChangesFileTree: changesFileTreeStub,
                    CenteredInputModal: centeredInputModalStub,
                    IconButton: iconButtonStub,
                },
                directives: {
                    tooltip: {},
                },
            },
        });

        await wrapper.get('[data-testid="history-item-abc123"]').trigger('contextmenu');

        expect(selectedRepo.selectCommit).toHaveBeenCalledWith('abc123');
        expect(mockContextMenu.openAtEvent).toHaveBeenCalledTimes(1);

        const openAtEventMock = mockContextMenu.openAtEvent as ReturnType<typeof vi.fn>;
        const entries = openAtEventMock.mock.calls[0]?.[1] as ContextMenuEntry[];

        expect(entries.some((entry) => isMenuItem(entry) && entry.label === 'Add Tag...')).toBe(true);
        expect(entries.some((entry) => isMenuItem(entry) && entry.label === 'Rename Tag...')).toBe(true);
        expect(entries.some((entry) => isMenuItem(entry) && entry.label === 'Delete Tag')).toBe(true);
    });
});
