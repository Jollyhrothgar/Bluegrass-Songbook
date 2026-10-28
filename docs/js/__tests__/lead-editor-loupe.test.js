// The loupe's placement (pure): centred on the finger, kept 6px inside the viewport, never above the top band, and
// the content aligned so the spot under the finger sits right above the tail, also when the bubble is clamped.
import { describe, it, expect } from 'vitest';
import { placeLoupe, LOUPE_SCALE, LOUPE_GAP } from '../lead-editor/loupe.js';

const base = { vw: 390, topLimit: 48, height: 70, chartBoxLeft: 200, cloneBoxLeft: 150 };
// the spot under the finger, in the bubble: where the content puts it after the shift
const underTail = (p, o) => (p.shift + o.cloneBoxLeft + (o.fingerX - o.chartBoxLeft) * LOUPE_SCALE);

describe('placeLoupe', () => {
    it('is centred on the finger, 280px wide, bottom edge 56px above it', () => {
        const o = { ...base, fingerX: 195, fingerY: 400 };
        const p = placeLoupe(o);
        expect(p.width).toBe(280);
        expect(p.left).toBe(55);
        expect(p.top + o.height).toBe(400 - LOUPE_GAP);
        expect(p.tailX).toBe(140);
        expect(underTail(p, o)).toBeCloseTo(p.tailX);
    });
    it('narrow viewports: the width is viewport - 12', () => {
        expect(placeLoupe({ ...base, vw: 200, fingerX: 100, fingerY: 400 }).width).toBe(188);
    });
    it('clamps 6px from the left edge; the tail follows the finger and the content stays aligned', () => {
        const o = { ...base, fingerX: 20, fingerY: 400 };
        const p = placeLoupe(o);
        expect(p.left).toBe(6);
        expect(p.tailX).toBe(14);
        expect(underTail(p, o)).toBeCloseTo(p.tailX);
    });
    it('clamps 6px from the right edge', () => {
        const o = { ...base, fingerX: 370, fingerY: 400 };
        const p = placeLoupe(o);
        expect(p.left + p.width).toBe(384);
        expect(p.tailX).toBe(370 - p.left);
        expect(underTail(p, o)).toBeCloseTo(p.tailX);
    });
    it('the tail never reaches the bubble corner', () => {
        expect(placeLoupe({ ...base, fingerX: 0, fingerY: 400 }).tailX).toBe(10);
        expect(placeLoupe({ ...base, fingerX: 390, fingerY: 400 }).tailX).toBe(270);
    });
    it('never above the top band: with no room it sits just below it', () => {
        const p = placeLoupe({ ...base, fingerX: 195, fingerY: 100 });
        expect(p.top).toBe(48);
    });
    it('without a boxed element the content is not shifted', () => {
        expect(placeLoupe({ ...base, chartBoxLeft: null, cloneBoxLeft: null, fingerX: 195, fingerY: 400 }).shift).toBe(0);
    });
});
