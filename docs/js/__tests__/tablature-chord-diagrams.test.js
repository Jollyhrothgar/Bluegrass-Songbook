// Chord diagrams on the tab staff (G15d3): a box above the owning track's
// staff at the anchor's measure and tick, the name printed once, and a band
// reserved only for tabs that have diagrams.
//
// jsdom has no layout engine, so the renderer lays out against its nominal
// 800px width (4 measures per row); the phone-width case stubs clientWidth.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TabRenderer } from '../renderers/tablature.js';
import { attachChordDiagrams, attachOtfDecorations } from '../renderers/measure-timing.js';
import { CHORD_BOX_HEIGHT } from '../renderers/chord-box.js';

const TRACK = { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] };
const OTF = {
    chords: [
        { name: 'G', frets: [0, 0, 0, 0, 0] },
        { name: 'Am7' },
        { name: 'D', frets: [2, 3, 2, 0, null] },
    ],
    chord_diagrams: [
        { measure: 1, tick: 0, track: 'banjo', chord: 0 },
        { measure: 1, tick: 960, track: 'banjo', chord: 2 },
        { measure: 2, tick: 480, track: 'banjo', chord: 1 },
        { measure: 2, tick: 0, track: 'guitar', chord: 0 },        // another track's
    ],
    annotations: [],
};
const base = () => [1, 2, 3, 4, 5].map(m => ({
    measure: m, events: [{ tick: 0, notes: [{ s: 1, f: m % 4 }] }],
}));

function draw(otf = OTF, width = null) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    if (width) Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
    let notation = attachOtfDecorations(base(), otf);
    notation = attachChordDiagrams(notation, otf, 'banjo');
    const renderer = new TabRenderer(container);
    renderer.render(TRACK, notation, 480, '4/4');
    return { container, renderer };
}
const topMarginOf = (c) => {
    const lines = [...c.querySelectorAll('.stave-row svg > line')];
    const ys = lines.filter(l => l.getAttribute('y1') === l.getAttribute('y2')).map(l => Number(l.getAttribute('y1')));
    return Math.min(...ys);
};

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('attachChordDiagrams', () => {
    it('hangs the resolved chord on its measure, for this track only', () => {
        const out = attachChordDiagrams(base(), OTF, 'banjo');
        expect(out[0].diagrams.map(d => [d.tick, d.chord.name])).toEqual([[0, 'G'], [960, 'D']]);
        expect(out[1].diagrams.map(d => d.chord.name)).toEqual(['Am7']);
        expect(out[2].diagrams).toBeUndefined();
        expect(attachChordDiagrams(base(), OTF, 'guitar')[1].diagrams[0].index).toBe(0);
    });

    it('skips a diagram whose chord is not in the table and leaves a plain tab alone', () => {
        const otf = { chords: [], chord_diagrams: [{ measure: 1, tick: 0, track: 'banjo', chord: 0 }] };
        const notation = base();
        expect(attachChordDiagrams(notation, otf, 'banjo')).toBe(notation);
        expect(attachChordDiagrams(notation, {}, 'banjo')).toBe(notation);
    });
});

