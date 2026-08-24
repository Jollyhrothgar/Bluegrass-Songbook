// Unit tests for overlay geometry: cursor/grid placement from the
// renderer's real rowData (the inverse of the click hit-test). The old
// overlay assumed uniform measure widths, so the grid "ruler" and
// crosshair drifted off the actual notes.
import { describe, it, expect } from 'vitest';

import {
    positionFromSvgPoint,
    svgPointForPosition,
    gridLinesForRow,
    selectionRectsForRow,
} from '../../otf-editor/cursor.js';

const geoms = [
    { display: 29, x: 20, width: 400, ticks: 1920, noteX0: 35, noteW: 370, noteOffset: 0, startTick: 0 },
    { display: 30, x: 420, width: 220, ticks: 960, noteX0: 455, noteW: 170, noteOffset: 10, startTick: 1920 },
];

const rowData = [
    { rowIndex: 0, firstMeasure: 29, lastMeasure: 30, measures: geoms },
];

const opts = { topMargin: 30, stringSpacing: 15, stringCount: 5, gridSubdivision: 240 };

describe('svgPointForPosition', () => {
    it('places the cursor on the measure\'s own note area', () => {
        const p = svgPointForPosition(rowData, { measure: 29, tick: 0, string: 1 }, opts);
        expect(p).toMatchObject({ rowIndex: 0, x: 35, y: 30 });
    });

    it('is ts-aware: ticks scale over the short measure\'s own length', () => {
        const p = svgPointForPosition(rowData, { measure: 30, tick: 480, string: 3 }, opts);
        expect(p.x).toBeCloseTo(465 + 85); // noteX0 + offset + half of noteW
        expect(p.y).toBe(30 + 2 * 15);
    });

    it('round-trips with the click hit-test', () => {
        for (const pos of [
            { measure: 29, tick: 960, string: 2 },
            { measure: 30, tick: 720, string: 4 },
        ]) {
            const p = svgPointForPosition(rowData, pos, opts);
            expect(positionFromSvgPoint(geoms, p.x, p.y, opts)).toEqual(pos);
        }
    });

    it('returns null for measures not in any row', () => {
        expect(svgPointForPosition(rowData, { measure: 99, tick: 0, string: 1 }, opts)).toBeNull();
        expect(svgPointForPosition([], { measure: 29, tick: 0, string: 1 }, opts)).toBeNull();
    });
});

// Uniform measure slots (plan tab-editor-input-parity.md §7): a 2-beat
// pickup in a 4/4 tune gets a FULL slot, uses half of its note area and
// is pushed right so its end lands on the barline. The renderer says so
// with noteW = half the slot and noteOffset = the other half; every
// overlay function reads exactly those two numbers, so the cursor has to
// land on the pickup's real notes without knowing anything about it.
const PICKUP_GEOMS = [
    // full slot 370 wide; 960 of 1920 ticks -> 185 used, 185 offset
    { display: 1, x: 20, width: 400, ticks: 960, noteX0: 35, noteW: 185, noteOffset: 185, startTick: 0 },
    { display: 2, x: 420, width: 400, ticks: 1920, noteX0: 435, noteW: 370, noteOffset: 0, startTick: 960 },
];
const PICKUP_ROWS = [
    { rowIndex: 0, firstMeasure: 1, lastMeasure: 2, measures: PICKUP_GEOMS },
];

describe('short measures in a uniform slot', () => {
    it('puts the pickup in the RIGHT half of its slot', () => {
        const p = svgPointForPosition(PICKUP_ROWS, { measure: 1, tick: 0, string: 1 }, opts);
        expect(p.x).toBeCloseTo(35 + 185);            // half way across the slot
        // its last tick lands on the barline (noteX0 + full slot width)
        const end = svgPointForPosition(PICKUP_ROWS, { measure: 1, tick: 960, string: 1 }, opts);
        expect(end.x).toBeCloseTo(35 + 370);
    });

    it('beats line up with the measure below: pickup tick t == 4/4 tick t+960', () => {
        for (const tick of [0, 240, 480, 720]) {
            const pick = svgPointForPosition(PICKUP_ROWS, { measure: 1, tick, string: 1 }, opts);
            const full = svgPointForPosition(
                PICKUP_ROWS, { measure: 2, tick: tick + 960, string: 1 }, opts);
            expect(pick.x - PICKUP_GEOMS[0].noteX0)
                .toBeCloseTo(full.x - PICKUP_GEOMS[1].noteX0, 5);
        }
    });

    it('hit-tests clicks in the pickup back to its own ticks', () => {
        for (const tick of [0, 240, 480, 720]) {
            const pos = { measure: 1, tick, string: 3 };
            const p = svgPointForPosition(PICKUP_ROWS, pos, opts);
            expect(positionFromSvgPoint(PICKUP_GEOMS, p.x, p.y, opts)).toEqual(pos);
        }
    });

    it('clicks in the pickup\'s dead left half clamp to its first tick', () => {
        // x inside measure 1's slot but left of its note area
        const hit = positionFromSvgPoint(PICKUP_GEOMS, 60, 30, opts);
        expect(hit).toEqual({ measure: 1, tick: 0, string: 1 });
    });

    it('grid lines follow the offset, one per slot of the SHORT measure', () => {
        const lines = gridLinesForRow(PICKUP_GEOMS, 240, () => 480);
        const m1 = lines.filter(l => l.display === 1);
        expect(m1).toHaveLength(4);                    // 960 / 240
        expect(m1[0].x).toBeCloseTo(35 + 185);         // starts mid-slot
    });
});

