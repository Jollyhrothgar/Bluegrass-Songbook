import { describe, it, expect } from 'vitest';
import { isPercussionTrack, pitchedTracks } from '../renderers/otf-tracks.js';

// A drum track's `tuning` is empty and its `s`/`f` are kit line + hit
// variant. Sounding one through the pitched path (tuning[s-1] + f) is what
// made MandoTom2's arrangements play as "bizarre instrumental music".

const PERC = {
    id: 'percussion', instrument: 'percussion', tuning: [],
    capo: 0, role: 'percussion', percussion: true, lines: 8,
};
const MANDO = {
    id: 'mandolin', instrument: 'mandolin',
    tuning: ['E5', 'A4', 'D4', 'G3'], capo: 0, role: 'lead',
};

describe('isPercussionTrack', () => {
    it('detects the explicit flag', () => {
        expect(isPercussionTrack(PERC)).toBe(true);
    });

    it('falls back to the instrument type for pre-flag documents', () => {
        expect(isPercussionTrack({ id: 'drums', instrument: 'percussion' })).toBe(true);
    });

    it('leaves pitched tracks alone', () => {
        expect(isPercussionTrack(MANDO)).toBe(false);
        expect(isPercussionTrack({ id: 'banjo', instrument: '5-string-banjo' })).toBe(false);
    });

    it('never guesses from the track name — TablEdit names can lie', () => {
        // mandolin-hangout 2613's drum track is named "Guitar Standard",
        // and a real 8-string instrument must not be mistaken for drums.
        expect(isPercussionTrack({ id: 'guitar', instrument: '6-string-guitar' })).toBe(false);
        expect(isPercussionTrack({ id: 'percussionist-solo', instrument: 'mandolin' })).toBe(false);
        expect(isPercussionTrack({ id: 'drums', instrument: '8-string' })).toBe(false);
    });

    it('tolerates missing/!malformed tracks', () => {
        expect(isPercussionTrack(null)).toBe(false);
        expect(isPercussionTrack(undefined)).toBe(false);
        expect(isPercussionTrack({})).toBe(false);
    });
});

describe('pitchedTracks', () => {
    it('drops percussion and preserves order', () => {
        const tracks = [MANDO, PERC, { id: 'bass', instrument: 'upright-bass' }];
        expect(pitchedTracks(tracks).map(t => t.id)).toEqual(['mandolin', 'bass']);
    });

    it('handles a missing track list', () => {
        expect(pitchedTracks(undefined)).toEqual([]);
        expect(pitchedTracks([])).toEqual([]);
    });
});
