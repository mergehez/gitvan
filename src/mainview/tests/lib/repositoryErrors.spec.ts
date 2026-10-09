import { describe, expect, it } from 'vitest';
import { isRepositoryNotFoundError, ignoreRemovedRepository, repositoryNotFoundMessage } from '../../../shared/repositoryErrors.js';

describe('isRepositoryNotFoundError', () => {
    it('recognises the message the backend raises', () => {
        expect(isRepositoryNotFoundError(new Error(repositoryNotFoundMessage))).toBe(true);
    });

    it('recognises it when it arrives wrapped in the HTTP error the dev server returns', () => {
        expect(isRepositoryNotFoundError(new Error(`Backend error (500): {"error":"${repositoryNotFoundMessage}"}`))).toBe(true);
        expect(isRepositoryNotFoundError(repositoryNotFoundMessage)).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isRepositoryNotFoundError(new Error('Something else went wrong.'))).toBe(false);
        expect(isRepositoryNotFoundError(undefined)).toBe(false);
        expect(isRepositoryNotFoundError({ message: repositoryNotFoundMessage })).toBe(false);
    });
});

describe('ignoreRemovedRepository', () => {
    it('returns the value of a load that succeeds', async () => {
        await expect(ignoreRemovedRepository(async () => 'loaded')).resolves.toBe('loaded');
    });

    it('swallows only the removed-repository outcome', async () => {
        await expect(
            ignoreRemovedRepository(async () => {
                throw new Error(repositoryNotFoundMessage);
            })
        ).resolves.toBeUndefined();

        await expect(
            ignoreRemovedRepository(async () => {
                throw new Error('The remote rejected the push.');
            })
        ).rejects.toThrow('The remote rejected the push.');
    });
});
