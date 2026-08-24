// Unit tests for title-match.js — the narrowing matcher behind the bounty board.
import { describe, it, expect } from 'vitest';
import {
    stripAnnotation,
    normalizeTitle,
    tokenBag,
    matchTier,
    findAutoMatches,
    buildTitleIndex,
} from '../title-match.js';

describe('stripAnnotation', () => {
    it('drops Strum Machine arrangement and performer suffixes', () => {
        expect(stripAnnotation('Sally Ann via Tommy Jarrell, mostly 1 & 4')).toBe('Sally Ann');
        expect(stripAnnotation('Sweet Sunny South modal')).toBe('Sweet Sunny South');
        expect(stripAnnotation('Cotton-Eyed Joe 16 bars')).toBe('Cotton-Eyed Joe');
        expect(stripAnnotation('More Pretty Girls Than One w/minor')).toBe('More Pretty Girls Than One');
        expect(stripAnnotation('Talk to Your Heart 4/4 time')).toBe('Talk to Your Heart');
    });

    it('leaves titles that merely contain those words alone', () => {
        expect(stripAnnotation('Minor Swing')).toBe('Minor Swing');
        expect(stripAnnotation('Major Bowes')).toBe('Major Bowes');
    });
});

describe('normalizeTitle', () => {
    it('folds accents, case, and punctuation', () => {
        expect(normalizeTitle('Señor')).toBe('senor');
        expect(normalizeTitle("Walkin’ In My Sleep")).toBe('walkin in my sleep');
        expect(normalizeTitle('St. James Infirmary')).toBe('st james infirmary');
    });

    it('normalizes articles at both ends', () => {
        // The wanted list carries the trailing form; the corpus carries the leading one.
        expect(normalizeTitle('Bluest Man in Town, The')).toBe('bluest man in town');
        expect(normalizeTitle('The Bluest Man In Town')).toBe('bluest man in town');
        expect(normalizeTitle('Last Song, The')).toBe('last song');
    });

    it('drops parentheticals but keeps interior articles', () => {
        // Interior articles stay so the result still matches the corpus title
        // verbatim — only leading/trailing ones are positional noise.
        expect(normalizeTitle('Quinn the Eskimo (The Mighty Quinn)')).toBe('quinn the eskimo');
        expect(normalizeTitle('Quinn the Eskimo')).toBe('quinn the eskimo');
    });

    it('expands ampersands', () => {
        expect(normalizeTitle('Jim & Jesse')).toBe('jim and jesse');
    });
});

describe('tokenBag', () => {
    it('drops stopwords so word-order variants collide', () => {
        expect([...tokenBag('Pallet on the Floor')].sort()).toEqual(['floor', 'pallet']);
        expect([...tokenBag('Pallet on Your Floor')].sort()).toEqual(['floor', 'pallet']);
    });
});

describe('matchTier', () => {
    it('reports exact for identical normalized titles', () => {
        expect(matchTier('Adieu False Heart via Dirk Powell', 'Adieu False Heart')).toBe('exact');
        expect(matchTier('Bluest Man in Town, The', 'The Bluest Man In Town')).toBe('exact');
    });

    it('reports token-set for word-order and possessive variants', () => {
        expect(matchTier('Pallet on the Floor', 'Pallet on Your Floor')).toBe('token-set');
    });

    // The whole point of the module: it must NOT auto-resolve the pairs that
    // fuzzy scoring gets wrong. These all sit in the 0.80-0.93 band.
    it.each([
        ['500 Miles', '900 Miles'],
        ['Foggy Mountain Rock', 'Foggy Mountain Top'],
        ['New Camptown Races', 'Camptown Races'],
        ['Pallet on the Floor', 'Carpet On The Floor'],
        ['Maid Behind the Bar', 'The Girl Behind The Bar'],
        ['Sweet Thing', 'Sweet Thang'],
        ['Bill Cheatum', 'Bill Cheatham'],
        ['Can the Circle Be Unbroken (By and By)', 'Will The Circle Be Unbroken'],
    ])('refuses to auto-resolve %s / %s', (a, b) => {
        expect(matchTier(a, b)).toBeNull();
    });

    it('needs two real tokens before trusting a token-set match', () => {
        // Both reduce to the single token {floor}. Without the guard this
        // would report token-set and silently retire a real bounty.
        expect(matchTier('On the Floor', 'Floor')).toBeNull();
        // Two tokens is enough, in any order.
        expect(matchTier('Rose of the Mountain', 'Mountain Rose')).toBe('token-set');
    });

    it('handles empty and missing input', () => {
        expect(matchTier('', 'Anything')).toBeNull();
        expect(matchTier(null, undefined)).toBeNull();
    });
});

describe('findAutoMatches', () => {
    const corpus = [
        { id: 'make-me-a-pallet-on-the-floor', title: 'Make Me a Pallet on the Floor', chord_count: 5 },
        { id: 'pallet-on-your-floor', title: 'Pallet on Your Floor', chord_count: 2 },
        { id: 'carpet-on-the-floor', title: 'Carpet On The Floor', chord_count: 3 },
    ];

    it('returns every candidate, not just the best-scoring one', () => {
        const hits = findAutoMatches('Pallet on the Floor', corpus);
        expect(hits.map(h => h.id)).toEqual(['pallet-on-your-floor']);
        // Carpet must never surface here — ranking by ratio put it first.
        expect(hits.some(h => h.id === 'carpet-on-the-floor')).toBe(false);
    });

    it('tolerates rows without titles', () => {
        expect(findAutoMatches('Anything', [null, {}, { title: '' }])).toEqual([]);
    });
});

describe('buildTitleIndex', () => {
    it('groups corpus rows by normalized title', () => {
        const idx = buildTitleIndex([
            { id: 'a', title: 'Shady Grove' },
            { id: 'b', title: 'shady grove' },
            { id: 'c', title: 'Cripple Creek' },
        ]);
        expect(idx.get('shady grove').map(s => s.id)).toEqual(['a', 'b']);
        expect(idx.get('cripple creek').map(s => s.id)).toEqual(['c']);
    });
});
