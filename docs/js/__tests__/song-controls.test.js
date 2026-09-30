// Unit tests for song-controls.js (unified song page pills)
import { describe, it, expect, beforeEach } from 'vitest';
import { keyPillLabel, transposeBySemitone, practiceLinks, buildKeyPill } from '../song-controls.js';
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
