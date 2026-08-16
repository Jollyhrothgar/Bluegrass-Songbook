// Phase 3b: the client half of the dedup offramp.
//
// Two things are worth guarding here and nothing else:
//
// 1. **Parity with the Python scorer.** `docs/js/dedup-check.js` and
//    `scripts/lib/dedup_scorer.py` are the same scorer at two moments, so the
//    numbers are asserted against the SAME fixture texts the Python tests use
//    (`tests/fixtures/dedup/`, provenance documented in
//    `tests/test_dedup_scorer.py`). The `how-long-blues` pair is the real
//    issue-#208 miss: a lyrics-only scrape and the same song submitted with
//    chords, which the old matcher scored 0.043 against a 0.5 threshold.
//    If a threshold moves on one side and not the other, a user is offered
//    one story and gets another — so these tests exist to break.
//
// 2. **The decision mapping.** Which buttons are offered, and what each one
//    does to the submission. That logic is pure and exported precisely so it
//    can be tested without a DOM.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
    CONTAINMENT_DUPLICATE,
    CONTAINMENT_MATCH,
    Choice,
    Outcome,
    Warning,
    chordproLyricWords,
    containment,
    findLikelyMatch,
    hasChords,
    lyricWords,
    makeChart,
    matchPercent,
    narrowCandidates,
    normalizeTitle,
    offrampChoices,
    planForChoice,
    ratio,
    scorePair,
    shouldOffer,
    titleSimilarity,
} from '../dedup-check.js';

const FIXTURES = resolve(__dirname, '../../../tests/fixtures/dedup');
const fixture = (name) => readFileSync(resolve(FIXTURES, `${name}.pro`), 'utf-8');

const HOW_LONG_SCRAPE = fixture('how-long-blues');      // lyrics only
const HOW_LONG_SUBMITTED = fixture('how-long-blues-1'); // same song, with chords
const I_WALK_ALONE = fixture('i-walk-alone');
const I_WALK_THE_LINE = fixture('i-walk-the-line');
const GOOD_HEARTED_WOMAN = fixture('good-hearted-woman');
const GOOD_HEARTED_MAN = fixture('good-hearted-man');
const BLACKBERRY_ABC = fixture('blackberry-blossom-abc');
const BLACKBERRY_CHORDS = fixture('blackberry-blossom-chords');

describe('normalization', () => {
    it('strips articles, parentheticals and punctuation from titles', () => {
        expect(normalizeTitle('The Long Black Veil')).toBe('long black veil');
        expect(normalizeTitle('Blackberry Blossom (Live)')).toBe('blackberry blossom');
        expect(normalizeTitle("Ain't Misbehavin'")).toBe('aint misbehavin');
        expect(normalizeTitle('How Long Blues Lyrics and Chords')).toBe('how long blues');
        expect(normalizeTitle('St. Anne’s Reel')).toBe('saint annes reel');
    });

    it('folds non-ASCII the way Python encode(ascii, ignore) does', () => {
        // The bluegrasslyrics scrape is full of curly apostrophes.
        expect([...lyricWords('can’t')]).toEqual(['cant']);
        expect(normalizeTitle('Café')).toBe('cafe');
    });

    it('reads chord presence, not bracket presence', () => {
        expect(hasChords('[G]Blue moon')).toBe(true);
        expect(hasChords('[Verse 1]\nno chords here')).toBe(false);
        expect(hasChords('[x2]')).toBe(false);
        expect(hasChords('{comment: [G] in a directive}')).toBe(false);
        expect(hasChords(HOW_LONG_SCRAPE)).toBe(false);
        expect(hasChords(HOW_LONG_SUBMITTED)).toBe(true);
    });

    it('drops directives, chords, comments and ABC from the word set', () => {
        const words = chordproLyricWords([
            '{meta: title Ignored}',
            '# a comment, also ignored',
            '[G]Real [C]lyrics here',
            '{start_of_abc}',
            'X:1 T:Not Lyrics',
            '{end_of_abc}',
        ].join('\n'));
        expect([...words].sort()).toEqual(['here', 'lyrics', 'real']);
    });
});

describe('difflib ratio parity', () => {
    // Values taken from Python: difflib.SequenceMatcher(None, a, b).ratio()
    it('matches SequenceMatcher on the strings title narrowing uses', () => {
        expect(ratio('abcd', 'abcd')).toBeCloseTo(1.0, 10);
        expect(ratio('', '')).toBe(1);
        expect(ratio('abc', 'xyz')).toBeCloseTo(0.0, 10);
        expect(ratio('i walk alone', 'i walk line')).toBeCloseTo(0.8695652173913043, 12);
        expect(ratio('good hearted woman', 'good hearted man')).toBeCloseTo(0.9411764705882353, 12);
        expect(ratio('how long blues', 'how long blues lyrics and chords'))
            .toBeCloseTo(0.6086956521739131, 12);
    });

    it('short-circuits identical and empty titles', () => {
        expect(titleSimilarity('The Long Black Veil', 'Long Black Veil')).toBe(1);
        expect(titleSimilarity('', 'anything')).toBe(0);
    });
});

