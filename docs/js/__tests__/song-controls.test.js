// Unit tests for song-controls.js (unified song page pills)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { keyButtonLabel, transposeBySemitone, practiceLinks, renderKeyContent, renderDisplayContent, renderDetails } from '../song-controls.js';
import * as state from '../state.js';

describe('keyButtonLabel', () => {
    it('formats the current key as the dock draws it', () => {
        expect(keyButtonLabel('G')).toBe('Key: G');
        expect(keyButtonLabel('F#')).toBe('Key: F#');
    });

    it('falls back to plain "Key" when no key is known', () => {
        expect(keyButtonLabel(null)).toBe('Key');
        expect(keyButtonLabel('')).toBe('Key');
    });
});

describe('transposeBySemitone', () => {
    beforeEach(() => {
        state.setCurrentSong(null);
        state.setOriginalDetectedKey('G');
        state.setOriginalDetectedMode('major');
        state.setCurrentDetectedKey('G');
    });

    it('moves up a chromatic half step', () => {
        expect(transposeBySemitone(1)).toBe('Ab');
        expect(state.currentDetectedKey).toBe('Ab');
    });

    it('moves down a chromatic half step', () => {
        expect(transposeBySemitone(-1)).toBe('F#');
        expect(state.currentDetectedKey).toBe('F#');
    });

    it('wraps around the chromatic circle', () => {
        state.setCurrentDetectedKey('B');
        expect(transposeBySemitone(1)).toBe('C');
        state.setCurrentDetectedKey('C');
        expect(transposeBySemitone(-1)).toBe('B');
    });

    it('normalizes enharmonic spellings before transposing', () => {
        state.setCurrentDetectedKey('Db'); // not in CHROMATIC_MAJOR_KEYS (C# is)
        expect(transposeBySemitone(1)).toBe('D');
    });

    it('uses the minor chromatic set for minor keys', () => {
        state.setOriginalDetectedKey('Am');
        state.setOriginalDetectedMode('minor');
        state.setCurrentDetectedKey('Am');
        expect(transposeBySemitone(1)).toBe('Bbm');
        expect(transposeBySemitone(-1)).toBe('Am');
    });

    it('is a no-op without key state', () => {
        state.setCurrentDetectedKey(null);
        expect(transposeBySemitone(1)).toBe(null);
        state.setOriginalDetectedKey(null);
        state.setCurrentDetectedKey('G');
        expect(transposeBySemitone(1)).toBe(null);
    });
});

describe('practiceLinks', () => {
    it('gives Strum Machine (with ?key=) then YouTube when matched', () => {
        const links = practiceLinks(
            { title: 'Salt Creek', strum_machine_url: 'https://strummachine.com/app/songs/x' }, 'Bb');
        expect(links.map(l => l.id)).toEqual(['strum', 'youtube']);
        expect(links[0].href).toBe('https://strummachine.com/app/songs/x?key=Bb');
    });

    it('omits ?key= when no key is known', () => {
        const [strum] = practiceLinks({ title: 'X', strum_machine_url: 'https://s.example/x' }, null);
        expect(strum.href).toBe('https://s.example/x');
    });

    it('always offers a YouTube title search without the artist', () => {
        const links = practiceLinks({ title: "Earl's Breakdown & Co", artist: 'Flatt' }, 'G');
        expect(links).toHaveLength(1);
        expect(links[0].href).toBe(
            'https://www.youtube.com/results?search_query=' +
            encodeURIComponent("Earl's Breakdown & Co bluegrass"));
    });
});

describe('Key sheet', () => {
    it('no longer carries a Strum Machine button', () => {
        const el = document.createElement('div');
        renderKeyContent(el, { title: 'X', strum_machine_url: 'https://s.example/x' });
        expect(el.innerHTML).toContain('pill-nashville-btn');
        expect(el.innerHTML).not.toContain('pill-strum-btn');
        expect(el.innerHTML).not.toContain('Strum Machine');
    });
});

describe('Display sheet', () => {
    // one sheet at a time: jsdom's selector engine finds a duplicate #id elsewhere in the document before it looks inside the container
    const open = (opts) => { document.body.innerHTML = ''; const el = document.createElement('div'); document.body.appendChild(el); renderDisplayContent(el, opts); return el; };
    afterEach(() => { document.body.innerHTML = ''; state.setChartCells(4); state.setChartBars(1); state.setChartOrder('once'); state.setAutoHideControls(false); });

    it('holds layout, chords and Auto-hide; Size is the dock\'s, not this sheet\'s', () => {
        const el = open({ hasChart: false, wide: true });
        expect([...el.querySelectorAll('input[type=checkbox]')].map(i => i.id))
            .toEqual(['pill-twocol', 'pill-sections', 'pill-compact', 'pill-autohide']);
        expect(el.querySelector('#pill-chord-mode')).toBeTruthy();
        expect(el.querySelector('[data-size]')).toBeNull();
    });

    it('has the Chart group only for a song with a chart', () => {
        expect(open({ hasChart: false }).querySelector('#pill-chart-cells')).toBeNull();
        const el = open({ hasChart: true });
        expect([...el.querySelectorAll('#pill-chart-cells .pill-mode-btn')].map(b => b.textContent)).toEqual(['2', '4', '6', '8']);
        expect([...el.querySelectorAll('#pill-chart-bars .pill-mode-btn')].map(b => b.textContent)).toEqual(['One cell', 'Two cells']);
        expect([...el.querySelectorAll('#pill-chart-order .pill-mode-btn')].map(b => b.textContent)).toEqual(['Each section once', 'As sung']);
    });

    it('two columns are for wide screens only', () => {
        expect(open({ wide: false }).querySelector('#pill-twocol').disabled).toBe(true);
        expect(open({ wide: true }).querySelector('#pill-twocol').disabled).toBe(false);
    });

    it('the Chart group writes the remembered choices and lights the current one', () => {
        const el = open({ hasChart: true });
        el.querySelector('#pill-chart-cells [data-value="6"]').click();
        el.querySelector('#pill-chart-bars [data-value="2"]').click();
        el.querySelector('#pill-chart-order [data-value="sung"]').click();
        expect([state.chartCells, state.chartBars, state.chartOrder]).toEqual([6, 2, 'sung']);
        expect(el.querySelector('#pill-chart-cells .active').textContent).toBe('6');
        const again = open({ hasChart: true });
        expect(again.querySelector('#pill-chart-order .active').textContent).toBe('As sung');
    });

    it('Auto-hide controls is off until it is turned on, and is remembered', () => {
        const el = open({});
        expect(el.querySelector('#pill-autohide').checked).toBe(false);
        el.querySelector('#pill-autohide').click();
        expect(state.autoHideControls).toBe(true);
        expect(open({}).querySelector('#pill-autohide').checked).toBe(true);
    });
});

