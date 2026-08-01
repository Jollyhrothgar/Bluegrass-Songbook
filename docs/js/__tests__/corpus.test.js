// Corpus assembly: canon + background archive + pending overlay.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    parseJsonl, fetchJsonl, markArchived, mergeCorpus, countDistinctTitles,
    ensureStems, whenIdle,
} from '../corpus.js';

const CANON = [
    { id: 'blue-moon-of-kentucky', title: 'Blue Moon of Kentucky', artist: 'Bill Monroe', group_id: 'g1', has_content: true },
    { id: 'blue-moon-of-kentucky-elvis', title: 'Blue Moon of Kentucky', artist: 'Elvis', group_id: 'g1', has_content: true },
];

const ARCHIVE = [
    { id: 'obscure-b-side', title: 'Obscure B Side', artist: 'Nobody', indexed: false },
    { id: 'another-pruned-one', title: 'Another Pruned One', group_id: 'g1' },
];

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('parseJsonl', () => {
    it('parses one row per line and tolerates blank lines', () => {
        const rows = parseJsonl('{"id":"a"}\n\n{"id":"b"}\n');
        expect(rows.map(r => r.id)).toEqual(['a', 'b']);
    });

    it('returns [] for empty input', () => {
        expect(parseJsonl('')).toEqual([]);
        expect(parseJsonl(null)).toEqual([]);
    });
});

describe('fetchJsonl', () => {
    it('fetches without a cache override (HTTP caching / ETags do the work)', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve('{"id":"a"}\n{"id":"b"}'),
        }));
        const rows = await fetchJsonl('data/index.jsonl');
        expect(rows).toHaveLength(2);
        expect(global.fetch).toHaveBeenCalledWith('data/index.jsonl');
        expect(global.fetch.mock.calls[0]).toHaveLength(1);   // no options object
    });

    it('throws on a non-ok response', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
        await expect(fetchJsonl('data/archive.jsonl')).rejects.toThrow(/404/);
    });
});

describe('markArchived', () => {
    it('forces indexed:false so archive rows can never enter search', () => {
        const rows = markArchived([{ id: 'a' }, { id: 'b', indexed: false }]);
        expect(rows.every(r => r.indexed === false)).toBe(true);
    });

    it('tolerates null', () => {
        expect(markArchived(null)).toEqual([]);
    });
});

describe('mergeCorpus', () => {
    it('canon only: songs and groups built', () => {
        const { songs, groups } = mergeCorpus({ canon: CANON });
        expect(songs).toHaveLength(2);
        expect(groups.g1).toHaveLength(2);
    });

    it('appends archive rows after canon and keeps them out of the count', () => {
        const { songs } = mergeCorpus({ canon: CANON, archive: markArchived(ARCHIVE) });
        expect(songs).toHaveLength(4);
        expect(songs.slice(0, 2).map(s => s.id)).toEqual(CANON.map(s => s.id));
        expect(songs.find(s => s.id === 'obscure-b-side')).toBeTruthy();
        expect(countDistinctTitles(songs)).toBe(1);   // one distinct canon title
    });

    it('archive rows join the groups they belong to (arrangement pill sees them)', () => {
        const { groups } = mergeCorpus({ canon: CANON, archive: markArchived(ARCHIVE) });
        expect(groups.g1.map(s => s.id)).toContain('another-pruned-one');
        expect(groups.g1).toHaveLength(3);
    });

    it('re-merging with the archive is stable (no duplicate rows)', () => {
        const first = mergeCorpus({ canon: CANON });
        const second = mergeCorpus({ canon: CANON, archive: markArchived(ARCHIVE) });
        expect(first.songs).toHaveLength(2);
        expect(new Set(second.songs.map(s => s.id)).size).toBe(second.songs.length);
    });

    it('pending rows overlay the row they replace, inheriting its fields', () => {
        const pending = [{
            id: 'blue-moon-of-kentucky',
            replaces_id: 'blue-moon-of-kentucky',
            title: 'Blue Moon of Kentucky',
            content: '[G]edited',
            source: 'pending',
        }];
        const { songs } = mergeCorpus({ canon: CANON, pending });
        const row = songs.find(s => s.id === 'blue-moon-of-kentucky');
        expect(row.source).toBe('pending');
        expect(row.content).toBe('[G]edited');
        expect(row.group_id).toBe('g1');            // inherited from the static row
        expect(songs.filter(s => s.id === 'blue-moon-of-kentucky')).toHaveLength(1);
    });

    it('a pending row can replace an ARCHIVED row once the archive is in', () => {
        const pending = [{
            id: 'obscure-b-side', replaces_id: 'obscure-b-side',
            title: 'Obscure B Side', content: '[C]rescued', source: 'pending',
        }];
        const { songs } = mergeCorpus({
            canon: CANON, archive: markArchived(ARCHIVE), pending,
        });
        const row = songs.find(s => s.id === 'obscure-b-side');
        expect(row.content).toBe('[C]rescued');
        expect(row.indexed).toBe(false);            // still off the shelf
    });

    it('a brand-new pending song with no replaces_id is simply appended', () => {
        const pending = [{ id: 'brand-new', title: 'Brand New', content: '[D]new' }];
        const { songs } = mergeCorpus({ canon: CANON, pending });
        expect(songs).toHaveLength(3);
        expect(songs.at(-1).id).toBe('brand-new');
    });

    it('handles being called with nothing', () => {
        expect(mergeCorpus()).toEqual({ songs: [], groups: {} });
    });
});

describe('ensureStems', () => {
    it('builds a stem set once per song', () => {
        const songs = [{ id: 'a', title: 'Blue Moon', artist: 'Bill Monroe' }];
        ensureStems(songs);
        expect(songs[0]._stems instanceof Set).toBe(true);
        const first = songs[0]._stems;
        ensureStems(songs);
        expect(songs[0]._stems).toBe(first);   // not rebuilt
    });
});

describe('countDistinctTitles', () => {
    it('counts searchable titles case-insensitively, archive excluded', () => {
        expect(countDistinctTitles([
            { title: 'Salt Creek' },
            { title: 'salt creek' },
            { title: 'Whiskey Before Breakfast' },
            { title: 'Pruned Tune', indexed: false },
        ])).toBe(2);
    });
});

describe('whenIdle', () => {
    it('uses requestIdleCallback when available', () => {
        const ric = vi.fn(cb => { cb(); return 7; });
        vi.stubGlobal('requestIdleCallback', ric);
        const fn = vi.fn();
        whenIdle(fn);
        expect(ric).toHaveBeenCalled();
        expect(fn).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('falls back to a timeout, and the canceller stops it', () => {
        vi.stubGlobal('requestIdleCallback', undefined);
        vi.useFakeTimers();
        const fn = vi.fn();
        const cancel = whenIdle(fn, 2000);
        cancel();
        vi.advanceTimersByTime(5000);
        expect(fn).not.toHaveBeenCalled();

        const fn2 = vi.fn();
        whenIdle(fn2, 2000);
        vi.advanceTimersByTime(2000);
        expect(fn2).toHaveBeenCalled();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
});
