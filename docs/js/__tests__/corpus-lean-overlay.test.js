// The boot overlay is LEAN: pending rows arrive without `content`, the archive
// is loaded on demand, and the last-known curation sets are cached. (B2 / B3)
import { describe, it, expect, vi } from 'vitest';

import {
    transformPendingRow, mergeCorpus, overlayPendingTabParts, rowHasContent,
    overlaysNeedArchive, readCachedIdSet, writeCachedIdSet,
    PENDING_OVERLAY_COLUMNS, pendingForkArrangements,
} from '../corpus.js';
import { initialArrangementSlug } from '../work-view.js';

const CANON = [
    { id: 'rocky-top', title: 'Rocky Top', artist: 'Osborne Brothers', has_content: true },
    { id: 'foggy-mountain-breakdown', title: 'Foggy Mountain Breakdown', has_content: true },
];
const ARCHIVE = [
    { id: 'archived-gem', title: 'Archived Gem', artist: 'Nobody', indexed: false, has_content: true },
];

const leanSong = (over = {}) => ({
    id: 'a-new-song', title: 'A New Song', artist: 'Me', part_type: 'lead-sheet',
    created_by: 'u1', has_content: true, ...over,
});

describe('PENDING_OVERLAY_COLUMNS', () => {
    it('never asks for the heavy column', () => {
        const cols = PENDING_OVERLAY_COLUMNS.split(',');
        expect(cols).not.toContain('content');
        expect(cols).not.toContain('*');
    });

    it('covers every column the transforms read', () => {
        const cols = PENDING_OVERLAY_COLUMNS.split(',');
        for (const c of ['id', 'title', 'artist', 'composer', 'key', 'mode', 'tags', 'notes',
            'status', 'replaces_id', 'created_by', 'created_at', 'part_type', 'instrument', 'part_file']) {
            expect(cols).toContain(c);
        }
    });
});

describe('rowHasContent', () => {
    it('trusts inline content first', () => {
        expect(rowHasContent({ content: 'x' })).toBe(true);
        expect(rowHasContent({ content: '' })).toBe(false);
    });
    it('then the has_content flag the overlay fetch attaches', () => {
        expect(rowHasContent({ has_content: true })).toBe(true);
        expect(rowHasContent({ has_content: false })).toBe(false);
    });
    it('assumes a body for an unflagged row unless its kind says it has none', () => {
        expect(rowHasContent({ part_type: 'lead-sheet' })).toBe(true);
        expect(rowHasContent({ part_type: 'metadata' })).toBe(false);
        expect(rowHasContent({ status: 'placeholder' })).toBe(false);
    });
});

describe('transformPendingRow — lean rows', () => {
    it('a song with a body defers it: flagged, no inline content key', () => {
        const row = transformPendingRow(leanSong());
        expect(row).toMatchObject({ id: 'a-new-song', has_content: true, deferred_content: true, source: 'pending' });
        expect('content' in row).toBe(false);
        expect(row.first_line).toBe('');
        expect(row.status).toBeUndefined();
    });

    it('a placeholder request (no body) stays a placeholder with inline empty content', () => {
        const row = transformPendingRow(leanSong({ has_content: false, status: 'placeholder' }));
        expect(row.content).toBe('');
        expect(row.status).toBe('placeholder');
        expect(row.deferred_content).toBeUndefined();
    });

    it('a row with no body and no status is a placeholder, as before', () => {
        expect(transformPendingRow(leanSong({ has_content: false })).status).toBe('placeholder');
    });

    it('rows that still carry content inline behave exactly as they always did', () => {
        const row = transformPendingRow({ id: 's', title: 'S', content: '[G]Hello there\n' });
        expect(row.content).toBe('[G]Hello there\n');
        expect(row.first_line).toBe('Hello there');
        expect(row.deferred_content).toBeUndefined();
    });

    it('a tab with a body flags its part instead of carrying the OTF', () => {
        const row = transformPendingRow({
            id: 'tab:rocky-top:abc123', replaces_id: 'rocky-top', title: 'Rocky Top',
            part_type: 'tablature', instrument: 'banjo', has_content: true,
        });
        expect(row.pending_part).toMatchObject({
            instrument: 'banjo', pending: true, pending_id: 'tab:rocky-top:abc123',
            content_deferred: true,
        });
        expect('content' in row.pending_part).toBe(false);
    });

    it('metadata rows are unaffected', () => {
        const row = transformPendingRow({
            id: 'meta:rocky-top:abc123', replaces_id: 'rocky-top', part_type: 'metadata', title: 'New Title',
        });
        expect(row.pending_metadata).toEqual({ title: 'New Title' });
    });
});

