/**
 * Author colours for the commit list: distinct enough to tell authors apart at a
 * glance, desaturated enough that a long history does not turn into confetti.
 */
export const AUTHOR_COLORS = ['#8ea8c3', '#9fb59b', '#c2a98b', '#b09cc4', '#86b3b0', '#c39aa6', '#b5b98c', '#9aa7c9'];

/** Drops case and surrounding whitespace so `A@b.com` and `a@b.com` share a colour. */
function normalizeAuthorKey(authorKey: string) {
    return authorKey.trim().toLowerCase();
}

export function authorColorIndex(authorKey: string) {
    const normalized = normalizeAuthorKey(authorKey);
    let hash = 0;

    for (let index = 0; index < normalized.length; index += 1) {
        hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
    }

    return Math.abs(hash) % AUTHOR_COLORS.length;
}

export function authorColor(authorKey: string) {
    return AUTHOR_COLORS[authorColorIndex(authorKey)]!;
}
