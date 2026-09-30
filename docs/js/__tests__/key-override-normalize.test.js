import { describe, it, expect } from 'vitest';
import { normalizeKeyForMode, CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS } from '../chords.js';

// Every value the notes-sheet picker can store (new and legacy spellings)
const PICKER = ['C', 'C#', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
const LEGACY_SLASH = ['C#/Db', 'D#/Eb', 'F#/Gb', 'G#/Ab', 'A#/Bb'];

describe('normalizeKeyForMode', () => {
    it.each(PICKER.concat(LEGACY_SLASH))('%s maps into the major list', (k) => {
        expect(CHROMATIC_MAJOR_KEYS).toContain(normalizeKeyForMode(k, 'major'));
    });
    it.each(PICKER.concat(LEGACY_SLASH))('%s maps into the minor list', (k) => {
        expect(CHROMATIC_MINOR_KEYS).toContain(normalizeKeyForMode(k, 'minor'));
    });
    it('maps stored sharps to key-list flats', () => {
        expect(normalizeKeyForMode('D#', 'major')).toBe('Eb');
        expect(normalizeKeyForMode('G#', 'major')).toBe('Ab');
        expect(normalizeKeyForMode('A#', 'major')).toBe('Bb');
        expect(normalizeKeyForMode('D#/Eb', 'major')).toBe('Eb');
        expect(normalizeKeyForMode('C#/Db', 'major')).toBe('C#');
    });
    it('gives minor songs minor key names', () => {
        expect(normalizeKeyForMode('A', 'minor')).toBe('Am');
        expect(normalizeKeyForMode('A#', 'minor')).toBe('Bbm');
        expect(normalizeKeyForMode('Eb', 'minor')).toBe('Ebm');
        expect(normalizeKeyForMode('G#', 'minor')).toBe('G#m');
    });
    it('is idempotent on canonical names', () => {
        for (const k of CHROMATIC_MAJOR_KEYS) expect(normalizeKeyForMode(k, 'major')).toBe(k);
        for (const k of CHROMATIC_MINOR_KEYS) expect(normalizeKeyForMode(k, 'minor')).toBe(k);
    });
    it('returns null for junk', () => {
        for (const k of [null, undefined, '', '--', 'H', 5]) expect(normalizeKeyForMode(k, 'major')).toBeNull();
    });
});
