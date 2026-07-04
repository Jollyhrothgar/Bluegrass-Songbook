// Tests for ts-aware measure math (measure-timing.js).
//
// This module is the single source of truth for per-measure time
// signatures (OTF metadata.time_signature_changes) shared by the
// renderer, the player, and (eventually) the editing facade.
//
// Ground truths from the oracle-verified corpus:
// - 22456: 4/4 tune, measure 1 is a 3/4 pickup  -> changes [{measure:1, '3/4'}]
// - 18926: 4/4 tune, measure 1 is a 1/4 pickup  -> changes [{measure:1, '1/4'}]
// - 27493: 2/2 (V3) tune, 2/4 measures at 30/49 -> changes [{30,'2/4'},{49,'2/4'}]
//   1920 ticks per 2/2 measure (banjo has notes at tick 1800).

import { describe, it, expect } from 'vitest';
import {
    parseTimeSignature,
    measureTicksFor,
    MeasureTiming,
    identityTimeline,
    readingListTimeline,
    TimelineTiming,
    expandNotation,
    makePlaybackToVisualMapper,
    buildMetronomeSchedule,
    analyzeReadingList,
    prepareCompactNotation,
} from '../renderers/measure-timing.js';

describe('parseTimeSignature', () => {
    it('parses num/den', () => {
        expect(parseTimeSignature('3/4')).toEqual({ num: 3, den: 4 });
        expect(parseTimeSignature('2/2')).toEqual({ num: 2, den: 2 });
        expect(parseTimeSignature('6/8')).toEqual({ num: 6, den: 8 });
    });
    it('falls back to 4/4 on garbage', () => {
        expect(parseTimeSignature(undefined)).toEqual({ num: 4, den: 4 });
        expect(parseTimeSignature('')).toEqual({ num: 4, den: 4 });
        expect(parseTimeSignature('waltz')).toEqual({ num: 4, den: 4 });
        expect(parseTimeSignature('0/0')).toEqual({ num: 4, den: 4 });
    });
});

describe('measureTicksFor', () => {
    // ticksPerBeat is per QUARTER note (480 default); a whole note is 4*480.
    it('handles denominator, not just numerator', () => {
        expect(measureTicksFor('4/4', 480)).toBe(1920);
        expect(measureTicksFor('3/4', 480)).toBe(1440);
        expect(measureTicksFor('2/4', 480)).toBe(960);
        expect(measureTicksFor('1/4', 480)).toBe(480);
        // The old numerator*480 math gave 960 for 2/2 — half the real length.
        expect(measureTicksFor('2/2', 480)).toBe(1920);
        expect(measureTicksFor('6/8', 480)).toBe(1440);
    });
});

describe('MeasureTiming', () => {
    const mt = new MeasureTiming({
        timeSignature: '4/4',
        timeSignatureChanges: [
            { measure: 1, time_signature: '3/4' },
            { measure: 30, time_signature: '2/4' },
        ],
        ticksPerBeat: 480,
    });

    it('applies per-measure overrides, default elsewhere', () => {
        expect(mt.ticksFor(1)).toBe(1440);
        expect(mt.ticksFor(2)).toBe(1920);
        expect(mt.ticksFor(30)).toBe(960);
        expect(mt.ticksFor(31)).toBe(1920);
        expect(mt.defaultTicks).toBe(1920);
    });

    it('exposes signature and beats per measure', () => {
        expect(mt.signatureFor(1)).toBe('3/4');
        expect(mt.signatureFor(2)).toBe('4/4');
        expect(mt.beatsFor(1)).toBe(3);
        expect(mt.beatsFor(30)).toBe(2);
        expect(mt.beatTicksFor(1)).toBe(480);
    });

    it('2/2 beats are half notes', () => {
        const cut = new MeasureTiming({ timeSignature: '2/2' });
        expect(cut.ticksFor(1)).toBe(1920);
        expect(cut.beatsFor(1)).toBe(2);
        expect(cut.beatTicksFor(1)).toBe(960);
    });

    it('works without changes (uniform)', () => {
        const plain = new MeasureTiming({ timeSignature: '4/4' });
        expect(plain.ticksFor(99)).toBe(1920);
    });
});

