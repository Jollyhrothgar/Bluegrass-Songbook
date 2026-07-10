// Unit tests for the shared smart-paste pipeline (smart-paste.js):
// the paste-wiring decision logic used by the Visual editor.
import { describe, it, expect } from 'vitest';
import { convertPastedText, looksLikeChordPro } from '../smart-paste.js';

const CHORD_SHEET = `G              C
Way down upon the Swanee River
D7                 G
Far, far away
G                C
That's where my heart is turning ever
D7               G
That's where the old folks stay`;

describe('looksLikeChordPro', () => {
    it('detects inline chord brackets', () => {
        expect(looksLikeChordPro('Your cheatin [G]heart will [C]weep')).toBe(true);
    });
    it('detects ChordPro directives', () => {
        expect(looksLikeChordPro('{start_of_verse: Verse 1}\nplain words')).toBe(true);
        expect(looksLikeChordPro('{title: My Song}\nplain words')).toBe(true);
        expect(looksLikeChordPro('{soc}\nchorus words')).toBe(true);
    });
    it('does not fire on plain lyrics or [Verse] markers', () => {
        expect(looksLikeChordPro('just some plain lyrics\nsecond line')).toBe(false);
        expect(looksLikeChordPro('[Verse 1]\nplain words here')).toBe(false);
    });
});

describe('convertPastedText', () => {
    it('plain lyrics stay plain', () => {
        expect(convertPastedText('hello world friend\nanother line').kind).toBe('plain');
    });

    it('empty/whitespace text stays plain', () => {
        expect(convertPastedText('').kind).toBe('plain');
        expect(convertPastedText('  \n ').kind).toBe('plain');
    });

    it('chords-over-lyrics converts to ChordPro at the chord column positions', () => {
        const res = convertPastedText(CHORD_SHEET);
        expect(res.kind).toBe('chordpro');
        expect(res.text).toContain('[G]Way down upon');
        expect(res.text).toMatch(/\[D7\]Far, far away/);
        expect(res.text).toContain('[C]');
        // no orphan chord lines remain
        expect(res.text.split('\n').some(l => /^G\s+C\s*$/.test(l))).toBe(false);
    });

    it('existing ChordPro passes through unchanged', () => {
        const src = '{start_of_verse: Verse 1}\n[G]hello [C]world\n{end_of_verse}';
        const res = convertPastedText(src);
        expect(res.kind).toBe('chordpro');
        expect(res.text).toBe(src);
    });

    it('inline-bracket text without directives passes through', () => {
        const src = '[G]hello [C]world friend';
        const res = convertPastedText(src);
        expect(res.kind).toBe('chordpro');
        expect(res.text).toBe(src);
    });

    it('Ultimate Guitar paste is cleaned, converted, and carries title/artist', () => {
        const ug = `Wagon Wheel Chords by Old Crow Medicine Show
1,234,567 views5,578 saves6 comments
Tuning: E A D G B EKey: ACapo: no capo

[Verse 1]
G                        D
Heading down south to the land of the pines
Em                 C
I'm thumbing my way into North Caroline
Last update: Oct 16, 2023
Rating`;
        const res = convertPastedText(ug);
        expect(res.kind).toBe('chordpro');
        expect(res.title).toBe('Wagon Wheel');
        expect(res.artist).toBe('Old Crow Medicine Show');
        expect(res.text).toContain('[G]Heading down south to the');
        expect(res.text).toContain('[D]');
        expect(res.text).toContain("[Em]I'm thumbing my way");
        expect(res.text).not.toContain('Last update');
        expect(res.text).not.toContain('views');
    });

    it('single stray chord-looking word does not trigger conversion', () => {
        const res = convertPastedText('Amazing grace how sweet the sound\nA wretch like me');
        expect(res.kind).toBe('plain');
    });
});
