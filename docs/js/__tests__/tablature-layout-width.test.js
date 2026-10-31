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

        describe('bars per row: Auto or an exact count (G22)', () => {
            const draw = (width, barsPerRow = 'auto', { scale = 1, notation = NOTATION } = {}) => {
                const el = document.createElement('div');
                document.body.appendChild(el);
                setWidth(el, width);
                const r = new TabRenderer(el);
                r.options.barsPerRow = barsPerRow;
                if (scale !== 1) r._scale = scale;
                r.render(TRACK, notation);
                return { r, el };
            };

            it('Auto is the default and reads the count from the music', () => {
                // NOTATION is one note per bar: sparse, so the floor (180) rules: 1220 / 180 = 6
                expect(draw(1300).r.rowFit()).toMatchObject({ chosen: null, auto: 6, count: 6, most: 8 });
            });

            it('Auto gives fewer bars to denser music at the same width', () => {
                const dense = Array.from({ length: 16 }, (_, i) => ({
                    measure: i + 1,
                    events: Array.from({ length: 32 }, (_, k) => ({ tick: k * 60, notes: [{ s: 1, f: k % 5 }] })),
                }));
                const sparse = draw(1300).r.rowFit().auto;
                const busy = draw(1300, 'auto', { notation: dense }).r.rowFit().auto;
                expect(busy).toBeLessThan(sparse);
                expect(busy).toBe(3);   // 32nds need 32 x 11 + 30 = 382px a bar; 1220 holds three
            });

            it('Auto follows Size: a bigger staff leaves fewer bars per row', () => {
                expect(draw(1300, 'auto', { scale: 1.6 }).r.rowFit().auto)
                    .toBeLessThan(draw(1300).r.rowFit().auto);
            });

            it('Auto re-fits when the container resizes', () => {
                const { r, el } = draw(1300);
                setWidth(el, 700);   // usable 620 -> 3
                r._onContainerResize();
                vi.advanceTimersByTime(150);
                expect(r.rowFit()).toMatchObject({ chosen: null, auto: 3, count: 3 });
            });

            it('an exact count holds at any width that has room', () => {
                for (const width of [700, 1000, 1300, 1800]) {
                    const { r } = draw(width, 2);
                    expect(r.rowFit()).toMatchObject({ chosen: 2, count: 2 });
                    expect(r._computedMeasuresPerRow).toBe(2);
                }
            });

            it('an exact count survives a resize: set 2, widen, still 2', () => {
                const { r, el } = draw(700, 2);
                setWidth(el, 1800);
                r._onContainerResize();
                vi.advanceTimersByTime(150);
                expect(r.rowFit().count).toBe(2);
            });

            it('an exact count stretches to fill the row (no maxMeasureWidth cap)', () => {
                const { r, el } = draw(1300, 2);
                expect(r._computedMeasureWidth).toBeCloseTo((1300 - r.options.leftMargin - 30) / 2, 5);
                expect(r._computedMeasureWidth).toBeGreaterThan(r.options.maxMeasureWidth);
                // the row's svg spans the usable width
                const w = svgWidths(el)[0];
                expect(w).toBeGreaterThan(1300 - r.options.leftMargin - 30);
            });

            it('Auto rows fill the width too', () => {
                const { r } = draw(1300);
                expect(r._computedMeasureWidth * r._computedMeasuresPerRow)
                    .toBeCloseTo(1300 - r.options.leftMargin - 30, 5);
            });

            it('clamps an exact count to 1-8', () => {
                expect(draw(1800, 99).r.rowFit()).toMatchObject({ chosen: 8, count: 8 });
                expect(draw(1800, 0).r.rowFit()).toMatchObject({ chosen: 1, count: 1 });
            });

            it('shows the most that fit at the hard floor, and the chosen count returns with room', () => {
                // 420 wide: 340 usable; a 4th bar would be 85px < 90px
                const { r, el } = draw(420, 5);
                expect(r.rowFit()).toMatchObject({ chosen: 5, count: 3, most: 3 });
                expect(r._computedMeasureWidth).toBeGreaterThanOrEqual(r.options.hardMinMeasureWidth);
                for (const w of svgWidths(el)) expect(w).toBeLessThanOrEqual(420);
                setWidth(el, 1300);
                r._onContainerResize();
                vi.advanceTimersByTime(150);
                expect(r.rowFit()).toMatchObject({ chosen: 5, count: 5 });
            });

            it('setBarsPerRow re-lays out and accepts auto', () => {
                const { r, el } = draw(1300);
                const before = rows(el);
                r.setBarsPerRow(3);
                expect(r.rowFit()).toMatchObject({ chosen: 3, count: 3 });
                expect(rows(el)).toBeGreaterThan(before);
                r.setBarsPerRow('auto');
                expect(r.rowFit()).toMatchObject({ chosen: null, count: 6 });
                expect(rows(el)).toBe(before);
            });

            it('has no fit to report while measuresPerRow is pinned', () => {
                const el = document.createElement('div');
                document.body.appendChild(el);
                setWidth(el, 1300);
                const r = new TabRenderer(el, { measuresPerRow: 4 });
                r.render(TRACK, NOTATION);
                expect(r.rowFit()).toBeNull();
            });

            it('a pinned count (the tab editor) never squeezes below minMeasureWidth', () => {
                // the editor's layout (A20/A21) keeps triplets and 32nds readable and
                // scrolls a row that doesn't fit; only the reader's count squeezes
                const el = document.createElement('div');
                document.body.appendChild(el);
                setWidth(el, 420);
                const r = new TabRenderer(el, { measuresPerRow: 3 });
                r.render(TRACK, NOTATION);
                expect(r._computedMeasuresPerRow).toBe(3);
                expect(r._computedMeasureWidth).toBe(r.options.minMeasureWidth);
            });
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