describe('the #208 pair', () => {
    const scrape = makeChart(HOW_LONG_SCRAPE, { title: 'How Long Blues', id: 'how-long-blues' });
    const submitted = makeChart(HOW_LONG_SUBMITTED, { title: 'How Long Blues', id: 'how-long-blues-1' });

    it('scores 0.886 containment — the number the Python scorer reports', () => {
        expect(containment(submitted.words, scrape.words)).toBeCloseTo(0.886, 3);
    });

    it('calls the richer submission an enrichment of the sparser work', () => {
        const verdict = scorePair(submitted, scrape);
        expect(verdict.outcome).toBe(Outcome.ENRICH);
        // Rounded exactly as MatchVerdict does, so the two sides report the
        // same number as well as reaching the same conclusion.
        expect(verdict.score).toBe(0.8857);
        expect(verdict.matchedId).toBe('how-long-blues');
        expect(verdict.autoActionable).toBe(true);
        expect(verdict.lowConfidence).toBe(false);
        expect(verdict.score).toBeGreaterThanOrEqual(CONTAINMENT_DUPLICATE);
        expect(verdict.details.sizeRatio).toBeCloseTo(0.7955, 3);
    });

    it('calls the reverse a duplicate, and never auto-actionable', () => {
        const verdict = scorePair(scrape, submitted);
        expect(verdict.outcome).toBe(Outcome.DUPLICATE);
        expect(verdict.autoActionable).toBe(false);
    });

    it('is worth interrupting a submission for', () => {
        expect(shouldOffer(scorePair(submitted, scrape))).toBe(true);
        expect(matchPercent(scorePair(submitted, scrape))).toBe(89);
    });
});

describe('the known false positives stay below threshold', () => {
    it('I Walk Alone is not I Walk The Line', () => {
        const verdict = scorePair(
            makeChart(I_WALK_ALONE, { title: 'I Walk Alone', id: 'i-walk-alone' }),
            makeChart(I_WALK_THE_LINE, { title: 'I Walk The Line', id: 'i-walk-the-line' }));
        expect(verdict.score).toBeLessThan(CONTAINMENT_MATCH);
        expect(verdict.outcome).toBe(Outcome.NO_MATCH);
        expect(shouldOffer(verdict)).toBe(false);
    });

    it('Good Hearted Woman is not Good Hearted Man', () => {
        const verdict = scorePair(
            makeChart(GOOD_HEARTED_WOMAN, { title: 'Good Hearted Woman', id: 'a' }),
            makeChart(GOOD_HEARTED_MAN, { title: 'Good Hearted Man', id: 'b' }));
        expect(verdict.score).toBeLessThan(CONTAINMENT_MATCH);
        expect(verdict.outcome).toBe(Outcome.NO_MATCH);
    });
});

describe('instrumentals', () => {
    it('never decide on lyrics they do not have, and never interrupt', () => {
        const verdict = scorePair(
            makeChart(BLACKBERRY_CHORDS, { title: 'Blackberry Blossom', id: 'bb-1' }),
            makeChart(BLACKBERRY_ABC, { title: 'Blackberry Blossom', id: 'bb' }));

        expect(verdict.lowConfidence).toBe(true);
        expect(verdict.autoActionable).toBe(false);
        expect(verdict.score).toBe(0);
        expect(verdict.warnings).toContain(Warning.NO_LYRICS);
        // Identical titles, so it IS named as a candidate — but the modal
        // must not fire on it. "0% of its lyrics match" helps nobody.
        expect(verdict.outcome).toBe(Outcome.ARRANGEMENT_CANDIDATE);
        expect(shouldOffer(verdict)).toBe(false);
    });
});

describe('candidate narrowing', () => {
    const corpus = [
        { id: 'how-long-blues', title: 'How Long Blues' },
        { id: 'how-long-blues-lyrics', title: 'How Long Blues Lyrics and Chords' },
        { id: 'long-black-veil', title: 'The Long Black Veil' },
        { id: 'blue-moon-of-kentucky', title: 'Blue Moon of Kentucky' },
        { id: 'no-title', title: '' },
    ];

    it('keeps same-song titles and drops unrelated ones', () => {
        const ids = narrowCandidates('How Long Blues', corpus).map(c => c.song.id);
        expect(ids).toContain('how-long-blues');
        expect(ids).toContain('how-long-blues-lyrics');
        expect(ids).not.toContain('blue-moon-of-kentucky');
        expect(ids).not.toContain('no-title');
    });

    it('honours the limit and the exclude set', () => {
        expect(narrowCandidates('How Long Blues', corpus, { limit: 1 })).toHaveLength(1);
        const ids = narrowCandidates('How Long Blues', corpus, {
            exclude: new Set(['how-long-blues']),
        }).map(c => c.song.id);
        expect(ids).not.toContain('how-long-blues');
    });

    it('returns nothing for an unusable title', () => {
        expect(narrowCandidates('', corpus)).toEqual([]);
        expect(narrowCandidates('The A An', corpus)).toEqual([]);
    });
});

