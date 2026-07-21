// Unit tests for click → position mapping from real renderer geometry.
// The old mapper assumed uniform measure widths and a fixed
// measures-per-row; TabRenderer produces variable widths (adornments,
// short 2/4 measures), so clicks drifted — especially when scrolled.
import { describe, it, expect } from 'vitest';

import { positionFromSvgPoint } from '../../otf-editor/cursor.js';

// Two-measure row mimicking a 2/2 tune with a 2/4 measure: m30 is half
// the ticks and narrower. Geometry shaped like TabRenderer's rowData
// measures (x, width, ticks, noteX0, noteW, noteOffset).
const geoms = [
    { display: 29, x: 20, width: 400, ticks: 1920, noteX0: 35, noteW: 370, noteOffset: 0 },
    { display: 30, x: 420, width: 220, ticks: 960, noteX0: 455, noteW: 170, noteOffset: 10 },
];

const opts = {
    topMargin: 30,
    stringSpacing: 15,
    stringCount: 5,
    gridSubdivision: 240,
};

describe('positionFromSvgPoint', () => {
    it('maps a point to the measure containing it', () => {
        expect(positionFromSvgPoint(geoms, 100, 30, opts).measure).toBe(29);
        expect(positionFromSvgPoint(geoms, 500, 30, opts).measure).toBe(30);
    });

    it('maps x within the note area to a grid-snapped tick', () => {
        // middle of m29's note area → half of 1920, snapped to 240 grid
        const mid = positionFromSvgPoint(geoms, 35 + 185, 30, opts);
        expect(mid.measure).toBe(29);
        expect(mid.tick).toBe(960);
        // left edge of the note area → tick 0
        expect(positionFromSvgPoint(geoms, 35, 30, opts).tick).toBe(0);
    });

    it('is ts-aware: the short measure maps over ITS tick length', () => {
        // middle of m30's note area (noteX0 455 + offset 10, width 170)
        const p = positionFromSvgPoint(geoms, 465 + 85, 30, opts);
        expect(p.measure).toBe(30);
        expect(p.tick).toBe(480); // half of 960, snapped
    });

    it('clamps the tick inside the measure at the right edge', () => {
        const p = positionFromSvgPoint(geoms, 420 + 219, 30, opts);
        expect(p.measure).toBe(30);
        expect(p.tick).toBeLessThan(960);
        expect(p.tick % opts.gridSubdivision).toBe(0);
    });

    it('clamps x before the first and past the last measure', () => {
        expect(positionFromSvgPoint(geoms, 2, 30, opts).measure).toBe(29);
        const past = positionFromSvgPoint(geoms, 900, 30, opts);
        expect(past.measure).toBe(30);
    });

    it('maps y to the nearest string, clamped to the instrument', () => {
        expect(positionFromSvgPoint(geoms, 100, 30, opts).string).toBe(1);
        expect(positionFromSvgPoint(geoms, 100, 30 + 15, opts).string).toBe(2);
        expect(positionFromSvgPoint(geoms, 100, 30 + 4 * 15 + 7, opts).string).toBe(5);
        expect(positionFromSvgPoint(geoms, 100, 0, opts).string).toBe(1);      // above staff
        expect(positionFromSvgPoint(geoms, 100, 500, opts).string).toBe(5);    // below staff
    });

    it('respects the grid subdivision', () => {
        const fine = { ...opts, gridSubdivision: 120 };
        const p = positionFromSvgPoint(geoms, 35 + 46, 30, fine); // ~1/8 in
        expect(p.tick % 120).toBe(0);
    });

    it('returns null for empty geometry', () => {
        expect(positionFromSvgPoint([], 100, 30, opts)).toBeNull();
        expect(positionFromSvgPoint(null, 100, 30, opts)).toBeNull();
    });
});
