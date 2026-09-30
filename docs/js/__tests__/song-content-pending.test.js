// Pending rows arrive at boot WITHOUT their text; it is read from
// pending_songs when the song (or fork, or tab take) is opened. (B3)
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    getSongContent, peekSongContent, primeSongContent, clearSongContentCache,
    songHasContent, getArrangementContent, peekArrangementContent,
    getPendingContent, setPendingContentFetcher,
} from '../song-content.js';
import { loadPartOtf } from '../work-view.js';

const DEFERRED = { id: 'a-new-song', title: 'A New Song', has_content: true, deferred_content: true, source: 'pending' };

const okFetch = body => vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) }));

beforeEach(() => {
    clearSongContentCache();
    setPendingContentFetcher(null);
    vi.restoreAllMocks();
});

describe('getPendingContent', () => {
    it('reads the row once, then answers from cache', async () => {
        const fetcher = vi.fn(async () => '[G]text');
        setPendingContentFetcher(fetcher);
        expect(await getPendingContent('r1')).toBe('[G]text');
        expect(await getPendingContent('r1')).toBe('[G]text');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent asks', async () => {
        let release;
        const fetcher = vi.fn(() => new Promise(resolve => { release = () => resolve('x'); }));
        setPendingContentFetcher(fetcher);
        const a = getPendingContent('r1');
        const b = getPendingContent('r1');
        release();
        expect(await Promise.all([a, b])).toEqual(['x', 'x']);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('resolves null when the row is gone, and does not cache that', async () => {
        const fetcher = vi.fn(async () => null);
        setPendingContentFetcher(fetcher);
        expect(await getPendingContent('gone')).toBeNull();
        expect(await getPendingContent('gone')).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('a failed read rejects and is retried next time', async () => {
        const fetcher = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce('back');
        setPendingContentFetcher(fetcher);
        await expect(getPendingContent('r1')).rejects.toThrow('offline');
        expect(await getPendingContent('r1')).toBe('back');
    });

    it('rejects cleanly when no fetcher is installed', async () => {
        await expect(getPendingContent('r1')).rejects.toThrow();
    });
});

describe('a deferred pending song', () => {
    it('counts as having a lead sheet before anything is fetched', () => {
        expect(songHasContent(DEFERRED)).toBe(true);
        expect(peekSongContent(DEFERRED)).toBeNull();
    });

    it('fetches its text from pending_songs, not from data/songs', async () => {
        global.fetch = vi.fn();
        setPendingContentFetcher(vi.fn(async () => '[C]pending text'));
        expect(await getSongContent(DEFERRED)).toBe('[C]pending text');
        expect(global.fetch).not.toHaveBeenCalled();
        expect(peekSongContent(DEFERRED)).toBe('[C]pending text');
    });

    it('falls back to the published file once the row is gone (committed and cleaned up)', async () => {
        global.fetch = okFetch('[G]published');
        setPendingContentFetcher(vi.fn(async () => null));
        expect(await getSongContent(DEFERRED)).toBe('[G]published');
        expect(global.fetch).toHaveBeenCalledWith('data/songs/a-new-song.pro');
    });

    it('never answers with a published copy cached under the same id', async () => {
        // The overlay can land AFTER the page fetched the published file.
        global.fetch = okFetch('[G]published');
        await getSongContent({ id: 'a-new-song', has_content: true });
        expect(peekSongContent(DEFERRED)).toBeNull();
        setPendingContentFetcher(vi.fn(async () => '[C]pending'));
        expect(await getSongContent(DEFERRED)).toBe('[C]pending');
    });

    it('an edit saved this session primes it, so no read is needed', async () => {
        const fetcher = vi.fn(async () => 'from db');
        setPendingContentFetcher(fetcher);
        primeSongContent('a-new-song', '[D]just saved');
        expect(peekSongContent(DEFERRED)).toBe('[D]just saved');
        expect(await getSongContent(DEFERRED)).toBe('[D]just saved');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('a failed read rejects so the page can offer Retry', async () => {
        setPendingContentFetcher(vi.fn(async () => { throw new Error('offline'); }));
        await expect(getSongContent(DEFERRED)).rejects.toThrow('offline');
    });
});

describe('a pending fork (arrangement)', () => {
    const song = { id: 'rocky-top', has_content: true, deferred_content: true };
    const published = { slug: 'default', default: true, file: 'data/songs/rocky-top.pro' };
    const pendingTake = { slug: 'pending', pending: true, pending_id: 'rocky-top' };

    it('the pending take reads the row; the published take reads its file', async () => {
        global.fetch = okFetch('[G]published');
        setPendingContentFetcher(vi.fn(async () => '[C]mine'));
        expect(await getArrangementContent(song, pendingTake)).toBe('[C]mine');
        expect(await getArrangementContent(song, published)).toBe('[G]published');
    });

    it('fetching the published take does not seed the id-keyed cache of a pending row', async () => {
        global.fetch = okFetch('[G]published');
        await getArrangementContent(song, published);
        expect(peekSongContent(song)).toBeNull();
    });

    it('peek answers from what has been read, never from the published copy', async () => {
        expect(peekArrangementContent(song, pendingTake)).toBeNull();
        setPendingContentFetcher(vi.fn(async () => '[C]mine'));
        await getArrangementContent(song, pendingTake);
        expect(peekArrangementContent(song, pendingTake)).toBe('[C]mine');
    });

    it('a take that carries its text still wins without any read', async () => {
        const fetcher = vi.fn();
        setPendingContentFetcher(fetcher);
        expect(await getArrangementContent(song, { slug: 'pending', pending: true, content: 'inline' })).toBe('inline');
        expect(fetcher).not.toHaveBeenCalled();
    });
});

describe('loadPartOtf for a lean pending tab', () => {
    const OTF = { otf_version: '1.0', tracks: [{ id: 'banjo' }] };

    it('reads the document from pending_songs when the take is opened', async () => {
        const fetcher = vi.fn(async () => JSON.stringify(OTF));
        setPendingContentFetcher(fetcher);
        const fetchImpl = vi.fn();
        const otf = await loadPartOtf({ pending: true, pending_id: 'tab:rocky-top:abc123', content_deferred: true }, fetchImpl);
        expect(otf).toEqual(OTF);
        expect(fetcher).toHaveBeenCalledWith('tab:rocky-top:abc123');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('a row that has vanished reads as "could not be read back", not a crash', async () => {
        setPendingContentFetcher(vi.fn(async () => null));
        await expect(loadPartOtf({ pending: true, pending_id: 'tab:x:abc123' }, vi.fn()))
            .rejects.toThrow(/could not be read back/);
    });
});
