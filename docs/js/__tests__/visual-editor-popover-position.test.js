// Pure placement math for the anchored chord-palette popover (wide layout).
// Mirrors visual-editor-autoscroll.test.js: geometry in, decision out —
// no DOM, no layout.
import { describe, it, expect } from 'vitest';
import {
    computePopoverPosition, anchorRectFor, POPOVER_GAP, POPOVER_MARGIN
} from '../visual-editor/popover-position.js';

// A comfortable desktop-ish stage: preview pane on the right half.
const paneRect = { left: 700, right: 1400 };
const viewportHeight = 900;
const pop = { popWidth: 400, popHeight: 220 };

function target({ left, top, width = 40, height = 24 }) {
    return { left, top, width, height, right: left + width, bottom: top + height };
}

describe('computePopoverPosition — vertical placement', () => {
    it('sits below the target when there is room (dropdown-style)', () => {
        const t = target({ left: 900, top: 100 });
        const pos = computePopoverPosition({ targetRect: t, ...pop, paneRect, viewportHeight });
        expect(pos.placement).toBe('below');
        expect(pos.top).toBe(t.bottom + POPOVER_GAP);
    });

    it('flips above the target when below would overflow the viewport', () => {
        const t = target({ left: 900, top: 800 });   // bottom 824; 824+8+220 > 892
        const pos = computePopoverPosition({ targetRect: t, ...pop, paneRect, viewportHeight });
        expect(pos.placement).toBe('above');
        expect(pos.top).toBe(t.top - POPOVER_GAP - pop.popHeight);
        // fully inside the viewport
        expect(pos.top).toBeGreaterThanOrEqual(POPOVER_MARGIN);
        expect(pos.top + pop.popHeight).toBeLessThanOrEqual(viewportHeight);
    });

    it('uses the exact fit boundary (no premature flip)', () => {
        // bottom + gap + height == viewportHeight - margin → still below
        const top = viewportHeight - POPOVER_MARGIN - pop.popHeight - POPOVER_GAP - 24;
        const t = target({ left: 900, top });
        const pos = computePopoverPosition({ targetRect: t, ...pop, paneRect, viewportHeight });
        expect(pos.placement).toBe('below');
    });

    it('shrinks to the roomier side when it fits neither side — never covers the anchor', () => {
        // short viewport, tall popover (open picker): neither side fits whole
        const t = target({ left: 900, top: 300 });
        const pos = computePopoverPosition({
            targetRect: t, popWidth: 400, popHeight: 800, paneRect, viewportHeight: 600
        });
        // above has 284px of room vs 260 below → go above, shrunk to fit
        expect(pos.placement).toBe('above');
        expect(pos.maxHeight).toBe(t.top - POPOVER_GAP - POPOVER_MARGIN);
        expect(pos.top).toBeGreaterThanOrEqual(POPOVER_MARGIN);
        // shrunk popover ends above the target: the anchor stays tappable
        expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(t.top);
    });

    it('reports the room on the chosen side as maxHeight (internal scrolling cap)', () => {
        const t = target({ left: 900, top: 100 });
        const pos = computePopoverPosition({ targetRect: t, ...pop, paneRect, viewportHeight });
        expect(pos.placement).toBe('below');
        expect(pos.maxHeight)
            .toBe(viewportHeight - POPOVER_MARGIN - t.bottom - POPOVER_GAP);
    });
});

describe('computePopoverPosition — horizontal clamping', () => {
    it('centers on the target when there is room on both sides', () => {
        const t = target({ left: 1000, top: 100 });
        const pos = computePopoverPosition({ targetRect: t, ...pop, paneRect, viewportHeight });
        expect(pos.left).toBe(1000 + 20 - 200);   // target center minus half width
    });

    it('clamps to the pane left edge for targets near the left', () => {
        const t = target({ left: 710, top: 100 });
        const pos = computePopoverPosition({ targetRect: t, ...pop, paneRect, viewportHeight });
        expect(pos.left).toBe(paneRect.left + POPOVER_MARGIN);
    });

    it('clamps to the pane right edge for targets near the right', () => {
        const t = target({ left: 1350, top: 100 });
        const pos = computePopoverPosition({ targetRect: t, ...pop, paneRect, viewportHeight });
        expect(pos.left).toBe(paneRect.right - pop.popWidth - POPOVER_MARGIN);
        expect(pos.left + pop.popWidth).toBeLessThanOrEqual(paneRect.right);
    });

    it('pins to the pane left edge when the popover is wider than the pane', () => {
        const narrowPane = { left: 700, right: 1000 };
        const t = target({ left: 900, top: 100 });
        const pos = computePopoverPosition({
            targetRect: t, ...pop, paneRect: narrowPane, viewportHeight
        });
        expect(pos.left).toBe(narrowPane.left + POPOVER_MARGIN);
    });
});

describe('computePopoverPosition — follows the target on scroll', () => {
    it('tracks a scrolling anchor 1:1 while the placement side is stable', () => {
        const before = computePopoverPosition({
            targetRect: target({ left: 900, top: 300 }), ...pop, paneRect, viewportHeight
        });
        // pane scrolled down 120px → the target moved up 120px on screen
        const after = computePopoverPosition({
            targetRect: target({ left: 900, top: 180 }), ...pop, paneRect, viewportHeight
        });
        expect(before.placement).toBe('below');
        expect(after.placement).toBe('below');
        expect(before.top - after.top).toBe(120);
        expect(after.left).toBe(before.left);
    });

    it('flips from below to above as the target scrolls toward the fold', () => {
        const mid = computePopoverPosition({
            targetRect: target({ left: 900, top: 400 }), ...pop, paneRect, viewportHeight
        });
        const low = computePopoverPosition({
            targetRect: target({ left: 900, top: 850 }), ...pop, paneRect, viewportHeight
        });
        expect(mid.placement).toBe('below');
        expect(low.placement).toBe('above');
    });
});

describe('anchorRectFor — chip selections anchor to the whole line', () => {
    it('extends a chip rect to the full line so the popover clears the lyrics', () => {
        const chip = { left: 900, width: 30, top: 200, bottom: 220 };
        const line = { left: 750, width: 500, top: 200, bottom: 252 };
        const anchor = anchorRectFor({ targetRect: chip, lineRect: line });
        // horizontal stays on the chip, vertical spans the line
        expect(anchor.left).toBe(900);
        expect(anchor.width).toBe(30);
        expect(anchor.top).toBe(200);
        expect(anchor.bottom).toBe(252);
        // placed below this anchor, the popover starts under the lyric row
        const pos = computePopoverPosition({
            targetRect: anchor, ...pop, paneRect, viewportHeight
        });
        expect(pos.top).toBeGreaterThanOrEqual(line.bottom);
    });

    it('returns the target rect untouched when there is no line', () => {
        const t = { left: 10, width: 20, top: 30, bottom: 50 };
        expect(anchorRectFor({ targetRect: t, lineRect: null })).toEqual(t);
    });
});
