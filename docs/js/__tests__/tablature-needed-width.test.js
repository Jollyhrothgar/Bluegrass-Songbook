// G22: what Auto reads from the music. TabRenderer.neededMeasureWidth is pure:
// a bar's needed width is (bar length / smallest gap between note onsets) x a
// readable width per note slot (+ 30px of barline margin), never below
// targetMeasureWidth; the tab needs the 90th percentile bar.
import { describe, it, expect } from 'vitest';

import { TabRenderer } from '../renderers/tablature.js';

const OPT = { targetMeasureWidth: 180, noteSlotWidth: 20, autoPercentile: 0.9 };
const TICKS = 1920;   // one 4/4 bar at 480 per beat

const bar = (n, ticks) => ({ measure: n, events: ticks.map(t => ({ tick: t, notes: [{ s: 1, f: 0 }] })) });
const every = (step) => Array.from({ length: TICKS / step }, (_, i) => i * step);
const needed = (notation) => TabRenderer.neededMeasureWidth(notation, OPT, () => TICKS);

describe('TabRenderer.neededMeasureWidth', () => {
    it('is the floor for a tab with nothing in it', () => {
        expect(needed([])).toBe(180);
        expect(needed([{ measure: 1, events: [] }, { measure: 2 }])).toBe(180);
    });

    it('a sparse roll (quarters) needs only the floor', () => {
        expect(needed([bar(1, every(480))])).toBe(180);       // 4 slots: 110px < floor
    });

    it('an eighth-note roll is about what Auto used to aim for', () => {
        expect(needed([bar(1, every(240))])).toBe(8 * 20 + 30);   // 190
    });

    it('a bar of 64ths needs much more room than a roll', () => {
        const roll = needed([bar(1, every(240))]);
        const fast = needed([bar(1, every(30))]);
        expect(fast).toBe(64 * 20 + 30);
        expect(fast).toBeGreaterThan(roll * 5);
    });

    it('the smallest gap sets the bar, not the average', () => {
        // quarters, except two onsets a 16th apart
        const ticks = [0, 480, 960, 1080, 1440];
        expect(needed([bar(1, ticks)])).toBe(Math.max(180, (TICKS / 120) * 20 + 30));
    });

    it('a chord is one onset, and a single onset has no gap', () => {
        const chord = { measure: 1, events: [{ tick: 0, notes: [{ s: 1, f: 0 }, { s: 2, f: 0 }] }, { tick: 0, notes: [{ s: 3, f: 0 }] }] };
        expect(needed([chord])).toBe(180);
    });

    it('uses each bar\'s own length', () => {
        // a 2/4 bar (960 ticks) of eighths has 4 slots, not 8
        const short = bar(1, [0, 240, 480, 720]);
        expect(TabRenderer.neededMeasureWidth([short], OPT, () => 960)).toBe(180);
    });

    it('sizes to the 90th percentile bar, so one freak bar does not squeeze the tab', () => {
        const notation = [
            ...Array.from({ length: 19 }, (_, i) => bar(i + 1, every(240))),
            bar(20, every(30)),
        ];
        expect(needed(notation)).toBe(190);                   // 1 dense bar of 20: ignored
        notation[18] = bar(19, every(30));
        expect(needed(notation)).toBe(190);                   // 2 of 20 is the top 10%: still ignored
        notation[17] = bar(18, every(30));
        expect(needed(notation)).toBe(64 * 20 + 30);          // 3 of 20 are more than a freak
    });

    it('rests-only bars contribute the floor', () => {
        const notation = [
            ...Array.from({ length: 5 }, (_, i) => bar(i + 1, every(240))),
            ...Array.from({ length: 5 }, (_, i) => ({ measure: i + 6, events: [] })),
        ];
        // sorted: five 180s then five 190s; the 90th percentile is the 9th
        expect(needed(notation)).toBe(190);
        expect(needed(notation.slice(5))).toBe(180);
    });
});
