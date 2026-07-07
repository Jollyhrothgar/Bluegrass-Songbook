// Rest glyphs: silence after duration-carrying notes gets real rests;
// parsed tabs without durations render unchanged (ring-until-next).
import { describe, it, expect, afterEach } from 'vitest';

import {
    TabRenderer,
    restSpansForMeasure,
    restGlyphSequence,
} from '../renderers/tablature.js';

const TRACK = {
    id: 'banjo',
    instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};

describe('restSpansForMeasure', () => {
    it('finds the gap between a durated note and the next event', () => {
        const events = [
            { tick: 0, notes: [{ s: 1, f: 0, dur: 480 }] },
            { tick: 1440, notes: [{ s: 1, f: 2, dur: 480 }] },
        ];
        expect(restSpansForMeasure(events, 1920)).toEqual([
            { start: 480, len: 960 },
        ]);
    });

    it('finds the trailing gap to the measure end', () => {
        const events = [{ tick: 0, notes: [{ s: 1, f: 0, dur: 480 }] }];
        expect(restSpansForMeasure(events, 1920)).toEqual([
            { start: 480, len: 1440 },
        ]);
    });

    it('ignores events without explicit durations (legacy ring model)', () => {
        const events = [
            { tick: 0, notes: [{ s: 1, f: 0 }] },
            { tick: 480, notes: [{ s: 2, f: 1, dur: 240 }, { s: 3, f: 2 }] }, // mixed
        ];
        expect(restSpansForMeasure(events, 1920)).toEqual([]);
    });

    it('chords rest after their LONGEST note', () => {
        const events = [
            { tick: 0, notes: [{ s: 1, f: 0, dur: 240 }, { s: 2, f: 1, dur: 480 }] },
        ];
        expect(restSpansForMeasure(events, 960)).toEqual([
            { start: 480, len: 480 },
        ]);
    });

    it('ignores sub-32nd slivers and empty measures', () => {
        expect(restSpansForMeasure(
            [{ tick: 0, notes: [{ s: 1, f: 0, dur: 1890 }] }], 1920)).toEqual([]);
        expect(restSpansForMeasure([], 1920)).toEqual([]);
    });
});

describe('restGlyphSequence', () => {
    it('decomposes largest-first', () => {
        expect(restGlyphSequence(1440).map(r => r.ticks)).toEqual([960, 480]);
        expect(restGlyphSequence(420).map(r => r.ticks)).toEqual([240, 120, 60]);
        expect(restGlyphSequence(0)).toEqual([]);
    });
});

describe('TabRenderer tie arcs across barlines', () => {
    it('draws the arc between a split note and its tied continuation', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const r = new TabRenderer(container);
        // Whole note entered at beat 3 of m1 (4/4): 960 + tied 960 in m2 —
        // the arc spans the barline (way past the old 60px technique cap)
        r.render(TRACK, [
            { measure: 1, events: [{ tick: 960, notes: [{ s: 3, f: 0, dur: 960 }] }] },
            { measure: 2, events: [{ tick: 0, notes: [{ s: 3, f: 0, dur: 960, tie: true }] }] },
        ], 480, '4/4');
        expect(container.querySelector('.tie-arc')).not.toBeNull();
    });

    it('draws an incoming half-arc when the continuation starts a row', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const r = new TabRenderer(container);
        r.options.measuresPerRow = 1; // force the tie across a ROW break
        r.render(TRACK, [
            { measure: 1, events: [{ tick: 960, notes: [{ s: 3, f: 0, dur: 960 }] }] },
            { measure: 2, events: [{ tick: 0, notes: [{ s: 3, f: 0, dur: 960, tie: true }] }] },
        ], 480, '4/4');
        const rows = container.querySelectorAll('.stave-row');
        expect(rows).toHaveLength(2);
        expect(rows[1].querySelector('.tie-arc-in')).not.toBeNull();
        expect(rows[0].querySelector('.tie-arc-in')).toBeNull();
    });

    it('keeps the tight cap for technique slurs', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const r = new TabRenderer(container);
        // hammer-on a full measure away — no slur
        r.render(TRACK, [
            { measure: 1, events: [{ tick: 0, notes: [{ s: 3, f: 0 }] }] },
            { measure: 2, events: [{ tick: 0, notes: [{ s: 3, f: 2, tech: 'h' }] }] },
        ], 480, '4/4');
        expect(container.querySelector('.tech-slur')).toBeNull();
    });
});

describe('TabRenderer rest drawing', () => {
    const hadBravura = TabRenderer._bravuraReady;
    afterEach(() => { TabRenderer._bravuraReady = hadBravura; });

    const render = (events) => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const r = new TabRenderer(container);
        r.render(TRACK, [{ measure: 1, events }], 480, '4/4');
        return container;
    };

    it('draws rests after durated notes (Bravura available)', () => {
        TabRenderer._bravuraReady = true;
        const c = render([{ tick: 0, notes: [{ s: 1, f: 0, dur: 480 }] }]);
        // 1440-tick trailing gap → half + quarter
        expect(c.querySelectorAll('.rest-glyph')).toHaveLength(2);
    });

    it('draws nothing for legacy duration-less tabs', () => {
        TabRenderer._bravuraReady = true;
        const c = render([{ tick: 0, notes: [{ s: 1, f: 0 }] }]);
        expect(c.querySelectorAll('.rest-glyph')).toHaveLength(0);
    });

    it('skips rests entirely without the music font', () => {
        TabRenderer._bravuraReady = false;
        const c = render([{ tick: 0, notes: [{ s: 1, f: 0, dur: 480 }] }]);
        expect(c.querySelectorAll('.rest-glyph')).toHaveLength(0);
    });
});
