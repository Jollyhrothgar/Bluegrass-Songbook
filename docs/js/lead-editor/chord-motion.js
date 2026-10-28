// The chord cursor's motion and its text operations. PURE (no DOM, no CodeMirror), so
// every rule unit-tests without layout. Three things live here:
//
//   1. GLIDE: pointer movement (dx, dy, dt) -> a virtual POINT in screen space (gain
//      low when slow, higher when fast). The controller hit-tests the point with the same
//      function a tap uses (chords-touch.js), so the cursor follows what is DRAWN: visual
//      rows, wrapped lines, the slots past a row's end. One point serves every entry
//      point: long-press on the chart, holding the sheet as a trackpad, and the strip.
//   2. STOPS: where the cursor can stand on a line (doc-model.js `lineStops`): syllable starts, the
//      gap between two words, then the chords already trailing the words and ONE virtual empty slot.
//      Never a letter: letters only smooth the glide's ring.
//   3. TEXT OPERATIONS for the slots after the words and for chord-only lines:
//      place / remove / carry at a cursor.
//
// A cursor is { pos, after?: 1, newLine?: true }:
//   { pos }                 a stop on a lyric line; pos is AFTER any chords at that offset,
//                           which is where the book draws a chord's own box
//   { pos: lineEnd, after } the empty slot after the line's words and trailing chords.
//                           Virtual: nothing is written until a chord is picked
//   { pos: lineEnd, newLine } an empty chord line below the line ending at pos. Virtual too

import { analyzeDocument, chordAt, CHORD_TOKEN, lineStops } from './doc-model.js';

export { lineStops };

// ---------------------------------------------------------------------------
// Tuning (feel it on a phone; every number here is a guess until then)
// ---------------------------------------------------------------------------

/** Pointer speed (px per ms, smoothed): at or below SLOW_SPEED the gain is GAIN_SLOW. (Speed no longer changes what is targetable.) */
export const SLOW_SPEED = 0.5;        // 500 px/s
/** The gain ramps from GAIN_SLOW (at or below SLOW_SPEED) up to GAIN_FAST (at or above FAST_SPEED). */
export const FAST_SPEED = 1.5;        // 1500 px/s
export const GAIN_SLOW = 1.0;         // slow = precise: the point moves less than the finger
export const GAIN_FAST = 2.4;         // fast = covers the line
export const SPEED_SMOOTHING = 0.8;   // weight of the newest sample in the speed average
/** A press on the chart / sheet that stays within HOLD_SLOP_PX for HOLD_MS becomes a glide; moving first is a scroll. */
export const HOLD_MS = 300;
export const HOLD_SLOP_PX = 8;
/** A press on the cursor (or, with a mouse, a chord) becomes a drag after this much travel, no hold needed. */
export const GRAB_SLOP_PX = 5;
/**
 * Lifting a thumb slides its contact point a few px, enough to cross a syllable. A glide commits the stop that was current
 * SETTLE_MS before the lift when a newer stop appeared inside that window: what the reader saw, not what the lift did.
 */
export const SETTLE_MS = 80;
/** Haptic tick (ms) on every change of stop. */
export const TICK_MS = 5;
/**
 * Glide hysteresis. The committed stop only switches to a neighbour once the point has passed the midpoint
 * between the two stops by this fraction of the HALF-distance (0.35 = 67.5% of the way), so a finger resting
 * near a boundary does not flicker between them. Going back needs the same overshoot the other way.
 */
export const HYSTERESIS = 0.35;
/**
 * The gap you SEE between chords after the words (and on chord-only lines), in spaces; also before the first one.
 * Written as each chord's length + AFTER_GAP spaces after it (`home  [C#7]     [D]   [A]`): in ChordPro the spaces
 * after a chord are its lyric, the chord's segment is as wide as the chord or its spaces, and the next chord starts
 * where that segment ends, so a flat gap of spaces left only gap - width (C♯⁷ then D touched). 2, not 3 (owner, 2026-10-27).
 */
export const AFTER_GAP = 2;

// ---------------------------------------------------------------------------
// 1. Glide: pointer movement -> a virtual point in screen space
// ---------------------------------------------------------------------------

/** Gain for a smoothed speed: low when slow, higher when fast, linear between SLOW_SPEED and FAST_SPEED. */
export function gainFor(speed) {
    const t = Math.min(1, Math.max(0, (speed - SLOW_SPEED) / (FAST_SPEED - SLOW_SPEED)));
    return GAIN_SLOW + (GAIN_FAST - GAIN_SLOW) * t;
}

/**
 * The pointer's movement -> the movement of a virtual point (screen px). Slow is precise (gain 1), fast
 * covers the line; either way the cursor can only land on stops.
 * @returns {{ feed(dx:number, dy:number, dt:number): {dx:number, dy:number}, reset(): void }}
 */
