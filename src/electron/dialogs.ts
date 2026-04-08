import { BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron';
import type {
    AccountSummary,
    ChangeFileContextMenuAction,
    ChangeFileContextMenuOptions,
    ChangeFileContextMenuPrimaryAction,
    RepoContextMenuAction,
    RepoContextMenuOptions,
} from '../shared/gitClient.ts';

export async function showConfirmationDialog(
    window: BrowserWindow | undefined,
    params: {
        title: string;
        message: string;
        detail?: string;
        confirmLabel?: string;
        cancelLabel?: string;
    },
) {
    if (!window) {
        return false;
    }

    const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: [params.confirmLabel ?? 'Continue', params.cancelLabel ?? 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: params.title,
        message: params.message,
        detail: params.detail,
    });

    return response === 0;
}

type MenuItem<TData> =
    | 'separator'
    | (Omit<MenuItemConstructorOptions, 'submenu' | 'click'> & {
          data: TData;
          submenu?: MenuItem<TData>[];
      });
function createMenu<TAction>(items: MenuItem<TAction>[], finish: (action: TAction | undefined) => void): Menu {
    const electronMenuItems = items.map((item) => {
        if (item === 'separator') {
            return { type: 'separator' } as const;
        }
        const { data: action, submenu, ...menuItemOptions } = item;
        const electronMenuItem: Electron.MenuItemConstructorOptions = {
            ...menuItemOptions,
        };

        if (item.submenu) {
            electronMenuItem.submenu = createMenu(item.submenu, finish);
        } else {
            electronMenuItem.click = () => {
                finish(action);
            };
        }

        return electronMenuItem;
    });

    return Menu.buildFromTemplate(electronMenuItems);
}

function showMenu<TData>(window: BrowserWindow | undefined, items: MenuItem<TData>[], cancelData: TData | undefined = undefined): Promise<TData | undefined> {
    if (!window) {
        return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
        let settled = false;

        const finish = (action: TData | undefined) => {
            if (settled) {
                return;
            }

            settled = true;
            resolve(action);
        };

        const menu = createMenu(items, finish);

        menu.popup({
            window,
            callback() {
                finish(cancelData);
            },
        });
    });
}

export function showRepoContextMenu(window: BrowserWindow | undefined, ps: RepoContextMenuOptions) {
    const openWithItem: MenuItem<RepoContextMenuAction> =
        ps.openWithEditors.length > 1
            ? {
                  data: 'open-with' as const,
                  label: 'Open with...',
                  submenu: [
                      ...ps.openWithEditors.map((editor) => ({
                          data: {
                              kind: 'open-with-editor' as const,
                              editorPath: editor.path,
                          },
                          label: editor.label,
                      })),
                      'separator',
                      {
                          data: 'open-with' as const,
                          label: 'Pick Program',
                      },
                  ],
              }
            : {
                  data: 'open-with' as const,
                  label: 'Open with...',
              };

    const items: MenuItem<RepoContextMenuAction>[] = [
        { data: 'fetch', label: 'Fetch' },
        { data: 'pull', label: 'Pull', visible: ps.canPull },
        { data: 'push', label: 'Push', visible: ps.canPush },
        {
            data: 'publish',
            label: ps.hasRemote ? 'Publish Branch' : 'Publish Branch (No Remote Configured)',
            enabled: ps.hasRemote,
            visible: ps.canPublish,
        },
        'separator',
        openWithItem,
        'separator',
        {
            data: 'rename',
            label: 'Rename',
        },
        {
            data: 'delete',
            label: 'Delete',
        },
    ];

    return showMenu(window, items);
}

const changeFilePrimaryActionLabels: Record<ChangeFileContextMenuPrimaryAction, { singular: string; plural: string }> = {
    'discard-changes': {
        singular: 'Discard Changes',
        plural: 'Discard Changes',
    },
    'delete-file': {
        singular: 'Delete File',
        plural: 'Delete Files',
    },
    'revert-deletion': {
        singular: 'Revert Deletion',
        plural: 'Revert Deletions',
    },
};

const changeFileStageActionLabels: Record<ChangeFileContextMenuOptions['stageAction'], { singular: string; plural: string }> = {
    'stage-files': {
        singular: 'Stage File',
        plural: 'Stage Files',
    },
    'unstage-files': {
        singular: 'Unstage File',
        plural: 'Unstage Files',
    },
};

export function showChangeFileContextMenu(window: BrowserWindow | undefined, ps: ChangeFileContextMenuOptions) {
    const ignoreItems = ps.ignoreOptions.map((option) => ({
        data: {
            kind: 'ignore-path',
            value: option.value,
            mode: option.mode,
        } satisfies ChangeFileContextMenuAction,
        label: option.value,
    }));

    const countLabel = ps.selectionCount === 1 ? 'singular' : 'plural';
    const stageActionLabel = changeFileStageActionLabels[ps.stageAction][ps.selectionCount === 1 ? 'singular' : 'plural'];
    const items: MenuItem<ChangeFileContextMenuAction>[] = [];

    if (ps.primaryAction) {
        items.push({
            data: { kind: ps.primaryAction },
            label: changeFilePrimaryActionLabels[ps.primaryAction][countLabel],
        });
    }

    items.push({
        data: { kind: ps.stageAction },
        label: stageActionLabel,
    });

    if (ignoreItems.length > 0) {
        items.push('separator');
        items.push({
            data: { kind: 'ignore-path', value: '', mode: 'pattern' },
            label: 'Ignore...',
            submenu: ignoreItems,
        });
    }

    const hasFileUtilities = ps.showCopyPaths || ps.showRevealInFinder || ps.showOpenWithDefaultProgram;

    if (hasFileUtilities) {
        items.push('separator');

        if (ps.showCopyPaths) {
            items.push({
                data: { kind: 'copy-file-path' },
                label: 'Copy File Path',
            });
            items.push({
                data: { kind: 'copy-relative-file-path' },
                label: 'Copy Relative File Path',
            });
        }

        if (ps.showRevealInFinder) {
            items.push({
                data: { kind: 'reveal-in-finder' },
                label: process.platform === 'darwin' ? 'Reveal in Finder' : 'Reveal in File Manager',
            });
        }

        if (ps.showOpenWithDefaultProgram) {
            items.push({
                data: { kind: 'open-with-default-program' },
                label: 'Open with Default Program',
            });
        }
    }

    return showMenu<ChangeFileContextMenuAction>(window, items);
}

export function showAccountAssignmentMenu(window: BrowserWindow | undefined, ps: { accounts: AccountSummary[]; currentAccountId: number | undefined }) {
    return showMenu<number>(window, [
        {
            label: 'Unassigned',
            type: 'checkbox',
            data: 0,
            checked: ps.currentAccountId === undefined,
        },
        'separator',
        ...ps.accounts.map((account) => {
            return {
                label: `${account.label} (${account.provider})`,
                type: 'checkbox',
                checked: ps.currentAccountId === account.id,
                data: account.id,
            } as const;
        }),
    ]);
}