describe('timelines', () => {
    it('identityTimeline maps display == original', () => {
        expect(identityTimeline(3)).toEqual([
            { display: 1, original: 1 },
            { display: 2, original: 2 },
            { display: 3, original: 3 },
        ]);
    });

    it('readingListTimeline unrolls repeats', () => {
        const rl = [
            { from_measure: 1, to_measure: 3 },
            { from_measure: 2, to_measure: 2 },
        ];
        expect(readingListTimeline(rl, 3)).toEqual([
            { display: 1, original: 1 },
            { display: 2, original: 2 },
            { display: 3, original: 3 },
            { display: 4, original: 2 },
        ]);
    });

    it('readingListTimeline falls back to identity when empty', () => {
        expect(readingListTimeline(null, 2)).toEqual(identityTimeline(2));
        expect(readingListTimeline([], 2)).toEqual(identityTimeline(2));
    });
});

describe('TimelineTiming', () => {
    // 4/4 tune with a 3/4 pickup (22456 shape), 3 measures.
    const mt = new MeasureTiming({
        timeSignature: '4/4',
        timeSignatureChanges: [{ measure: 1, time_signature: '3/4' }],
    });
    const tt = new TimelineTiming(mt, identityTimeline(3));

    it('accumulates start ticks through short measures', () => {
        expect(tt.startTick(1)).toBe(0);
        expect(tt.startTick(2)).toBe(1440);   // not 1920 — the pickup is short
        expect(tt.startTick(3)).toBe(3360);
        expect(tt.ticksAt(1)).toBe(1440);
        expect(tt.ticksAt(2)).toBe(1920);
        expect(tt.totalTicks).toBe(1440 + 1920 + 1920);
    });

    it('locates an absolute tick inside the right measure', () => {
        expect(tt.locate(0)).toMatchObject({ display: 1, original: 1, tickInMeasure: 0 });
        expect(tt.locate(1439)).toMatchObject({ display: 1, tickInMeasure: 1439 });
        expect(tt.locate(1440)).toMatchObject({ display: 2, tickInMeasure: 0 });
        expect(tt.locate(1500)).toMatchObject({ display: 2, tickInMeasure: 60 });
        expect(tt.locate(3360)).toMatchObject({ display: 3, tickInMeasure: 0 });
    });

    it('extrapolates past the end with the default measure length', () => {
        // safety for ticks slightly past the last measure (end-of-playback)
        const past = tt.locate(tt.totalTicks + 100);
        expect(past.display).toBe(4);
        expect(past.tickInMeasure).toBe(100);
        expect(tt.startTick(5)).toBe(tt.totalTicks + 1920);
    });

    it('repeated original measures keep their override length', () => {
        // reading list repeats the pickup: [1-2, 1-2]
        const tl = readingListTimeline([
            { from_measure: 1, to_measure: 2 },
            { from_measure: 1, to_measure: 2 },
        ], 2);
        const t = new TimelineTiming(mt, tl);
        expect(t.startTick(3)).toBe(1440 + 1920);      // display 3 = original 1 again
        expect(t.ticksAt(3)).toBe(1440);
        expect(t.totalTicks).toBe(2 * (1440 + 1920));
    });
});

describe('expandNotation', () => {
    const notation = [
        { measure: 2, events: [{ tick: 0, notes: [{ s: 1, f: 0 }] }] },
        { measure: 3, events: [{ tick: 480, notes: [{ s: 2, f: 2 }] }] },
    ];

    it('preserves timeline slots for measures missing from a sparse track', () => {
        // 27493 shape: mandolin has nothing in measures 1-5; before the fix
        // expansion renumbered its first measure to 1, playing it 5 measures
        // early relative to the other tracks.
        const tl = identityTimeline(3);
        const out = expandNotation(notation, tl);
        expect(out.map(m => m.measure)).toEqual([2, 3]);
        expect(out.map(m => m.originalMeasure)).toEqual([2, 3]);
    });

    it('unrolls repeats and keeps original refs', () => {
        const tl = readingListTimeline([
            { from_measure: 1, to_measure: 3 },
            { from_measure: 2, to_measure: 3 },
        ], 3);
        const out = expandNotation(notation, tl);
        // slots: d1<-1 (missing), d2<-2, d3<-3, d4<-2, d5<-3
        expect(out.map(m => [m.measure, m.originalMeasure])).toEqual(
            [[2, 2], [3, 3], [4, 2], [5, 3]]);
        // events are cloned refs, not renumbered
        expect(out[2].events[0].tick).toBe(0);
    });
});