export function createPointGlide() {
    let speed = 0;
    return {
        reset() { speed = 0; },
        feed(dx, dy, dt) {
            const inst = Math.hypot(dx, dy) / Math.max(dt, 1);
            speed = speed * (1 - SPEED_SMOOTHING) + inst * SPEED_SMOOTHING;
            const g = gainFor(speed);
            return { dx: dx * g, dy: dy * g };
        },
    };
}

/** Clamp a point to a rect {left, right, top, bottom}. */
export function clampPoint(p, r) {
    return { x: Math.min(r.right, Math.max(r.left, p.x)), y: Math.min(r.bottom, Math.max(r.top, p.y)) };
}

// ---------------------------------------------------------------------------
// 2. Stops
// ---------------------------------------------------------------------------

const lineEndOf = (text, pos) => { const e = text.indexOf('\n', pos); return e === -1 ? text.length : e; };
const lineStartOf = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;
const gapText = (n = AFTER_GAP) => ' '.repeat(n);

const isStop = (s, c) => s.pos === c.pos && !!s.after === !!c.after;
export const cursorOf = (box) => (box ? { pos: box.pos, ...(box.after ? { after: 1 } : {}), ...(box.newLine ? { newLine: true } : {}) } : null);
export const sameCursor = (a, b) => !!a && !!b && a.pos === b.pos && !!a.after === !!b.after && !!a.newLine === !!b.newLine;
const asCursor = (s) => (s.after ? { pos: s.pos, after: 1 } : { pos: s.pos });

/** The lyric lines (kind 'lyric'), as analyzeDocument reports them. */
export function lyricLines(text) {
    return analyzeDocument(text).lines.filter((l) => l.kind === 'lyric');
}

function stopIndex(stops, c) {
    if (c.after) return stops.length - 1;
    const exact = stops.findIndex((s) => isStop(s, c));
    if (exact >= 0) return exact;
    let hit = 0;
    stops.forEach((s, i) => { if (!s.after && s.pos <= c.pos) hit = i; });
    return hit;
}

/**
 * Move the cursor.
 * @param {string} text
 * @param {{pos:number, after?:number, newLine?:boolean}} cursor
 * @param {{kind:'stop'|'line', dir:1|-1}} move   'stop' steps stop to stop in reading order (syllable, gap, next word ... slots after the words)
 * @param {object} [o]
 * @param {(stop)=>boolean} [o.skip]   stops to hop over (a chord being carried must not land on another chord)
 * @param {(stop)=>number} [o.xOf]     x of a stop on screen (default: its lyric offset)
 * @param {number} [o.anchorX]         the x to keep on a line move (default: the cursor's own)
 * @returns {{cursor:object, moved:boolean, crossedSeam:boolean, lineMove:boolean}}   (crossedSeam: the stop changed: tick)
 */
export function moveCursor(text, cursor, move, o = {}) {
    const stay = { cursor, moved: false, crossedSeam: false, lineMove: false };
    const lines = lyricLines(text);
    if (!lines.length) return stay;
    const skip = o.skip || (() => false);
    const xOf = o.xOf || ((s) => s.col);

    // which line, and (for a line move) where we are on it
    let here = lines.findIndex((l) => cursor.pos >= l.from && cursor.pos <= l.to);
    if (here < 0) here = lines.findIndex((l) => l.from > cursor.pos) - 1;
    if (here < 0) here = cursor.pos > lines[lines.length - 1].to ? lines.length - 1 : 0;

    if (move.kind === 'line') {
        let target = here + move.dir;
        // a pending chord line sits BELOW its line: up lands on that line, down on the next one
        if (cursor.newLine) target = move.dir < 0 ? here : here + 1;
        const line = lines[target];
        if (!line) return stay;
        const stops = lineStops(text, line.from).filter((s) => !skip(s));
        if (!stops.length) return stay;
        let ax = o.anchorX;
        if (ax == null) {
            if (cursor.newLine) ax = 0;
            else {
                const mine = lineStops(text, lines[here].from);
                ax = xOf(mine[stopIndex(mine, cursor)]);
            }
        }
        let best = null;
        for (const s of stops) {
            const x = xOf(s);
            const d = Number.isFinite(x) ? Math.abs(x - ax) : Infinity;
            if (!best || d < best.d) best = { s, d };
        }
        return { cursor: asCursor(best.s), moved: true, crossedSeam: true, lineMove: true };
    }

    // along the line: stop to stop
    const walk = (stops, from, dir) => {
        let i = from;
        for (;;) {
            i += dir;
            if (i < 0 || i >= stops.length) return -1;
            if (!skip(stops[i])) return i;
        }
    };
    if (cursor.newLine) {
        // leaving a pending chord line: right goes on to the next line, left back to the end of its line
        if (move.dir > 0) {
            const next = lines[here + 1];
            if (!next) return stay;
            const stops = lineStops(text, next.from);
            const i = skip(stops[0]) ? walk(stops, 0, 1) : 0;
            return i < 0 ? stay : { cursor: asCursor(stops[i]), moved: true, crossedSeam: true, lineMove: false };
        }
        const stops = lineStops(text, lines[here].from);
        return { cursor: asCursor(stops[stops.length - 1]), moved: true, crossedSeam: true, lineMove: false };
    }
    const stops = lineStops(text, lines[here].from);
    const at = stopIndex(stops, cursor);
    const to = walk(stops, at, move.dir);
    let landed;
    if (to >= 0) {
        landed = stops[to];
    } else {
        const other = lines[here + move.dir];
        if (!other) return stay;
        const next = lineStops(text, other.from);
        const idx = move.dir > 0 ? walk(next, -1, 1) : walk(next, next.length, -1);
        if (idx < 0) return stay;
        landed = next[idx];
    }
    return { cursor: asCursor(landed), moved: true, crossedSeam: true, lineMove: false };
}

