// Repeat signs (G15d4): the renderer draws what otf.measure_marks stores.
//
// Marks reach the renderer as display fields on each written measure
// (attachOtfDecorations): repeatStart, repeatEnd, ending/endingStart,
// endBar, jump. The unrolled score drops all but endBar (expandNotation).
// Ending 7 and anything only in `raw` model nothing, so nothing is drawn.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { TabRenderer } from '../renderers/tablature.js';
import {
    attachOtfDecorations, expandNotation, prepareCompactNotation,
    readingListTimeline,
} from '../renderers/measure-timing.js';
import { decodeMarkRaw } from '../otf-editor/otf-validate.js';

const TRACK = {
    id: 'banjo', instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};
const mark = (measure, raw) => ({ measure, ...decodeMarkRaw(raw), raw });
const bare = (n) => Array.from({ length: n }, (_, i) => ({
    measure: i + 1, events: [{ tick: 0, notes: [{ s: 1, f: 2 }] }] }));

function draw(otf, { n = 4, width = null } = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    if (width) Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
    if (width) vi.spyOn(TabRenderer, '_hasLayoutEngine').mockReturnValue(true);
    const notation = attachOtfDecorations(bare(n), otf);
    new TabRenderer(container).render(TRACK, notation, 480, '4/4');
    return container;
}
const dots = (c) => c.querySelectorAll('circle').length;

describe('TabRenderer repeat signs', () => {
    const hadBravura = TabRenderer._bravuraReady;
    afterEach(() => { TabRenderer._bravuraReady = hadBravura; vi.restoreAllMocks(); });

    // The nearest full-height thick bar (rect, width 3) to the first dot.
    const thickBarNextToDot = (c) => {
        const svg = c.querySelector('svg');
        const cx = Number(svg.querySelector('circle').getAttribute('cx'));
        const bars = [...svg.querySelectorAll('rect')]
            .filter(r => r.getAttribute('width') === '3' && Number(r.getAttribute('height')) > 30)
            .map(r => Number(r.getAttribute('x')));
        return { cx, x: bars.reduce((best, x) => Math.abs(x - cx) < Math.abs(best - cx) ? x : best) };
    };

    it('|: at the start of the measure (thick bar, thin bar, two dots)', () => {
        const c = draw({ measure_marks: [mark(2, 0x40)] }, { n: 4 });
        expect(dots(c)).toBe(2);
        const { cx, x } = thickBarNextToDot(c);
        expect(cx - x).toBeGreaterThan(0);   // dots sit right of the thick bar
        expect(cx - x).toBeLessThan(15);
    });

    it(':| at the end of the measure (dots left of the bars)', () => {
        const c = draw({ measure_marks: [mark(2, 0x80)] }, { n: 4 });
        expect(dots(c)).toBe(2);
        const { cx, x } = thickBarNextToDot(c);
        expect(x - cx).toBeGreaterThan(0);   // dots sit left of the thick bar
        expect(x - cx).toBeLessThan(15);
    });

    it('a repeat end on the last measure of a row is drawn too', () => {
        expect(dots(draw({ measure_marks: [mark(4, 0x80)] }, { n: 4 }))).toBe(2);
    });

    it('an "n." bracket over the measure: 0x81 is "1." and :|, 0x0a is "2."', () => {
        const c = draw({ measure_marks: [mark(2, 0x81), mark(3, 0x0a)] });
        const labels = [...c.querySelectorAll('text')].map(t => t.textContent);
        expect(labels).toContain('1.');
        expect(labels).toContain('2.');
        expect(dots(c)).toBe(2);   // only the 0x81 repeat end
    });

    it('end_bar is a thin-thick bar with no dots', () => {
        const c = draw({ measure_marks: [mark(2, 0x08)] });
        expect(dots(c)).toBe(0);
        const parts = [...c.querySelectorAll('.end-bar')].map(e => e.tagName);
        expect(parts.sort()).toEqual(['line', 'rect']);
    });

    it('an end bar on the last measure of the row is drawn instead of the plain bar', () => {
        const c = draw({ measure_marks: [mark(4, 0x0a)] }, { n: 4 });
        expect(c.querySelectorAll('.end-bar')).toHaveLength(2);
    });

    it('Signo and Coda are SMuFL glyphs with Bravura, words without', () => {
        TabRenderer._bravuraReady = true;
        let c = draw({ measure_marks: [mark(1, 0x18), mark(2, 0x28)] });
        expect(c.querySelector('.jump-signo').textContent).toBe('');
        expect(c.querySelector('.jump-coda').textContent).toBe('');
        TabRenderer._bravuraReady = false;
        c = draw({ measure_marks: [mark(1, 0x18), mark(2, 0x28)] });
        expect(c.querySelector('.jump-signo').textContent).toBe('Segno');
        expect(c.querySelector('.jump-coda').textContent).toBe('Coda');
    });

    it('Da Signo reads "D.S." and Al Coda reads "To Coda"', () => {
        const c = draw({ measure_marks: [mark(3, 0x10), mark(4, 0x20)] });
        expect(c.querySelector('.jump-da-signo').textContent).toBe('D.S.');
        expect(c.querySelector('.jump-al-coda').textContent).toBe('To Coda');
    });

    it('ending 7 and raw-only marks draw nothing', () => {
        const plain = draw({ measure_marks: [] });
        for (const raw of [0x07, 0x00, 0x0f ^ 0x08 /* 7 */, 0x38 | 0x07]) {
            const c = draw({ measure_marks: [mark(2, raw)] });
            expect(c.querySelectorAll('circle')).toHaveLength(0);
            expect(c.querySelectorAll('.end-bar')).toHaveLength(0);
            expect([...c.querySelectorAll('text')].map(t => t.textContent))
                .not.toContain('7.');
        }
        // 0x07 alone: same SVG as no marks at all
        expect(draw({ measure_marks: [mark(2, 0x07)] }).innerHTML).toBe(plain.innerHTML);
    });

    it('stays inside the staff at phone width (360px)', () => {
        TabRenderer._bravuraReady = true;
        const c = draw({ measure_marks: [mark(1, 0x41), mark(2, 0x81), mark(3, 0x2a), mark(4, 0x10)] },
            { n: 4, width: 360 });
        for (const svg of c.querySelectorAll('svg')) {
            const w = Number(svg.getAttribute('width'));
            expect(w).toBeLessThanOrEqual(360);
            for (const t of svg.querySelectorAll('.jump-mark')) {
                expect(Number(t.getAttribute('x'))).toBeLessThanOrEqual(w);
                expect(Number(t.getAttribute('x'))).toBeGreaterThan(0);
            }
        }
        expect(dots(c)).toBeGreaterThan(0);
    });

    it('sits below the reading-list section label and clear of it', () => {
        const otf = {
            reading_list: [{ from_measure: 1, to_measure: 4, name: 'Part A' }],
            measure_marks: [mark(1, 0x41), mark(2, 0x81), mark(3, 0x10)],
        };
        const c = draw(otf);
        const y = (sel) => Number(c.querySelector(sel).getAttribute('y'));
        const section = y('.section-label');
        const ending = Math.min(...[...c.querySelectorAll('text')]
            .filter(t => /^\d\.$/.test(t.textContent)).map(t => Number(t.getAttribute('y'))));
        const jump = y('.jump-mark');
        expect(ending - section).toBeGreaterThanOrEqual(12);   // 12px label, no overlap
        expect(jump).toBeGreaterThan(ending);
        // and the sign still sits above the first string
        const firstString = Math.min(...[...c.querySelectorAll('line')]
            .map(l => Number(l.getAttribute('y1'))).filter(v => v > jump));
        expect(firstString).toBeGreaterThan(jump);
    });
});

