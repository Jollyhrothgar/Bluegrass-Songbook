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
        // 3/4 pickup: 75% of a full measure's width, PLUS the footprint of
        // the m1 signature glyph (32px for single digits) so the note area
        // isn't squeezed by the mark.
        expect(geoms[0].width).toBe(135 + 32);
        expect(geoms[0].noteW).toBe(135 - 30);
        expect(geoms[1].width).toBe(180);
        // x positions accumulate the narrow measure
        expect(geoms[0].x).toBe(50);           // leftMargin
        expect(geoms[1].x).toBe(217);
        expect(geoms[2].x).toBe(397);
    });

    it('computes absolute ticks through the short measure', () => {
        const geoms = r.rowData[0].measures;
        expect(geoms[0].startTick).toBe(0);
        expect(geoms[1].startTick).toBe(1440);  // not 1920
        expect(geoms[2].startTick).toBe(3360);
        const m2n = r.noteElements.filter(n => n.measure === 2);
        expect(m2n.map(n => n.absTick).sort((a, b) => a - b)).toEqual([1440, 2400]);
    });

    it('positions notes against the measure\'s own length, centered', () => {
        // pickup measure: events at 0 and 960 of 1440 -> the leftover third
        // after the last note is split across both sides (noteOffset)
        const geom = r.rowData[0].measures[0];
        expect(geom.noteOffset).toBeCloseTo(geom.noteW * (1 - 960 / 1440) / 2, 5);
        const m1notes = r.noteElements.filter(n => n.measure === 1);
        const xs = m1notes.map(n => n.x).sort((a, b) => a - b);
        expect(xs[0]).toBeCloseTo(geom.noteX0 + geom.noteOffset, 5);
        expect(xs[1]).toBeCloseTo(geom.noteX0 + geom.noteOffset + (960 / 1440) * geom.noteW, 5);
        // symmetric: space left of first note == space right of last note
        const leftGap = xs[0] - geom.noteX0;
        const rightGap = (geom.noteX0 + geom.noteW) - xs[1];
        expect(leftGap).toBeCloseTo(rightGap, 5);
    });

    it('places the beat cursor using per-measure geometry', () => {
        r.updateBeatCursor(1440, { snapToBeats: false, autoScroll: false });
        const cursor = r.beatCursors[0].cursor;
        expect(cursor.style.display).toBe('block');
        const geom = r.rowData[0].measures[1];
        expect(parseFloat(cursor.getAttribute('x')))
            .toBeCloseTo(geom.noteX0 + geom.noteOffset - 1.5, 5);
    });

    it('marks the global signature at m1 but not the pickup override', () => {
        // TablEdit notates pickups under the main signature: m1 shows 4/4,
        // and m2 gets NO reversion mark.
        const geoms = r.rowData[0].measures;
        expect(geoms[0].signatureMark).toBe('4/4');
        expect(geoms[1].signatureMark).toBeNull();
        expect(geoms[2].signatureMark).toBeNull();
    });
});

describe('TabRenderer edge adornments grow the measure', () => {
    it('repeat signs add their footprint instead of squeezing notes', () => {
        const r = makeRenderer();
        const notation = [
            { measure: 1, events: [note(0)], repeatStart: true },
            { measure: 2, events: [note(0)], repeatEnd: true },
        ];
        r.render(TRACK, notation, 480, '4/4');
        const g = r.rowData[0].measures;
        // m1: signature (32) + repeat start (14); m2: repeat end (12)
        expect(g[0].width).toBe(180 + 32 + 14);
        expect(g[1].width).toBe(180 + 12);
        // note area identical to an unadorned measure in both
        expect(g[0].noteW).toBe(150);
        expect(g[1].noteW).toBe(150);
        expect(g[0].noteX0).toBe(50 + 14 + 32 + 15);
    });
});

describe('TabRenderer time-signature marks at mid-tune changes', () => {
    it('marks the change AND the reversion (wheel-hoss shape)', () => {
        const timing = new TimelineTiming(
            new MeasureTiming({
                timeSignature: '4/4',
                timeSignatureChanges: [{ measure: 2, time_signature: '2/4' }],
            }),
            identityTimeline(3),
        );
        const r = makeRenderer();
        const notation = [
            { measure: 1, events: [note(0)] },
            { measure: 2, events: [note(0)] },
            { measure: 3, events: [note(0)] },
        ];
        r.render(TRACK, notation, 480, '4/4', timing);
        const geoms = r.rowData[0].measures;
        expect(geoms.map(g => g.signatureMark)).toEqual(['4/4', '2/4', '4/4']);
        // glyph text is drawn (num + den for the 2/4 mark)
        const texts = [...r.container.querySelectorAll('text.time-signature')]
            .map(t => t.textContent);
        expect(texts).toContain('2');
        // marked measures reserve room: notes start after the glyph
        expect(geoms[1].noteX0).toBeGreaterThan(geoms[1].x + 15);
    });
});

describe('TabRenderer backward compatibility (no timing arg)', () => {
    it('uniform 4/4 keeps the old geometry (plus the m1 signature glyph)', () => {
        const r = makeRenderer();
        const notation = [
            { measure: 1, events: [note(0)] },
            { measure: 2, events: [note(0)] },
        ];
        r.render(TRACK, notation, 480, '4/4');
        const geoms = r.rowData[0].measures;
        expect(geoms[0]).toMatchObject({ x: 50, width: 180 + 32, startTick: 0, noteW: 150 });
        expect(geoms[1]).toMatchObject({ x: 262, width: 180, startTick: 1920, noteW: 150 });
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
