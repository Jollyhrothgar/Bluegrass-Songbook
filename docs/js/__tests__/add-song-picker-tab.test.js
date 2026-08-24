// @vitest-environment jsdom
// Phase 4c, surface (b): the add-song picker's Tablature card. A tab is
// always a tab OF something, so this path's whole job is turning "I want
// to tab something" into a target work before the editor opens.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const launchTabCreator = vi.fn(() => true);
vi.mock('../otf-editor/create-tab-entry.js', () => ({
    launchTabCreator: (...args) => launchTabCreator(...args),
}));

const { initAddSongPicker, openAddSongPicker, searchWorksForTab, tabResultsState } =
    await import('../add-song-picker.js');
const { setAllSongs } = await import('../state.js');

function mountPicker() {
    document.body.innerHTML = `
        <div id="add-song-picker" class="modal hidden">
            <h2 id="picker-header-title"></h2>
            <button id="add-song-picker-close"></button>
            <div class="picker-cards">
                <button class="picker-card picker-card-tab" data-type="tablature"></button>
                <button class="picker-card picker-card-request" data-type="request"></button>
            </div>
            <div class="picker-tab-target hidden">
                <button class="picker-back-btn picker-tab-back"></button>
                <input id="picker-tab-search" type="text">
                <select id="picker-tab-instrument">
                    <option value=""></option>
                    <option value="banjo">Banjo</option>
                    <option value="guitar">Guitar</option>
                </select>
                <div id="picker-tab-results"></div>
                <button id="picker-tab-new"></button>
            </div>
            <div class="picker-request-form hidden">
                <button class="picker-back-btn"></button>
                <input id="picker-req-title" type="text">
                <input id="picker-req-artist" type="text">
                <select id="picker-req-key"><option value=""></option></select>
                <textarea id="picker-req-notes"></textarea>
                <div id="picker-dedup-warning" class="hidden"></div>
                <button id="picker-req-submit" disabled></button>
                <span id="picker-req-status"></span>
            </div>
        </div>
    `;
}

const SONGS = [
    { id: 'salt-creek', title: 'Salt Creek', artist: 'Bill Monroe' },
    { id: 'salty-dog-blues', title: 'Salty Dog Blues', artist: 'Flatt & Scruggs' },
    { id: 'gold-rush', title: 'Gold Rush', artist: 'Bill Monroe' },
    {
        id: 'foggy-mountain-breakdown', title: 'Foggy Mountain Breakdown',
        artist: 'Earl Scruggs',
        tablature_parts: [
            { instrument: 'banjo', src_file: 'banjo.otf.json',
              author: 'schlange', default: true },
            { instrument: 'banjo', src_file: 'banjo-18967.otf.json',
              author: 'Devon Wells' },
            { instrument: 'mandolin', src_file: 'mandolin.otf.json' },
        ],
    },
];

const clickTabCard = () =>
    document.querySelector('.picker-card-tab').click();

