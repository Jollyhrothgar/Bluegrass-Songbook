// Chord box: a small SVG chord diagram (name, string lines, fret lines, dots,
// open/muted marks, first-fret label) for one `chords[]` record of an OTF
// document (docs/schema/otf.md, "chords").
//
// Standalone and dependency-free so any view can reuse it: the tab renderer
// puts one above a staff at each `chord_diagrams[]` anchor, but nothing here
// knows about staves.
//
//   geometry: chordBoxGeometry(chord, { showName })   pure, unit-tested
//   drawing:  renderChordBox(chord, { x, y, showName, ink, muted })  -> <g>
//
// Conventions (TablEdit's, via the record layout in the schema):
//   - `frets` has one item per string, STRING 1 FIRST. String 1 is the highest
//     pitch, so it is drawn on the RIGHT: a guitar G, [3,0,0,0,2,3], reads
//     "320003" left to right like every printed chord chart.
//   - a fret is absolute (0 = open, null = not played). The grid starts at
//     `first_fret` when that is above 1 (and a "3fr" label says so), else at
//     fret 1 when the shape fits the grid, else at its lowest fretted note.
//   - a record with no `frets` is a name-only chord: just its name, no grid.
//   - no barre line is stored in the file, and none is drawn: shared frets
//     simply show as a row of dots.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Layout constants, in SVG user units (the staff's strings are 14 apart). */
export const CHORD_BOX = Object.freeze({
    stringGap: 6,       // between string lines
    gridH: 28,          // the fret grid is always this tall...
    rows: 4,            // ...with this many fret rows (more rows share the height)
    nameH: 10,          // the name line above
    marksH: 7,          // the o / x row between the name and the grid
    dotR: 2.3,
    fontSize: 9,        // the name
    labelFont: 7,       // the first-fret label
    labelW: 12,         // room right of the grid for "3fr" when it is shown
    charW: 5,           // rough advance of one name character (no layout engine in jsdom)
});

/** Height of a full box (name + marks + grid): the band the tab renderer reserves. */
export const CHORD_BOX_HEIGHT = CHORD_BOX.nameH + CHORD_BOX.marksH + CHORD_BOX.gridH;

/** The fret the grid starts at. */
function gridStart(played, firstFret) {
    if (Number.isFinite(firstFret) && firstFret > 1) return firstFret;
    const fretted = played.filter(f => f > 0);
    if (!fretted.length) return 1;
    return Math.max(...fretted) <= CHORD_BOX.rows ? 1 : Math.min(...fretted);
}

/**
 * Where everything in a chord box sits, relative to its top-left corner.
 *
 * @param {{name: string, frets?: Array<number|null>, fingers?: Array<number|null>,
 *          first_fret?: number}} chord - an OTF `chords[]` record
 * @param {{showName?: boolean}} [opts] - showName false leaves the name line
 *   blank (its text is already on the page); the box keeps its height
 * @returns {{
 *   nameOnly: boolean, width: number, height: number,
 *   name: {text: string, x: number, y: number} | null,
 *   gridLeft: number, gridTop: number, gridW: number, gridH: number,
 *   stringXs: number[], fretYs: number[], rows: number, firstFret: number,
 *   nut: boolean, label: {text: string, x: number, y: number} | null,
 *   dots: Array<{x: number, y: number, string: number, fret: number, finger: number|null}>,
 *   marks: Array<{x: number, y: number, kind: 'o'|'x', string: number}>
 * }}
 */
