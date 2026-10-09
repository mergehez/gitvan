import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTagRun, renameTagRun, settingsState } = vi.hoisted(() => ({
    createTagRun: vi.fn(async () => undefined),
    renameTagRun: vi.fn(async () => undefined),
    settingsState: {} as Record<string, unknown>,
}));

vi.mock('../../composables/useRepos', () => ({
    useRepos: () => ({
        getSelectedRepo: () => ({
            createTag: createTagRun,
            renameTag: renameTagRun,
        }),
    }),
}));

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => ({ state: settingsState }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        isOperationRunning: vi.fn(() => false),
    },
}));

import { useCreateTag, useRenameTag } from '../../composables/useTagEditor';

describe('useCreateTag', () => {
    beforeEach(() => {
        createTagRun.mockClear();
    });

    it('opens with a cleared name and message for the requested target', () => {
        const editor = useCreateTag();

        editor.open({ sha: 'abc1234', label: 'abc1234 · Fix bug' });

        expect(editor.isOpen).toBe(true);
        expect(editor.target?.sha).toBe('abc1234');
        expect(editor.name).toBe('');
        expect(editor.message).toBe('');
    });

    it('requires a tag name before submitting', () => {
        const editor = useCreateTag();
        editor.open({ sha: 'abc1234', label: 'abc1234 · Fix bug' });

        expect(editor.canSubmit).toBe(false);

        editor.name = '  v1.0.0  ';

        expect(editor.canSubmit).toBe(true);
    });

    it('creates the tag with trimmed values and closes', async () => {
        const editor = useCreateTag();
        editor.open({ sha: 'abc1234', label: 'abc1234 · Fix bug' });
        editor.name = ' v1.0.0 ';
        editor.message = ' Release notes ';

        await editor.submit();

        expect(createTagRun).toHaveBeenCalledWith('abc1234', 'v1.0.0', 'Release notes');
        expect(editor.isOpen).toBe(false);
        expect(editor.name).toBe('');
    });

    it('omits a blank message so the tag stays lightweight', async () => {
        const editor = useCreateTag();
        editor.open({ sha: 'abc1234', label: 'abc1234 · Fix bug' });
        editor.name = 'v1.0.0';
        editor.message = '   ';

        await editor.submit();

        expect(createTagRun).toHaveBeenCalledWith('abc1234', 'v1.0.0', undefined);
    });
});

describe('useRenameTag', () => {
    beforeEach(() => {
        renameTagRun.mockClear();
    });

    it('opens with the current name pre-filled', () => {
        const editor = useRenameTag();

        editor.open('v1.0.0');

        expect(editor.isOpen).toBe(true);
        expect(editor.tagName).toBe('v1.0.0');
        expect(editor.nextTagName).toBe('v1.0.0');
    });

    it('rejects an unchanged or blank name', () => {
        const editor = useRenameTag();
        editor.open('v1.0.0');

        expect(editor.canSubmit).toBe(false);

        editor.nextTagName = '   ';

        expect(editor.canSubmit).toBe(false);

        editor.nextTagName = 'v1.0.1';

        expect(editor.canSubmit).toBe(true);
    });

    it('renames with a trimmed name and closes', async () => {
        const editor = useRenameTag();
        editor.open('v1.0.0');
        editor.nextTagName = ' v1.0.1 ';

        await editor.submit();

        expect(renameTagRun).toHaveBeenCalledWith('v1.0.0', 'v1.0.1');
        expect(editor.isOpen).toBe(false);
    });
});