/** A cursor sitting at (or just before) `pos`, whichever lyric line is nearest: for after a line is removed. */
export function cursorNear(text, pos) {
    const lines = lyricLines(text);
    if (!lines.length) return null;
    let line = null;
    for (const l of lines) if (l.from <= pos) line = l;
    line = line || lines[0];
    const stops = lineStops(text, line.from);
    return asCursor(stops[stops.length - 1]);
}

// ---------------------------------------------------------------------------
// 3. Text operations
// ---------------------------------------------------------------------------

/** True for a line that holds chords and no words: `[G] [C] [D7] [G]`. */
export function isChordOnlyLine(lineText) {
    return /\[[^\]\n]+\]/.test(lineText) && lineText.replace(CHORD_TOKEN, '').trim() === '';
}

/** Where the tail of a line starts: everything from there on is whitespace and chord tokens (the slots after the words). */
function tailStart(lineText) {
    return /(?:\s|\[[^\]\n]+\])*$/.exec(lineText).index;
}

/**
 * The tail written evenly (see AFTER_GAP): AFTER_GAP spaces before the first chord (none on a chords-only line, which
 * starts at its first chord), then after each chord its own length + AFTER_GAP, so every drawn gap is AFTER_GAP wide.
 */
function evenTailParts(tokens, chordOnly) {
    return tokens.map((t, i) => (i === 0 ? (chordOnly ? '' : gapText()) : gapText(tokens[i - 1].length - 2 + AFTER_GAP)) + t);
}
const evenTail = (tokens, chordOnly) => evenTailParts(tokens, chordOnly).join('');

/** The smallest change turning `oldText` (at `from`) into `newText`: the box maps through it to the neighbouring chord. */
function minimalChange(from, oldText, newText) {
    let a = 0;
    while (a < oldText.length && a < newText.length && oldText[a] === newText[a]) a++;
    let b = 0;
    while (b < oldText.length - a && b < newText.length - a && oldText[oldText.length - 1 - b] === newText[newText.length - 1 - b]) b++;
    return { from: from + a, to: from + oldText.length - b, insert: newText.slice(a, newText.length - b) };
}

/**
 * Put `chord` at the cursor.
 * @returns {{change:{from:number,to:number,insert:string}, cursor:object|null}}
 *   `cursor` is where the cursor goes next: the next empty slot for the virtual cursors, the changed chord itself for a
 *   chord in the slots after the words (that tail is re-spaced, so mapping the box through the change could slide it),
 *   else null (it stays).
 */