// F9: the Details sheet is where the song page names performers — only the
// MusicBrainz-backed covering artists; the scraped `artist` is never shown.
describe('Details credits', () => {
    function openInfo(song) {
        const container = document.createElement('div');
        document.body.appendChild(container);
        renderDetails(container, song);
        return container;
    }

    it('names the writer, then who recorded it with years — never an unconfirmed scraped artist', () => {
        const popover = openInfo({
            id: 'you-are-my-sunshine', title: 'You Are My Sunshine', artist: 'Johnny Cash',
            composer: 'Jimmie Davis, Charles Mitchell',
            covering_artists: ['Richard Greene', 'Norman Blake'], covering_years: [1979, null], tags: {},
        });
        const items = [...popover.querySelectorAll('.info-item')].map(el => el.textContent);
        expect(items[0]).toBe('Written by Jimmie Davis, Charles Mitchell');
        expect(items[1]).toBe('Recorded by Richard Greene (1979), Norman Blake');
        expect(popover.textContent).not.toContain('Johnny Cash');
    });

    it('links each recorder to a YouTube search for that recording', () => {
        const popover = openInfo({
            id: 'blue-moon', title: 'Blue Moon of Kentucky',
            covering_artists: ['Bill Monroe'], covering_years: [1947], tags: {},
        });
        const a = popover.querySelector('a.recorded-by-link');
        expect(a.textContent).toBe('Bill Monroe (1947)');
        expect(a.getAttribute('href'))
            .toBe('https://www.youtube.com/results?search_query=Blue+Moon+of+Kentucky+Bill+Monroe+1947');
        expect(a.getAttribute('target')).toBe('_blank');
    });

    it('shows three recorders and expands to the rest', () => {
        const popover = openInfo({
            id: 'famous', title: 'Famous',
            covering_artists: ['A', 'B', 'C', 'D', 'E'], covering_years: [1947, 1961, 1974, 1980, 1990], tags: {},
        });
        expect(popover.querySelector('.artists-visible').textContent).toBe('A (1947), B (1961), C (1974)');
        expect(popover.querySelector('.artists-more').textContent).toBe('(+2)');
        expect(popover.querySelector('.artists-hidden').textContent).toBe(', D (1980), E (1990)');
    });

    it('treats "Traditional" as the writer, and shows no scraped artists', () => {
        const popover = openInfo({ id: 'trad', artist: 'Traditional', tags: {} });
        const items = [...popover.querySelectorAll('.info-item')].map(el => el.textContent);
        expect(items[0]).toBe('Written by Traditional');
        expect(popover.textContent).not.toContain('Recorded by');
    });
});

// Everything the Info pill showed has to survive the move into Details.
describe('Details content', () => {
    function details(song, { signedIn = false } = {}) {
        window.SupabaseAuth = signedIn ? {
            isLoggedIn: () => true,
            fetchTagVotes: async () => ({ data: {} }),
            fetchUserTagVotes: async () => ({ data: {} }),
        } : undefined;
        const container = document.createElement('div');
        document.body.appendChild(container);
        renderDetails(container, song);
        return container;
    }

    it('shows the key, the book, the source and the notes', () => {
        const el = details({
            id: 'x', title: 'X', key: 'G', book: 'Golden Standards', source: 'classic-country',
            notes: 'Kick it off slow', tags: {},
        });
        const text = [...el.querySelectorAll('.info-item')].map(i => i.textContent);
        expect(text).toContain('Key G');
        expect(text).toContain('From Golden Standards');
        expect(text).toContain('Source Classic Country Song Lyrics');
        expect(text).toContain('Notes Kick it off slow');
    });

    it('offers tag votes and "+ Add your own" only to a signed-in reader', () => {
        const song = { id: 'x', tags: { Bluegrass: 1 } };
        const out = details(song);
        expect(out.querySelector('.votable-tag')).not.toBeNull();
        expect(out.querySelector('.vote-chip')).toBeNull();
        expect(out.querySelector('.add-tags-btn')).toBeNull();

        const inn = details(song, { signedIn: true });
        expect(inn.querySelector('.vote-chip')).not.toBeNull();
        expect(inn.querySelector('.add-tags-btn').textContent).toBe('+ Add your own');
    });

    it('says "None" when a song has no tags', () => {
        expect(details({ id: 'x', tags: {} }).querySelector('.no-tags').textContent).toBe('None');
    });
});
