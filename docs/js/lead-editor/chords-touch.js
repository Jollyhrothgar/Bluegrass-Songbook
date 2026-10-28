// Chords mode's pointing: which seam (a place a chord can go) does a tap mean?
//
// The chart is locked in Chords mode, so a tap is only ever "put the box here".
// CodeMirror's posAtCoords is used for exactly one thing - which LINE was hit
// (the line is picked by height, and a chord row belongs to the lyric under it).
// Along the line the seam is chosen by x, from where each seam really is on
// screen: the seam whose syllable span CONTAINS the tap. (Choosing the nearest
// character offset instead sends a tap on the right half of a short syllable to
// the NEXT seam, and posAtCoords over a chord row returns the segment boundary.)

import { analyzeDocument, lineSeams, lineModel, lineStops, snapCursor } from './doc-model.js';
import { HYSTERESIS } from './chord-motion.js';

const CHORD_ROW_EM = 1.5;   // how far above the lyric text a chord row reaches, in lyric-heights
const ROW_TOLERANCE = 3;    // px: items on one visual row share a top within this
const NEAREST_PROBE_PX = 6; // glide: step this far (up / down alternately) to find a lyric line near a point
const NEAREST_PROBES = 10;

/**
 * The places a point on a line can mean = the line's STOPS (doc-model `lineStops`: syllable starts, the gap
 * between words, the chords trailing the words, the empty slot after them). Returns
 * { targets: [{ s, after, at, kind }], rowPos }: `at` is where its left edge is measured (the chord's own
 * start for a trailing chord, whose segment begins before the position after it). `rowPos` is the end of
 * the last real letter: the lyric row the trailing items belong to.
 */
export function tapTargets(text, lineFrom, lineTo) {
    const model = lineModel(text.slice(lineFrom, lineTo));
    const targets = lineStops(text, lineFrom).map((st) => ({ s: st.pos, after: st.after, at: st.at, kind: st.kind }));
    const trimmed = model.lyrics.trimEnd().length;
    const rowPos = trimmed > 0 ? lineFrom + model.seamOffset(trimmed - 1) + 1 : null;
    return { targets, rowPos };
}

/** The visual row (items sharing a top) whose chord row + lyric row the y falls in; nearest wins, the upper on a tie. */
function rowAt(items, y) {
    const rows = [];
    for (const it of items) {
        let row = rows.find((r) => Math.abs(r.top - it.top) <= ROW_TOLERANCE);
        if (!row) { row = { top: it.top, bottom: it.bottom, items: [] }; rows.push(row); }
        row.items.push(it);
    }
    if (!rows.length) return null;
    let best = null;
    for (const r of rows) {
        const h = r.bottom - r.top;
        const lo = r.top - h * CHORD_ROW_EM;
        const d = y < lo ? lo - y : y > r.bottom ? y - r.bottom : 0;
        if (!best || d < best.d) best = { d, row: r };
    }
    return best.row.items.slice().sort((a, b) => a.left - b.left);
}

const hitOf = (it, next) => ({
    pos: it.s, after: it.after ? 1 : 0, kind: it.kind || 'syllable', seam: it.kind !== 'gap',
    left: it.left, right: next ? next.left : it.left + 10, top: it.top, bottom: it.bottom,
});

/**
 * PURE. Which item does the point (x, y) mean? `items` are one line's places as drawn:
 * [{ s, after, kind, left, top, bottom }]. The visual row is the one whose chord row + lyric row the y
 * falls in (a wrapped line has several rows); along the row, the item whose span contains x, the first for a
 * point left of everything and the after-the-words slot for a point past the end of the LAST row. For a TAP the
 * items are the line's stops; the glide's ring passes letters here (only to draw smoothly, never to commit).
 * Returns { pos, after, kind, seam, left, right, top, bottom } or null.
 */