describe('picker → tablature', () => {
    beforeEach(() => {
        launchTabCreator.mockClear();
        setAllSongs(SONGS);
        mountPicker();
        initAddSongPicker({ onUpload: () => {}, onChordPro: () => {} });
    });

    it('asks which song the tab is for', () => {
        openAddSongPicker();
        clickTabCard();
        expect(document.querySelector('.picker-tab-target').classList.contains('hidden'))
            .toBe(false);
        expect(document.querySelector('.picker-cards').classList.contains('hidden'))
            .toBe(true);
        expect(launchTabCreator).not.toHaveBeenCalled();
    });

    it('searches existing works and launches the editor targeted at one', () => {
        openAddSongPicker();
        clickTabCard();
        const search = document.getElementById('picker-tab-search');
        search.value = 'salt';
        search.dispatchEvent(new Event('input'));
        document.getElementById('picker-tab-instrument').value = 'banjo';

        const rows = document.querySelectorAll('.picker-tab-result');
        expect([...rows].map(r => r.dataset.workId))
            .toEqual(['salt-creek', 'salty-dog-blues']);

        rows[0].click();
        expect(launchTabCreator).toHaveBeenCalledWith({
            workId: 'salt-creek', instrument: 'banjo', title: 'Salt Creek',
            existingCount: 0,
        });
        // Launch navigates away — the modal must not be left open behind it
        expect(document.getElementById('add-song-picker').classList.contains('hidden'))
            .toBe(true);
    });

    it('shows a genuine no-match message when the corpus is loaded but nothing matches', () => {
        openAddSongPicker();
        clickTabCard();
        const search = document.getElementById('picker-tab-search');
        search.value = 'Brand New Tune';
        search.dispatchEvent(new Event('input'));

        const results = document.getElementById('picker-tab-results');
        expect(results.textContent).toMatch(/No song by that name/);
        expect(document.getElementById('picker-tab-new').classList.contains('hidden')).toBe(false);
    });

    it('can start a tab with no song behind it', () => {
        openAddSongPicker();
        clickTabCard();
        document.getElementById('picker-tab-search').value = 'Brand New Tune';
        document.getElementById('picker-tab-new').click();
        expect(launchTabCreator).toHaveBeenCalledWith({
            workId: null, instrument: '', title: 'Brand New Tune',
            existingCount: 0,
        });
    });

    it('skips the search when the work is already known (contribute mode)', () => {
        openAddSongPicker({ mode: 'contribute', targetSlug: 'gold-rush', title: 'Gold Rush' });
        clickTabCard();
        expect(launchTabCreator).toHaveBeenCalledWith({
            workId: 'gold-rush', instrument: '', title: 'Gold Rush',
            existingCount: 0,
        });
        expect(document.querySelector('.picker-tab-target').classList.contains('hidden'))
            .toBe(true);
    });
});

// The production bug (2026-08-16): a contributor targeted
// foggy-mountain-breakdown with a banjo tab from this very picker, spent
// an hour in the editor, and was blocked at Submit by the server's 409 —
// no fork path, no warning, work at risk. Contract principle 4: the
// offramp is a choice offered EARLY. The picker already holds the answer
// (`tablature_parts` is on the index row), so it costs nothing to say so
// before the editor opens.
describe('picker → tablature: the early offramp', () => {
    beforeEach(() => {
        launchTabCreator.mockClear();
        setAllSongs(SONGS);
        mountPicker();
        initAddSongPicker({ onUpload: () => {}, onChordPro: () => {} });
    });

    const chooseFoggy = (instrument = 'banjo') => {
        openAddSongPicker();
        clickTabCard();
        const search = document.getElementById('picker-tab-search');
        search.value = 'foggy';
        search.dispatchEvent(new Event('input'));
        document.getElementById('picker-tab-instrument').value = instrument;
        document.querySelector('.picker-tab-result').click();
    };

    it('says what already exists instead of opening the editor', () => {
        chooseFoggy();
        expect(launchTabCreator).not.toHaveBeenCalled();
        expect(document.querySelector('.tab-existing-head').textContent)
            .toBe('Foggy Mountain Breakdown already has 2 banjo tabs');
    });

    it('adding yours alongside proceeds exactly as before, count in hand', () => {
        chooseFoggy();
        document.querySelector('.tab-existing-add').click();
        expect(launchTabCreator).toHaveBeenCalledWith({
            workId: 'foggy-mountain-breakdown', instrument: 'banjo',
            title: 'Foggy Mountain Breakdown', existingCount: 2,
        });
    });

    it('does not interrupt an instrument the work has no tab for', () => {
        chooseFoggy('guitar');
        expect(document.querySelector('.tab-existing-panel')).toBe(null);
        expect(launchTabCreator).toHaveBeenCalledWith({
            workId: 'foggy-mountain-breakdown', instrument: 'guitar',
            title: 'Foggy Mountain Breakdown', existingCount: 0,
        });
    });

    it('with no instrument chosen, reports every tab the song has', () => {
        chooseFoggy('');
        expect(document.querySelector('.tab-existing-head').textContent)
            .toBe('Foggy Mountain Breakdown already has 3 tabs');
    });

    it('Back returns to the search results it came from', () => {
        chooseFoggy();
        document.querySelector('.tab-existing-back').click();
        expect(document.querySelector('.tab-existing-panel')).toBe(null);
        expect(document.getElementById('picker-tab-results').classList.contains('hidden'))
            .toBe(false);
        expect(document.querySelectorAll('.picker-tab-result').length).toBe(1);
    });

    it('leaves nothing behind when the picker closes', () => {
        chooseFoggy();
        document.getElementById('add-song-picker-close').click();
        expect(document.querySelector('.tab-existing-panel')).toBe(null);
    });
});

