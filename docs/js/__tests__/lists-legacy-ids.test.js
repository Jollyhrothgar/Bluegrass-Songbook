// The legacy-ID map (~300 KB gzipped) is fetched only when a stored list holds
// an id the corpus doesn't know. (B6)
import { describe, it, expect, beforeEach, vi } from 'vitest';

const songs = [];   // the mocked corpus; tests push rows into it
let corpusFailed = false;

vi.mock('../state.js', () => ({
    userLists: [],
    setUserLists: vi.fn(),
    get allSongs() { return songs; },
    isCloudSyncEnabled: false,
    setCloudSyncEnabled: vi.fn(),
    setListContext: vi.fn(),
    viewingListId: null,
    setViewingListId: vi.fn(),
    viewingPublicList: null,
    setViewingPublicList: vi.fn(),
    FAVORITES_LIST_ID: 'favorites',
    clearSelectedSongs: vi.fn(),
    setCurrentView: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    currentView: 'search',
    get corpusLoadFailed() { return corpusFailed; },
    focusedListId: null,
    setFocusedListId: vi.fn(),
}));
vi.mock('../add-song-picker.js', () => ({ openAddSongPicker: vi.fn() }));
vi.mock('../search-core.js', () => ({ showRandomSongs: vi.fn(), hideBatchOperationsBar: vi.fn() }));
vi.mock('../analytics.js', () => ({ trackListAction: vi.fn() }));
vi.mock('../list-picker.js', () => ({
    showListPicker: vi.fn(), closeListPicker: vi.fn(), updateTriggerButton: vi.fn(),
}));

const store = {};
vi.stubGlobal('localStorage', {
    getItem: vi.fn(k => (k in store ? store[k] : null)),
    setItem: vi.fn((k, v) => { store[k] = String(v); }),
    removeItem: vi.fn(k => { delete store[k]; }),
});

import { userLists } from '../state.js';
import {
    listItemIds, needsLegacyMapping, recordLegacyChecked, readCheckedIds,
    cleanupLegacySongIds, cleanLegacyIdsFromLists,
} from '../lists.js';

const MAPPING = { 'rockytoplyricsandchords': 'rocky-top' };
const mappingFetch = () => vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(MAPPING) }));
const list = (...ids) => ({ id: 'l1', name: 'L', songs: ids });

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    songs.length = 0;
    corpusFailed = false;
    userLists.length = 0;
    vi.restoreAllMocks();
    global.fetch = mappingFetch();
});

describe('needsLegacyMapping', () => {
    const known = new Set(['rocky-top', 'foggy-mountain-breakdown']);

    it('is false when every id is a known slug (part-qualified refs reduce to their work)', () => {
        expect(needsLegacyMapping([list('rocky-top', 'foggy-mountain-breakdown/banjo-tab')], known)).toBe(false);
    });
    it('is false for no lists or empty lists', () => {
        expect(needsLegacyMapping([], known)).toBe(false);
        expect(needsLegacyMapping([list()], known)).toBe(false);
    });
    it('is true when a list holds an id the corpus does not know', () => {
        expect(needsLegacyMapping([list('rocky-top', 'rockytoplyricsandchords')], known)).toBe(true);
    });
    it('ignores ids a previous check already settled', () => {
        expect(needsLegacyMapping([list('rockytoplyricsandchords')], known, new Set(['rockytoplyricsandchords']))).toBe(false);
    });
});

describe('recordLegacyChecked', () => {
    it('remembers unknown ids the map does not translate, not the ones it does', () => {
        recordLegacyChecked([list('gone-forever', 'rockytoplyricsandchords', 'rocky-top')], new Set(['rocky-top']), MAPPING);
        expect([...readCheckedIds()]).toEqual(['gone-forever']);
    });
});

describe('listItemIds', () => {
    it('collects work ids across lists', () => {
        expect([...listItemIds([list('a', 'b/part'), list('a')])].sort()).toEqual(['a', 'b']);
    });
    it('survives junk', () => {
        expect(listItemIds(null).size).toBe(0);
        expect(listItemIds([{ songs: [null, '', 5] }, {}]).size).toBe(0);
    });
});

describe('cleanupLegacySongIds (local lists, once)', () => {
    it('downloads nothing for a visitor with no lists', async () => {
        await cleanupLegacySongIds();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('downloads nothing when every stored id is a known work slug, and settles the migration', async () => {
        songs.push({ id: 'rocky-top' });
        userLists.push(list('rocky-top'));
        await cleanupLegacySongIds();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(store['songbook-legacy-cleanup-v2']).toBe('1');
    });

    it('downloads the map and migrates when a list holds an old id', async () => {
        songs.push({ id: 'rocky-top' });
        userLists.push(list('rockytoplyricsandchords', 'rocky-top'));
        await cleanupLegacySongIds();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(userLists[0].songs).toEqual(['rocky-top']);
        expect(store['songbook-legacy-cleanup-v2']).toBe('1');
    });

    it('does not wait forever for a corpus that failed to load', async () => {
        corpusFailed = true;
        vi.useFakeTimers();
        userLists.push(list('rockytoplyricsandchords'));
        const done = cleanupLegacySongIds();
        await vi.advanceTimersByTimeAsync(16000);
        await done;
        vi.useRealTimers();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(store['songbook-legacy-cleanup-v2']).toBeUndefined();
    });
});

describe('cleanLegacyIdsFromLists (every signed-in sync)', () => {
    it('hands the lists back untouched, with no request, when nothing is unknown', async () => {
        songs.push({ id: 'rocky-top' });
        const lists = [list('rocky-top')];
        expect(await cleanLegacyIdsFromLists(lists)).toBe(lists);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('fetches the map for an unknown id and cleans through it, once per session', async () => {
        vi.resetModules();   // a fresh in-memory cache, as in a new session
        const { cleanLegacyIdsFromLists: clean } = await import('../lists.js');
        songs.push({ id: 'rocky-top' });
        const cleaned = await clean([list('rockytoplyricsandchords', 'rocky-top')]);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(cleaned[0].songs).toEqual(['rocky-top']);   // deduped through the map
        await clean([list('rockytoplyricsandchords')]);
        expect(global.fetch).toHaveBeenCalledTimes(1);     // cached for the session
    });

    it('an unknown id the map does not know is settled: the next session skips the download', async () => {
        vi.resetModules();   // a fresh in-memory cache, as in a new session
        songs.push({ id: 'rocky-top' });
        await (await import('../lists.js')).cleanLegacyIdsFromLists([list('archived-or-deleted')]);
        expect(global.fetch).toHaveBeenCalledTimes(1);

        vi.resetModules();
        global.fetch = mappingFetch();
        await (await import('../lists.js')).cleanLegacyIdsFromLists([list('archived-or-deleted')]);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
