// Corpus assembly: canon + background archive + pending overlay.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    parseJsonl, fetchJsonl, markArchived, mergeCorpus, countDistinctTitles,
    ensureStems, whenIdle, transformPendingRow, isPendingTablature,
    isPendingMetadata, overlayPendingTabParts, applyPendingTabs,
    applyPendingMetadata,
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

// ---------------------------------------------------------------------
// Tabs on the instant pipeline: a pending row can be a PART, not a song.
// ---------------------------------------------------------------------

const OTF = '{"otf_version":"1.0","tracks":[{"id":"banjo"}]}';

/** A raw pending_songs row for a submitted tab. */
const tabRow = (over = {}) => transformPendingRow({
    id: 'gold-rush',
    replaces_id: 'gold-rush',
    title: 'Gold Rush',
    part_type: 'tablature',
    instrument: 'banjo',
    part_file: null,
    content: OTF,
    created_by: 'u1',
    ...over,
});

const TABBED_CANON = [{
    id: 'gold-rush', title: 'Gold Rush', artist: 'Bill Monroe', has_content: true,
    tablature_parts: [
        { instrument: 'banjo', label: 'Banjo', src_file: 'banjo.otf.json',
          file: 'data/tabs/gold-rush-banjo-1.otf.json', author: 'schlange', default: true },
    ],
}];

describe('transformPendingRow', () => {
    it('a lead-sheet row still becomes an index row with lyrics for search', () => {
        const row = transformPendingRow({
            id: 'brand-new', title: 'Brand New',
            content: '{title: Brand New}\n[G]Well I [C]wandered',
        });
        expect(isPendingTablature(row)).toBe(false);
        expect(row.source).toBe('pending');
        expect(row.first_line).toBe('Well I wandered');
        expect(row.lyrics).toContain('wandered');
    });

    it('a tablature row becomes a PART, never a song row', () => {
        const row = tabRow();
        expect(isPendingTablature(row)).toBe(true);
        // The OTF must never end up where a chart's text would be read.
        expect(row.content).toBeUndefined();
        expect(row.lyrics).toBeUndefined();
        expect(row.pending_part).toMatchObject({
            instrument: 'banjo', content: OTF, pending: true, pending_id: 'gold-rush',
        });
        expect(row.pending_part.src_file).toBeUndefined();  // a new take
    });

    it('carries part_file through as the take a correction targets', () => {
        expect(tabRow({ part_file: 'banjo.otf.json' }).pending_part.src_file)
            .toBe('banjo.otf.json');
    });
});

describe('overlayPendingTabParts', () => {
    it('appends a new take alongside the published ones', () => {
        const parts = overlayPendingTabParts(TABBED_CANON[0].tablature_parts, [tabRow()]);
        expect(parts).toHaveLength(2);
        expect(parts[0].author).toBe('schlange');           // untouched
        expect(parts[1]).toMatchObject({ file: null, pending: true, content: OTF });
    });

    it('a correction replaces the take it names, keeping that take\'s identity', () => {
        const parts = overlayPendingTabParts(
            TABBED_CANON[0].tablature_parts,
            [tabRow({ part_file: 'banjo.otf.json' })]);
        expect(parts).toHaveLength(1);                       // not a second take
        expect(parts[0].content).toBe(OTF);
        expect(parts[0].pending).toBe(true);
        expect(parts[0].author).toBe('schlange');            // identity survives
        expect(parts[0].file).toBe('data/tabs/gold-rush-banjo-1.otf.json');
    });

    it('ignores a row with no document', () => {
        expect(overlayPendingTabParts([], [tabRow({ content: '' })])).toEqual([]);
    });
});

