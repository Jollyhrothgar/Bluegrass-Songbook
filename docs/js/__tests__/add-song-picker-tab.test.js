// @vitest-environment jsdom
// Phase 4c, surface (b): the add-song picker's Tablature card. A tab is
// always a tab OF something, so this path's whole job is turning "I want
// to tab something" into a target work before the editor opens.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const launchTabCreator = vi.fn(() => true);
vi.mock('../otf-editor/create-tab-entry.js', () => ({
    launchTabCreator: (...args) => launchTabCreator(...args),
}));

const { initAddSongPicker, openAddSongPicker, searchWorksForTab } =
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
        });
        // Launch navigates away — the modal must not be left open behind it
        expect(document.getElementById('add-song-picker').classList.contains('hidden'))
            .toBe(true);
    });

    it('can start a tab with no song behind it', () => {
        openAddSongPicker();
        clickTabCard();
        document.getElementById('picker-tab-search').value = 'Brand New Tune';
        document.getElementById('picker-tab-new').click();
        expect(launchTabCreator).toHaveBeenCalledWith({
            workId: null, instrument: '', title: 'Brand New Tune',
        });
    });

    it('skips the search when the work is already known (contribute mode)', () => {
        openAddSongPicker({ mode: 'contribute', targetSlug: 'gold-rush', title: 'Gold Rush' });
        clickTabCard();
        expect(launchTabCreator).toHaveBeenCalledWith({
            workId: 'gold-rush', instrument: '', title: 'Gold Rush',
        });
        expect(document.querySelector('.picker-tab-target').classList.contains('hidden'))
            .toBe(true);
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