export function pickItem(items, x, y) {
    const row = rowAt(items, y);
    if (!row) return null;
    let at = 0;
    row.forEach((it, i) => { if (it.left <= x) at = i; });
    return hitOf(row[at], row[at + 1]);
}

/**
 * PURE. The glide's committed stop: the stop whose span CONTAINS the point, exactly like a tap (pickItem), so the
 * loupe's tail and the boxed syllable always agree. Sticky at the edges: `prev` is the stop the cursor is on
 * ({ pos, after }); stepping to a NEIGHBOUR needs the point HYSTERESIS x half the entered stop's width past the edge
 * they share, either way (a wobble on an edge does not flicker). A jump over several stops, or a `prev` that is not on
 * the picked row (the point changed row or line), is taken at once.
 */
export function pickStop(items, x, y, prev = null) {
    const row = rowAt(items, y);
    if (!row) return null;
    let at = 0;
    row.forEach((it, i) => { if (it.left <= x) at = i; });
    const pi = prev ? row.findIndex((it) => it.s === prev.pos && !!it.after === !!prev.after) : -1;
    if (pi >= 0 && Math.abs(at - pi) === 1) {
        const width = (i) => (row[i + 1] ? row[i + 1].left - row[i].left : 10);
        const edge = at > pi ? row[at].left : row[pi].left;
        const margin = HYSTERESIS * width(at) / 2;
        if (at > pi ? x < edge + margin : x > edge - margin) at = pi;
    }
    return hitOf(row[at], row[at + 1]);
}

/**
 * One placed item, measured from the real layout: { s, after, kind, left, top, bottom } (viewport px), or null.
 * A stop's geometry must NOT depend on where the cursor is: the cursor's own widget (the slot) is a zero-height box at
 * the baseline, so nothing here reads a ROW from a position the slot can sit at.
 */
function measure(view, line, t, rowPos) {
    const c = view.coordsAtPos(t.at, 1) || view.coordsAtPos(t.at, -1);
    if (!c) return null;
    // left from the position; the row from the LETTER at it - at a line's first seam the thing after the
    // position is the chord row's gap widget, which sits above the text. Trailing items (the chords after the words,
    // the empty slot) take the row of the LAST REAL LETTER, read from the letter itself (`rowPos - 1`, side 1): read at
    // the line end, it was the slot widget whenever the cursor stood in the slot (14px low, a row of its own), so a
    // finger past the last word picked the word, the widget went, the slot won again (a flicker at frame rate).
    const trailing = t.after || (rowPos != null && t.at >= rowPos);
    const lastLetter = rowPos != null && rowPos > line.from ? view.coordsAtPos(rowPos - 1, 1) : null;
    const letter = trailing ? (lastLetter || c) : (t.at < line.to ? view.coordsAtPos(t.at + 1, -1) : c);
    const row = trailing ? letter : (letter && Math.abs(letter.top - c.top) < 1 ? c : (letter || c));
    // the slot after the words starts where the content ends
    const left = t.after ? (view.coordsAtPos(line.to, -1) || c).left : c.left;
    return { s: t.s, after: t.after, kind: t.kind, left, top: row.top, bottom: row.bottom };
}

/** The drawn STOPS of the lyric line `line` (CodeMirror line). */
function lineItems(view, line, text) {
    const { targets, rowPos } = tapTargets(text, line.from, line.to);
    return targets.map((t) => measure(view, line, t, rowPos)).filter(Boolean);
}

/** The drawn LETTERS of the line: the glide's ring follows these so it moves smoothly. Never a cursor position. */
function letterItems(view, line, text) {
    const model = lineModel(text.slice(line.from, line.to));
    const trimmed = model.lyrics.trimEnd().length;
    const rowPos = trimmed > 0 ? line.from + model.seamOffset(trimmed - 1) + 1 : null;
    const seen = new Set();
    const out = [];
    for (let i = 0; i < trimmed; i++) {
        const s = line.from + model.seamOffset(i);
        if (seen.has(s)) continue;
        seen.add(s);
        const m = measure(view, line, { s, after: 0, at: s, kind: 'letter' }, rowPos);
        if (m) out.push(m);
    }
    return out;
}

