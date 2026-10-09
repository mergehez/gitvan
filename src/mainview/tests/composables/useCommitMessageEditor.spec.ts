import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCommitMessage, rewordCommit, isOperationRunning, showSuccessToast } = vi.hoisted(() => ({
    getCommitMessage: vi.fn(async () => ({ summary: 'Add release tag', body: 'Explains the tag.' })),
    rewordCommit: vi.fn(async () => undefined),
    isOperationRunning: vi.fn(() => false),
    showSuccessToast: vi.fn(),
}));

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => ({
        getSelectedRepo: () => ({ getCommitMessage, rewordCommit }),
    }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        isOperationRunning,
    },
}));

vi.mock('../../composables/useToast', () => ({
    toast: { showSuccessToast },
}));

import { useCommitMessageEditor } from '../../composables/useCommitMessageEditor';

function openMessageEditor(editor: ReturnType<typeof useCommitMessageEditor>, field: 'message' | 'description' = 'message') {
    return editor.open({
        sha: 'abc1234',
        label: 'abc1234 · Add release tag',
        field,
        anchorPoint: { x: 250, y: 40 },
    });
}

describe('useCommitMessageEditor', () => {
    beforeEach(() => {
        getCommitMessage.mockClear();
        getCommitMessage.mockResolvedValue({ summary: 'Add release tag', body: 'Explains the tag.' });
        rewordCommit.mockClear();
        isOperationRunning.mockReturnValue(false);
        showSuccessToast.mockClear();
    });

    it('opens the summary popover prefilled with the commit subject', async () => {
        const editor = useCommitMessageEditor();

        await editor.open({ sha: 'abc1234', label: 'abc1234 · Add release tag', field: 'message', anchorPoint: { x: 250, y: 40 } });

        expect(getCommitMessage).toHaveBeenCalledWith('abc1234');
        expect(editor.isOpen).toBe(true);
        expect(editor.title).toBe('Edit Commit Message');
        expect(editor.isMultiline).toBe(false);
        expect(editor.value).toBe('Add release tag');
        expect(editor.target?.label).toBe('abc1234 · Add release tag');
        expect(editor.anchorPoint).toEqual({ x: 250, y: 40 });
    });

    it('opens the description popover prefilled with the commit body', async () => {
        const editor = useCommitMessageEditor();

        await editor.open({ sha: 'abc1234', label: 'abc1234 · Add release tag', field: 'description' });

        expect(editor.title).toBe('Edit Commit Description');
        expect(editor.isMultiline).toBe(true);
        expect(editor.value).toBe('Explains the tag.');
    });

    it('keeps saving disabled until the edited half of the message changes', async () => {
        const editor = useCommitMessageEditor();
        await openMessageEditor(editor);

        expect(editor.canSubmit).toBe(false);

        editor.value = 'Reworded subject';

        expect(editor.canSubmit).toBe(true);
    });

    it('keeps saving disabled while the rewrite is running', async () => {
        const editor = useCommitMessageEditor();
        // Set before the first read so the cached computed sees the running operation.
        isOperationRunning.mockReturnValue(true);
        await editor.open({ sha: 'abc1234', label: 'abc1234 · Add release tag', field: 'message' });
        editor.value = 'Reworded subject';

        expect(editor.isSaving).toBe(true);
        expect(editor.canSubmit).toBe(false);
    });

    it('never allows an empty subject', async () => {
        const editor = useCommitMessageEditor();
        await openMessageEditor(editor);

        editor.value = '   ';

        expect(editor.canSubmit).toBe(false);
    });

    it('lets a description be cleared', async () => {
        const editor = useCommitMessageEditor();
        await openMessageEditor(editor, 'description');

        editor.value = '';

        expect(editor.canSubmit).toBe(true);
    });

    it('saves an edited subject without touching the existing description', async () => {
        const editor = useCommitMessageEditor();
        await openMessageEditor(editor);
        editor.value = ' Reworded subject ';

        await editor.submit();

        expect(rewordCommit).toHaveBeenCalledWith({
            commitSha: 'abc1234',
            summary: 'Reworded subject',
            description: 'Explains the tag.',
        });
        expect(showSuccessToast).toHaveBeenCalledWith('Commit message updated.');
        expect(editor.isOpen).toBe(false);
        expect(editor.value).toBe('');
    });

    it('saves an edited description without touching the existing subject', async () => {
        const editor = useCommitMessageEditor();
        await openMessageEditor(editor, 'description');
        editor.value = 'A rewritten body';

        await editor.submit();

        expect(rewordCommit).toHaveBeenCalledWith({
            commitSha: 'abc1234',
            summary: 'Add release tag',
            description: 'A rewritten body',
        });
        expect(showSuccessToast).toHaveBeenCalledWith('Commit description updated.');
    });

    it('does nothing when the value was left untouched', async () => {
        const editor = useCommitMessageEditor();
        await openMessageEditor(editor);

        await editor.submit();

        expect(rewordCommit).not.toHaveBeenCalled();
        expect(editor.isOpen).toBe(true);
    });

    it('closes without rewriting and forgets the target', async () => {
        const editor = useCommitMessageEditor();
        await openMessageEditor(editor);
        editor.value = 'Reworded subject';

        editor.close();

        expect(rewordCommit).not.toHaveBeenCalled();
        expect(editor.isOpen).toBe(false);
        expect(editor.target).toBeUndefined();
        expect(editor.anchorPoint).toBeUndefined();
        expect(editor.value).toBe('');
    });
});