export function placeAtCursor(text, cursor, chord) {
    if (cursor.newLine) {
        const end = lineEndOf(text, cursor.pos);
        const insert = `\n[${chord}]`;
        return { change: { from: end, to: end, insert }, cursor: { pos: end + insert.length, after: 1 } };
    }
    if (cursor.after) {
        const ls = lineStartOf(text, cursor.pos);
        const end = lineEndOf(text, cursor.pos);
        // the slots after the words are evenly spaced (evenTail). Existing trailing chords are re-spaced only when
        // the line is not already even; an even line just gets one more chord at its end.
        const line = text.slice(ls, end);
        const e = tailStart(line);
        const tokens = [...line.slice(e).matchAll(CHORD_TOKEN)].map((m) => m[0]);
        tokens.push(`[${chord}]`);
        const insert = evenTail(tokens, e === 0);
        const from = ls + e;
        const old = text.slice(from, end);
        const change = insert.startsWith(old) ? { from: end, to: end, insert: insert.slice(old.length) } : { from, to: end, insert };
        return { change, cursor: { pos: from + insert.length, after: 1 } };
    }
    const at = chordAt(text, cursor.pos);
    if (at) {
        // a chord in the slots after the words: its width sets the gap after it, so the tail is written evenly again,
        // and the cursor stays on the chord just changed (D -> D7 keeps the box on D7, not on the chord after it)
        const ls = lineStartOf(text, at.from);
        const line = text.slice(ls, lineEndOf(text, at.from));
        const e = tailStart(line);
        if (at.from - ls >= e) {
            const found = [...line.slice(e).matchAll(CHORD_TOKEN)];
            const idx = found.findIndex((m) => ls + e + m.index === at.from);
            const parts = evenTailParts(found.map((m, i) => (i === idx ? `[${chord}]` : m[0])), e === 0);
            return {
                change: minimalChange(ls + e, line.slice(e), parts.join('')),
                cursor: { pos: ls + e + parts.slice(0, idx + 1).join('').length },
            };
        }
        return { change: { from: at.from, to: at.to, insert: `[${chord}]` }, cursor: null };
    }
    return { change: { from: cursor.pos, to: cursor.pos, insert: `[${chord}]` }, cursor: null };
}

/**
 * The change removing the chord `at` makes ({from, to, insert, wholeLine}). A chord-only line's last chord takes the
 * whole line. A chord in the slots after the words is removed by writing the rest of the tail evenly (evenTail: each gap
 * depends on the chord before it, and none is left trailing); a chord anywhere else is just its token.
 */
function removalRange(text, at) {
    const ls = lineStartOf(text, at.from);
    const le = lineEndOf(text, at.from);
    const lineText = text.slice(ls, le);
    if (isChordOnlyLine(lineText) && [...lineText.matchAll(CHORD_TOKEN)].length === 1) {
        // the line goes, with one newline (before it, else after it)
        return ls > 0 ? { from: ls - 1, to: le, insert: '', wholeLine: true } : { from: ls, to: Math.min(le + 1, text.length), insert: '', wholeLine: true };
    }
    const e = tailStart(lineText);
    if (at.from - ls < e) return { from: at.from, to: at.to, insert: '', wholeLine: false };
    const tail = lineText.slice(e);
    const keep = [...tail.matchAll(CHORD_TOKEN)].filter((m) => ls + e + m.index !== at.from).map((m) => m[0]);
    return { ...minimalChange(ls + e, tail, keep.length ? evenTail(keep, e === 0) : ''), wholeLine: false };
}

/**
 * Remove the chord on the cursor's stop. Removing a chord line's last chord removes the line.
 * @returns {{change, lineRemoved:boolean}|null}
 */
export function removeAtCursor(text, cursor) {
    if (cursor.after || cursor.newLine) return null;
    const at = chordAt(text, cursor.pos);
    if (!at) return null;
    const r = removalRange(text, at);
    return { change: { from: r.from, to: r.to, insert: r.insert }, lineRemoved: r.wholeLine };
}

/**
 * Carry the chord on `from` to `to` (a cursor from moveCursor). The target's own chord is replaced;
 * the after-the-words slot appends. Returns the new text and where the cursor lands, or null.
 */
export function carryChord(text, from, to) {
    if (from.after || from.newLine) return null;
    const at = chordAt(text, from.pos);
    if (!at) return null;
    if (sameCursor(from, to)) return { text, cursor: from };
    // take it out (a chord line's only chord takes its line along, unless the chord is staying on it)
    const sameLine = lineStartOf(text, from.pos) === lineStartOf(text, to.pos);
    let r = removalRange(text, at);
    if (r.wholeLine && sameLine) r = { from: at.from, to: at.to, insert: '', wholeLine: false };
    const delta = r.insert.length - (r.to - r.from);
    const mapPos = (p) => (p >= r.to ? p + delta : p > r.from ? r.from : p);
    const without = text.slice(0, r.from) + r.insert + text.slice(r.to);
    const tpos = mapPos(to.pos);
    const target = to.after ? { pos: tpos, after: 1 } : { pos: tpos };
    const placed = placeAtCursor(without, target, at.chord);
    const next = without.slice(0, placed.change.from) + placed.change.insert + without.slice(placed.change.to);
    if (to.after) return { text: next, cursor: { pos: placed.cursor.pos } };
    // landed after the chord just written
    const wrote = placed.change.from + `[${at.chord}]`.length;
    return { text: next, cursor: { pos: wrote } };
}

/** The cursor for an empty chord line below the lyric line holding `pos` (null when there is none). */
export function chordLineCursor(text, pos) {
    const lines = lyricLines(text);
    const line = lines.find((l) => pos >= l.from && pos <= l.to);
    return line ? { pos: line.to, newLine: true } : null;
}
