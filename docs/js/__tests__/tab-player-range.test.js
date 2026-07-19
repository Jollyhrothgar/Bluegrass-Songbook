// Range clipping for play-from-cursor / loop-a-phrase.
// Pure schedule math — the audio side is exercised live in the browser.
import { describe, it, expect } from 'vitest';

import {
    clipScheduleToRange,
    applyTieExtensions,
    effectiveDurationSeconds,
    slideWaypoints,
} from '../renderers/tab-player.js';

// 120 BPM, 480 tpq → 1 tick ≈ 1.0417ms; use a round number instead
const SPT = 0.001; // seconds per tick, keeps expectations readable

const notes = [
    { absTick: 0, time: 0, midi: 62 },
    { absTick: 480, time: 0.48, midi: 64 },
    { absTick: 960, time: 0.96, midi: 65 },
    { absTick: 1440, time: 1.44, midi: 67 },
    { absTick: 1920, time: 1.92, midi: 69 },
];

describe('applyTieExtensions (tie chains ring through)', () => {
    it('extends the source note through its continuations', () => {
        const trackNotes = [
            { absTick: 960, string: 3, explicitEndTick: 1920 }, // 960-tick half
        ];
        applyTieExtensions(trackNotes, [
            { absTick: 1920, string: 3, durTicks: 960 },  // tied into m2
            { absTick: 2880, string: 3, durTicks: 480 },  // and further
        ]);
        expect(trackNotes[0].explicitEndTick).toBe(3360); // full whole+quarter
    });

    it('only extends notes on the SAME string, before the tie', () => {
        const trackNotes = [
            { absTick: 0, string: 2 },
            { absTick: 480, string: 3 },
        ];
        applyTieExtensions(trackNotes, [{ absTick: 960, string: 3, durTicks: 480 }]);
        expect(trackNotes[0].explicitEndTick).toBeUndefined();
        expect(trackNotes[1].explicitEndTick).toBe(1440);
    });

    it('ignores orphan ties', () => {
        const trackNotes = [{ absTick: 960, string: 1 }];
        applyTieExtensions(trackNotes, [{ absTick: 0, string: 1, durTicks: 480 }]);
        expect(trackNotes[0].explicitEndTick).toBeUndefined();
    });
});

describe('effectiveDurationSeconds', () => {
    const base = { decay: 1.5, sustain: 1.0 };

    it('explicit durations survive other tracks\' events', () => {
        // whole note (4s) with a backing track hitting every 0.25s
        const d = effectiveDurationSeconds(
            { ...base, explicitDurSec: 4 }, 10, 0.25);
        expect(d).toBe(4); // NOT cut to 0.25
    });

    it('a re-attack on the same string still cuts an explicit note', () => {
        const d = effectiveDurationSeconds(
            { ...base, explicitDurSec: 4 }, 1.0, 0.25);
        expect(d).toBe(1.0);
    });

    it('ring-model notes keep the legacy any-track truncation', () => {
        const d = effectiveDurationSeconds(base, 10, 0.25);
        expect(d).toBeCloseTo(0.25 * 0.95);
    });

    it('ring-model notes cap at the mixer decay', () => {
        const d = effectiveDurationSeconds(base, 10, 10);
        expect(d).toBe(1.5);
    });

    it('explicit duration plays full length at phrase end', () => {
        // Last note on its string: the scheduler passes stringGap =
        // Infinity (nothing ever re-attacks), so a written 3s note
        // must NOT be silently capped at the 1.5s mixer decay.
        const d = effectiveDurationSeconds(
            { ...base, explicitDurSec: 3 }, Infinity, 0.25);
        expect(d).toBe(3);
    });

    it('sustain scales, floor holds', () => {
        expect(effectiveDurationSeconds({ decay: 1.5, sustain: 0.5, explicitDurSec: 2 }, 10, 10))
            .toBe(1.0);
        expect(effectiveDurationSeconds(base, 0.001, 0.001)).toBeCloseTo(0.03);
    });
});

describe('clipScheduleToRange', () => {
    it('keeps everything with the default open range', () => {
        const out = clipScheduleToRange(notes, { secondsPerTick: SPT });
        expect(out).toHaveLength(5);
        expect(out[0].time).toBe(0);
    });

    it('drops notes before startTick and rebases times to zero', () => {
        const out = clipScheduleToRange(notes, { startTick: 960, secondsPerTick: SPT });
        expect(out.map(n => n.absTick)).toEqual([960, 1440, 1920]);
        expect(out[0].time).toBeCloseTo(0);
        expect(out[1].time).toBeCloseTo(0.48);
    });

    it('endTick is exclusive (loop ranges never double the boundary note)', () => {
        const out = clipScheduleToRange(notes, {
            startTick: 480, endTick: 1920, secondsPerTick: SPT,
        });
        expect(out.map(n => n.absTick)).toEqual([480, 960, 1440]);
    });

    it('preserves absolute ticks for visualization callbacks', () => {
        const out = clipScheduleToRange(notes, { startTick: 960, secondsPerTick: SPT });
        // times rebased, absTicks NOT — highlights stay on the right notes
        expect(out[0].absTick).toBe(960);
        expect(out[0].time).toBeCloseTo(0);
    });

    it('does not mutate the input schedule', () => {
        clipScheduleToRange(notes, { startTick: 960, secondsPerTick: SPT });
        expect(notes[2].time).toBeCloseTo(0.96);
    });

    it('supports alternate tick fields (metronome clicks)', () => {
        const clicks = [
            { tick: 0, time: 0 }, { tick: 480, time: 0.48 }, { tick: 960, time: 0.96 },
        ];
        const out = clipScheduleToRange(clicks, {
            startTick: 480, endTick: 960, secondsPerTick: SPT, tickKey: 'tick',
        });
        expect(out).toEqual([{ tick: 480, time: expect.closeTo(0, 5) }]);
    });

    it('returns empty for an empty or fully-excluded range', () => {
        expect(clipScheduleToRange([], { secondsPerTick: SPT })).toEqual([]);
        expect(clipScheduleToRange(notes, {
            startTick: 5000, secondsPerTick: SPT,
        })).toEqual([]);
    });
});

describe('slideWaypoints (pitch glide, WebAudioFont `slides` format)', () => {
    // salt-creek m1: source f5 slides to f8 (+3 semitones). At SPT=0.001 the
    // source's written eighth (240 ticks) => holdSec 0.24; the extended note
    // (through the target) => 0.48s.
    it('holds source pitch, then bends up into the target at its onset', () => {
        const wp = slideWaypoints(3, 0.24, 0.48);
        expect(wp).toHaveLength(2);
        expect(wp[0].delta).toBe(0);            // no pitch change while ringing
        expect(wp[1].delta).toBe(3);            // reach the target pitch
        expect(wp[1].when).toBeCloseTo(0.24);   // exactly at the target onset
        // the glide is a quick, snappy slide (~45ms), not a slow bend
        expect(wp[1].when - wp[0].when).toBeCloseTo(0.045);
        expect(wp[0].when).toBeGreaterThanOrEqual(0);
    });

    it('never emits negative times when the target sits at the note start', () => {
        const wp = slideWaypoints(2, 0, 0.3);
        expect(wp.every(p => p.when >= 0)).toBe(true);
        expect(wp[1].delta).toBe(2);
    });

    it('caps the glide to a fraction of a very short note', () => {
        const wp = slideWaypoints(4, 0.05, 0.05);  // 50ms note
        const glide = wp[1].when - wp[0].when;
        expect(glide).toBeLessThanOrEqual(0.05 * 0.3 + 1e-9);
    });
});
