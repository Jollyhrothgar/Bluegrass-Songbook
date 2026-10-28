// @vitest-environment node
// Scores syllabify() against where real charts put chords INSIDE words.
// Fixture: ./scripts/build-syllable-corpus (works/*/lead-sheet.pro).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { syllabify } from '../visual-editor/syllables.js';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/syllable-corpus.json', import.meta.url), 'utf8'));
const seamsOf = (w) => { const s = new Set(); let o = 0; for (const p of syllabify(w)) { if (o) s.add(o); o += p.length; } return s; };
const dots = (w) => syllabify(w).join('·');

const ONE_SYLLABLE = ('home love time there where make life give one like have come gone some mine made more take ' +
    "here were are place once please leave live cause lord heart night world through eyes gave smile tired loved lived " +
    'arms tears dreams mind the and you your my me to of in is it for with that all but not what when they will ' +
    'been said down time rose rain blue true').split(' ');

describe('syllabify against the corpus', () => {
    it('matches human in-word chord placements at 71% or better (count-weighted)', () => {
        let hit = 0, total = 0;
        for (const [w, off, n] of corpus.placements) { total += n; if (seamsOf(w).has(off)) hit += n; }
        const rate = hit / total;
        console.log(`syllable match rate: ${(100 * rate).toFixed(2)}% of ${total} chords`);
        expect(rate).toBeGreaterThanOrEqual(0.71);
    });
    it('every frequent lyric word reconstructs', () => {
        for (const w of corpus.words) expect(syllabify(w).join('')).toBe(w);
    });
    it.each(ONE_SYLLABLE)('does not split the one-syllable word %s', (w) => {
        expect(syllabify(w)).toEqual([w]);
    });
    it.each([
        ['forever', 'for·ev·er'], ['everything', 'every·thing'], ['without', 'with·out'],
        ['someone', 'some·one'], ['away', 'a·way'], ['again', 'a·gain'], ['tonight', 'to·night'],
        ['every', 'ev·ery'], ['lonesome', 'lone·some'], ['hollow', 'hol·low'], ['evening', 'eve·ning'],
        ['amazing', 'a·maz·ing'], ['over', 'o·ver'], ['tomorrow', 'to·mor·row'], ['together', 'to·geth·er'],
        ['angel', 'an·gel'], ['only', 'on·ly'],
    ])('splits %s as %s', (w, want) => {
        expect(dots(w)).toBe(want);
    });
    it('keeps case, apostrophes and the join invariant', () => {
        for (const w of ["Away", "lovin'", "you're", "i've", "ain't", "Don't", "o'er", "'cause", 'spring-time']) {
            expect(syllabify(w).join('')).toBe(w);
        }
        expect(dots('Away')).toBe('A·way');
        expect(syllabify("you're")).toEqual(["you're"]);
        expect(syllabify("i've")).toEqual(["i've"]);
    });
});
