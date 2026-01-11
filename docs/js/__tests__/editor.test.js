// Unit tests for editor.js paste handlers
import { describe, it, expect } from 'vitest';
import { cleanChordUPaste, cleanUltimateGuitarPaste, editorConvertToChordPro } from '../editor.js';

describe('cleanChordUPaste', () => {
    it('extracts full song from ChordU paste with artist and quoted title', () => {
        // This simulates a ChordU paste with the full structure including "Traditional" marker
        const chordUPaste = `ChordU
Find chords for tracks u love

Chords for John Cowan "King Of California"
Tempo:
120.8 bpm
Chords used:FBbDmAmC
Tuning:Standard Tuning (EADGBE)Capo:+0fret
[Ab] [C]
[F]
I left my home - short preview

100%  ➙
121
BPM

F, 0 Transpose
guitar
piano
ukulele

Show All Diagrams
ChordsNotesBeta
Simplified
Advanced
Bass
Edited
Download PDFDownload MidiEdit This Version

gold
 Hide lyrics
 Blocks
 Traditional
_ _ _ [Ab] _ _ _ [C] _ _
_ [F] _ _ _ _ _ _ _
_ I left my home and one true love _ East of the Ohio [Dm] River
And _ _ _ [F] her father said we could never wed _ For I had neither gold [Dm] nor the silver
_ But _ _ _ [Am] my darling dear, [Bb] please listen _ dear _ Cause [F] I think [C] it's fair [D] now to [F] warn you _ _
_ _ _ _ [Bb] That I'll return [Dm] to claim your hand _ [F] _
_ _ As [Am] a king [Bb] of _
[F] California
_ _ Over _ _ _ _ _ _ _ _ _ _
_ _ deserts hot and mountains cold _ I've traveled the Indian country




About ChordU
Features
Terms Of Use`;

        const result = cleanChordUPaste(chordUPaste);

        expect(result.cleaned).toBe(true);
        expect(result.title).toBe('King Of California');
        expect(result.artist).toBe('John Cowan');

        // Should get full song (after Traditional), not short preview
        expect(result.text).toContain('I left my home and one true love');
        expect(result.text).toContain('deserts hot and mountains cold');
        expect(result.text).toContain("I've traveled the Indian country");

        // Should remove _ timing markers
        expect(result.text).not.toContain(' _ ');

        // Should remove header/footer cruft
        expect(result.text).not.toContain('ChordU');
        expect(result.text).not.toContain('Traditional');
        expect(result.text).not.toContain('About ChordU');

        // Should preserve chord brackets
        expect(result.text).toContain('[F]');
        expect(result.text).toContain('[Dm]');
    });

    it('extracts title without artist when not in quotes', () => {
        const chordUPaste = `ChordU
Find chords for tracks u love

Chords for The Old Home Place
Tempo:
124.1 bpm
Chords used:BbEbFDC

100%  ➙
guitar
piano

Show All Diagrams
Simplified
Advanced
Bass
Edited

gold
 Hide lyrics
 Blocks
 Traditional
_ _ _ D _ _ Eb _ _ Bb _
_ _ _ _ It's been tenD long years Eb since I left Bb my home
_ Where the coolD fall nights Eb make the wood Bb smoke rise
_ And the fox hunter blows his horn




About ChordU
Features`;

        const result = cleanChordUPaste(chordUPaste);

        expect(result.cleaned).toBe(true);
        expect(result.title).toBe('The Old Home Place');
        expect(result.artist).toBeNull();

        // Should get content after Traditional
        expect(result.text).toContain("It's been tenD long years");
        expect(result.text).toContain('fox hunter blows his horn');
    });

    it('handles paste ending with "You may also like"', () => {
        const chordUPaste = `ChordU
Find chords for tracks u love

Chords for Roustabout
Tempo:
131.25 bpm

gold
 Hide lyrics
 Blocks
 Traditional
_ _ _ _ _ _ _ _
I'm just a roster pal, _ _ _ shifting from town to town. _ _
Db No job can hold me down, I'm just a knockGm around guy.
_ _ _ _ _ [Bb] till I find my place there's no doubt.
_ [Eb] _ [Gb] I'll [Bb] be a rovingEb roster pal


You may also like
Jason Isbell "Mutineer"
3:10`;

        const result = cleanChordUPaste(chordUPaste);

        expect(result.cleaned).toBe(true);
        expect(result.title).toBe('Roustabout');

        // Should stop before "You may also like"
        expect(result.text).not.toContain('You may also like');
        expect(result.text).not.toContain('Jason Isbell');

        // Should have song content
        expect(result.text).toContain("I'm just a roster pal");
        expect(result.text).toContain('rovingEb roster pal');
    });

    it('returns unchanged for non-ChordU content', () => {
        const regularText = `[Verse 1]
[G]This is a [C]regular song
With [D]some chords`;

        const result = cleanChordUPaste(regularText);

        expect(result.cleaned).toBe(false);
        expect(result.text).toBe(regularText);
        expect(result.title).toBeNull();
        expect(result.artist).toBeNull();
    });

    it('returns uncleaned if Traditional marker not found', () => {
        const incompletePaste = `ChordU
Find chords for tracks u love

Chords for Some Song "Title"
Just some random content without the Traditional marker`;

        const result = cleanChordUPaste(incompletePaste);

        expect(result.cleaned).toBe(false);
        expect(result.title).toBe('Title');
        expect(result.artist).toBe('Some Song');
    });
});

