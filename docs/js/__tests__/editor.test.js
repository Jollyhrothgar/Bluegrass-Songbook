// Unit tests for editor.js paste handlers
import { describe, it, expect } from 'vitest';
import { cleanChordUPaste, cleanUltimateGuitarPaste, editorConvertToChordPro } from '../editor.js';

describe('cleanChordUPaste', () => {
    it('detects and cleans ChordU paste', () => {
        const chordUPaste = `ChordU
Find chords for tracks u love

Chords for John Cowan "King Of California"
Tempo:
120.8 bpm
Chords used:FBbDmAmC
Tuning:Standard Tuning (EADGBE)Capo:+0fret
[Ab] [C]
[F]
I left my home and one true love East of the Ohio [Dm] River
[F] her father said we could never wed For I had neither gold [Dm] nor the silver
[Am] my darling dear, [Bb] please listen dear Cause [F] I think [C] it's fair [D] now to [F] warn you
[Bb] That I'll return [Dm] to claim your hand [F]
As [Am] a king [Bb] of
[F] California

100%  ➙
121
BPM


F, 0 Transpose ➙ Chords: F , Bb , Dm , Am , C
F
1
3
4
2
1
1
1
1
1
Bb
1
2
3
4
1
1
1
1
guitar
piano
ukulele
mandolin
banjo
bass

Show All Diagrams`;

        const result = cleanChordUPaste(chordUPaste);

        expect(result.cleaned).toBe(true);
        expect(result.title).toBe('King Of California');
        expect(result.artist).toBe('John Cowan');

        // Should remove header cruft
        expect(result.text).not.toContain('ChordU');
        expect(result.text).not.toContain('Find chords for tracks u love');
        expect(result.text).not.toContain('Tempo:');
        expect(result.text).not.toContain('Chords used:');
        expect(result.text).not.toContain('Tuning:');

        // Should remove footer cruft
        expect(result.text).not.toContain('guitar');
        expect(result.text).not.toContain('piano');
        expect(result.text).not.toContain('Show All Diagrams');
        expect(result.text).not.toContain('BPM');
        expect(result.text).not.toContain('Transpose');

        // Should preserve song content with chords
        expect(result.text).toContain('[F]');
        expect(result.text).toContain('[Dm]');
        expect(result.text).toContain('I left my home and one true love');
        expect(result.text).toContain('California');
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
G B7 C G
G D  G

[Verse 2]
           G       B7        C       G
Well, the girl ran off with somebody else
                         D
The tariffs took all my pay
     G       B7            C          G
And here I stand where the old home stood
             D        G
Before they took it away

         G         B7            C          G
Now the geese fly south and the cold wind blows
                             D
As I stand here and hang my head
      G       B7         C       G
I've lost my love, I've lost my home
           D               G
And now I wish that I was dead

[Chorus]
       D                        G
     What have they done to the old home place?
       A7                  D7
     Why did they tear it down?
           G        B7        C          G
     And why did I leave my plow in the field?
                     D          G
     And look for a job in the town?
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
Strumming pattern
Edit
Whole 245 bpm
1

&

2

&

3

&

4

&

Seen recently
Tom Petty Album Cover
Runnin Down A Dream • Ver 1
Tom Petty
4.8
(2,142)
Blue & Lonesome Album Cover
Roustabout • Ver 1
Blue & Lonesome
© 2026
Ultimate-Guitar.com
All rights reserved`;

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
        expect(result.text).not.toContain('Ultimate-Guitar.com');
        expect(result.text).not.toContain('Seen recently');

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
