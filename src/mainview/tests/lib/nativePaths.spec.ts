import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinNativePath, writeClipboardText } from '../../lib/nativePaths';

describe('joinNativePath', () => {
    it.each([
        ['/repo', 'src/app.ts', '/repo/src/app.ts'],
        ['/repo/', 'src/app.ts', '/repo/src/app.ts'],
        ['/repo', '/src/app.ts', '/repo/src/app.ts'],
        ['/repo', 'src\\app.ts', '/repo/src/app.ts'],
        ['C:\\repo', 'src/app.ts', 'C:\\repo\\src\\app.ts'],
        ['C:\\repo\\', 'src\\app.ts', 'C:\\repo\\src\\app.ts'],
        ['/repo', '', '/repo'],
    ])('joins %s with %s', (base, relative, expected) => {
        expect(joinNativePath(base, relative)).toBe(expected);
    });
});

describe('writeClipboardText', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });

    it('writes through the clipboard API when it is available', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

        await writeClipboardText('hello');

        expect(writeText).toHaveBeenCalledWith('hello');
    });

    it('falls back to a temporary textarea and removes it again', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        let copied: string | undefined;
        (document as unknown as { execCommand: (command: string) => boolean }).execCommand = vi.fn((command: string) => {
            copied = document.querySelector('textarea')?.value;
            return command === 'copy';
        });

        await writeClipboardText('fallback text');

        expect(copied).toBe('fallback text');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('removes the textarea even when the copy command throws', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        (document as unknown as { execCommand: (command: string) => boolean }).execCommand = vi.fn(() => {
            throw new Error('copy is not supported');
        });

        await expect(writeClipboardText('hello')).rejects.toThrow('copy is not supported');
        expect(document.querySelector('textarea')).toBeNull();
    });
});