describe('overlayPendingTabParts with deferred content', () => {
    it('keeps a deferred part (it has a body, just not here yet)', () => {
        const row = transformPendingRow({
            id: 'tab:rocky-top:abc123', replaces_id: 'rocky-top', title: 'Rocky Top',
            part_type: 'tablature', instrument: 'banjo', has_content: true,
        });
        const parts = overlayPendingTabParts([], [row]);
        expect(parts).toHaveLength(1);
        expect(parts[0]).toMatchObject({ file: null, pending: true, content_deferred: true });
    });

    it('still drops a tab row that has no body at all', () => {
        const row = transformPendingRow({
            id: 'tab:rocky-top:abc123', replaces_id: 'rocky-top', title: 'Rocky Top',
            part_type: 'tablature', instrument: 'banjo', has_content: false,
        });
        expect(overlayPendingTabParts([], [row])).toEqual([]);
    });
});

describe('mergeCorpus with a lean pending song', () => {
    it('a deferred edit of a published work keeps the published fields and flags the pending text', () => {
        const pending = [transformPendingRow(leanSong({ id: 'rocky-top', replaces_id: 'rocky-top', title: 'Rocky Top' }))];
        const { songs } = mergeCorpus({ canon: CANON, pending });
        const merged = songs.find(s => s.id === 'rocky-top');
        expect(merged).toMatchObject({ source: 'pending', deferred_content: true, has_content: true });
        expect('content' in merged).toBe(false);   // an undefined key would have clobbered the base
        expect(songs.filter(s => s.id === 'rocky-top')).toHaveLength(1);
    });

    it('a fork advertises the pending take by id instead of by text', () => {
        const pending = [transformPendingRow(leanSong({ id: 'rocky-top', replaces_id: 'rocky-top', title: 'Rocky Top' }))];
        const { songs } = mergeCorpus({ canon: CANON, pending });
        const arr = songs.find(s => s.id === 'rocky-top').arrangements;
        expect(arr).toHaveLength(2);
        expect(arr[1]).toMatchObject({ slug: 'pending', pending: true, pending_id: 'rocky-top' });
        expect('content' in arr[1]).toBe(false);
    });

    it('a pending song with inline text still forks with the text', () => {
        const fork = pendingForkArrangements(CANON[0], { id: 'rocky-top', content: '[G]x' });
        expect(fork[1].content).toBe('[G]x');
        expect(fork[1].pending_id).toBeUndefined();
    });

    it('a row with no body at all is not a fork', () => {
        expect(pendingForkArrangements(CANON[0], { id: 'rocky-top', content: '' })).toBeNull();
        expect(pendingForkArrangements(CANON[0], { id: 'rocky-top' })).toBeNull();
    });

    it('the work page opens on the pending take when the row is lean', () => {
        const pending = [transformPendingRow(leanSong({ id: 'rocky-top', replaces_id: 'rocky-top', title: 'Rocky Top' }))];
        const { songs } = mergeCorpus({ canon: CANON, pending });
        const song = songs.find(s => s.id === 'rocky-top');
        expect(initialArrangementSlug(song, song.arrangements)).toBe('pending');
    });
});