describe('findLikelyMatch', () => {
    const corpus = [
        { id: 'how-long-blues', title: 'How Long Blues', has_content: true },
        { id: 'i-walk-the-line', title: 'I Walk The Line', has_content: true },
    ];
    const content = {
        'how-long-blues': HOW_LONG_SCRAPE,
        'i-walk-the-line': I_WALK_THE_LINE,
    };
    const fetchContent = async (song) => content[song.id] ?? '';

    it('finds the sparse work a richer submission should enrich', async () => {
        const match = await findLikelyMatch({
            title: 'How Long Blues',
            content: HOW_LONG_SUBMITTED,
            songs: corpus,
            fetchContent,
        });

        expect(match).not.toBeNull();
        expect(match.song.id).toBe('how-long-blues');
        expect(match.verdict.outcome).toBe(Outcome.ENRICH);
    });

    it('shows no modal for a song the corpus does not have', async () => {
        const match = await findLikelyMatch({
            title: 'I Walk Alone',
            content: I_WALK_ALONE,
            songs: corpus,
            fetchContent,
        });
        // Title-narrows onto "I Walk The Line", scores it, rejects it.
        expect(match).toBeNull();
    });

    it('shows no modal when nothing even narrows', async () => {
        const calls = [];
        const match = await findLikelyMatch({
            title: 'Some Song Nobody Has Written',
            content: HOW_LONG_SUBMITTED,
            songs: corpus,
            fetchContent: async (song) => { calls.push(song.id); return ''; },
        });
        expect(match).toBeNull();
        // Zero added friction: not one content fetch on the common path.
        expect(calls).toEqual([]);
    });

    it('survives a candidate whose content will not load', async () => {
        const match = await findLikelyMatch({
            title: 'How Long Blues',
            content: HOW_LONG_SUBMITTED,
            songs: corpus,
            fetchContent: async () => { throw new Error('offline'); },
        });
        expect(match).toBeNull();
    });
});

describe('the offer', () => {
    const enrichMatch = {
        song: { id: 'how-long-blues', title: 'How Long Blues', indexed: true },
        verdict: scorePair(
            makeChart(HOW_LONG_SUBMITTED, { title: 'How Long Blues' }),
            makeChart(HOW_LONG_SCRAPE, { title: 'How Long Blues', id: 'how-long-blues' })),
    };
    const ids = (match, opts) => offrampChoices(match, opts).map(c => c.id);

    it('always offers the user override', () => {
        expect(ids(enrichMatch)).toContain(Choice.NEW);
        expect(ids(enrichMatch, { trusted: true })).toContain(Choice.NEW);
    });

    it('leads with enrichment when that is what the scorer found', () => {
        const choices = offrampChoices(enrichMatch);
        expect(choices[0].id).toBe(Choice.ENRICH);
        expect(choices[0].primary).toBe(true);
        expect(choices[0].label).toMatch(/chords/i);
    });

    it('offers promote only for an archived match, and only to a trusted user', () => {
        const archived = { ...enrichMatch, song: { ...enrichMatch.song, indexed: false } };
        expect(ids(archived, { trusted: true })).toContain(Choice.PROMOTE);
        expect(ids(archived, { trusted: false })).not.toContain(Choice.PROMOTE);
        expect(ids(enrichMatch, { trusted: true })).not.toContain(Choice.PROMOTE);
    });

    it('offers nothing at all without a match', () => {
        expect(offrampChoices(null)).toEqual([]);
    });
});

describe('what each choice does', () => {
    const match = { song: { id: 'how-long-blues', title: 'How Long Blues' } };

    it('enrich and arrangement are the same retarget, said differently', () => {
        const enrich = planForChoice(Choice.ENRICH, match);
        const arrangement = planForChoice(Choice.ARRANGEMENT, match);

        expect(enrich.submit).toBe(true);
        expect(enrich.retargetId).toBe('how-long-blues');
        expect(arrangement.retargetId).toBe(enrich.retargetId);
        expect(arrangement.intent).not.toBe(enrich.intent);
    });

    it('promote retargets too, but promotes first', () => {
        const plan = planForChoice(Choice.PROMOTE, match);
        expect(plan.promoteFirst).toBe(true);
        expect(plan.retargetId).toBe('how-long-blues');
        expect(plan.submit).toBe(true);
    });

    it('view submits nothing and sends the user to the work', () => {
        const plan = planForChoice(Choice.VIEW, match);
        expect(plan.submit).toBe(false);
        expect(plan.retargetId).toBeNull();
        expect(plan.navigateTo).toBe('#work/how-long-blues');
    });

    it('"different song" submits as new, untouched', () => {
        const plan = planForChoice(Choice.NEW, match);
        expect(plan.submit).toBe(true);
        expect(plan.retargetId).toBeNull();
        expect(plan.promoteFirst).toBe(false);
    });

    it('an unknown choice falls back to the safe one', () => {
        expect(planForChoice('nonsense', match).retargetId).toBeNull();
    });
});
