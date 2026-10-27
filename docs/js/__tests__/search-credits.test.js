// F9: search rows credit the writer and name a covering artist only when the
// search asked for one. Search matches only what a row can show, so the
// scraped `artist` neither matches nor appears. Drives the real search() → renderResults() hand-off, which is
// where an `artist:` filter used to get lost (only free text reached the row).
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

vi.mock('../list-picker.js', () => ({ showListPicker: vi.fn() }));
vi.mock('../work-view.js', () => ({ openWork: vi.fn() }));
vi.mock('../analytics.js', () => ({
    trackSearch: vi.fn(),
    trackSearchResultClick: vi.fn()
}));
vi.mock('../add-song-picker.js', () => ({ openAddSongPicker: vi.fn() }));
vi.mock('../song-content.js', () => ({ songHasContent: vi.fn(() => true) }));
vi.mock('../shell.js', () => ({ pill: vi.fn() }));

import { initSearch, search, renderResults } from '../search-core.js';
import { setAllSongs, setDungeonMode } from '../state.js';

const CORPUS = [
    { id: 'you-are-my-sunshine', title: 'You Are My Sunshine', artist: 'Johnny Cash',
      composer: 'Jimmie Davis, Charles Mitchell', covering_artists: ['Mac Wiseman', 'Norman Blake'],
      covering_years: [2008, 2000] },
    { id: 'cold-cold-heart', title: 'Cold Cold Heart', artist: 'Hank Williams',
      covering_artists: ['Hank Williams'] },
    { id: 'jambalaya', title: 'Jambalaya', artist: 'Hank Williams' },
    { id: 'hey-good-lookin', title: "Hey Good Lookin'", artist: 'Somebody Else',
      composer: 'Hank Williams' },
];

let results;
beforeEach(async () => {
    globalThis.IntersectionObserver ??= class { observe() {} disconnect() {} };
    document.body.innerHTML = '<div id="results"></div>';
    results = document.getElementById('results');
    await initSearch({ resultsDiv: results });
    setDungeonMode(false);
    setAllSongs(CORPUS.map(s => ({ ...s })));
});

const row = (id) => results.querySelector(`.result-item[data-id="${id}"]`);

describe('search rows (F9)', () => {
    it('credit the writer and never the scraped artist on a title search', () => {
        search('sunshine');
        const r = row('you-are-my-sunshine');
        expect(r.querySelector('.result-writer').textContent).toBe('Written by Jimmie Davis, Charles Mitchell');
        expect(r.textContent).not.toContain('Johnny Cash');
        expect(r.querySelector('.result-covering')).toBeNull();
    });

    it('name the artist an artist: filter matched', () => {
        search('artist:hank williams');
        const r = row('cold-cold-heart');
        expect(r.querySelector('.result-covering').textContent).toBe('Recorded by: Hank Williams');
        expect(r.querySelector('.result-writer')).toBeNull();   // no writer known: say nothing
    });

    it('never match on the scraped artist alone', () => {
        search('artist:hank williams');
        expect(row('jambalaya')).toBeNull();
        search('johnny cash');
        expect(row('you-are-my-sunshine')).toBeNull();
    });

    it('match artist: against the writer, and show why', () => {
        search('artist:hank williams');
        expect(row('hey-good-lookin').querySelector('.result-writer').textContent)
            .toBe('Written by Hank Williams');
    });

    it('name the artist free text matched, and only that one', () => {
        search('mac wiseman');
        expect(row('you-are-my-sunshine').querySelector('.result-covering').textContent)
            .toBe('Recorded by: Mac Wiseman (2008)');
    });

    it('show no artist line in a list or collection render', () => {
        search('artist:hank williams');
        renderResults(CORPUS, '');
        expect(results.querySelector('.result-covering')).toBeNull();
    });
});