/**
 * What the tap at (x, y) means: { pos, after, kind, ... } of the lyric line under it, or null when the
 * tap is not on a lyric line. `after` is the empty slot after the words: a tap to the RIGHT of
 * the last word (or of the chords already trailing it). The hit is always one of the line's STOPS.
 *
 * The glide uses the SAME function for its virtual point (so a glide and a tap agree), with
 *   nearest  a point not over a lyric line (a label, a gap) means the nearest lyric line
 *   prev     the stop the cursor is on: the hit is sticky (pickStop's hysteresis)
 *   ring     also return `ring`, the drawn rect of the LETTER under the point (the overlay follows letters
 *            continuously; only the committed stop is quantised)
 * and gets the hit's drawn rect back too (left/right/top/bottom, viewport px).
 */
export function cursorAtPoint(view, x, y, { nearest = false, prev = null, ring = false } = {}) {
    const doc = view.state.doc;
    const text = doc.toString();
    const analysis = analyzeDocument(text);
    const probe = (py) => {
        const pos = view.posAtCoords({ x, y: py }, false);
        if (pos == null) return null;
        const line = doc.lineAt(pos);
        const info = analysis.lines[line.number - 1];
        return info && info.kind === 'lyric' ? line : null;
    };
    let line = probe(y);
    if (!line && nearest) {
        for (let k = 1; k <= NEAREST_PROBES && !line; k++) line = probe(y - k * NEAREST_PROBE_PX) || probe(y + k * NEAREST_PROBE_PX);
    }
    if (!line) return null;
    const items = lineItems(view, line, text);
    const hit = prev ? pickStop(items, x, y, prev) : pickItem(items, x, y);
    if (hit && ring) {
        const r = hit.after ? null : pickItem(letterItems(view, line, text), x, y);
        hit.ring = r && Math.abs(r.top - hit.top) <= ROW_TOLERANCE ? { left: r.left, right: Math.max(r.right, r.left + 6), top: r.top, bottom: r.bottom } : { left: hit.left, right: hit.right, top: hit.top, bottom: hit.bottom };
    }
    return hit;
}

/** The seam of the lyric line under (x, y), or null when the tap is not on a lyric line. */
export function seamAtPoint(view, x, y) {
    return cursorAtPoint(view, x, y)?.pos ?? null;
}

/** The stop a chord label sits on: the first real stop at or after the end of its `[..]` token (a gap, a syllable or a trailing chord). */
export function seamOfChordEl(view, chordEl) {
    let pos;
    try { pos = view.posAtDOM(chordEl); } catch { return null; }
    const doc = view.state.doc;
    const line = doc.lineAt(pos);
    const text = doc.toString();
    const m = /^\[[^\]\n]+\]/.exec(text.slice(pos, line.to));
    const end = m ? pos + m[0].length : pos;
    const stops = lineStops(text, line.from).filter((s) => !s.after);
    return (stops.find((s) => s.pos >= end) ?? stops[stops.length - 1])?.pos ?? null;
}

/** The stop on the line holding `pos` that a caret position means (snapped, see doc-model `snapCursor`). */
export function seamForPos(view, pos) {
    const doc = view.state.doc;
    const line = doc.lineAt(Math.min(pos, doc.length));
    const text = doc.toString();
    const info = analyzeDocument(text).lines[line.number - 1];
    if (!info || info.kind !== 'lyric') return null;
    return snapCursor(text, Math.min(pos, doc.length)).pos;
}

/** First lyric line's first seam (a sensible place to start in an untouched song). */
export function firstSeam(view) {
    const text = view.state.doc.toString();
    const first = analyzeDocument(text).lines.find((l) => l.kind === 'lyric');
    return first ? lineSeams(text, first.from)[0] : null;
}