describe('searchWorksForTab', () => {
    it('prefers title prefixes and returns nothing for an empty query', () => {
        expect(searchWorksForTab('gold', SONGS).map(s => s.id)).toEqual(['gold-rush']);
        expect(searchWorksForTab('', SONGS)).toEqual([]);
        expect(searchWorksForTab('   ', SONGS)).toEqual([]);
    });

    it('tolerates near-misses the way the dedup check does', () => {
        expect(searchWorksForTab('salt creek', SONGS).map(s => s.id)[0]).toBe('salt-creek');
        expect(searchWorksForTab('the gold rush', SONGS).map(s => s.id)).toContain('gold-rush');
    });
});

// Triage (2026-08-16): "Tab a Song" told a user searching for Foggy
// Mountain "No song by that name" when the real cause was index.jsonl
// failing to fetch — allSongs stayed [] and the picker read that as a
// confident no-match instead of an unloaded corpus. These three states
// (a match, a genuine no-match, and a never-loaded corpus) must render
// three different things.
describe('tabResultsState (pure)', () => {
    it('a match wins regardless of corpus size', () => {
        expect(tabResultsState('salt', [{ id: 'salt-creek' }], false).kind).toBe('matches');
    });

    it('a genuine no-match: query present, no matches, corpus loaded', () => {
        const state = tabResultsState('some unknown tune', [], false);
        expect(state.kind).toBe('no-match');
        expect(state.message).toMatch(/No song by that name/);
    });

    it('empty query with a loaded corpus shows neither message', () => {
        expect(tabResultsState('', [], false).kind).toBe('empty-query');
        expect(tabResultsState('   ', [], false).kind).toBe('empty-query');
    });

    it('an empty corpus always reports corpus-empty, even with no query', () => {
        const withQuery = tabResultsState('anything', [], true);
        expect(withQuery.kind).toBe('corpus-empty');
        expect(withQuery.message).toMatch(/isn't loaded/);

        const noQuery = tabResultsState('', [], true);
        expect(noQuery.kind).toBe('corpus-empty');
    });

    it('an empty corpus wins even if matches were somehow passed in', () => {
        // Defensive: corpusEmpty is the authoritative signal, not matches.length.
        expect(tabResultsState('salt', [{ id: 'salt-creek' }], true).kind).toBe('corpus-empty');
    });
});

describe('picker → tablature: empty-corpus honesty', () => {
    beforeEach(() => {
        launchTabCreator.mockClear();
        setAllSongs([]);
        mountPicker();
        initAddSongPicker({ onUpload: () => {}, onChordPro: () => {} });
    });

    it('shows the corpus-not-loaded message instead of "no song by that name"', () => {
        openAddSongPicker();
        clickTabCard();
        const search = document.getElementById('picker-tab-search');
        search.value = 'foggy mountain';
        search.dispatchEvent(new Event('input'));

        const results = document.getElementById('picker-tab-results');
        expect(results.textContent).toMatch(/isn't loaded/);
        expect(results.textContent).not.toMatch(/No song by that name/);
    });

    it('hides the add-as-new-song button while the corpus is empty', () => {
        openAddSongPicker();
        clickTabCard();
        const search = document.getElementById('picker-tab-search');
        search.value = 'foggy mountain';
        search.dispatchEvent(new Event('input'));

        expect(document.getElementById('picker-tab-new').classList.contains('hidden')).toBe(true);
    });

    it('refuses to start a tab with no target even if the hidden button is clicked anyway', () => {
        openAddSongPicker();
        clickTabCard();
        const newBtn = document.getElementById('picker-tab-new');
        newBtn.classList.remove('hidden'); // simulate a stale/bypassed DOM state
        newBtn.click();
        expect(launchTabCreator).not.toHaveBeenCalled();
    });
});