describe('applyPendingTabs / mergeCorpus with tablature rows', () => {
    it('attaches to the work it targets instead of becoming a row of its own', () => {
        const { songs } = mergeCorpus({ canon: TABBED_CANON, pending: [tabRow()] });
        expect(songs).toHaveLength(1);
        expect(songs[0].tablature_parts).toHaveLength(2);
        expect(songs[0].has_content).toBe(true);             // the chart is intact
        expect(songs[0].content).toBeUndefined();            // no OTF in the lyrics slot
    });

    it('does NOT flag the work itself as pending (My Submissions reads that flag)', () => {
        const { songs } = mergeCorpus({ canon: TABBED_CANON, pending: [tabRow()] });
        expect(songs[0].source).toBeUndefined();
    });

    it('never mutates the canon row it overlays (rebuilds must not accumulate)', () => {
        const canon = JSON.parse(JSON.stringify(TABBED_CANON));
        mergeCorpus({ canon, pending: [tabRow()] });
        mergeCorpus({ canon, pending: [tabRow()] });
        expect(canon[0].tablature_parts).toHaveLength(1);
    });

    it('a tab for an unpublished work becomes a tab-only row, not a fake song', () => {
        const { songs } = mergeCorpus({
            canon: TABBED_CANON,
            pending: [tabRow({ id: 'brand-new-reel', replaces_id: null, title: 'Brand New Reel' })],
        });
        const row = songs.find(s => s.id === 'brand-new-reel');
        expect(row.has_content).toBeUndefined();             // nothing to fetch
        expect(row.source).toBe('pending');
        expect(row.tablature_parts[0].content).toBe(OTF);
        expect(row.lyrics).toBe('');
    });

    it('lands on the pending SONG row when a work has an edit and a tab at once', () => {
        const { songs } = mergeCorpus({
            canon: TABBED_CANON,
            pending: [
                transformPendingRow({
                    id: 'gold-rush', replaces_id: 'gold-rush',
                    title: 'Gold Rush', content: '[G]edited chart',
                }),
                tabRow(),
            ],
        });
        expect(songs).toHaveLength(1);
        expect(songs[0].content).toBe('[G]edited chart');
        expect(songs[0].tablature_parts).toHaveLength(2);
    });

    it('a deleted work takes its pending tab with it', () => {
        const { songs } = mergeCorpus({
            canon: TABBED_CANON, pending: [tabRow()], deleted: ['gold-rush'],
        });
        expect(songs).toHaveLength(0);
    });

    it('applyPendingTabs is a no-op without tab rows', () => {
        const songs = [{ id: 'a' }];
        expect(applyPendingTabs(songs, [])).toBe(songs);
    });
});

