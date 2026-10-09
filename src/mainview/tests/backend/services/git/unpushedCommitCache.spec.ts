import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    invalidateAllUnpushedCommitSets,
    invalidateUnpushedCommitSet,
    readCachedUnpushedCommitSet,
    readUnpushedCommitSet,
} from '../../../../../backend/services/git/unpushedCommitCache.js';

beforeEach(() => {
    invalidateAllUnpushedCommitSets();
});

describe('unpushedCommitCache', () => {
    it('computes once and serves the same set afterwards', async () => {
        const compute = vi.fn(async () => new Set(['a']));

        const first = await readUnpushedCommitSet('/repo', compute);
        const second = await readUnpushedCommitSet('/repo', compute);

        expect(compute).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
    });

    it('shares one in-flight computation between concurrent callers', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const compute = vi.fn(async () => {
            await gate;
            return new Set(['a']);
        });

        const first = readUnpushedCommitSet('/repo', compute);
        const second = readUnpushedCommitSet('/repo', compute);
        release();

        const [setA, setB] = await Promise.all([first, second]);

        expect(compute).toHaveBeenCalledTimes(1);
        expect(setA).toBe(setB);
    });

    it('keys the cache by repository path', async () => {
        const compute = vi.fn(async () => new Set<string>());

        await readUnpushedCommitSet('/one', compute);
        await readUnpushedCommitSet('/two', compute);

        expect(compute).toHaveBeenCalledTimes(2);
    });

    it('recomputes only the invalidated repository', async () => {
        const compute = vi.fn(async () => new Set(['a']));

        await readUnpushedCommitSet('/one', compute);
        await readUnpushedCommitSet('/two', compute);

        invalidateUnpushedCommitSet('/one');

        await readUnpushedCommitSet('/one', compute);
        await readUnpushedCommitSet('/two', compute);

        expect(compute).toHaveBeenCalledTimes(3);
    });

    it('recomputes after everything is invalidated', async () => {
        const compute = vi.fn(async () => new Set(['a']));

        await readUnpushedCommitSet('/one', compute);
        invalidateAllUnpushedCommitSets();
        await readUnpushedCommitSet('/one', compute);

        expect(compute).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failed computation', async () => {
        const failing = vi.fn(async () => {
            throw new Error('boom');
        });

        await expect(readUnpushedCommitSet('/repo', failing)).rejects.toThrow('boom');
        expect(readCachedUnpushedCommitSet('/repo')).toBeUndefined();

        const working = vi.fn(async () => new Set(['a']));
        await expect(readUnpushedCommitSet('/repo', working)).resolves.toEqual(new Set(['a']));
    });

    it('exposes the cached set without computing it', async () => {
        const compute = vi.fn(async () => new Set(['a']));

        expect(readCachedUnpushedCommitSet('/repo')).toBeUndefined();

        await readUnpushedCommitSet('/repo', compute);

        await expect(readCachedUnpushedCommitSet('/repo')).resolves.toEqual(new Set(['a']));
        expect(compute).toHaveBeenCalledTimes(1);
    });
});
