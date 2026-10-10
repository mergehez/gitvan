import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import MonacoEditorSettingsButton from '../../components/MonacoEditorSettingsButton.vue';

type MockSettings = {
    state: {
        diffFontSize: number;
        diffViewMode: 'changes' | 'full-file';
        diffIgnoredChars: string;
        diffIgnoredCharsEnabled: boolean;
        showWhitespaceChanges: boolean;
        diffViewWrap: boolean;
    };
    setDiffFontSize: ReturnType<typeof vi.fn>;
    setDiffViewMode: ReturnType<typeof vi.fn>;
    setDiffIgnoredChars: ReturnType<typeof vi.fn>;
    setDiffIgnoredCharsEnabled: ReturnType<typeof vi.fn>;
    setShowWhitespaceChanges: ReturnType<typeof vi.fn>;
    setDiffViewWrap: ReturnType<typeof vi.fn>;
};

let mockSettings: MockSettings;

vi.mock('../../composables/useSettings', () => ({
    useSettings: () => mockSettings,
}));

let wrapper: ReturnType<typeof mount> | undefined;

function mountButton(props: Record<string, unknown> = {}) {
    wrapper = mount(MonacoEditorSettingsButton, {
        props,
        global: {
            directives: {
                tooltip: {},
            },
        },
    });

    return wrapper;
}

async function openDialog(button: ReturnType<typeof mount>) {
    await button.get('[data-testid="diff-settings-button"]').trigger('click');
    await nextTick();

    return button.get('[role="dialog"]');
}

function checkboxes(button: ReturnType<typeof mount>) {
    return button.findAll('input[type="checkbox"]');
}

function dispatchOnDocument(type: string, init: Record<string, unknown> = {}) {
    document.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
}

describe('MonacoEditorSettingsButton', () => {
    beforeEach(() => {
        mockSettings = {
            state: reactive({
                diffFontSize: 12,
                diffViewMode: 'full-file',
                diffIgnoredChars: '',
                diffIgnoredCharsEnabled: true,
                showWhitespaceChanges: false,
                diffViewWrap: false,
            }),
            setDiffFontSize: vi.fn(),
            setDiffViewMode: vi.fn(),
            setDiffIgnoredChars: vi.fn(),
            setDiffIgnoredCharsEnabled: vi.fn(),
            setShowWhitespaceChanges: vi.fn(),
            setDiffViewWrap: vi.fn(),
        };
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = undefined;
    });

    it('toggles the diff settings dialog from the toolbar trigger', async () => {
        const button = mountButton();

        expect(button.get('[data-testid="diff-settings-button"]').attributes('aria-haspopup')).toBe('dialog');
        expect(button.find('[role="dialog"]').exists()).toBe(false);

        const dialog = await openDialog(button);
        expect(dialog.attributes('aria-label')).toBe('Diff settings');
        expect(dialog.text()).toContain('Font Size');

        await button.get('[data-testid="diff-settings-button"]').trigger('click');
        expect(button.find('[role="dialog"]').exists()).toBe(false);
    });

    it('reflects the current diff settings when opened', async () => {
        mockSettings.state.diffFontSize = 16;
        mockSettings.state.diffViewMode = 'changes';
        mockSettings.state.showWhitespaceChanges = true;
        mockSettings.state.diffViewWrap = true;
        mockSettings.state.diffIgnoredCharsEnabled = false;
        mockSettings.state.diffIgnoredChars = ',;';

        const button = mountButton();
        await openDialog(button);

        expect((button.get('input[type="range"]').element as HTMLInputElement).value).toBe('16');
        expect((button.get('input[type="number"]').element as HTMLInputElement).value).toBe('16');

        const [changesOnly, hideWhitespace, wrap, ignoredCharsEnabled] = checkboxes(button);
        expect((changesOnly!.element as HTMLInputElement).checked).toBe(true);
        expect((hideWhitespace!.element as HTMLInputElement).checked).toBe(false);
        expect((wrap!.element as HTMLInputElement).checked).toBe(true);
        expect((ignoredCharsEnabled!.element as HTMLInputElement).checked).toBe(false);
        expect((button.get('input[type="text"]').element as HTMLInputElement).value).toBe(',;');
    });

    it('updates the font size from the slider and the number field', async () => {
        const button = mountButton();
        await openDialog(button);

        await button.get('input[type="range"]').setValue('18');
        expect(mockSettings.setDiffFontSize).toHaveBeenCalledWith(18);

        const number = button.get('input[type="number"]');
        (number.element as HTMLInputElement).value = '20';
        await number.trigger('change');

        expect(mockSettings.setDiffFontSize).toHaveBeenLastCalledWith(20);
    });

    it('updates the diff view options from the checkboxes', async () => {
        const button = mountButton();
        await openDialog(button);

        const [changesOnly, hideWhitespace, wrap, ignoredCharsEnabled] = checkboxes(button);

        await changesOnly!.setValue(true);
        expect(mockSettings.setDiffViewMode).toHaveBeenLastCalledWith('changes');

        await changesOnly!.setValue(false);
        expect(mockSettings.setDiffViewMode).toHaveBeenLastCalledWith('full-file');

        // The box starts checked (whitespace changes are shown), so unchecking asks for the filter.
        await hideWhitespace!.setValue(false);
        expect(mockSettings.setShowWhitespaceChanges).toHaveBeenLastCalledWith(true);

        await wrap!.setValue(true);
        expect(mockSettings.setDiffViewWrap).toHaveBeenLastCalledWith(true);

        await ignoredCharsEnabled!.setValue(false);
        expect(mockSettings.setDiffIgnoredCharsEnabled).toHaveBeenLastCalledWith(false);

        await button.get('input[type="text"]').setValue(',;');
        expect(mockSettings.setDiffIgnoredChars).toHaveBeenLastCalledWith(',;');
    });

    it('checks the whitespace filter box when whitespace changes are already ignored', async () => {
        mockSettings.state.showWhitespaceChanges = true;
        const button = mountButton();
        await openDialog(button);

        const [, hideWhitespace] = checkboxes(button);
        expect((hideWhitespace!.element as HTMLInputElement).checked).toBe(false);

        await hideWhitespace!.setValue(true);
        expect(mockSettings.setShowWhitespaceChanges).toHaveBeenLastCalledWith(false);
    });

    it('keeps only the font size controls when diff options are hidden', async () => {
        const button = mountButton({ hideDiffOptions: true });
        const dialog = await openDialog(button);

        expect(dialog.text()).toContain('Font Size');
        expect(dialog.text()).not.toContain('Show changes only');
        expect(dialog.text()).not.toContain('Hide whitespace changes');
        expect(dialog.text()).not.toContain('Wrap diff view');
        expect(dialog.text()).not.toContain('Chars To Ignore');
        expect(checkboxes(button)).toHaveLength(0);
    });

    it('closes on escape and on an outside click but not on a click inside', async () => {
        const button = mountButton();
        const dialog = await openDialog(button);

        dialog.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await nextTick();
        expect(button.find('[role="dialog"]').exists()).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        await nextTick();
        expect(button.find('[role="dialog"]').exists()).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await nextTick();
        expect(button.find('[role="dialog"]').exists()).toBe(false);

        await openDialog(button);
        dispatchOnDocument('mousedown');
        await nextTick();
        expect(button.find('[role="dialog"]').exists()).toBe(false);
    });
});