describe('mergeCorpus curation overlays (deleted_songs / promoted_songs)', () => {
    it('deleted ids drop out of the corpus entirely (mirrors filter_suppressed)', () => {
        const { songs, groups } = mergeCorpus({
            canon: CANON,
            deleted: new Set(['blue-moon-of-kentucky-elvis']),
        });
        expect(songs.map(s => s.id)).toEqual(['blue-moon-of-kentucky']);
        expect(groups.g1).toHaveLength(1);
    });

    it('deleted ids drop archived rows too, so deep links stop resolving', () => {
        const { songs } = mergeCorpus({
            canon: CANON,
            archive: markArchived([...ARCHIVE.map(r => ({ ...r }))]),
            deleted: ['obscure-b-side'],
        });
        expect(songs.find(s => s.id === 'obscure-b-side')).toBeUndefined();
    });

    it('a deleted id also drops its pending overlay row', () => {
        const pending = [{ id: 'brand-new', title: 'Brand New', content: '[D]new' }];
        const { songs } = mergeCorpus({
            canon: CANON, pending, deleted: ['brand-new'],
        });
        expect(songs.find(s => s.id === 'brand-new')).toBeUndefined();
    });

    it('accepts raw Supabase rows ({song_id}) as well as ids', () => {
        const { songs } = mergeCorpus({
            canon: CANON, deleted: [{ song_id: 'blue-moon-of-kentucky' }],
        });
        expect(songs.map(s => s.id)).toEqual(['blue-moon-of-kentucky-elvis']);
    });

    it('promoted archive rows become searchable (mirrors apply_index_prune)', () => {
        const archive = markArchived(ARCHIVE.map(r => ({ ...r })));
        const { songs } = mergeCorpus({
            canon: CANON, archive, promoted: ['obscure-b-side'],
        });
        const row = songs.find(s => s.id === 'obscure-b-side');
        expect(row.indexed).toBe(true);
        expect(countDistinctTitles(songs)).toBe(2);   // canon title + promoted
    });

    it('promotion copies the row, so un-promoting restores indexed:false', () => {
        const archive = markArchived(ARCHIVE.map(r => ({ ...r })));
        mergeCorpus({ canon: CANON, archive, promoted: ['obscure-b-side'] });
        const { songs } = mergeCorpus({ canon: CANON, archive });
        expect(songs.find(s => s.id === 'obscure-b-side').indexed).toBe(false);
    });

    it('promoting an id that is only in the archive does nothing until it loads', () => {
        const { songs } = mergeCorpus({ canon: CANON, promoted: ['obscure-b-side'] });
        expect(songs.find(s => s.id === 'obscure-b-side')).toBeUndefined();
        expect(songs).toHaveLength(2);
    });

    it('deletion beats promotion for the same id (build order)', () => {
        const archive = markArchived(ARCHIVE.map(r => ({ ...r })));
        const { songs } = mergeCorpus({
            canon: CANON, archive,
            promoted: ['obscure-b-side'], deleted: ['obscure-b-side'],
        });
        expect(songs.find(s => s.id === 'obscure-b-side')).toBeUndefined();
    });

    it('empty overlays leave the corpus untouched', () => {
        const plain = mergeCorpus({ canon: CANON });
        const overlaid = mergeCorpus({
            canon: CANON, deleted: new Set(), promoted: [],
        });
        expect(overlaid.songs.map(s => s.id)).toEqual(plain.songs.map(s => s.id));
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

describe('applyPendingTabs — a tab that mints a new work', () => {
    // REGRESSION. The row id used to BE the work slug, so filing the overlay
    // row under row.id worked. Once tab rows moved into their own
    // `tab:<slug>:<rand>` namespace (to stop two submitters colliding on the
    // primary key), that fallback filed the new work under an id nothing links
    // to — the submit page's "View it" link, search and any shared URL all use
    // the real slug — so a freshly submitted tab 404'd at its own address.
    // Built through transformPendingRow so the test exercises the real chain
    // a raw pending_songs row takes on its way into the corpus.
    const tabRow = (over = {}) => transformPendingRow({
        id: 'tab:welcome-to-new-york:bciu053d',
        replaces_id: null,
        title: 'Welcome to New York',
        part_type: 'tablature',
        instrument: 'banjo',
        content: '{"tracks":[{"id":"banjo"}]}',
        ...over,
    });

    it('files the work under the slug derived from its title', () => {
        const out = applyPendingTabs([], [tabRow()]);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('welcome-to-new-york');
        expect(out[0].id).not.toContain('tab:');
        expect(out[0].tablature_parts).toHaveLength(1);
    });

    it('merges onto the published row once the work exists, not beside it', () => {
        // The window this closes: after the durable commit deploys, the real
        // row and the pending row would otherwise both be in the corpus and
        // the song would appear twice in search until cleanup-pending reaped
        // the row.
        const published = { id: 'welcome-to-new-york', title: 'Welcome to New York', tablature_parts: [] };
        const out = applyPendingTabs([published], [tabRow()]);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('welcome-to-new-york');
        expect(out[0].tablature_parts).toHaveLength(1);
    });

    it('still honours replaces_id when the tab names an existing work', () => {
        const published = { id: 'salt-creek', title: 'Salt Creek', tablature_parts: [] };
        const out = applyPendingTabs(
            [published],
            [tabRow({ id: 'tab:salt-creek:zz9911', replaces_id: 'salt-creek', title: 'Salt Creek' })]);
        expect(out).toHaveLength(1);
        expect(out[0].tablature_parts).toHaveLength(1);
    });

    it('drops a titleless row rather than minting an empty slug', () => {
        expect(applyPendingTabs([], [tabRow({ title: '' })])).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------
// The third kind of pending row: a METADATA edit
// ---------------------------------------------------------------------
//
// It owns no bytes at all — `content` is null and `replaces_id` names the work
// whose title / artist / key / notes are being changed. Two things it must
// never do: become a row of its own (there is no song behind it), or cost the
// work its parts (renaming a work must not lose its tabs).

/** A raw pending_songs row for a metadata edit, run through the transform. */
const metaRow = (over = {}) => transformPendingRow({
    id: 'meta:welcome-to-new-york:bciu053d',
    replaces_id: 'welcome-to-new-york',
    title: 'Welcome to New York',
    artist: 'Bill Emerson',
    key: 'G',
    notes: null,
    content: null,
    part_type: 'metadata',
    created_by: 'u1',
    ...over,
});

const TAB_ONLY_CANON = [{
    id: 'welcome-to-new-york',
    title: 'Welcome to New York',
    artist: '',
    tablature_parts: [
        { instrument: 'banjo', src_file: 'banjo.otf.json',
          file: 'data/tabs/welcome-to-new-york-banjo-1.otf.json' },
    ],
}];

describe('transformPendingRow — metadata rows', () => {
    it('becomes a metadata edit, never a song row', () => {
        const row = metaRow();
        expect(isPendingMetadata(row)).toBe(true);
        expect(isPendingTablature(row)).toBe(false);
        // None of the song-row machinery may attach to it: no source flag, no
        // lyrics, no content — the merge must not read it as a work.
        expect(row.source).toBeUndefined();
        expect(row.lyrics).toBeUndefined();
        expect(row.content).toBeUndefined();
        expect(row.pending_metadata).toEqual({
            title: 'Welcome to New York', artist: 'Bill Emerson', key: 'G',
        });
    });

    it('carries only the fields the edit actually set', () => {
        // An absent field means "unchanged", which is what lets an edit leave
        // the key alone instead of blanking it.
        const row = metaRow({ key: null, artist: undefined });
        expect(row.pending_metadata).toEqual({ title: 'Welcome to New York' });
    });
});

describe('applyPendingMetadata', () => {
    it('is a no-op — same array — when there are no metadata rows', () => {
        const songs = TAB_ONLY_CANON;
        expect(applyPendingMetadata(songs, [])).toBe(songs);
        expect(applyPendingMetadata(songs, null)).toBe(songs);
        // …and when every row is unaddressed, so the zero-cost path holds for
        // a corpus rebuild that has nothing to apply.
        expect(applyPendingMetadata(songs, [metaRow({ replaces_id: null })])).toBe(songs);
    });

    it('overlays the edited fields onto the work it names', () => {
        const [song] = applyPendingMetadata(TAB_ONLY_CANON, [metaRow()]);
        expect(song.artist).toBe('Bill Emerson');
        expect(song.key).toBe('G');
        expect(song.pending_metadata).toEqual({
            id: 'meta:welcome-to-new-york:bciu053d', created_by: 'u1',
        });
    });

    it('keeps the work\'s parts — a rename must not cost it its tabs', () => {
        const [song] = applyPendingMetadata(
            TAB_ONLY_CANON, [metaRow({ title: 'Welcome To New York City' })]);
        expect(song.title).toBe('Welcome To New York City');
        expect(song.tablature_parts).toHaveLength(1);
        expect(song.tablature_parts[0].file)
            .toBe('data/tabs/welcome-to-new-york-banjo-1.otf.json');
        expect(song.id).toBe('welcome-to-new-york');   // the URL is permanent
    });

    it('drops an edit whose target is not in the corpus — it mints nothing', () => {
        // Unlike a tab, which legitimately mints the work it is the first part
        // of. A synthesized row here would be a title with nothing behind it,
        // competing in search with the real work the moment the archive loads.
        const out = applyPendingMetadata(TAB_ONLY_CANON, [
            metaRow({ replaces_id: 'a-work-nobody-loaded' }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('welcome-to-new-york');
        expect(out[0].artist).toBe('');
    });

    it('lets the newest edit of one work win, whatever order the rows arrive', () => {
        // `select('*')` promises no order, and two people may hold an unlanded
        // edit of the same work at once — that is why the ids are namespaced.
        const older = metaRow({
            id: 'meta:welcome-to-new-york:aaaaaa', artist: 'Somebody Else',
            created_at: '2026-08-18T10:00:00Z',
        });
        const newer = metaRow({
            id: 'meta:welcome-to-new-york:bbbbbb', artist: 'Bill Emerson',
            created_at: '2026-08-18T11:00:00Z',
        });
        for (const rows of [[older, newer], [newer, older]]) {
            expect(applyPendingMetadata(TAB_ONLY_CANON, rows)[0].artist)
                .toBe('Bill Emerson');
        }
    });

    it('drops the stale stem set so search follows the new title', () => {
        const stemmed = ensureStems([{ ...TAB_ONLY_CANON[0] }]);
        expect(stemmed[0]._stems).toBeDefined();
        const [song] = applyPendingMetadata(stemmed, [metaRow({ title: 'Gold Rush' })]);
        expect(song._stems).toBeUndefined();
    });
});

describe('mergeCorpus with metadata rows', () => {
    it('applies the edit without adding a row or flagging the work pending', () => {
        const { songs } = mergeCorpus({ canon: TAB_ONLY_CANON, pending: [metaRow()] });
        expect(songs).toHaveLength(1);
        expect(songs[0].artist).toBe('Bill Emerson');
        // Same rule a pending tab part follows: the WORK is as durable as it
        // was a second ago, so flagging it `source: 'pending'` would report
        // every other contribution to it as gone from the songbook.
        expect(songs[0].source).toBeUndefined();
        expect(songs[0].tablature_parts).toHaveLength(1);
    });

    it('re-stems the merged row, so the new artist is searchable', () => {
        const { songs } = mergeCorpus({ canon: TAB_ONLY_CANON, pending: [metaRow()] });
        expect(songs[0]._stems).toBeDefined();
        expect([...songs[0]._stems].some(s => s.startsWith('emerson'))).toBe(true);
    });

    it('does not let a metadata row hide the work the way a song row would', () => {
        // Both kinds name a work in `replaces_id`, and for a SONG row that
        // means "hide that row, show this one". Read that way, a metadata row
        // would delete the work and leave a contentless stub in its place.
        const { songs } = mergeCorpus({ canon: TAB_ONLY_CANON, pending: [metaRow()] });
        expect(songs.map(s => s.id)).toEqual(['welcome-to-new-york']);
        expect(songs[0].id).not.toContain('meta:');
    });

    it('lands on top of a pending tab for the same work', () => {
        // Submitting a tab and then naming its artist is the whole motivating
        // case, and both rows are in flight at once.
        const tab = transformPendingRow({
            id: 'tab:welcome-to-new-york:bciu053d',
            replaces_id: null, title: 'Welcome to New York',
            part_type: 'tablature', instrument: 'banjo',
            content: '{"tracks":[{"id":"banjo"}]}', created_by: 'u1',
        });
        const { songs } = mergeCorpus({ canon: [], pending: [tab, metaRow()] });
        expect(songs).toHaveLength(1);
        expect(songs[0].id).toBe('welcome-to-new-york');
        expect(songs[0].artist).toBe('Bill Emerson');
        expect(songs[0].tablature_parts).toHaveLength(1);
        // …and the submitter owns that part, which is what makes the edit
        // affordance visible in the seconds before any build has run.
        expect(songs[0].tablature_parts[0].submitted_by).toBe('u1');
    });
});
