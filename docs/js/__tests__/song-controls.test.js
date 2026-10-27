// Unit tests for song-controls.js (unified song page pills)
import { describe, it, expect, beforeEach } from 'vitest';
import { keyPillLabel, transposeBySemitone, practiceLinks, buildKeyPill, buildInfoPill } from '../song-controls.js';
import * as state from '../state.js';

describe('keyPillLabel', () => {
    it('formats the current key', () => {
        expect(keyPillLabel('G')).toBe('Key of G');
        expect(keyPillLabel('F#')).toBe('Key of F#');
    });

    it('falls back to plain "Key" when no key is known', () => {
        expect(keyPillLabel(null)).toBe('Key');
        expect(keyPillLabel('')).toBe('Key');
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

describe('Key pill', () => {
    it('no longer carries a Strum Machine button', () => {
        const pillEl = buildKeyPill({ title: 'X', strum_machine_url: 'https://s.example/x' });
        pillEl.pillApi.refresh();
        expect(pillEl.innerHTML).toContain('pill-nashville-btn');
        expect(pillEl.innerHTML).not.toContain('pill-strum-btn');
        expect(pillEl.innerHTML).not.toContain('Strum Machine');
    });
});

// F9: the Info pill is where the song page names performers — only the
// MusicBrainz-backed covering artists; the scraped `artist` is never shown.
describe('Info pill credits', () => {
    function openInfo(song, versions = []) {
        const root = buildInfoPill(song, versions);
        document.body.appendChild(root);
        root.querySelector('.pill-btn').click();
        return root.querySelector('.pill-popover');
    }

    it('names the writer, then who recorded it with years — never an unconfirmed scraped artist', () => {
        const popover = openInfo({
            id: 'you-are-my-sunshine', title: 'You Are My Sunshine', artist: 'Johnny Cash',
            composer: 'Jimmie Davis, Charles Mitchell',
            covering_artists: ['Richard Greene', 'Norman Blake'], covering_years: [1979, null], tags: {},
        });
        const items = [...popover.querySelectorAll('.info-item')].map(el => el.textContent);
        expect(items[0]).toBe('Written by: Jimmie Davis, Charles Mitchell');
        expect(items[1]).toBe('Recorded by: Richard Greene (1979), Norman Blake');
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

    it('treats "Traditional" as the writer, and shows no versions\' scraped artists', () => {
        const popover = openInfo({ id: 'trad', artist: 'Traditional', tags: {} },
            [{ artist: 'Ralph Stanley' }]);
        const items = [...popover.querySelectorAll('.info-item')].map(el => el.textContent);
        expect(items[0]).toBe('Written by: Traditional');
        expect(popover.textContent).not.toContain('Recorded by');
        expect(popover.textContent).not.toContain('Ralph Stanley');
    });
});