describe('TabRenderer chord diagrams', () => {
    it('draws one box per diagram on this track, addressed by measure and tick', () => {
        const { container } = draw();
        const boxes = [...container.querySelectorAll('.chord-diagram')];
        expect(boxes.map(b => [b.dataset.measure, b.dataset.tick, b.dataset.chord]))
            .toEqual([['1', '0', '0'], ['1', '960', '2'], ['2', '480', '1']]);
    });

    it('puts a box above the staff, centred on its tick', () => {
        const { container } = draw();
        const staffTop = topMarginOf(container);
        const box = container.querySelector('.chord-diagram[data-tick="960"]');
        const m = /translate\(([\d.-]+) ([\d.-]+)\)/.exec(box.getAttribute('transform'));
        expect(Number(m[2]) + CHORD_BOX_HEIGHT).toBeLessThanOrEqual(staffTop);   // wholly above the strings
        // later ticks sit further right
        const first = /translate\(([\d.-]+)/.exec(container.querySelector('.chord-diagram[data-tick="0"]').getAttribute('transform'));
        expect(Number(m[1])).toBeGreaterThan(Number(first[1]));
    });

    it('draws o / x marks and dots for a shaped chord and bare text for a name-only one', () => {
        const { container } = draw();
        const d = container.querySelector('.chord-diagram[data-chord="2"]');
        expect(d.querySelectorAll('.chord-dot')).toHaveLength(3);
        expect(d.querySelectorAll('.chord-open')).toHaveLength(1);
        expect(d.querySelectorAll('.chord-muted')).toHaveLength(1);
        const am7 = container.querySelector('.chord-diagram[data-chord="1"]');
        expect(am7.querySelector('.chord-name').textContent).toBe('Am7');
        expect(am7.querySelector('.chord-string')).toBeNull();
    });

    it('does not print a name a text annotation at the same measure and tick already says', () => {
        const otf = { ...OTF, annotations: [
            { measure: 1, tick: 0, text: 'G' },          // same measure+tick+name: deduped
            { measure: 1, tick: 960, text: 'A' },        // same place, other name: both print
            { measure: 2, tick: 0, text: 'Am7' },        // same name, other tick: both print
        ] };
        const { container } = draw(otf);
        const nameOf = (tick, m = 1) =>
            container.querySelector(`.chord-diagram[data-measure="${m}"][data-tick="${tick}"] .chord-name`);
        expect(nameOf(0)).toBeNull();
        expect(nameOf(960).textContent).toBe('D');
        expect(nameOf(480, 2).textContent).toBe('Am7');
        const texts = [...container.querySelectorAll('.annotation-text')].map(t => t.textContent);
        expect(texts).toEqual(['G', 'A', 'Am7']);                    // annotations untouched
        // a deduped name-only chord has nothing left to draw
        const only = { ...OTF, annotations: [{ measure: 2, tick: 480, text: 'Am7' }] };
        expect(draw(only).container.querySelector('.chord-diagram[data-chord="1"]')).toBeNull();
    });

    it('reserves the band only for a tab that has diagrams', () => {
        const withBoxes = draw().container;
        const plain = draw({ ...OTF, chord_diagrams: [] }).container;
        expect(topMarginOf(withBoxes) - topMarginOf(plain)).toBe(CHORD_BOX_HEIGHT + 2);
        expect(plain.querySelector('.chord-diagram')).toBeNull();
    });

    it('puts text lanes between the chord boxes and the staff (Mike, 2026-10-31: nearer the staff = more important)', () => {
        const otf = { ...OTF, annotations: [{ measure: 1, tick: 480, text: 'Long Choke' }] };
        const { container } = draw(otf);
        const textY = Number(container.querySelector('.annotation-text').getAttribute('y'));
        const boxY = Number(/translate\([\d.-]+ ([\d.-]+)\)/.exec(
            container.querySelector('.chord-diagram').getAttribute('transform'))[1]);
        expect(textY).toBeGreaterThan(boxY + CHORD_BOX_HEIGHT);
        expect(textY).toBeLessThan(topMarginOf(container));
    });

    it('fits a phone-width row: no box leaves the drawing or overlaps its neighbour', () => {
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
        vi.spyOn(TabRenderer, '_hasLayoutEngine').mockReturnValue(true);
        const { container } = draw(OTF, 360);
        const svg = container.querySelector('.stave-row svg');
        const width = Number(svg.getAttribute('viewBox').split(' ')[2]);
        const xs = [...svg.querySelectorAll('.chord-diagram')].map(b => {
            const x = Number(/translate\(([\d.-]+)/.exec(b.getAttribute('transform'))[1]);
            return [x, x + b.chordBoxSize.width];
        });
        expect(xs.length).toBeGreaterThan(0);
        for (const [l, r] of xs) { expect(l).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(width); }
        for (let i = 1; i < xs.length; i++) {
            if (xs[i][0] > xs[i - 1][0]) expect(xs[i][0]).toBeGreaterThanOrEqual(xs[i - 1][1]);
        }
    });
});
