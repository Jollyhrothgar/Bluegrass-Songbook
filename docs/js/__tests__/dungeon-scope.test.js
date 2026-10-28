// Dungeon mode: the search scope flips to archived-only rows.
// Uses the REAL state.js (live dungeonMode binding) and mocks the rest of
// search-core's dependencies like search-core.test.js does.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Spread the real module so a new util export never silently arrives as
// `undefined` here; override only the few this test deliberately neutralizes.
vi.mock('../utils.js', async (importOriginal) => ({
    ...await importOriginal(),
    highlightMatch: vi.fn((text) => text),
    escapeHtml: vi.fn((text) => text),
    requireLogin: vi.fn(() => true)
}));

vi.mock('../tags.js', () => ({
    songHasTags: vi.fn(() => true),
    getTagCategory: vi.fn(() => 'genre'),
    formatTagName: vi.fn((tag) => tag),
    getInstrumentTags: vi.fn(() => []),
    INSTRUMENT_FACETS: [],
    toggleFacetTag: vi.fn(),
    activeQueryTags: vi.fn(() => []),
    onTagSync: vi.fn(),
    syncTagControls: vi.fn()
}));

vi.mock('../lists.js', () => ({
    isFavorite: vi.fn(() => false),
    reorderFavoriteItem: vi.fn(),
    reorderFavoriteItemByRef: vi.fn(),
    showFavorites: vi.fn(),
    isSongInAnyList: vi.fn(() => false),
    updateResultListButton: vi.fn(),
    getViewingListId: vi.fn(() => null),
    reorderSongInList: vi.fn(),
    reorderSongInListByRef: vi.fn(),
    isViewingOwnList: vi.fn(() => false),
    removeSongFromList: vi.fn(),
    showListView: vi.fn(),
    clearListView: vi.fn(),
    FAVORITES_LIST_ID: 'favorites',
    toggleFavorite: vi.fn(),
    addSongToList: vi.fn(),
    getSongMetadata: vi.fn(() => ({})),
    openNotesSheet: vi.fn()
}));

const store = {};
vi.stubGlobal('localStorage', {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
});

vi.mock('../list-picker.js', () => ({ showListPicker: vi.fn() }));
vi.mock('../work-view.js', () => ({ openWork: vi.fn() }));
vi.mock('../analytics.js', () => ({
    trackSearch: vi.fn(),
    trackSearchResultClick: vi.fn()
}));
vi.mock('../add-song-picker.js', () => ({ openAddSongPicker: vi.fn() }));
vi.mock('../song-content.js', () => ({ songHasContent: vi.fn(() => true) }));
vi.mock('../shell.js', () => ({ pill: vi.fn() }));

import { searchableSongs, search } from '../search-core.js';
import { setAllSongs, setDungeonMode, dungeonMode, setIncludeDungeon, includeDungeon } from '../state.js';
import { countDistinctTitles } from '../corpus.js';

const CORPUS = [
    { id: 'canon-song', title: 'Canon Song', artist: 'Bill Monroe' },
    { id: 'canon-song-2', title: 'Other Canon Song', artist: 'Flatt' },
    { id: 'dungeon-song', title: 'Dungeon Song', artist: 'Nobody', indexed: false },
    { id: 'dungeon-song-2', title: 'Forgotten Waltz', artist: 'Anon', indexed: false },
];

beforeEach(() => {
    setDungeonMode(false);
    setIncludeDungeon(false);
    setAllSongs(CORPUS.map(s => ({ ...s })));
});

describe('searchableSongs scope', () => {
    it('defaults to canon-only (indexed !== false)', () => {
        expect(searchableSongs().map(s => s.id)).toEqual(['canon-song', 'canon-song-2']);
    });

    it('flips to archived-only in dungeon mode', () => {
        setDungeonMode(true);
        expect(searchableSongs().map(s => s.id)).toEqual(['dungeon-song', 'dungeon-song-2']);
    });

    it('restores canon scope when dungeon mode ends', () => {
        setDungeonMode(true);
        setDungeonMode(false);
        expect(searchableSongs().map(s => s.id)).toEqual(['canon-song', 'canon-song-2']);
    });
});

describe('search in dungeon mode', () => {
    it('matches archive rows and never canon rows', () => {
        setDungeonMode(true);
        const results = search('song', { skipRender: true });
        const ids = results.map(s => s.id);
        expect(ids).toContain('dungeon-song');
        expect(ids).not.toContain('canon-song');
    });

    it('canon search never surfaces archive rows', () => {
        const results = search('song', { skipRender: true });
        const ids = results.map(s => s.id);
        expect(ids).toContain('canon-song');
        expect(ids).not.toContain('dungeon-song');
    });
});

describe('canon-only consumers ignore dungeon mode', () => {
    it('countDistinctTitles counts canon regardless of mode', () => {
        const before = countDistinctTitles(CORPUS);
        setDungeonMode(true);
        expect(countDistinctTitles(CORPUS)).toBe(before);
        expect(before).toBe(2);
    });
});

describe('setDungeonMode', () => {
    it('exposes the live flag', () => {
        expect(dungeonMode).toBe(false);
        setDungeonMode(true);
        expect(dungeonMode).toBe(true);
    });
});

describe('Include the dungeon', () => {
    it('searches canon and archive together', () => {
        setIncludeDungeon(true);
        expect(searchableSongs().map(s => s.id).sort())
            .toEqual(['canon-song', 'canon-song-2', 'dungeon-song', 'dungeon-song-2']);
    });

    it('ranks the canon above an equally relevant archive row', () => {
        setIncludeDungeon(true);
        // Every "song" title is in the same relevance tier (contains the
        // query); within a tier the canon comes first.
        const ids = search('song', { skipRender: true }).map(s => s.id);
        expect(ids.indexOf('canon-song')).toBeLessThan(ids.indexOf('dungeon-song'));
        expect(ids.indexOf('canon-song-2')).toBeLessThan(ids.indexOf('dungeon-song'));
    });

    it('still lets a better match from the dungeon outrank the canon', () => {
        setIncludeDungeon(true);
        const ids = search('dungeon song', { skipRender: true }).map(s => s.id);
        expect(ids[0]).toBe('dungeon-song');
    });

    it('dungeon mode stays archive-only while it is on', () => {
        setIncludeDungeon(true);
        setDungeonMode(true);
        expect(searchableSongs().map(s => s.id)).toEqual(['dungeon-song', 'dungeon-song-2']);
    });

    it('is remembered in localStorage, and forgotten when unticked', () => {
        setIncludeDungeon(true);
        expect(includeDungeon).toBe(true);
        expect(localStorage.getItem('songbook-include-dungeon')).toBe('1');
        setIncludeDungeon(false);
        expect(localStorage.getItem('songbook-include-dungeon')).toBeNull();
    });
});
