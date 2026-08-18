// Keeping the edit cursor visible inside the editor's OWN scroll region.
//
// The create-a-tab page now pins its chrome and scrolls only the tab, so
// "scroll to follow the cursor" means the canvas container's scrollTop —
// never the window's. These cover the arithmetic that decides it.
import { describe, it, expect } from 'vitest';

import { EditorCursor, scrollToReveal } from '../../otf-editor/cursor.js';

describe('scrollToReveal', () => {
    const VIEW = 300;

    it('leaves the offset alone when the item already fits', () => {
        expect(scrollToReveal(0, VIEW, 100, 20)).toBe(0);
        expect(scrollToReveal(500, VIEW, 600, 20)).toBe(500);
    });

    it('scrolls back when the item is off the near edge', () => {
        // item at 100, margin 24 -> reveal from 76
        expect(scrollToReveal(200, VIEW, 100, 20, 24)).toBe(76);
    });

    it('never scrolls past zero', () => {
        expect(scrollToReveal(50, VIEW, 5, 20, 24)).toBe(0);
    });

    it('scrolls forward just far enough when the item is off the far edge', () => {
        // trailing edge 400+20+24 = 444; 444 - 300 = 144
        expect(scrollToReveal(0, VIEW, 400, 20, 24)).toBe(144);
    });

    it('accounts for the margin at the edge the item enters from', () => {
        const withMargin = scrollToReveal(0, VIEW, 400, 20, 24);
        const noMargin = scrollToReveal(0, VIEW, 400, 20, 0);
        expect(withMargin - noMargin).toBe(24);
    });

    it('pins an item taller than the viewport to its own start', () => {
        // A 400px item in a 300px window: showing its end would push its
        // start (where the cursor is) out of sight.
        expect(scrollToReveal(0, VIEW, 500, 400, 24)).toBe(476);
    });

    it('is a no-op when the element is not laid out (or not a scroller)', () => {
        expect(scrollToReveal(0, 0, 9999, 20)).toBe(0);
        expect(scrollToReveal(30, undefined, 9999, 20)).toBe(30);
    });
});

describe('EditorCursor.revealCursor', () => {
    /** Minimal stand-in for the canvas container's scroll surface. */
    const scroller = (over = {}) => ({
        scrollTop: 0, scrollLeft: 0,
        clientHeight: 300, clientWidth: 500,
        ...over,
    });

    /** revealCursor only touches this.container — no DOM mount needed. */
    const cursorWith = (container) => {
        const c = Object.create(EditorCursor.prototype);
        c.container = container;
        return c;
    };

    it('scrolls the container (not the window) to a cursor below the fold', () => {
        const el = scroller();
        cursorWith(el).revealCursor({ x: 40, y: 800 });
        // box is y±14 -> [786, 814); +24 margin -> 838; 838 - 300
        expect(el.scrollTop).toBe(538);
        expect(el.scrollLeft).toBe(0);   // horizontally already visible
    });

    it('scrolls horizontally for a cursor off the right edge', () => {
        const el = scroller();
        cursorWith(el).revealCursor({ x: 1200, y: 20 });
        expect(el.scrollLeft).toBe(1200 + 14 + 24 - 500);
        expect(el.scrollTop).toBe(0);
    });

    it('brings a cursor scrolled off the top back into view', () => {
        const el = scroller({ scrollTop: 600 });
        cursorWith(el).revealCursor({ x: 10, y: 300 });
        expect(el.scrollTop).toBe(300 - 14 - 24);
    });

    it('goes all the way home when the first row is nearly in view', () => {
        // Jumping back to measure 1 must not leave the track header (and
        // the top of the staff) shaved off by a few pixels.
        const el = scroller({ scrollTop: 500 });
        cursorWith(el).revealCursor({ x: 10, y: 120 });
        expect(el.scrollTop).toBe(0);
    });

    it('does not snap a cursor that was already visible', () => {
        const el = scroller({ scrollTop: 30, scrollLeft: 20 });
        cursorWith(el).revealCursor({ x: 100, y: 100 });
        expect(el.scrollTop).toBe(30);
        expect(el.scrollLeft).toBe(20);
    });

    it('does not move an already-visible cursor', () => {
        const el = scroller({ scrollTop: 100, scrollLeft: 50 });
        cursorWith(el).revealCursor({ x: 200, y: 200 });
        expect(el.scrollTop).toBe(100);
        expect(el.scrollLeft).toBe(50);
    });

    it('survives a missing container or position', () => {
        expect(() => cursorWith(null).revealCursor({ x: 1, y: 1 })).not.toThrow();
        expect(() => cursorWith(scroller()).revealCursor(null)).not.toThrow();
    });
});
