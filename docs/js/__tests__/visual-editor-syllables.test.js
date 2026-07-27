// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { syllabify, tokenizeLine } from '../visual-editor/syllables.js';

describe('syllabify', () => {
    it('splits multi-syllable words', () => {
        expect(syllabify('senses').join('|')).toBe('sen|ses');
        expect(syllabify('forest').length).toBeGreaterThan(1);
    });
    it('keeps single-syllable words whole', () => {
        expect(syllabify('heart')).toEqual(['heart']);
    });
    it('always reconstructs the input exactly', () => {
        for (const w of ['spring-time', "cheatin'", 'a', 'XYZ', '123', 'mountains']) {
            expect(syllabify(w).join('')).toBe(w);
        }
    });
});

describe('tokenizeLine', () => {
    it('splits on hyphens like the corpus uses (sen-ses → sen + -ses)', () => {
        const tokens = tokenizeLine('my sen-ses', []);
        const senses = tokens.filter(t => t.start >= 3);
        expect(senses[0]).toEqual({ text: 'sen', start: 3 });
        expect(senses[1]).toEqual({ text: '-ses', start: 6 });
    });

    it('forces a seam at an existing mid-word chord offset', () => {
        // "D[D/F]own the street" → chord at offset 1 of "Down"
        const tokens = tokenizeLine('Down the street', [1]);
        expect(tokens[0]).toEqual({ text: 'D', start: 0 });
        expect(tokens[1].start).toBe(1);
        expect(tokens[1].text.startsWith('o')).toBe(true);
    });

    it('every in-word chord offset is a token start', () => {
        const lyrics = 'You fill up my senses like a night';
        for (const pos of [0, 4, 9, 12, 15, 18, 22]) {
            const tokens = tokenizeLine(lyrics, [pos]);
            if (lyrics[pos] !== ' ') {
                expect(tokens.some(t => t.start === pos), `pos ${pos}`).toBe(true);
            }
        }
    });

    it('token texts reconstruct the words (whitespace excluded)', () => {
        const lyrics = 'hello  big world';
        const tokens = tokenizeLine(lyrics, []);
        expect(tokens.map(t => t.text).join('')).toBe('hellobigworld');
    });

    it('returns no tokens for blank lines', () => {
        expect(tokenizeLine('   ', [])).toEqual([]);
        expect(tokenizeLine('', [])).toEqual([]);
    });
});
