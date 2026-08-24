// Tests for partitionWanted in bounty-view.js — the filter that stops the
// board advertising songs the book already has.
import { describe, it, expect } from 'vitest';
import { partitionWanted } from '../bounty-view.js';

const CORPUS = [
    { id: 'will-the-circle-be-unbroken', title: 'Will The Circle Be Unbroken', chord_count: 3, has_content: true },
    { id: 'make-me-a-pallet-on-the-floor', title: 'Make Me a Pallet on the Floor', chord_count: 5, has_content: true },
    { id: 'carpet-on-the-floor', title: 'Carpet On The Floor', chord_count: 3, has_content: true },
    { id: '900-miles', title: '900 Miles', chord_count: 3, has_content: true },
    { id: 'sally-ann', title: 'Sally Ann', chord_count: 0, has_content: true },
    { id: 'shady-grove', title: 'Shady Grove', chord_count: 4, has_content: true },
];

// Shape emitted by scripts/lib/bounty_decisions.py.
const VERDICTS = {
    covered: {
        'Can the Circle Be Unbroken (By and By)': { work: 'will-the-circle-be-unbroken', chords: 3, archived: false },
        'Pallet on the Floor': { work: 'make-me-a-pallet-on-the-floor', chords: 5, archived: false },
        'Sally Ann via Tommy Jarrell, mostly 1 & 4': { work: 'sally-ann', chords: 0, archived: false },
        'Come All Ye Tenderhearted': { work: 'come-all-you-tender-hearted', chords: 3, archived: true },
    },
    not_a_song: ['Band Introductions', 'Talk'],
    types: { 'Flatbush Waltz': 'Instrumental' },
};

const titles = list => list.map(s => s.title);

describe('partitionWanted', () => {
    // The two entries that prompted this whole pass. If either ever renders
    // again, the regression is exactly the one Mike reported.
    it('drops Can the Circle and Pallet on the Floor', () => {
        const wanted = [
            { title: 'Can the Circle Be Unbroken (By and By)', type: 'Vocal' },
            { title: 'Pallet on the Floor', type: 'Vocal' },
            { title: 'Cripple Creek', type: 'Instrumental' },
        ];
        const { missing } = partitionWanted(wanted, CORPUS, VERDICTS);
        expect(titles(missing)).toEqual(['Cripple Creek']);
    });

    it('keeps songs the ledger marked distinct despite close titles', () => {
        // 500 Miles scores 0.89 against 900 Miles and is a different song.
        const wanted = [{ title: '500 Miles', type: 'Vocal' }];
        const { missing } = partitionWanted(wanted, CORPUS, VERDICTS);
        expect(titles(missing)).toEqual(['500 Miles']);
    });

    it('drops catalog artifacts', () => {
        const wanted = [
            { title: 'Band Introductions', type: 'Vocal' },
            { title: 'Talk', type: 'Vocal' },
            { title: 'Blackberry Blossom', type: 'Instrumental' },
        ];
        const { missing, stats } = partitionWanted(wanted, CORPUS, VERDICTS);
        expect(titles(missing)).toEqual(['Blackberry Blossom']);
        expect(stats.junk).toBe(2);
    });

    it('counts a lyrics-only match separately — it belongs in Needs Chords', () => {
        const wanted = [{ title: 'Sally Ann via Tommy Jarrell, mostly 1 & 4', type: 'Vocal' }];
        const { missing, stats } = partitionWanted(wanted, CORPUS, VERDICTS);
        expect(missing).toEqual([]);
        expect(stats.lyricsOnly).toBe(1);
    });

    it('self-heals: drops an entry that matches the corpus but has no verdict', () => {
        // Simulates a contribution landing in pending_songs after the last build.
        const wanted = [{ title: 'Shady Grove', type: 'Vocal' }];
        const { missing, stats } = partitionWanted(wanted, CORPUS, VERDICTS);
        expect(missing).toEqual([]);
        expect(stats.liveMatch).toBe(1);
        expect(stats.adjudicated).toBe(0);
    });

    it('does not self-heal on a near miss', () => {
        // "Carpet On The Floor" is in the corpus; "Pallet on the Floor" without
        // a verdict must still render rather than being auto-matched to it.
        const wanted = [{ title: 'Pallet on the Floor', type: 'Vocal' }];
        const { missing } = partitionWanted(wanted, CORPUS, { covered: {}, not_a_song: [], types: {} });
        expect(titles(missing)).toEqual(['Pallet on the Floor']);
    });

    it('applies type corrections to surviving entries', () => {
        const wanted = [{ title: 'Flatbush Waltz', type: 'Vocal' }];
        const { missing } = partitionWanted(wanted, CORPUS, VERDICTS);
        expect(missing[0].type).toBe('Instrumental');
        // Original object is not mutated.
        expect(wanted[0].type).toBe('Vocal');
    });

    it('renders everything when no verdicts are loaded', () => {
        const wanted = [
            { title: 'Can the Circle Be Unbroken (By and By)', type: 'Vocal' },
            { title: 'Cripple Creek', type: 'Instrumental' },
        ];
        const { missing } = partitionWanted(wanted, [], { covered: {}, not_a_song: [], types: {} });
        expect(missing).toHaveLength(2);
    });

    it('routes a placeholder match to the Started section, not Missing', () => {
        // A placeholder is still a bounty, but "Started — Needs Content"
        // already asks for it. Listing it in both places is the double-count.
        const wanted = [{ title: 'Cripple Creek', type: 'Instrumental' }];
        const withPlaceholder = [...CORPUS, { id: 'cripple-creek', title: 'Cripple Creek', status: 'placeholder' }];
        const { missing, stats } = partitionWanted(wanted, withPlaceholder, VERDICTS);
        expect(missing).toEqual([]);
        expect(stats.started).toBe(1);
        expect(stats.liveMatch).toBe(0);
    });
});