describe('makePlaybackToVisualMapper', () => {
    it('maps expanded playback ticks back to written-measure ticks', () => {
        const mt = new MeasureTiming({
            timeSignature: '4/4',
            timeSignatureChanges: [{ measure: 1, time_signature: '3/4' }],
        });
        const rl = [
            { from_measure: 1, to_measure: 2 },
            { from_measure: 1, to_measure: 2 },
        ];
        const play = new TimelineTiming(mt, readingListTimeline(rl, 2));
        const visual = new TimelineTiming(mt, identityTimeline(2));
        const map = makePlaybackToVisualMapper(play, visual);

        expect(map(0)).toBe(0);
        expect(map(1440)).toBe(1440);         // display 2 start -> original 2 start
        // display 3 (= original 1, second pass) starts at 3360 -> visual 0
        expect(map(3360)).toBe(0);
        expect(map(3360 + 100)).toBe(100);
        // display 4 (= original 2) -> visual 1440
        expect(map(3360 + 1440 + 60)).toBe(1500);
    });
});

describe('two-feel presentation (cut time)', () => {
    const mt = new MeasureTiming({
        timeSignature: '4/4',
        timeSignatureChanges: [{ measure: 17, time_signature: '2/4' }],
        feel: 'two',
    });

    it('presents 4/4 as 2/2 and 2/4 as 1/2', () => {
        expect(mt.defaultSignature).toBe('2/2');
        expect(mt.signatureFor(1)).toBe('2/2');
        expect(mt.signatureFor(17)).toBe('1/2');
    });

    it('does not change tick math (equal-length signatures)', () => {
        expect(mt.ticksFor(1)).toBe(1920);
        expect(mt.ticksFor(17)).toBe(960);
        expect(mt.defaultTicks).toBe(1920);
    });

    it('beats follow the feel: half-note pulse', () => {
        expect(mt.beatsFor(1)).toBe(2);
        expect(mt.beatTicksFor(1)).toBe(960);
        expect(mt.beatsFor(17)).toBe(1);
        expect(mt.beatTicksFor(17)).toBe(960);
    });

    it('metronome clicks halves in two feel', () => {
        const tt = new TimelineTiming(mt, identityTimeline(1));
        expect(buildMetronomeSchedule(tt)).toEqual([
            { tick: 0, isDownbeat: true },
            { tick: 960, isDownbeat: false },
        ]);
    });

    it('other signatures pass through untouched', () => {
        const waltz = new MeasureTiming({ timeSignature: '3/4', feel: 'two' });
        expect(waltz.signatureFor(1)).toBe('3/4');
        expect(waltz.beatsFor(1)).toBe(3);
    });
});

describe('repeat-sign analysis (moved from work-view)', () => {
    it('18926 Leather Britches: [1-25, 18-24, 26] -> repeat 18..24, endings 25/26', () => {
        const rl = [
            { from_measure: 1, to_measure: 25 },
            { from_measure: 18, to_measure: 24 },
            { from_measure: 26, to_measure: 26 },
        ];
        const a = analyzeReadingList(rl);
        expect([...a.repeatStartMarkers]).toEqual([18]);
        expect([...a.repeatEndMarkers]).toEqual([24]);
        expect(a.endings).toEqual({ 25: 1, 26: 2 });

        const notation = Array.from({ length: 26 }, (_, i) => ({ measure: i + 1, events: [] }));
        const compact = prepareCompactNotation(notation, rl);
        expect(compact[17].repeatStart).toBe(true);
        expect(compact[23].repeatEnd).toBe(true);
        expect(compact[24].ending).toBe(1);
        expect(compact[25].ending).toBe(2);
        expect(compact[0].repeatStart).toBeUndefined();
    });
});

describe('buildMetronomeSchedule', () => {
    it('clicks per-measure beats, downbeat first', () => {
        const mt = new MeasureTiming({
            timeSignature: '4/4',
            timeSignatureChanges: [{ measure: 1, time_signature: '3/4' }],
        });
        const tt = new TimelineTiming(mt, identityTimeline(2));
        const clicks = buildMetronomeSchedule(tt);
        expect(clicks).toEqual([
            { tick: 0, isDownbeat: true },
            { tick: 480, isDownbeat: false },
            { tick: 960, isDownbeat: false },
            { tick: 1440, isDownbeat: true },
            { tick: 1920, isDownbeat: false },
            { tick: 2400, isDownbeat: false },
            { tick: 2880, isDownbeat: false },
        ]);
    });

    it('2/2 clicks half notes, not quarters', () => {
        const mt = new MeasureTiming({ timeSignature: '2/2' });
        const tt = new TimelineTiming(mt, identityTimeline(1));
        expect(buildMetronomeSchedule(tt)).toEqual([
            { tick: 0, isDownbeat: true },
            { tick: 960, isDownbeat: false },
        ]);
    });
});