export function chordBoxGeometry(chord, opts = {}) {
    const B = CHORD_BOX;
    const showName = opts.showName !== false;
    const text = chord?.name || '';
    const nameW = text.length * B.charW;

    if (!chord?.frets || !chord.frets.length) {
        return {
            nameOnly: true, width: nameW, height: B.nameH,
            name: showName && text ? { text, x: nameW / 2, y: B.nameH - 2 } : null,
            gridLeft: 0, gridTop: B.nameH, gridW: 0, gridH: 0,
            stringXs: [], fretYs: [], rows: 0, firstFret: 1, nut: false,
            label: null, dots: [], marks: [],
        };
    }

    const frets = chord.frets;
    const n = frets.length;
    const played = frets.filter(f => Number.isFinite(f));
    const firstFret = gridStart(played, chord.first_fret);
    const lastFret = played.length ? Math.max(...played) : firstFret;
    const rows = Math.max(B.rows, lastFret - firstFret + 1);
    const rowH = B.gridH / rows;

    const showLabel = firstFret > 1;
    const gridW = (n - 1) * B.stringGap;
    const gridLeft = Math.max(0, (nameW - gridW) / 2);
    const width = Math.max(nameW, gridW) + (showLabel ? B.labelW : 0);
    const gridTop = B.nameH + B.marksH;

    // String 1 (the first item) is drawn rightmost.
    const xOf = (i) => gridLeft + (n - 1 - i) * B.stringGap;
    const stringXs = Array.from({ length: n }, (_, i) => xOf(i));
    const fretYs = Array.from({ length: rows + 1 }, (_, r) => gridTop + r * rowH);

    const dots = [];
    const marks = [];
    frets.forEach((f, i) => {
        if (f === null || f === undefined) {
            marks.push({ x: xOf(i), y: B.nameH + B.marksH - 2, kind: 'x', string: i + 1 });
        } else if (f === 0) {
            marks.push({ x: xOf(i), y: B.nameH + B.marksH - 2, kind: 'o', string: i + 1 });
        } else {
            const row = f - firstFret;
            if (row < 0 || row >= rows) return;     // outside the shown window
            dots.push({
                x: xOf(i), y: gridTop + (row + 0.5) * rowH,
                string: i + 1, fret: f, finger: chord.fingers?.[i] ?? null,
            });
        }
    });

    return {
        nameOnly: false, width, height: gridTop + B.gridH,
        name: showName && text ? { text, x: gridLeft + gridW / 2, y: B.nameH - 2 } : null,
        gridLeft, gridTop, gridW, gridH: B.gridH,
        stringXs, fretYs, rows, firstFret,
        nut: firstFret === 1,
        label: showLabel
            ? { text: `${firstFret}fr`, x: gridLeft + gridW + 3, y: gridTop + rowH * 0.5 + B.labelFont / 2 - 1 }
            : null,
        dots, marks,
    };
}

function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
}

/**
 * Draw a chord box as an SVG <g> whose top-left corner is (x, y).
 *
 * Classes, for tests and for styling: `.chord-diagram` (the group; carries
 * data-chord-name), `.chord-name`, `.chord-string`, `.chord-fret`,
 * `.chord-nut`, `.chord-dot`, `.chord-open`, `.chord-muted`, `.chord-fret-label`.
 *
 * @param {object} chord - an OTF `chords[]` record
 * @param {{x?: number, y?: number, showName?: boolean, ink?: string, muted?: string}} [opts]
 * @returns {SVGGElement} with `.chordBoxSize = {width, height}` for the caller's layout
 */
export function renderChordBox(chord, opts = {}) {
    const B = CHORD_BOX;
    const ink = opts.ink || 'currentColor';
    const muted = opts.muted || ink;
    const g = chordBoxGeometry(chord, opts);

    const root = el('g', {
        class: 'chord-diagram',
        transform: `translate(${opts.x || 0} ${opts.y || 0})`,
        'data-chord-name': chord?.name || '',
    });
    root.chordBoxSize = { width: g.width, height: g.height };

    if (g.name) {
        const t = el('text', {
            class: 'chord-name', x: g.name.x, y: g.name.y, 'text-anchor': 'middle',
            'font-size': B.fontSize, 'font-weight': 700, fill: ink,
        });
        t.textContent = g.name.text;
        root.appendChild(t);
    }
    if (g.nameOnly) return root;

    const left = g.gridLeft, right = g.gridLeft + g.gridW;
    g.fretYs.forEach((y, r) => {
        const isNut = r === 0 && g.nut;
        root.appendChild(el('line', {
            class: isNut ? 'chord-nut' : 'chord-fret',
            x1: left, x2: right, y1: y, y2: y,
            stroke: isNut ? ink : muted, 'stroke-width': isNut ? 1.8 : 0.7,
        }));
    });
    const top = g.fretYs[0], bottom = g.fretYs[g.fretYs.length - 1];
    for (const x of g.stringXs) {
        root.appendChild(el('line', {
            class: 'chord-string', x1: x, x2: x, y1: top, y2: bottom,
            stroke: muted, 'stroke-width': 0.7,
        }));
    }
    for (const d of g.dots) {
        root.appendChild(el('circle', {
            class: 'chord-dot', cx: d.x, cy: d.y, r: B.dotR, fill: ink,
            'data-string': d.string, 'data-fret': d.fret,
        }));
    }
    for (const m of g.marks) {
        if (m.kind === 'o') {
            root.appendChild(el('circle', {
                class: 'chord-open', cx: m.x, cy: m.y - 1.5, r: 1.9,
                fill: 'none', stroke: ink, 'stroke-width': 0.8, 'data-string': m.string,
            }));
        } else {
            const x = m.x, y = m.y - 1.5, r = 1.8;
            const cross = el('path', {
                class: 'chord-muted', d: `M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}`,
                stroke: ink, 'stroke-width': 0.8, fill: 'none', 'data-string': m.string,
            });
            root.appendChild(cross);
        }
    }
    if (g.label) {
        const t = el('text', {
            class: 'chord-fret-label', x: g.label.x, y: g.label.y,
            'font-size': B.labelFont, fill: muted,
        });
        t.textContent = g.label.text;
        root.appendChild(t);
    }
    return root;
}
