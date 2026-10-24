import { expect, openSandboxRepo, test } from './support/sandbox';

test('opens the diff in read-only edit mode with selection and search', async ({ page }) => {
    await openSandboxRepo(page, 'partial-changes');

    const changedFileButton = page.locator('[data-testid="file-tree-item-unstaged-second.txt"]').first();
    await expect(changedFileButton).toBeVisible();
    await changedFileButton.click();

    const diffRoot = page.getByTestId('diffs-diff-editor-root');
    await expect(diffRoot).toBeVisible();

    // Edit mode attaches an editor to the additions column; that is what makes the content
    // focusable and selectable, and it is the only column the editor marks editable.
    const content = diffRoot.locator('[data-code]:not([data-deletions]) > [data-content]').first();
    await expect(content).toHaveAttribute('contenteditable', 'true');
    await expect(content).toContainText('line 2 **MODIFIED**');

    // The diff is still read-only: typed input never reaches the rendered document.
    await content.click();
    await page.keyboard.type('not part of the diff');
    await expect(content).not.toContainText('not part of the diff');
    await expect(content).toContainText('line 2 **MODIFIED**');

    // Editing shortcuts (indent, move line, toggle comment) do not mutate it either.
    const textBeforeShortcuts = await content.textContent();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Alt+ArrowUp');
    await page.keyboard.press('ControlOrMeta+/');
    await expect.poll(async () => content.textContent()).toBe(textBeforeShortcuts);

    // ⌘F belongs to the diff while it has focus, so it opens the editor's search panel
    // instead of the changes panel's file filter.
    await page.keyboard.press('ControlOrMeta+f');
    const searchInput = diffRoot.locator('input[data-search]');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
    await expect(page.getByPlaceholder('Search files...')).toBeHidden();

    await searchInput.fill('MODIFIED');
    await expect(diffRoot.locator('[data-matches]')).toContainText('of');

    await searchInput.press('Escape');
    await expect(searchInput).toBeHidden();
});
