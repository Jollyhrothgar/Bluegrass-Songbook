// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
    computeTargetIndex, indicatorY, computeDragScroll,
    DRAG_EDGE_PX, DRAG_MAX_STEP
} from '../visual-editor/drag-reorder.js';

// three stacked cards, 100px tall, 10px gaps (host coords)
const RECTS = [
    { top: 0, bottom: 100 },
    { top: 110, bottom: 210 },
    { top: 220, bottom: 320 }
];

describe('computeTargetIndex', () => {
    it('keeps the index when the pointer stays inside the dragged card', () => {
        expect(computeTargetIndex(RECTS, 0, 50)).toBe(0);
        expect(computeTargetIndex(RECTS, 1, 160)).toBe(1);
        expect(computeTargetIndex(RECTS, 2, 300)).toBe(2);
    });

    it('moves down once the pointer passes the next card midpoint', () => {
        expect(computeTargetIndex(RECTS, 0, 159)).toBe(0);  // above card 1 mid
        expect(computeTargetIndex(RECTS, 0, 161)).toBe(1);  // past card 1 mid
        expect(computeTargetIndex(RECTS, 0, 271)).toBe(2);  // past card 2 mid
    });

    it('moves up once the pointer passes the previous card midpoint', () => {
        expect(computeTargetIndex(RECTS, 2, 51)).toBe(1);   // above card 1 mid
        expect(computeTargetIndex(RECTS, 2, 49)).toBe(0);   // above card 0 mid
    });

    it('clamps to the ends for far-out pointer positions', () => {
        expect(computeTargetIndex(RECTS, 1, -500)).toBe(0);
        expect(computeTargetIndex(RECTS, 1, 5000)).toBe(2);
    });

    it('handles a single card', () => {
        expect(computeTargetIndex([{ top: 0, bottom: 100 }], 0, 9999)).toBe(0);
    });
});

describe('indicatorY', () => {
    it('sits above the first card for target 0', () => {
        expect(indicatorY(RECTS, 2, 0)).toBe(RECTS[0].top - 2);
    });
    it('sits below the last remaining card for the end target', () => {
        expect(indicatorY(RECTS, 0, 2)).toBe(RECTS[2].bottom + 2);
    });
    it('sits in the middle of an interior gap (dragged card excluded)', () => {
        // dragging card 0; target 1 = gap between cards 1 and 2
        expect(indicatorY(RECTS, 0, 1)).toBe((210 + 220) / 2);
        // dragging card 2; target 1 = gap between cards 0 and 1
        expect(indicatorY(RECTS, 2, 1)).toBe((100 + 110) / 2);
    });
});

describe('computeDragScroll', () => {
    it('is zero in the middle of the viewport', () => {
        expect(computeDragScroll(400, 0, 800)).toBe(0);
    });
    it('scrolls up near the top, faster closer to the edge', () => {
        const slow = computeDragScroll(DRAG_EDGE_PX - 4, 0, 800);
        const fast = computeDragScroll(2, 0, 800);
        expect(slow).toBeLessThan(0);
        expect(fast).toBeLessThan(slow);
        expect(fast).toBeGreaterThanOrEqual(-DRAG_MAX_STEP);
    });
    it('scrolls down near the bottom and caps at max speed', () => {
        expect(computeDragScroll(800 - 4, 0, 800)).toBeGreaterThan(0);
        expect(computeDragScroll(2000, 0, 800)).toBe(DRAG_MAX_STEP);
    });
});
