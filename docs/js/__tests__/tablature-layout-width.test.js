// The staff's width budget, and what happens when there isn't one.
//
// A container inside a `display:none` ancestor (an unselected track's
// section, a page still behind `.hidden`) reports clientWidth 0. The
// renderer used to answer that with `|| 800` and engrave an 800px staff —
// which looked merely narrow in a wide viewport and ran off the right edge
// the moment the viewport was narrower than 800 (browser zoom, phone). The
// reflow logic was never at fault; its input was a guess.
//
// jsdom has no layout at all, so these tests do two things explicitly:
// stub `TabRenderer._hasLayoutEngine()` to say "a browser would know the
// width here", and define clientWidth on the container.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TabRenderer } from '../renderers/tablature.js';

const TRACK = {
    id: 'banjo', instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};
// Enough measures that measures-per-row is visible in the row count.
const NOTATION = Array.from({ length: 16 }, (_, i) => ({
    measure: i + 1,
    events: [{ tick: 0, notes: [{ s: 1, f: i % 5 }] }],
}));

const setWidth = (el, width) =>
    Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });

const rows = (container) => container.querySelectorAll('.stave-row').length;
const svgWidths = (container) => [...container.querySelectorAll('.stave-row svg')]
    .map(s => Number(s.getAttribute('width')));

// Minimal ResizeObserver stand-in: jsdom has none, and the point of these
// tests is the plumbing (who is observed, and what a fire does), which is
// exactly what a stub can pin. Real reflow is verified in a browser.
class FakeResizeObserver {
    static instances = [];
    constructor(cb) {
        this.cb = cb;
        this.observed = [];
        FakeResizeObserver.instances.push(this);
    }
    observe(el) { this.observed.push(el); }
    disconnect() { this.observed = []; }
    fire() { this.cb([], this); }
}

describe('TabRenderer width budget', () => {
    let container;

    beforeEach(() => {
        FakeResizeObserver.instances = [];
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        container.remove();
    });

    describe('with no layout engine (jsdom, headless callers)', () => {
        it('keeps the nominal width rather than deferring forever', () => {
            // There is no reveal to wait for here, so drawing is right.
            expect(TabRenderer._hasLayoutEngine()).toBe(false);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);
            expect(rows(container)).toBeGreaterThan(0);
            expect(r._layoutWidth).toBe(TabRenderer.NOMINAL_WIDTH);
            expect(r._layoutDeferred).toBe(false);
        });
    });

    describe('in a browser', () => {
        beforeEach(() => {
            vi.spyOn(TabRenderer, '_hasLayoutEngine').mockReturnValue(true);
        });

        it('lays out against the container width, not a fallback', () => {
            setWidth(container, 1300);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);

            expect(r._layoutWidth).toBe(1300);
            // Every row is engraved to fit that width — no 800px staff.
            for (const w of svgWidths(container)) {
                expect(w).toBeLessThanOrEqual(1300);
                expect(w).toBeGreaterThan(TabRenderer.NOMINAL_WIDTH);
            }
        });

        it('a narrower container reflows to fewer measures per row', () => {
            setWidth(container, 1300);
            const wide = new TabRenderer(container);
            wide.render(TRACK, NOTATION);
            const wideRows = rows(container);

            const narrow = document.createElement('div');
            document.body.appendChild(narrow);
            setWidth(narrow, 420);
            const r = new TabRenderer(narrow);
            r.render(TRACK, NOTATION);

            expect(rows(narrow)).toBeGreaterThan(wideRows);
            // and nothing engraved wider than the box it must fit in
            for (const w of svgWidths(narrow)) expect(w).toBeLessThanOrEqual(420);
            narrow.remove();
        });

        it('draws nothing into a container that has no box yet', () => {
            setWidth(container, 0);            // display:none ancestor
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);

            expect(rows(container)).toBe(0);
            expect(r._layoutDeferred).toBe(true);
            expect(r._layoutWidth).toBe(0);
        });

        it('observes the container BEFORE the first (possibly deferred) draw', () => {
            setWidth(container, 0);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);

            const observer = FakeResizeObserver.instances[0];
            expect(observer).toBeDefined();
            expect(observer.observed).toContain(container);
            // Deferred while it was already being watched — the promise the
            // observer owes can actually be kept.
            expect(r._layoutDeferred).toBe(true);
        });

        it('draws on reveal, synchronously, at the real width', () => {
            setWidth(container, 0);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);
            expect(rows(container)).toBe(0);

            setWidth(container, 900);                    // the reveal
            FakeResizeObserver.instances[0].fire();

            // No timer was needed: a debounce here would mean 150ms of
            // wrong layout followed by a reflow flash.
            expect(rows(container)).toBeGreaterThan(0);
            expect(r._layoutWidth).toBe(900);
            expect(r._layoutDeferred).toBe(false);
        });

        it('never re-renders into a container that lost its box', () => {
            setWidth(container, 1300);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);
            const before = svgWidths(container);

            setWidth(container, 0);                      // track hidden
            FakeResizeObserver.instances[0].fire();
            vi.runAllTimers();

            // Hiding a track must not overwrite its good layout with a guess.
            expect(svgWidths(container)).toEqual(before);
            expect(r._layoutWidth).toBe(1300);
        });

        it('debounces a genuine resize and ignores a no-op one', () => {
            setWidth(container, 1300);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);
            const spy = vi.spyOn(r, '_renderInternal');
            const observer = FakeResizeObserver.instances[0];

            observer.fire();                 // same width: nothing changed
            vi.runAllTimers();
            expect(spy).not.toHaveBeenCalled();

            setWidth(container, 600);
            observer.fire();
            expect(spy).not.toHaveBeenCalled();   // debounced, not immediate
            vi.advanceTimersByTime(150);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(r._layoutWidth).toBe(600);
        });

        it('subtracts the container padding from the budget', () => {
            setWidth(container, 1300);
            container.style.padding = '0 16px';
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);
            // The staff must fit the CONTENT box; laying out against the
            // padded width made every row 32px too wide, which CSS then
            // silently scaled back down.
            expect(r._layoutWidth).toBe(1268);
        });
    });

    describe('setScale — size is a layout input, not a lens', () => {
        beforeEach(() => {
            vi.spyOn(TabRenderer, '_hasLayoutEngine').mockReturnValue(true);
        });

        it('a bigger scale reflows to fewer measures per row', () => {
            setWidth(container, 1300);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);
            const before = rows(container);

            r.setScale(1.6);

            // The CSS transform scales the drawing back up, so the budget
            // shrinks: bigger notes, fewer per row, same total width.
            expect(r._layoutWidth).toBeCloseTo(1300 / 1.6, 5);
            expect(rows(container)).toBeGreaterThan(before);
            expect(container.style.getPropertyValue('--tab-scale')).toBe('1.6');
        });

        it('a smaller scale fits more measures per row', () => {
            setWidth(container, 1300);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);
            const before = rows(container);

            r.setScale(0.6);
            expect(rows(container)).toBeLessThanOrEqual(before);
            expect(r._layoutWidth).toBeCloseTo(1300 / 0.6, 5);
        });

        it('re-setting the same scale is a no-op', () => {
            setWidth(container, 1300);
            const r = new TabRenderer(container);
            r.render(TRACK, NOTATION);
            const spy = vi.spyOn(r, '_renderInternal');
            r.setScale(1);
            expect(spy).not.toHaveBeenCalled();
        });
    });
});