describe('display fields from measure_marks', () => {
    const marks = [mark(1, 0x40), mark(4, 0x81), mark(5, 0x0a)];

    it('attachOtfDecorations sets repeat/ending/endBar fields and ending starts', () => {
        const out = attachOtfDecorations(bare(6), { measure_marks: marks });
        expect(out[0].repeatStart).toBe(true);
        expect(out[3]).toMatchObject({ repeatEnd: true, ending: 1, endingStart: true });
        expect(out[4]).toMatchObject({ ending: 2, endingStart: true, endBar: true });
        expect(out[1].repeatStart).toBeUndefined();
        expect(out[5]).toEqual(bare(6)[5]);
    });

    it('consecutive same-numbered endings share one bracket start', () => {
        const out = attachOtfDecorations(bare(4),
            { measure_marks: [mark(2, 0x01), mark(3, 0x01)] });
        expect([out[1].endingStart, out[2].endingStart]).toEqual([true, undefined]);
    });

    it('does not touch a doc without marks', () => {
        const n = bare(3);
        expect(attachOtfDecorations(n, {})).toBe(n);
    });

    it('unrolling drops repeat signs, endings and jumps but keeps the end bar', () => {
        const decorated = attachOtfDecorations(bare(6), {
            measure_marks: [...marks, mark(6, 0x10)] });
        const rl = [{ from_measure: 1, to_measure: 4 }, { from_measure: 1, to_measure: 3 },
                    { from_measure: 5, to_measure: 6 }];
        const out = expandNotation(decorated, readingListTimeline(rl, 6));
        for (const m of out) {
            expect(m.repeatStart).toBeUndefined();
            expect(m.repeatEnd).toBeUndefined();
            expect(m.ending).toBeUndefined();
            expect(m.jump).toBeUndefined();
        }
        expect(out.some(m => m.endBar)).toBe(true);
    });

    it('reading-list-derived signs merge with stored marks (one sign, not two)', () => {
        const rl = [{ from_measure: 1, to_measure: 8 }, { from_measure: 1, to_measure: 8 }];
        const stored = attachOtfDecorations(bare(8), { measure_marks: [mark(8, 0x80)] });
        const merged = prepareCompactNotation(stored, rl);
        expect(merged[7].repeatEnd).toBe(true);
        expect(merged[0].repeatStart).toBe(true);   // derived, marks had none
    });
});
