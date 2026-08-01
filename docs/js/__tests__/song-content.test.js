// Content on demand: data/songs/{id}.pro fetching, caching, in-flight
// dedupe, and the legacy fat-index fallback (rows that still carry
// `content` inline must never trigger a request).
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    getSongContent, getSongContents, peekSongContent, primeSongContent,
    clearSongContentCache, songHasContent, songHasAbc, songContentUrl,
} from '../song-content.js';

const LEAN = { id: 'blue-moon-of-kentucky', title: 'Blue Moon', has_content: true };
const LEAN_NO_CONTENT = { id: 'tab-only-work', title: 'Tab Only' };
const LEGACY = {
    id: 'your-cheating-heart',
    title: 'Your Cheatin Heart',
    content: '{meta: title Your Cheatin Heart}\n[G]Your cheatin heart\n',
};

function mockFetchOk(body, { delay = 0 } = {}) {
    return vi.fn(() => new Promise(resolve => {
        const respond = () => resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
        delay ? setTimeout(respond, delay) : respond();
    }));
}

beforeEach(() => {
    clearSongContentCache();
    vi.restoreAllMocks();
});

describe('songContentUrl', () => {
    it('points at the per-work .pro file', () => {
        expect(songContentUrl('blue-moon-of-kentucky')).toBe('data/songs/blue-moon-of-kentucky.pro');
    });

    it('escapes ids that need it', () => {
        expect(songContentUrl('a b')).toBe('data/songs/a%20b.pro');
    });
});

describe('getSongContent — lean index', () => {
    it('fetches the .pro file for a row flagged has_content', async () => {
        global.fetch = mockFetchOk('[G]fetched content');
        const text = await getSongContent(LEAN);
        expect(text).toBe('[G]fetched content');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledWith('data/songs/blue-moon-of-kentucky.pro');
    });

    it('caches: a second ask makes no second request', async () => {
        global.fetch = mockFetchOk('[G]once');
        await getSongContent(LEAN);
        const again = await getSongContent(LEAN);
        expect(again).toBe('[G]once');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent asks for the same work', async () => {
        global.fetch = mockFetchOk('[G]shared', { delay: 5 });
        const [a, b, c] = await Promise.all([
            getSongContent(LEAN), getSongContent(LEAN), getSongContent(LEAN),
        ]);
        expect([a, b, c]).toEqual(['[G]shared', '[G]shared', '[G]shared']);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('resolves to empty string without fetching when there is no lead sheet', async () => {
        global.fetch = vi.fn();
        expect(await getSongContent(LEAN_NO_CONTENT)).toBe('');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects on HTTP failure and does not cache it (retry actually retries)', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 404 })
            .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('[G]second try') });

        await expect(getSongContent(LEAN)).rejects.toThrow(/404/);
        expect(await getSongContent(LEAN)).toBe('[G]second try');
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});

describe('getSongContent — legacy fat index', () => {
    it('returns the inline content without any request', async () => {
        global.fetch = vi.fn();
        expect(await getSongContent(LEGACY)).toBe(LEGACY.content);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('treats an empty inline string as "no content", still no request', async () => {
        global.fetch = vi.fn();
        expect(await getSongContent({ id: 'placeholder-work', content: '' })).toBe('');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('handles a null/undefined song', async () => {
        expect(await getSongContent(null)).toBe('');
        expect(await getSongContent(undefined)).toBe('');
    });
});

describe('getSongContents (batch)', () => {
    it('degrades a failed row to empty string instead of failing the batch', async () => {
        global.fetch = vi.fn(url => url.includes('missing')
            ? Promise.resolve({ ok: false, status: 500 })
            : Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('[C]ok') }));

        const out = await getSongContents([
            LEAN,
            { id: 'missing-work', has_content: true },
            LEGACY,
        ]);
        expect(out).toEqual(['[C]ok', '', LEGACY.content]);
    });
});

describe('peekSongContent / primeSongContent', () => {
    it('peek is null until content is in hand, then returns it', async () => {
        global.fetch = mockFetchOk('[D]peeked');
        expect(peekSongContent(LEAN)).toBe(null);
        await getSongContent(LEAN);
        expect(peekSongContent(LEAN)).toBe('[D]peeked');
    });

    it('peek returns legacy inline content immediately', () => {
        expect(peekSongContent(LEGACY)).toBe(LEGACY.content);
    });

    it('primed content is served without a request', async () => {
        global.fetch = vi.fn();
        primeSongContent(LEAN.id, '[A]just edited');
        expect(peekSongContent(LEAN)).toBe('[A]just edited');
        expect(await getSongContent(LEAN)).toBe('[A]just edited');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('clearSongContentCache(id) drops just that entry', async () => {
        primeSongContent('a', 'A');
        primeSongContent('b', 'B');
        clearSongContentCache('a');
        expect(peekSongContent({ id: 'a', has_content: true })).toBe(null);
        expect(peekSongContent({ id: 'b', has_content: true })).toBe('B');
    });
});

describe('songHasContent', () => {
    it('reads the has_content flag on lean rows', () => {
        expect(songHasContent(LEAN)).toBe(true);
        expect(songHasContent(LEAN_NO_CONTENT)).toBe(false);
    });

    it('falls back to the inline string on legacy rows', () => {
        expect(songHasContent(LEGACY)).toBe(true);
        expect(songHasContent({ id: 'x', content: '' })).toBe(false);
    });

    it('is false for null', () => {
        expect(songHasContent(null)).toBe(false);
    });
});

describe('songHasAbc', () => {
    it('reads the has_abc flag', () => {
        expect(songHasAbc({ id: 'x', has_abc: true })).toBe(true);
        expect(songHasAbc({ id: 'x', has_content: true })).toBe(false);
    });

    it('falls back to a legacy abc_content field', () => {
        expect(songHasAbc({ id: 'x', abc_content: 'X:1\nT:Tune\n' })).toBe(true);
        expect(songHasAbc({ id: 'x', abc_content: '' })).toBe(false);
    });

    it('falls back to an inline {start_of_abc} block', () => {
        expect(songHasAbc({ id: 'x', content: '{start_of_abc}\nX:1\n{end_of_abc}' })).toBe(true);
        expect(songHasAbc({ id: 'x', content: '{meta: title T}\n[G]words' })).toBe(false);
    });

    it('sees ABC in content that arrived via a fetch', async () => {
        const song = { id: 'red-haired-boy', has_content: true };
        expect(songHasAbc(song)).toBe(false);
        global.fetch = mockFetchOk('{start_of_abc}\nX:1\n{end_of_abc}');
        await getSongContent(song);
        expect(songHasAbc(song)).toBe(true);
    });
});