describe('selectionRectsForRow', () => {
    it('covers the intersection of the range with each measure\'s note area', () => {
        // last half of m29 + first quarter of m30 (ticks 960..2400)
        const rects = selectionRectsForRow(geoms, 960, 2400);
        expect(rects).toHaveLength(2);
        expect(rects[0]).toMatchObject({ display: 29 });
        expect(rects[0].x0).toBeCloseTo(35 + 185);        // halfway into m29
        expect(rects[0].x1).toBeCloseTo(35 + 370);        // to m29's end
        expect(rects[1]).toMatchObject({ display: 30 });
        expect(rects[1].x0).toBeCloseTo(465);             // m30 note start
        expect(rects[1].x1).toBeCloseTo(465 + 85);        // half of the SHORT measure
    });

    it('skips measures outside the range', () => {
        const rects = selectionRectsForRow(geoms, 0, 960);
        expect(rects).toHaveLength(1);
        expect(rects[0].display).toBe(29);
    });

    it('is ts-aware: tick spans scale by each measure\'s own length', () => {
        // 480 ticks is a quarter of m29 but HALF of m30
        const inLong = selectionRectsForRow(geoms, 0, 480)[0];
        const inShort = selectionRectsForRow(geoms, 1920, 2400)[0];
        expect(inLong.x1 - inLong.x0).toBeCloseTo(370 / 4);
        expect(inShort.x1 - inShort.x0).toBeCloseTo(170 / 2);
    });

    it('returns empty for degenerate or empty input', () => {
        expect(selectionRectsForRow(geoms, 500, 500)).toEqual([]);
        expect(selectionRectsForRow(geoms, 900, 100)).toEqual([]);
        expect(selectionRectsForRow([], 0, 100)).toEqual([]);
        expect(selectionRectsForRow(null, 0, 100)).toEqual([]);
    });
});

describe('gridLinesForRow', () => {
    // 2/2 feels in halves (960 ticks/beat); 2/4 in quarters (480)
    const beatTicksFor = (m) => (m === 30 ? 480 : 960);

    it('emits lines per measure over each measure\'s OWN tick length', () => {
        const lines = gridLinesForRow(geoms, 240, beatTicksFor);
        const m29 = lines.filter(l => l.display === 29);
        const m30 = lines.filter(l => l.display === 30);
        expect(m29).toHaveLength(8);  // 1920 / 240
        expect(m30).toHaveLength(4);  // 960 / 240 — the short measure gets fewer
    });

    it('positions lines inside the note area like the renderer does', () => {
        const lines = gridLinesForRow(geoms, 240, beatTicksFor);
        const m30 = lines.filter(l => l.display === 30);
        expect(m30[0].x).toBeCloseTo(465);            // tick 0 at noteX0+offset
        expect(m30[2].x).toBeCloseTo(465 + 85);       // tick 480 halfway
    });

    it('marks felt beats den-aware', () => {
        const lines = gridLinesForRow(geoms, 240, beatTicksFor);
        expect(lines.filter(l => l.display === 29 && l.isBeat).map(l => l.tick))
            .toEqual([0, 960]);
        expect(lines.filter(l => l.display === 30 && l.isBeat).map(l => l.tick))
            .toEqual([0, 480]);
    });

    it('handles empty geometry', () => {
        expect(gridLinesForRow([], 240, beatTicksFor)).toEqual([]);
        expect(gridLinesForRow(null, 240, beatTicksFor)).toEqual([]);
    });
});
