// Unit tests for the shared smart-paste pipeline (smart-paste.js):
// the paste-wiring decision logic used by the Visual editor.
import { describe, it, expect } from 'vitest';
import { convertPastedText, looksLikeChordPro, cleanUltimateGuitarPaste } from '../smart-paste.js';

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

    it('UG chrome with no recognizable song body returns unchanged instead of crashing', () => {
        // page header/footer copied without the tab body: markers say UG,
        // but there is no [Verse]-style header and no chord-over-lyrics line
        const res = cleanUltimateGuitarPaste('ultimate-guitar\njust some prose about tabs\nmore prose');
        expect(res.cleaned).toBe(false);
        expect(res.text).toContain('just some prose about tabs');
    });
});

// Regression: a whole-page select-all from a UG tab, chrome and all. The song
// body used to be sliced away entirely — the header's "Tuning:E A D G B E"
// reads as a chord line, so it won the start scan, and the chord-diagram
// list's "Chords" header then ended the slice a few lines later.
describe('cleanUltimateGuitarPaste on a full-page paste', () => {
    const FULL_PAGE = `Tabs
Courses
+ Publish tab
Sample Song Chords by Some Artist
451,846 views, added to favorites 13,040 times
Difficulty:Absolute Beginner
Tuning:E A D G B E
Key:F#
Capo:4th fret
Author someuser [a] 123. 4 contributors total, last edit on 5 hours ago
We have an official Sample Song tab made by UG professional guitarists.
Chords
D
G
A
E
Strumming
EditIs this strumming pattern correct?
[Verse 1]
D
first placeholder lyric line
G                                        A
second placeholder lyric line
X
Please rate this tab
Welcome Offer
Related tabs
© 2026
Ultimate-Guitar.com`;

    it('keeps the song body and drops the page header', () => {
        const res = cleanUltimateGuitarPaste(FULL_PAGE);
        expect(res.cleaned).toBe(true);
        expect(res.title).toBe('Sample Song');
        expect(res.artist).toBe('Some Artist');
        expect(res.text).toContain('[Verse 1]');
        expect(res.text).toContain('first placeholder lyric line');
        expect(res.text).toContain('second placeholder lyric line');
        // header metadata, chord-diagram list and footer are all gone
        expect(res.text).not.toContain('Tuning:');
        expect(res.text).not.toContain('Capo:');
        expect(res.text).not.toContain('Author someuser');
        expect(res.text).not.toContain('Strumming');
        expect(res.text).not.toContain('Ultimate-Guitar.com');
        expect(res.text).not.toContain('Please rate this tab');
    });

    it('closes every section it opens', () => {
        // An unclosed {soc}/{sov:} parses, but does not round-trip: the
        // serializer supplies the missing {end_of_*}, so the saved work stops
        // matching what the editor wrote and the corpus round-trip test fails.
        const sheet = `[Verse 1]
D                    G
first placeholder lyric line
[Chorus]
G                    D
second placeholder lyric line
[Verse 2]
D                    G
third placeholder lyric line`;
        const res = convertPastedText(sheet);
        const opens = (res.text.match(/\{so[vcb]\b/g) || []).length;
        const closes = (res.text.match(/\{eo[vcb]\}/g) || []).length;
        expect(opens).toBe(3);
        expect(closes).toBe(opens);
        // the verse closes before the chorus opens, and the last section
        // closes at the end rather than being left dangling
        expect(res.text.indexOf('{eov}')).toBeLessThan(res.text.indexOf('{soc}'));
        expect(res.text.trimEnd().endsWith('{eov}')).toBe(true);
    });

    it('converts the full-page paste to ChordPro rather than a header dump', () => {
        const res = convertPastedText(FULL_PAGE);
        expect(res.kind).toBe('chordpro');
        expect(res.text).toContain('{sov: Verse 1}');
        expect(res.text).toContain('[D]first placeholder lyric line');
        expect(res.text).toContain('[G]second placeholder lyric line');
    });

    it('finds the song without section markers, past the chord-diagram list', () => {
        const noMarkers = `Sample Song Chords by Some Artist
Tuning:E A D G B E
Key:F#
Capo:4th fret
Chords
D
G
A
E
Strumming
D                    A
first placeholder lyric line
G                    D
second placeholder lyric line`;
        const res = cleanUltimateGuitarPaste(noMarkers);
        expect(res.cleaned).toBe(true);
        const lines = res.text.split('\n');
        // the slice starts at the real chord line, not at the header or the
        // trailing "E" of the chord-diagram list
        expect(lines[0]).toMatch(/^D\s+A\s*$/);
        expect(res.text).toContain('first placeholder lyric line');
        expect(res.text).toContain('second placeholder lyric line');
    });
});