describe('mergeCorpus before the archive has loaded', () => {
    const editOfArchived = transformPendingRow(leanSong({ id: 'archived-gem', replaces_id: 'archived-gem', title: 'Archived Gem' }));
    const tabOfArchived = transformPendingRow({
        id: 'tab:archived-gem:abc123', replaces_id: 'archived-gem', title: 'Archived Gem',
        part_type: 'tablature', instrument: 'banjo', has_content: true,
    });
    const newTab = transformPendingRow({
        id: 'tab:brand-new:abc123', title: 'Brand New', part_type: 'tablature', instrument: 'banjo', has_content: true,
    });

    it('holds back an edit and a tab that name a work only the archive has', () => {
        const { songs } = mergeCorpus({
            canon: CANON, archive: [], pending: [editOfArchived, tabOfArchived], archiveLoaded: false,
        });
        expect(songs.map(s => s.id).sort()).toEqual(['foggy-mountain-breakdown', 'rocky-top']);
    });

    it('applies them onto the archived row once it is in', () => {
        const { songs } = mergeCorpus({
            canon: CANON, archive: ARCHIVE, pending: [editOfArchived, tabOfArchived], archiveLoaded: true,
        });
        const merged = songs.find(s => s.id === 'archived-gem');
        expect(merged.source).toBe('pending');
        expect(merged.indexed).toBe(false);   // still off the shelf: the archived base kept it there
        expect(merged.tablature_parts).toHaveLength(1);
        expect(songs.filter(s => s.id === 'archived-gem')).toHaveLength(1);
    });

    it('does not hold back a tab that mints a new work, or an edit of a canon work', () => {
        const editOfCanon = transformPendingRow(leanSong({ id: 'rocky-top', replaces_id: 'rocky-top', title: 'Rocky Top' }));
        const { songs } = mergeCorpus({
            canon: CANON, pending: [newTab, editOfCanon, transformPendingRow(leanSong())], archiveLoaded: false,
        });
        expect(songs.find(s => s.id === 'brand-new')).toBeTruthy();
        expect(songs.find(s => s.id === 'rocky-top').source).toBe('pending');
        expect(songs.find(s => s.id === 'a-new-song')).toBeTruthy();
    });

    it('defaults to archive-loaded (every existing caller)', () => {
        const { songs } = mergeCorpus({ canon: CANON, archive: ARCHIVE, pending: [editOfArchived] });
        expect(songs.find(s => s.id === 'archived-gem').source).toBe('pending');
    });
});

describe('overlaysNeedArchive', () => {
    it('is false with nothing overlaid', () => {
        expect(overlaysNeedArchive({ canon: CANON })).toBe(false);
        expect(overlaysNeedArchive({ canon: CANON, pending: [], promoted: new Set() })).toBe(false);
    });

    it('is false for a promotion the canon already holds (the build folded it in)', () => {
        expect(overlaysNeedArchive({ canon: CANON, promoted: new Set(['rocky-top']) })).toBe(false);
    });

    it('is true for a promotion only the archive can supply — a fresh promotion must not vanish', () => {
        expect(overlaysNeedArchive({ canon: CANON, promoted: new Set(['archived-gem']) })).toBe(true);
        expect(overlaysNeedArchive({ canon: CANON, promoted: ['archived-gem'] })).toBe(true);
        expect(overlaysNeedArchive({ canon: CANON, promoted: [{ song_id: 'archived-gem' }] })).toBe(true);
    });

    it('is true for an edit or a tab that names a work the canon does not hold', () => {
        const edit = transformPendingRow(leanSong({ id: 'archived-gem', replaces_id: 'archived-gem' }));
        const tab = transformPendingRow({
            id: 'tab:archived-gem:abc123', replaces_id: 'archived-gem', title: 'x', part_type: 'tablature',
            instrument: 'banjo', has_content: true,
        });
        expect(overlaysNeedArchive({ canon: CANON, pending: [edit] })).toBe(true);
        expect(overlaysNeedArchive({ canon: CANON, pending: [tab] })).toBe(true);
    });

    it('is false for new songs, tabs that mint a work, edits of canon works and metadata rows', () => {
        const pending = [
            transformPendingRow(leanSong()),
            transformPendingRow({ id: 'tab:new-one:abc123', title: 'New One', part_type: 'tablature', instrument: 'banjo', has_content: true }),
            transformPendingRow(leanSong({ id: 'rocky-top', replaces_id: 'rocky-top' })),
            transformPendingRow({ id: 'meta:archived-gem:abc123', replaces_id: 'archived-gem', part_type: 'metadata', title: 'T' }),
        ];
        expect(overlaysNeedArchive({ canon: CANON, pending })).toBe(false);
    });

    it('ignores a promoted id that is also deleted (deletion wins — nothing to rescue)', () => {
        expect(overlaysNeedArchive({
            canon: CANON, promoted: ['archived-gem'], deleted: ['archived-gem'],
        })).toBe(false);
        expect(overlaysNeedArchive({
            canon: CANON, promoted: ['archived-gem'], deleted: ['something-else'],
        })).toBe(true);
    });

    it('counts a pending SONG row as a known target for a pending tab', () => {
        const song = transformPendingRow(leanSong({ id: 'brand-new-song' }));
        const tab = transformPendingRow({
            id: 'tab:brand-new-song:abc123', replaces_id: 'brand-new-song', title: 'x',
            part_type: 'tablature', instrument: 'banjo', has_content: true,
        });
        expect(overlaysNeedArchive({ canon: CANON, pending: [song, tab] })).toBe(false);
        // ...but the same tab with no such song does need it
        expect(overlaysNeedArchive({ canon: CANON, pending: [tab] })).toBe(true);
    });

    it('does not wait for the archive for a tab whose target is deleted', () => {
        const tab = transformPendingRow({
            id: 'tab:archived-gem:abc123', replaces_id: 'archived-gem', title: 'x',
            part_type: 'tablature', instrument: 'banjo', has_content: true,
        });
        expect(overlaysNeedArchive({ canon: CANON, pending: [tab], deleted: ['archived-gem'] })).toBe(false);
    });
});

