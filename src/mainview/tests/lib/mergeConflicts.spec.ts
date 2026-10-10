import { describe, expect, it } from 'vitest';
import { parseMergeConflictBlocks, resolveMergeConflictBlock } from '../../lib/mergeConflicts';

function conflict(mine: string, theirs: string) {
    return `<<<<<<< HEAD\n${mine}=======\n${theirs}>>>>>>> feature\n`;
}

describe('parseMergeConflictBlocks', () => {
    it('returns nothing for content without conflicts', () => {
        expect(parseMergeConflictBlocks('one\ntwo\n')).toEqual([]);
        expect(parseMergeConflictBlocks('')).toEqual([]);
    });

    it('reports the offsets, sides and line numbers of a conflict at the top of the file', () => {
        const content = conflict('mine\n', 'theirs\n');
        const blocks = parseMergeConflictBlocks(content);

        expect(blocks).toHaveLength(1);

        const block = blocks[0]!;
        expect(block).toMatchObject({
            index: 0,
            startOffset: 0,
            endOffset: content.length,
            startLine: 1,
            currentHeader: '<<<<<<< HEAD\n',
            separator: '=======\n',
            incomingHeader: '>>>>>>> feature\n',
            current: 'mine\n',
            incoming: 'theirs\n',
            currentHeaderStartOffset: 0,
            currentStartOffset: '<<<<<<< HEAD\n'.length,
            incomingStartOffset: '<<<<<<< HEAD\nmine\n=======\n'.length,
            incomingHeaderStartOffset: '<<<<<<< HEAD\nmine\n=======\ntheirs\n'.length,
        });
        // The block spans five lines and ends on the line after `>>>>>>> feature`.
        expect(block.endLine).toBe(6);
    });

    it('counts the line number from the top of the file', () => {
        const content = `one\ntwo\n${conflict('mine\n', 'theirs\n')}`;
        const blocks = parseMergeConflictBlocks(content);

        expect(blocks[0]!.startLine).toBe(3);
        expect(blocks[0]!.endLine).toBe(8);
        expect(blocks[0]!.startOffset).toBe('one\ntwo\n'.length);
    });

    it('lists every conflict with its own offsets', () => {
        const content = `${conflict('a\n', 'b\n')}middle\n${conflict('c\n', 'd\n')}`;
        const blocks = parseMergeConflictBlocks(content);

        expect(blocks.map((block) => block.index)).toEqual([0, 1]);
        expect(blocks[0]!.startLine).toBe(1);
        expect(blocks[0]!.endLine).toBe(6);
        expect(blocks[1]!.startLine).toBe(7);
        expect(blocks[1]!.endLine).toBe(12);
        expect(blocks[1]!.startOffset).toBe(content.indexOf('<<<<<<< HEAD', 1));
        expect(blocks[1]!.current).toBe('c\n');
        expect(blocks[1]!.incoming).toBe('d\n');
    });

    it('treats a conflict that reaches the end of the file without a newline', () => {
        const content = `top\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature`;
        const blocks = parseMergeConflictBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]!.startLine).toBe(2);
        expect(blocks[0]!.endOffset).toBe(content.length);
    });
});

describe('resolveMergeConflictBlock', () => {
    it('replaces the block with the chosen side and keeps the rest of the file', () => {
        const content = `before\n${conflict('mine\n', 'theirs\n')}after\n`;
        const block = parseMergeConflictBlocks(content)[0]!;

        expect(resolveMergeConflictBlock(content, block, 'current')).toBe('before\nmine\nafter\n');
        expect(resolveMergeConflictBlock(content, block, 'incoming')).toBe('before\ntheirs\nafter\n');
        expect(resolveMergeConflictBlock(content, block, 'both')).toBe('before\nmine\ntheirs\nafter\n');
    });

    it('leaves the other conflicts alone', () => {
        const content = `${conflict('a\n', 'b\n')}${conflict('c\n', 'd\n')}`;
        const blocks = parseMergeConflictBlocks(content);

        const resolved = resolveMergeConflictBlock(content, blocks[1]!, 'incoming');

        expect(resolved).toBe(`${conflict('a\n', 'b\n')}d\n`);
        expect(parseMergeConflictBlocks(resolved)).toHaveLength(1);
    });
});
