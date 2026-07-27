// Unit tests for song-controls.js (unified song page pills)
import { describe, it, expect, beforeEach } from 'vitest';
import { keyPillLabel, transposeBySemitone } from '../song-controls.js';
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