describe('mergeCorpus hold-back with the archive not loaded', () => {
    it('keeps a pending tab that targets a pending song row (it attaches to that row)', () => {
        const song = transformPendingRow(leanSong({ id: 'brand-new-song' }));
        const tab = transformPendingRow({
            id: 'tab:brand-new-song:abc123', replaces_id: 'brand-new-song', title: 'x',
            part_type: 'tablature', instrument: 'banjo', has_content: true,
        });
        const { songs } = mergeCorpus({ canon: CANON, pending: [song, tab], archiveLoaded: false });
        const row = songs.find(s => s.id === 'brand-new-song');
        expect(row.tablature_parts?.length).toBeGreaterThan(0);
    });
});

describe('cached curation id sets', () => {
    const fakeStorage = (initial = {}) => {
        const store = { ...initial };
        return {
            store,
            getItem: vi.fn(k => (k in store ? store[k] : null)),
            setItem: vi.fn((k, v) => { store[k] = v; }),
        };
    };

    it('round-trips a set', () => {
        const storage = fakeStorage();
        writeCachedIdSet('deleted', new Set(['a', 'b']), storage);
        expect([...readCachedIdSet('deleted', storage)].sort()).toEqual(['a', 'b']);
        expect([...readCachedIdSet('promoted', storage)]).toEqual([]);
    });

    it('an empty or garbled cache is an empty set, never a throw', () => {
        expect(readCachedIdSet('deleted', fakeStorage()).size).toBe(0);
        expect(readCachedIdSet('deleted', fakeStorage({ 'songbook-curation-deleted': 'not json' })).size).toBe(0);
        expect(readCachedIdSet('deleted', fakeStorage({ 'songbook-curation-deleted': '{"a":1}' })).size).toBe(0);
        expect(readCachedIdSet('deleted', fakeStorage({ 'songbook-curation-deleted': '[1,"ok"]' }))).toEqual(new Set(['ok']));
    });

    it('blocked storage is survivable on both sides', () => {
        const blocked = {
            getItem() { throw new Error('denied'); },
            setItem() { throw new Error('denied'); },
        };
        expect(readCachedIdSet('deleted', blocked).size).toBe(0);
        expect(() => writeCachedIdSet('deleted', new Set(['a']), blocked)).not.toThrow();
        expect(readCachedIdSet('deleted', undefined).size).toBe(0);
    });

    it('a cached deletion applies on the very first merge (no flash)', () => {
        const cached = readCachedIdSet('deleted', fakeStorage({ 'songbook-curation-deleted': '["rocky-top"]' }));
        const { songs } = mergeCorpus({ canon: CANON, deleted: cached });
        expect(songs.map(s => s.id)).toEqual(['foggy-mountain-breakdown']);
    });
});
