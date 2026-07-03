// TabRenderer consumption of per-measure time signatures.
//
// jsdom: container.clientWidth is 0, so the renderer falls back to an
// 800px container -> availableWidth 720 -> 4 measures per row at 180px.

import { describe, it, expect, beforeEach } from 'vitest';
import { TabRenderer } from '../renderers/tablature.js';
import {
    MeasureTiming,
    TimelineTiming,
    identityTimeline,
} from '../renderers/measure-timing.js';

const TRACK = {
    id: 'banjo',
    instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};

function note(tick, s = 1, f = 0) {
    return { tick, notes: [{ s, f }] };
}

function makeRenderer() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return new TabRenderer(container);
}

// 22456 shape: 4/4 tune, measure 1 is a 3/4 pickup.
const PICKUP_TIMING = new TimelineTiming(
    new MeasureTiming({
        timeSignature: '4/4',
        timeSignatureChanges: [{ measure: 1, time_signature: '3/4' }],
    }),
    identityTimeline(3),
);

const PICKUP_NOTATION = [
    { measure: 1, events: [note(0), note(960)] },
    { measure: 2, events: [note(0), note(960, 2, 3)] },
    { measure: 3, events: [note(0)] },
];

describe('TabRenderer with per-measure time signatures', () => {
    let r;
    beforeEach(() => {
        r = makeRenderer();
        r.render(TRACK, PICKUP_NOTATION, 480, '4/4', PICKUP_TIMING);
    });

    it('renders the short measure narrower (tight, no dead space)', () => {
        const geoms = r.rowData[0].measures;
        expect(geoms.map(g => g.display)).toEqual([1, 2, 3]);
        // 3/4 pickup: 75% of a full measure's width
        expect(geoms[0].width).toBe(135);
        expect(geoms[1].width).toBe(180);
        // x positions accumulate the narrow measure
        expect(geoms[0].x).toBe(50);           // leftMargin
        expect(geoms[1].x).toBe(185);
        expect(geoms[2].x).toBe(365);
    });

    it('computes absolute ticks through the short measure', () => {
        const geoms = r.rowData[0].measures;
        expect(geoms[0].startTick).toBe(0);
        expect(geoms[1].startTick).toBe(1440);  // not 1920
        expect(geoms[2].startTick).toBe(3360);
        const m2n = r.noteElements.filter(n => n.measure === 2);
        expect(m2n.map(n => n.absTick).sort((a, b) => a - b)).toEqual([1440, 2400]);
    });

    it('positions notes against the measure\'s own length', () => {
        // pickup measure: tick 960 of 1440 -> 2/3 across the note area
        const geom = r.rowData[0].measures[0];
        const noteArea = geom.width - 30;
        const m1notes = r.noteElements.filter(n => n.measure === 1);
        const xs = m1notes.map(n => n.x).sort((a, b) => a - b);
        expect(xs[0]).toBeCloseTo(geom.x + 15, 5);
        expect(xs[1]).toBeCloseTo(geom.x + 15 + (960 / 1440) * noteArea, 5);
    });

    it('places the beat cursor using per-measure geometry', () => {
        r.updateBeatCursor(1440, { snapToBeats: false, autoScroll: false });
        const cursor = r.beatCursors[0].cursor;
        expect(cursor.style.display).toBe('block');
        const geom = r.rowData[0].measures[1];
        expect(parseFloat(cursor.getAttribute('x'))).toBeCloseTo(geom.x + 15 - 1.5, 5);
    });
});

describe('TabRenderer backward compatibility (no timing arg)', () => {
    it('uniform 4/4 keeps the old geometry exactly', () => {
        const r = makeRenderer();
        const notation = [
            { measure: 1, events: [note(0)] },
            { measure: 2, events: [note(0)] },
        ];
        r.render(TRACK, notation, 480, '4/4');
        const geoms = r.rowData[0].measures;
        expect(geoms[0]).toMatchObject({ x: 50, width: 180, startTick: 0 });
        expect(geoms[1]).toMatchObject({ x: 230, width: 180, startTick: 1920 });
        expect(r.ticksPerMeasure).toBe(1920);
    });

    it('2/2 measures are 1920 ticks, not 960 (denominator bug)', () => {
        // 27493 banjo has notes at tick 1800 inside 2/2 measures; with the
        // old numerator*480 math they rendered past the barline.
        const r = makeRenderer();
        const notation = [
            { measure: 1, events: [note(0), note(1800)] },
            { measure: 2, events: [note(0)] },
        ];
        r.render(TRACK, notation, 480, '2/2');
        expect(r.ticksPerMeasure).toBe(1920);
        const geom = r.rowData[0].measures[0];
        const m1notes = r.noteElements.filter(n => n.measure === 1);
        const maxX = Math.max(...m1notes.map(n => n.x));
        expect(maxX).toBeLessThan(geom.x + geom.width);   // stays inside its measure
        // and measure 2 starts a full 1920 ticks in
        expect(r.rowData[0].measures[1].startTick).toBe(1920);
    });
});
