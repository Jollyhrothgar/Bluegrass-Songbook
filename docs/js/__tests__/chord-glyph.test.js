// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { chordGlyphHtml } from '../chords.js';
import { renderSectionsHtml, parseChordPro } from '../renderers/chordpro.js';

const text = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };

describe('chordGlyphHtml (display only)', () => {
    it('leaves plain letters and minors as they were', () => {
        expect(chordGlyphHtml('G')).toBe('G');
        expect(chordGlyphHtml('Am')).toBe('Am');
    });
    it('spells out sevenths and extensions as superscripts', () => {
        expect(chordGlyphHtml('G7')).toBe('<span class="cg">G<sup>7</sup></span>');
        expect(chordGlyphHtml('Cmaj7')).toContain('<sup>maj7</sup>');
        expect(chordGlyphHtml('Am7')).toBe('<span class="cg">Am<sup>7</sup></span>');
        expect(chordGlyphHtml('Gsus4')).toContain('<sup>sus4</sup>');
    });
    it('draws sharps and flats as glyphs', () => {
        expect(text(chordGlyphHtml('F#m'))).toBe('F♯m');
        expect(text(chordGlyphHtml('Bb'))).toBe('B♭');
        expect(text(chordGlyphHtml('Eb7'))).toBe('E♭7');
    });
    it('draws diminished, half-diminished and augmented', () => {
        expect(text(chordGlyphHtml('F#dim'))).toBe('F♯°');
        expect(text(chordGlyphHtml('F#m7b5'))).toBe('F♯ø7');
        expect(text(chordGlyphHtml('Caug'))).toBe('C+');
    });
    it('flats inside extensions', () => {
        expect(text(chordGlyphHtml('G7b9'))).toBe('G7♭9');
    });
    it('draws a slash bass smaller', () => {
        const html = chordGlyphHtml('D/F#');
        expect(html).toContain('<span class="bass">/F');
        expect(text(html)).toBe('D/F♯');
    });
    it('can dim the root so a decoration reads as the result', () => {
        expect(chordGlyphHtml('D7', { faintRoot: true })).toContain('<span class="faint">D</span>');
    });
    it('handles Nashville numerals', () => {
        expect(text(chordGlyphHtml('bVII'))).toBe('♭VII');
        expect(chordGlyphHtml('V7')).toBe('<span class="cg">V<sup>7</sup></span>');
        expect(chordGlyphHtml('IV')).toBe('IV');
    });
    it('escapes anything that is not a chord, unchanged otherwise', () => {
        expect(chordGlyphHtml('<b>')).toBe('&lt;b&gt;');
        expect(chordGlyphHtml('N.C.')).toBe('N.C.');
        expect(chordGlyphHtml(undefined)).toBe('');
    });
    // Stored XSS guard: chord text is contributor-written and this HTML lands
    // on every song page. Text after a chord-looking root must stay escaped
    // even when it starts with the ° / ø the dim mappings produce.
    it('never emits markup from the chord text itself', () => {
        for (const evil of [
            'G°<img src=x onerror=alert(1)>', 'Gø<img src=x onerror=alert(1)>',
            'G<img src=x onerror=alert(1)>', 'Gm"><script>alert(1)</script>',
            'D/F#<img src=x>', 'IV°<img src=x onerror=alert(1)>',
        ]) {
            const html = chordGlyphHtml(evil);
            expect(html, evil).not.toMatch(/<(img|script)/i);
            expect(html, evil).toContain('&lt;');
        }
        expect(chordGlyphHtml('Gdim')).toBe('<span class="cg">G<sup>°</sup></span>');
        expect(chordGlyphHtml('F#m7b5')).toContain('<sup>ø7</sup>');
    });
});

describe('the book draws the glyphs (HTML path only)', () => {
    const html = renderSectionsHtml(parseChordPro('[F#m7]Hello [G]there').sections, {});
    it('screen HTML carries glyphs', () => {
        expect(html).toContain('<span class="cl-chord"><span class="cg">F');
        expect(html).toContain('<span class="cl-chord">G</span>');
    });
});
