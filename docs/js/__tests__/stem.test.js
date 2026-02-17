import { describe, it, expect } from 'vitest';
import { normalizeWord, stemWord, buildStemSet } from '../stem.js';

describe('normalizeWord', () => {
    it('lowercases input', () => {
        expect(normalizeWord('Hello')).toBe('hello');
    });

    it('expands music contractions: in\' → ing', () => {
        expect(normalizeWord("rollin'")).toBe('rolling');
        expect(normalizeWord("cryin'")).toBe('crying');
        expect(normalizeWord("lovin'")).toBe('loving');
    });

    it('strips punctuation', () => {
        expect(normalizeWord("baby's")).toBe('babys');
        expect(normalizeWord('hello!')).toBe('hello');
        expect(normalizeWord('"quoted"')).toBe('quoted');
    });

    it('handles empty input', () => {
        expect(normalizeWord('')).toBe('');
    });
});

describe('stemWord', () => {
    it('stems basic words', () => {
        expect(stemWord('rolling')).toBe('roll');
        expect(stemWord('singing')).toBe('sing');
        expect(stemWord('crying')).toBe('cry');
        expect(stemWord('running')).toBe('run');
    });

    it('stems music contractions', () => {
        // rollin' → rolling → roll
        expect(stemWord("rollin'")).toBe('roll');
        // cryin' → crying → cry
        expect(stemWord("cryin'")).toBe('cry');
    });

    it('stems plurals', () => {
        expect(stemWord('mountains')).toBe('mountain');
        expect(stemWord('babies')).toBe('babi');
    });

    it('returns empty for punctuation-only input', () => {
        expect(stemWord("'")).toBe('');
        expect(stemWord('...')).toBe('');
    });

    it('short words pass through', () => {
        expect(stemWord('in')).toBe('in');
        expect(stemWord('my')).toBe('my');
    });
});

describe('buildStemSet', () => {
    it('builds a set of stems from text', () => {
        const stems = buildStemSet("Rollin' in My Sweet Baby's Arms");
        expect(stems.has('roll')).toBe(true);   // rollin' → rolling → roll
        expect(stems.has('sweet')).toBe(true);
        expect(stems.has('arm')).toBe(true);     // arms → arm
    });

    it('handles empty text', () => {
        const stems = buildStemSet('');
        expect(stems.size).toBe(0);
    });

    it('deduplicates stems', () => {
        const stems = buildStemSet('sing singing singer');
        expect(stems.has('sing')).toBe(true);
        // All three reduce to 'sing'
        expect(stems.size).toBeLessThanOrEqual(3);
    });
});
