// Range clipping for play-from-cursor / loop-a-phrase.
// Pure schedule math — the audio side is exercised live in the browser.
import { describe, it, expect } from 'vitest';

import { clipScheduleToRange } from '../renderers/tab-player.js';

// 120 BPM, 480 tpq → 1 tick ≈ 1.0417ms; use a round number instead
const SPT = 0.001; // seconds per tick, keeps expectations readable

const notes = [
    { absTick: 0, time: 0, midi: 62 },
    { absTick: 480, time: 0.48, midi: 64 },
    { absTick: 960, time: 0.96, midi: 65 },
    { absTick: 1440, time: 1.44, midi: 67 },
    { absTick: 1920, time: 1.92, midi: 69 },
];

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
