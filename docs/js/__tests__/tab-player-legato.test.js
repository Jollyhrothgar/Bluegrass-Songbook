// Hammer-ons and pull-offs are ONE pick (fix-it A15): the source note keeps
// ringing and its pitch steps to the target, the way TablEdit plays them.
// The player used to re-pick every `h`/`p` target at full volume; only
// slides glided.
import { describe, it, expect } from 'vitest';

import { absorbLegato, legatoWaypoints } from '../renderers/tab-player.js';

const src = () => ({ absTick: 0, midi: 62, explicitEndTick: 240 });

describe('absorbLegato', () => {
    it('folds an h/p//-target into the preceding note on its string', () => {
        for (const tech of ['h', 'p', '/']) {
            const s = src();
            const last = { 3: s };
            expect(absorbLegato(last, { s: 3, tech, dur: 240 }, 64, 240)).toBe(true);
            expect(s.explicitEndTick).toBe(480);
            expect(s.legs).toEqual([{ toMidi: 64, atTick: 240, glide: tech === '/' }]);
        }
    });

    it('chains: 0h2p0 is one pick with two steps', () => {
        const s = src();
        const last = { 3: s };
        absorbLegato(last, { s: 3, tech: 'h', dur: 240 }, 64, 240);
        absorbLegato(last, { s: 3, tech: 'p', dur: 240 }, 62, 480);
        expect(s.legs.map(l => l.toMidi)).toEqual([64, 62]);
        expect(s.explicitEndTick).toBe(720);
    });

    it('leaves plain notes, other strings and source-less targets alone', () => {
        const s = src();
        expect(absorbLegato({ 3: s }, { s: 3, dur: 240 }, 64, 240)).toBe(false);
        expect(absorbLegato({ 3: s }, { s: 2, tech: 'h', dur: 240 }, 64, 240)).toBe(false);
        expect(absorbLegato({}, { s: 3, tech: 'h', dur: 240 }, 64, 240)).toBe(false);
    });
});

describe('legatoWaypoints', () => {
    it('steps for a hammer, glides for a slide, relative to the source pitch', () => {
        const wp = legatoWaypoints(62, [
            { toMidi: 64, atSec: 0.25, glide: false },
            { toMidi: 67, atSec: 0.5, glide: true },
        ], 1);
        expect(wp[0]).toEqual({ delta: 0, when: expect.any(Number) });
        expect(wp[1]).toEqual({ delta: 2, when: 0.25 });
        expect(wp[1].when - wp[0].when).toBeLessThan(0.02);   // a step, not a glide
        expect(wp[3]).toEqual({ delta: 5, when: 0.5 });
        expect(wp[3].when - wp[2].when).toBeGreaterThan(0.03); // a glide
        expect(wp[2].delta).toBe(2);
    });
});
