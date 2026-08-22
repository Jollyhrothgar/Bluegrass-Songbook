// Unit tests for the editor's pitch math.
//
// The numbers here are checked against `renderers/tab-player.js`'s own
// tables (PITCH_TO_MIDI and DEFAULT_TUNINGS) — this module is a port of
// the arithmetic the player already sounds, so a note re-strung in the
// editor must land on the fret that keeps the player's MIDI number.
import { describe, it, expect } from 'vitest';

import {
    PITCH_TO_MIDI,
    pitchToMidi,
    tuningMidi,
    openMidi,
    notePitch,
    fretForPitch,
} from '../../otf-editor/pitch.js';

const banjo = {
    id: 'banjo', instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};

describe('pitchToMidi', () => {
    it('matches the player: C4 is 60, A4 is 69', () => {
        expect(pitchToMidi('C4')).toBe(60);
        expect(pitchToMidi('A4')).toBe(69);
        expect(pitchToMidi('G3')).toBe(55);
    });

    it('handles sharps and whitespace', () => {
        expect(pitchToMidi('A#2')).toBe(46);
        expect(pitchToMidi(' D3 ')).toBe(50);
    });

    it('is null for anything it does not know (the player guesses 60; we do not)', () => {
        expect(pitchToMidi('H4')).toBe(null);
        expect(pitchToMidi('')).toBe(null);
        expect(pitchToMidi(undefined)).toBe(null);
        expect(PITCH_TO_MIDI.G3).toBe(55);
    });
});

describe('tuningMidi / openMidi', () => {
    it('resolves the banjo open-G tuning the player uses', () => {
        expect(tuningMidi(banjo)).toEqual([62, 59, 55, 50, 67]);
    });

    it('falls back to the instrument default when tuning is missing', () => {
        expect(tuningMidi({ instrument: 'mandolin' })).toEqual([76, 69, 62, 55]);
        expect(tuningMidi({ instrument: '6-string-guitar', tuning: [] }))
            .toEqual([64, 59, 55, 50, 45, 40]);
    });

    it('is null for a percussion track (no tuning, no default)', () => {
        expect(tuningMidi({ instrument: 'percussion', tuning: [] })).toBe(null);
        expect(tuningMidi(null)).toBe(null);
    });

    it('openMidi is 1-indexed and range-checked', () => {
        expect(openMidi(banjo, 1)).toBe(62);
        expect(openMidi(banjo, 5)).toBe(67);
        expect(openMidi(banjo, 0)).toBe(null);
        expect(openMidi(banjo, 6)).toBe(null);
    });
});

describe('notePitch / fretForPitch', () => {
    it('notePitch is tuning + fret, exactly as the player sounds it', () => {
        expect(notePitch(banjo, { s: 3, f: 5 })).toBe(60);   // G3 + 5 = C4
        expect(notePitch(banjo, { s: 5, f: 0 })).toBe(67);
    });

    it('fretForPitch inverts it', () => {
        expect(fretForPitch(banjo, 4, 60)).toBe(10);         // D3 + 10 = C4
        expect(fretForPitch(banjo, 3, 60)).toBe(5);
    });

    it('returns the honest negative when a string cannot reach the pitch', () => {
        // D3 open (50) does not exist on G3 (55)
        expect(fretForPitch(banjo, 3, 50)).toBe(-5);
    });

    it('is null when either side is unknown', () => {
        expect(notePitch(banjo, { s: 9, f: 0 })).toBe(null);
        expect(notePitch(banjo, { s: 1 })).toBe(null);
        expect(fretForPitch({ instrument: 'percussion', tuning: [] }, 1, 60)).toBe(null);
    });
});

