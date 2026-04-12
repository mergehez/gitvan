import { BrowserWindow, dialog } from 'electron';

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
