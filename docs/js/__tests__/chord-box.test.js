// The chord box (renderers/chord-box.js): where the strings, frets, dots and
// o / x marks of one `chords[]` record sit. Geometry is pure; the drawing
// test only checks that every piece of the geometry reaches the SVG.
import { describe, it, expect } from 'vitest';
import { chordBoxGeometry, renderChordBox, CHORD_BOX, CHORD_BOX_HEIGHT } from '../renderers/chord-box.js';

const G = { name: 'G', frets: [3, 0, 0, 0, 2, 3], fingers: [3, null, null, null, 1, 2] };
const F_HIGH = { name: 'F', frets: [1, 3, 3, 2, null, null], first_fret: 3 };

describe('chordBoxGeometry', () => {
    it('lays out one string per fret entry, string 1 on the RIGHT', () => {
        const g = chordBoxGeometry(G);
        expect(g.stringXs).toHaveLength(6);
        // x grows as the string index falls: string 1 is rightmost
        expect(g.stringXs[0]).toBeGreaterThan(g.stringXs[5]);
        expect(g.stringXs[0] - g.stringXs[1]).toBe(CHORD_BOX.stringGap);
        expect(g.gridW).toBe(5 * CHORD_BOX.stringGap);
    });

    it('reads 320003 left to right for a guitar G', () => {
        const g = chordBoxGeometry(G);
        const leftToRight = [...g.dots].sort((a, b) => a.x - b.x).map(d => d.fret);
        expect(leftToRight).toEqual([3, 2, 3]);                         // low E, A string (2), high e
        expect(g.dots.map(d => d.string).sort()).toEqual([1, 5, 6]);
    });

    it('marks open strings o and unplayed strings x, above the nut', () => {
        const g = chordBoxGeometry({ name: 'D', frets: [2, 3, 2, 0, null, null] });
        expect(g.marks.filter(m => m.kind === 'o').map(m => m.string)).toEqual([4]);
        expect(g.marks.filter(m => m.kind === 'x').map(m => m.string)).toEqual([5, 6]);
        for (const m of g.marks) expect(m.y).toBeLessThan(g.gridTop);
        expect(g.dots.map(d => d.string)).toEqual([1, 2, 3]);           // marks never double as dots
    });

    it('puts a dot in the middle of its fret row; fret 1 is the first row', () => {
        const g = chordBoxGeometry({ name: 'x', frets: [1, 3, null] });
        const rowH = g.gridH / g.rows;
        const byFret = Object.fromEntries(g.dots.map(d => [d.fret, d.y]));
        expect(byFret[1]).toBeCloseTo(g.gridTop + 0.5 * rowH);
        expect(byFret[3]).toBeCloseTo(g.gridTop + 2.5 * rowH);
        expect(g.nut).toBe(true);
    });

    it('starts the grid at first_fret and labels it when above 1', () => {
        const g = chordBoxGeometry(F_HIGH);
        expect(g.firstFret).toBe(3);
        expect(g.nut).toBe(false);
        expect(g.label.text).toBe('3fr');
        expect(g.dots.find(d => d.fret === 3).y).toBeCloseTo(g.gridTop + 0.5 * (g.gridH / g.rows));
        // frets below the window (the fret-1 dot) are not drawn, not misplaced
        expect(g.dots.some(d => d.fret === 1)).toBe(false);
    });

    it('derives the window from the shape when first_fret is absent', () => {
        expect(chordBoxGeometry({ name: 'a', frets: [0, 2, 2] }).firstFret).toBe(1);
        const high = chordBoxGeometry({ name: 'a', frets: [7, 9, 9, null] });
        expect(high.firstFret).toBe(7);
        expect(high.label.text).toBe('7fr');
    });

    it('grows the row count, not the box, for a wide span', () => {
        const g = chordBoxGeometry({ name: 'a', frets: [1, 6, 0] });
        expect(g.rows).toBe(6);
        expect(g.height).toBe(CHORD_BOX_HEIGHT);
    });

    it('is a name alone for a record with no frets', () => {
        const g = chordBoxGeometry({ name: 'Am7' });
        expect(g.nameOnly).toBe(true);
        expect(g.dots).toEqual([]);
        expect(g.stringXs).toEqual([]);
        expect(g.name.text).toBe('Am7');
    });

    it('leaves the name out, keeping the box height, when showName is false', () => {
        const shown = chordBoxGeometry(G);
        const hidden = chordBoxGeometry(G, { showName: false });
        expect(hidden.name).toBeNull();
        expect(hidden.height).toBe(shown.height);
        expect(hidden.dots).toEqual(shown.dots);
    });

    it('is no taller than the band the tab renderer reserves', () => {
        for (const chord of [G, F_HIGH, { name: 'x', frets: [1, 7, 0, null] }]) {
            expect(chordBoxGeometry(chord).height).toBeLessThanOrEqual(CHORD_BOX_HEIGHT);
        }
    });
});

describe('renderChordBox', () => {
    it('draws the strings, frets, dots and marks of the geometry', () => {
        const g = renderChordBox({ name: 'D', frets: [2, 3, 2, 0, null, null] }, { x: 10, y: 4 });
        expect(g.getAttribute('transform')).toBe('translate(10 4)');
        expect(g.querySelectorAll('.chord-string')).toHaveLength(6);
        expect(g.querySelectorAll('.chord-nut, .chord-fret')).toHaveLength(5);   // 4 rows -> 5 lines
        expect(g.querySelectorAll('.chord-nut')).toHaveLength(1);
        expect(g.querySelectorAll('.chord-dot')).toHaveLength(3);
        expect(g.querySelectorAll('.chord-open')).toHaveLength(1);
        expect(g.querySelectorAll('.chord-muted')).toHaveLength(2);
        expect(g.querySelector('.chord-name').textContent).toBe('D');
        expect(g.querySelector('.chord-fret-label')).toBeNull();
    });

    it('draws no nut and a fret label for a high position', () => {
        const g = renderChordBox(F_HIGH);
        expect(g.querySelector('.chord-nut')).toBeNull();
        expect(g.querySelector('.chord-fret-label').textContent).toBe('3fr');
    });

    it('draws only text for a name-only chord, and nothing when the name is hidden', () => {
        const named = renderChordBox({ name: 'Am7' });
        expect(named.querySelector('.chord-name').textContent).toBe('Am7');
        expect(named.querySelector('.chord-string')).toBeNull();
        expect(renderChordBox({ name: 'Am7' }, { showName: false }).children).toHaveLength(0);
    });

    it('reports its size for the caller\'s layout', () => {
        const g = renderChordBox(G);
        expect(g.chordBoxSize.width).toBe(chordBoxGeometry(G).width);
        expect(g.chordBoxSize.height).toBe(CHORD_BOX_HEIGHT);
    });
});