describe('cleanUltimateGuitarPaste', () => {
    it('detects and cleans Ultimate Guitar paste', () => {
        const ugPaste = `Tabs
Courses
Songbooks
Articles
Forums
Publish tab
Pro+
Enter artist name or song title
Old Home Place Chords by J.D. Crowe & The New South
102,226 views5,578 saves6 comments
Author: michaeldgoodwin [a] 444Difficulty: beginner
Speed: 0.2
Transpose
Tuning: E A D G B EKey: BbCapo:
Artist:  J.D. Crowe and the New South
Song:  Old Home Place

[Intro]
G B7 C G
G    D
G B7 C G
G D  G

[Verse 1]
           G        B7         C          G
It's been ten long years since I left my home
                           D
In the holler where I was born
           G         B7              C          G
Where the cool fall nights make the wood smoke rise
                     D        G
And the fox hunter blows his horn

   G       B7          C             G
I fell in love with a girl from the town
                              D
I thought that she would be true
   G    B7      C        G
I ran away to Charlottesville
                 D           G
And worked in a sawmill or two

[Chorus]
       D                        G
     What have they done to the old home place?
       A7                  D7
     Why did they tear it down?
           G        B7        C          G
     And why did I leave my plow in the field?
                     D          G
     And look for a job in the town?

[Interlude]
G B7 C G
G    D
X
Last update: Oct 16, 2023
Rating
4.9
315 rates
Please, rate this tab
Welcome Offer

75% Off

Chords
Guitar
Ukulele
Piano
G
B7
C
D
A7
D7
Strumming pattern`;

        const result = cleanUltimateGuitarPaste(ugPaste);

        expect(result.cleaned).toBe(true);
        expect(result.title).toBe('Old Home Place');
        expect(result.artist).toBe('J.D. Crowe & The New South');

        // Should remove header cruft
        expect(result.text).not.toContain('Tabs\n');
        expect(result.text).not.toContain('Courses');
        expect(result.text).not.toContain('102,226 views');
        expect(result.text).not.toContain('Author:');

        // Should remove footer cruft
        expect(result.text).not.toContain('Last update:');
        expect(result.text).not.toContain('Rating');
        expect(result.text).not.toContain('Please, rate this tab');

        // Should preserve song content
        expect(result.text).toContain('[Intro]');
        expect(result.text).toContain('[Verse 1]');
        expect(result.text).toContain('[Chorus]');
        expect(result.text).toContain("It's been ten long years since I left my home");
        expect(result.text).toContain('What have they done to the old home place');
    });

    it('returns unchanged for non-UG content', () => {
        const regularText = `[Verse 1]
[G]This is a [C]regular song
With [D]some chords`;

        const result = cleanUltimateGuitarPaste(regularText);

        expect(result.cleaned).toBe(false);
        expect(result.text).toBe(regularText);
        expect(result.title).toBeNull();
        expect(result.artist).toBeNull();
    });
});

describe('editorConvertToChordPro', () => {
    it('converts chord-above-lyrics format to ChordPro', () => {
        const chordSheet = `[Verse 1]
G       C        D
I want to hold your hand
G       C        D
And never let it go`;

        const result = editorConvertToChordPro(chordSheet);

        // Should have inline chords
        expect(result).toContain('[G]');
        expect(result).toContain('[C]');
        expect(result).toContain('[D]');
        // Lyrics are preserved (chords may be embedded within words)
        expect(result).toContain('I want');
        expect(result).toContain('hand');
        expect(result).toContain('go');
    });

    it('handles section markers', () => {
        const text = `[Verse 1]
G       C
Hello world

[Chorus]
D       G
Sing along`;

        const result = editorConvertToChordPro(text);

        expect(result).toContain('{sov: Verse 1}');
        expect(result).toContain('{soc}');
    });
});
