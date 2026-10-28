// The chord cursor's motion and text operations (pure: no DOM, no CodeMirror).
import { describe, it, expect } from 'vitest';
import {
    createPointGlide, gainFor, clampPoint, lineStops, AFTER_GAP, HYSTERESIS, moveCursor, placeAtCursor, removeAtCursor, carryChord, chordLineCursor, cursorNear,
    isChordOnlyLine, SLOW_SPEED, FAST_SPEED, GAIN_SLOW, GAIN_FAST, SPEED_SMOOTHING, HOLD_MS, HOLD_SLOP_PX, GRAB_SLOP_PX,
} from '../lead-editor/chord-motion.js';
import { analyzeDocument } from '../lead-editor/doc-model.js';

const apply = (text, { from, to, insert }) => text.slice(0, from) + insert + text.slice(to);

describe('glide: pointer movement -> a screen-space point', () => {
    it('the tuning constants are exported and ordered', () => {
        expect(FAST_SPEED).toBeGreaterThan(SLOW_SPEED);
        expect(GAIN_FAST).toBeGreaterThan(GAIN_SLOW);
        expect(GAIN_SLOW).toBeGreaterThanOrEqual(0.9);          // a slow drag stays connected to the finger
        expect(SPEED_SMOOTHING).toBeGreaterThanOrEqual(0.7);    // and the response is not delayed by averaging
        expect(HOLD_MS).toBe(300);
        expect(HOLD_SLOP_PX).toBeGreaterThan(GRAB_SLOP_PX);
    });
    it('gain is low when slow, higher when fast, linear between', () => {
        expect(gainFor(0)).toBe(GAIN_SLOW);
        expect(gainFor(SLOW_SPEED)).toBe(GAIN_SLOW);
        expect(gainFor(FAST_SPEED)).toBe(GAIN_FAST);
        expect(gainFor(10)).toBe(GAIN_FAST);
        const mid = gainFor((SLOW_SPEED + FAST_SPEED) / 2);
        expect(mid).toBeGreaterThan(GAIN_SLOW);
        expect(mid).toBeLessThan(GAIN_FAST);
    });
    it('slow movement is scaled by the slow gain, fast by the fast gain (speed no longer changes what is targetable)', () => {
        const slow = createPointGlide().feed(6, 3, 40);          // 0.17 px/ms
        expect(slow.tier).toBeUndefined();
        expect(slow.dx).toBeCloseTo(6 * GAIN_SLOW);
        expect(slow.dy).toBeCloseTo(3 * GAIN_SLOW);
        const g = createPointGlide();
        let last;
        for (let i = 0; i < 10; i++) last = g.feed(40, 0, 8);    // 5 px/ms
        expect(last.dx).toBeCloseTo(40 * GAIN_FAST);
    });
    it('clampPoint keeps the point inside the chart', () => {
        const r = { left: 10, right: 100, top: 20, bottom: 200 };
        expect(clampPoint({ x: -5, y: 500 }, r)).toEqual({ x: 10, y: 200 });
        expect(clampPoint({ x: 50, y: 50 }, r)).toEqual({ x: 50, y: 50 });
    });
});

describe('stops: syllables, the gap between words, the trailing chords, then one empty slot', () => {
    const kinds = (stops) => stops.map((s) => `${s.kind}${s.after ? '*' : ''}`);
    it('a plain line: syllable starts and ONE gap per word break, in reading order; no letters, no spaces', () => {
        const text = 'Amazing grace';
        const stops = lineStops(text, 0);
        expect(stops.map((s) => s.pos)).toEqual([0, 1, 4, 7, 8, 13]);   // A|maz|ing, gap(7), grace (silent e: one syllable), slot
        expect(kinds(stops)).toEqual(['syllable', 'syllable', 'syllable', 'gap', 'syllable', 'after*']);
        expect(stops.at(-1)).toMatchObject({ pos: 13, after: 1 });
        for (const s of stops) if (s.kind === 'syllable') expect(/\s/.test(text[s.pos])).toBe(false);
        const sorted = [...stops].sort((a, b) => a.pos - b.pos);
        expect(stops.map((s) => s.pos)).toEqual(sorted.map((s) => s.pos));
    });
    it('a chord already mid-word is a syllable stop; a gap chord maps to the gap; trailing chords are after-stops', () => {
        const text = 'Ma[G]ny long years[D] since home   [A]   [E7]';
        const stops = lineStops(text, 0);
        const at = (pos) => stops.find((s) => s.pos === pos && !s.after);
        expect(at(text.indexOf('ny'))).toMatchObject({ kind: 'syllable', chord: 'G' });
        const gap = stops.find((s) => s.kind === 'gap' && s.chord === 'D');
        expect(gap.pos).toBe(text.indexOf('[D]') + 3);
        expect(text[gap.pos]).toBe(' ');
        expect(stops.filter((s) => s.kind === 'gap')).toHaveLength(4);        // Many|long|years|since|home
        const tail = stops.filter((s) => s.kind === 'after');
        expect(tail.map((s) => s.chord)).toEqual(['A', 'E7', null]);
        expect(tail.at(-1)).toMatchObject({ pos: text.length, after: 1 });
        // no stop sits on a whitespace character except the one gap per run, and none is mid-syllable
        for (const s of stops) {
            if (s.kind === 'syllable') expect(/\S/.test(text[s.pos] ?? '')).toBe(true);
            expect(s.pos).toBeGreaterThanOrEqual(0);
        }
        const positions = stops.map((s) => `${s.pos}:${s.after}`);
        expect(new Set(positions).size).toBe(positions.length);
    });
    it('a double space is one gap stop; a trailing chord stops where it ends and the empty slot still comes after it', () => {
        expect(lineStops('years  since', 0).filter((s) => s.kind === 'gap').map((s) => s.pos)).toEqual([5]);
        const text = 'at home [D]';
        const stops = lineStops(text, 0);
        expect(stops.at(-2)).toMatchObject({ pos: text.length, chord: 'D', after: 0, kind: 'after' });
        expect(stops.at(-1)).toMatchObject({ pos: text.length, after: 1 });
    });
    it('a chords-only line has only after stops', () => {
        expect(kinds(lineStops('[G]   [C]', 0))).toEqual(['after', 'after', 'after*']);
    });
});

describe('moveCursor', () => {
    const text = 'Amazing grace\nhow sweet';
    it('steps stop to stop in reading order: syllable, gap, next word ... slot after the words', () => {
        const walked = [];
        let c = { pos: 0 };
        for (let i = 0; i < 6; i++) { c = moveCursor(text, c, { kind: 'stop', dir: 1 }).cursor; walked.push(c); }
        expect(walked).toEqual([{ pos: 1 }, { pos: 4 }, { pos: 7 }, { pos: 8 }, { pos: 13, after: 1 }, { pos: 14 }]);
        // and back again
        expect(moveCursor(text, { pos: 8 }, { kind: 'stop', dir: -1 }).cursor).toEqual({ pos: 7 });
        expect(moveCursor(text, { pos: 14 }, { kind: 'stop', dir: -1 }).cursor).toEqual({ pos: 13, after: 1 });
    });
    it('every step changes the stop (the haptic tick)', () => {
        expect(moveCursor(text, { pos: 1 }, { kind: 'stop', dir: 1 }).crossedSeam).toBe(true);
    });
    it('past the last chords that already trail the words: chord, then the empty slot', () => {
        const t = 'at home [D]';
        const onD = moveCursor(t, { pos: 7 }, { kind: 'stop', dir: 1 });
        expect(onD.cursor).toEqual({ pos: t.length });
        expect(moveCursor(t, onD.cursor, { kind: 'stop', dir: 1 }).cursor).toEqual({ pos: t.length, after: 1 });
    });
    it('a line move keeps the x position (here: the lyric column)', () => {
        const t2 = 'abcdef\nabcdef';
        expect(moveCursor(t2, { pos: 0 }, { kind: 'line', dir: 1 }).cursor).toEqual({ pos: 7 });
    });
    it('a line move uses the supplied x (what is really drawn)', () => {
        const t2 = 'abcdef\nabcdef';
        const r = moveCursor(t2, { pos: 0 }, { kind: 'line', dir: 1 }, { anchorX: 100, xOf: (s) => s.col * 10 });
        expect(r.cursor).toEqual({ pos: 13, after: 1 });   // x=100 is past every stop: the slot after the words is nearest
        expect(r.lineMove).toBe(true);
    });
    it('the first and last line stay put', () => {
        expect(moveCursor(text, { pos: 2 }, { kind: 'line', dir: -1 }).moved).toBe(false);
        expect(moveCursor(text, { pos: 16 }, { kind: 'line', dir: 1 }).moved).toBe(false);
    });
    it('when carrying a chord, occupied stops are hopped over', () => {
        const t = 'a[C]b c[D]d';
        const skip = (s) => !s.after && !!s.chord && s.pos !== 4;
        const r = moveCursor(t, { pos: 4 }, { kind: 'stop', dir: 1 }, { skip });
        expect(chordAtPosOf(t, r.cursor.pos)).not.toBe('D');
    });
});
const chordAtPosOf = (t, pos) => (t.slice(0, pos).match(/\[([^\]]+)\]$/) || [])[1] || null;

// After a chord, ChordPro's spaces are that chord's own lyric: a chord's segment is as wide as the chord or its spaces,
// whichever is wider, and the next chord starts where it ends. So the GAP you see after a chord is (its spaces - its width):
// to see AFTER_GAP every time, a chord is followed by its own length + AFTER_GAP spaces (the first chord after a word gets
// AFTER_GAP: the word before it is lyric already).
const after = (name) => ' '.repeat(name.length + AFTER_GAP);
/** The gaps a monospace book draws between the chords of a tail (in characters): segment width - chord width. */
function drawnGaps(tail) {
    const parts = [...tail.matchAll(/\[([^\]]+)\]( *)/g)];
    return parts.slice(0, -1).map((m) => Math.max(m[1].length, m[2].length) - m[1].length);
}

describe('chords after the words are evenly spaced', () => {
    const G = ' '.repeat(AFTER_GAP);
    const place = (t, c, ch) => { const r = placeAtCursor(t, c, ch); return { text: apply(t, r.change), cursor: r.cursor }; };
    it('the gap is a fixed number of spaces', () => {
        expect(AFTER_GAP).toBe(2);   // owner, 2026-10-27: 2 reads better than 3
    });
    it('every gap you SEE is AFTER_GAP wide, whatever the chord before it (C#7 then D does not touch)', () => {
        let t = 'I\'ve lost my home';
        let c = { pos: t.length, after: 1 };
        for (const ch of ['C#7', 'D', 'A', 'E7', 'F#m7b5', 'G']) { const r = place(t, c, ch); t = r.text; c = r.cursor; }
        expect(t).toBe(`I've lost my home${G}[C#7]${after('C#7')}[D]${after('D')}[A]${after('A')}[E7]${after('E7')}[F#m7b5]${after('F#m7b5')}[G]`);
        expect(drawnGaps(t.slice(t.indexOf('['))).every((g) => g === AFTER_GAP)).toBe(true);
    });
    it('the first chord gets the gap too', () => {
        const t = 'We left our old home';
        const r = place(t, { pos: t.length, after: 1 }, 'D');
        expect(r.text).toBe(`We left our old home${G}[D]`);
        expect(r.cursor).toEqual({ pos: r.text.length, after: 1 });
    });
    it('D then A gives `home   [D]   [A]`; D, A, E7 stay even', () => {
        let t = 'old home';
        let c = { pos: t.length, after: 1 };
        for (const ch of ['D', 'A', 'E7']) {
            const r = place(t, c, ch);
            t = r.text;
            c = r.cursor;
            expect(c).toEqual({ pos: t.length, after: 1 });
        }
        expect(t).toBe(`old home${G}[D]${after('D')}[A]${after('A')}[E7]`);
    });
    it('trailing whitespace already on the line is not doubled', () => {
        const t = 'old home ';
        expect(apply(t, placeAtCursor(t, { pos: t.length, after: 1 }, 'D').change)).toBe(`old home${G}[D]`);
        expect(apply('', placeAtCursor('', { pos: 0, after: 1 }, 'D').change)).toBe('[D]');
    });
    it('a line written with the old 3-spaces-before-each-chord rule is re-spaced too, when its slots are used', () => {
        const t = `home${G}[C#7]${G}[D]`;
        expect(place(t, { pos: t.length, after: 1 }, 'A').text).toBe(`home${G}[C#7]${after('C#7')}[D]${after('D')}[A]`);
    });
    it('changing a chord in the tail (D -> D7) re-spaces what follows it; a chord before the tail is just replaced', () => {
        const t = `home${G}[D]${after('D')}[A]`;
        expect(apply(t, placeAtCursor(t, { pos: t.indexOf('[D]') + 3 }, 'D7').change)).toBe(`home${G}[D7]${after('D7')}[A]`);
        const r = placeAtCursor(t, { pos: t.indexOf('[D]') + 3 }, 'D7');
        expect(r.cursor).toEqual({ pos: apply(t, r.change).indexOf('[D7]') + 4 });   // the box stays on D7 (a 2nd decoration goes to it)
        expect(apply(t, placeAtCursor(t, { pos: t.length }, 'A7').change)).toBe(`home${G}[D]${after('D')}[A7]`);
        expect(apply('a[C]b home', placeAtCursor('a[C]b home', { pos: 4 }, 'C#7').change)).toBe('a[C#7]b home');
    });
    it('a legacy line with uneven spacing is re-spaced when the user adds to ITS after-slots, and not otherwise', () => {
        const t = 'old home [D] [A]\nnext line [G]';
        const r = place(t, { pos: 16, after: 1 }, 'E');
        expect(r.text).toBe(`old home${G}[D]${after('D')}[A]${after('A')}[E]\nnext line [G]`);   // the other line is untouched
    });
    it('works on the line the cursor is on, not the last one', () => {
        const t = 'one\ntwo\nthree';
        expect(apply(t, placeAtCursor(t, { pos: 3, after: 1 }, 'G').change)).toBe(`one${G}[G]\ntwo\nthree`);
    });
    it('leaving an empty slot writes nothing (moving is not an edit)', () => {
        const t = 'old home';
        const r = moveCursor(t, { pos: t.length, after: 1 }, { kind: 'stop', dir: -1 });
        expect(r.cursor).toEqual({ pos: 4 });   // the last word's only syllable: home (silent e, never ho|me)
    });
    it('replacing the chord at an ordinary stop is unchanged', () => {
        const t = 'a[C]b';
        const r = placeAtCursor(t, { pos: 4 }, 'D');
        expect(apply(t, r.change)).toBe('a[D]b');
        expect(r.cursor).toBe(null);
    });
    it('a chord at a gap stop is written at the space: `years[D] since`', () => {
        const t = 'many years since';
        const r = placeAtCursor(t, { pos: 10 }, 'D');
        expect(apply(t, r.change)).toBe('many years[D] since');
        expect(r.cursor).toBe(null);
    });
    it('removing an after-slot chord removes its gap, the rest stays evenly spaced, and no trailing whitespace is left', () => {
        const t = `old home${G}[D]${after('D')}[A]${after('A')}[E7]`;
        expect(apply(t, removeAtCursor(t, { pos: t.indexOf('[E7]') + 4 }).change)).toBe(`old home${G}[D]${after('D')}[A]`);
        expect(apply(t, removeAtCursor(t, { pos: t.indexOf('[D]') + 3 }).change)).toBe(`old home${G}[A]${after('A')}[E7]`);
        // the gap after a removed WIDE chord would be too big for the chord now before it: re-spaced
        const w = `home${G}[A]${after('A')}[C#7]${after('C#7')}[D]`;
        expect(apply(w, removeAtCursor(w, { pos: w.indexOf('[C#7]') + 5 }).change)).toBe(`home${G}[A]${after('A')}[D]`);
        const one = `old home${G}[D]`;
        const out = apply(one, removeAtCursor(one, { pos: one.length }).change);
        expect(out).toBe('old home');
        expect(/\s$/.test(out)).toBe(false);
    });
    it('removing a gap or mid-word chord only takes the token', () => {
        const t = 'many years[D] since';
        expect(apply(t, removeAtCursor(t, { pos: 13 }).change)).toBe('many years since');
    });
});

describe('chord lines', () => {
    it('the cursor for a new chord line sits below the cursor\'s line', () => {
        expect(chordLineCursor('one\ntwo', 1)).toEqual({ pos: 3, newLine: true });
        expect(chordLineCursor('{title: x}\n', 3)).toBe(null);
    });
    it('the first pick writes the line; each next pick appends one gap: G C D7 G is evenly spaced', () => {
        let t = 'one\ntwo';
        let c = { pos: 3, newLine: true };
        for (const ch of ['G', 'C', 'D7', 'G']) {
            const r = placeAtCursor(t, c, ch);
            t = apply(t, r.change);
            c = r.cursor;
        }
        expect(t).toBe(`one\n[G]${after('G')}[C]${after('C')}[D7]${after('D7')}[G]\ntwo`);
        expect(isChordOnlyLine(`[G]${after('G')}[C]`)).toBe(true);
        expect(isChordOnlyLine('home [D]')).toBe(false);
    });
    it('the chord line stays inside its section', () => {
        let t = '{start_of_verse}\nline one\n{end_of_verse}';
        const r = placeAtCursor(t, chordLineCursor(t, 20), 'G');
        t = apply(t, r.change);
        expect(t).toBe('{start_of_verse}\nline one\n[G]\n{end_of_verse}');
        const a = analyzeDocument(t);
        expect(a.lines[2].kind).toBe('lyric');
        expect(a.lines[2].section).toBe(a.lines[1].section);
    });
    it('a chord line that was never written leaves no trace', () => {
        const t = 'one\ntwo';
        expect(moveCursor(t, { pos: 3, newLine: true }, { kind: 'stop', dir: 1 }).cursor).toEqual({ pos: 4 });
        expect(moveCursor(t, { pos: 3, newLine: true }, { kind: 'line', dir: -1 }).cursor.pos).toBeLessThanOrEqual(3);
    });
    it('removing the last chord removes the line', () => {
        const t = 'one\n[G]\ntwo';
        const r = removeAtCursor(t, { pos: 7 });
        expect(r.lineRemoved).toBe(true);
        expect(apply(t, r.change)).toBe('one\ntwo');
        expect(cursorNear(apply(t, r.change), r.change.from)).toEqual({ pos: 3, after: 1 });
    });
    it('removing a chord from a line of several keeps the line and the even spacing', () => {
        const t = `[G]${after('G')}[C]${after('C')}[D]`;
        const c = t.indexOf('[C]') + 3;
        expect(apply(t, removeAtCursor(t, { pos: 3 }).change)).toBe(`[C]${after('C')}[D]`);
        expect(apply(t, removeAtCursor(t, { pos: t.length }).change)).toBe(`[G]${after('G')}[C]`);
        expect(apply(t, removeAtCursor(t, { pos: c }).change)).toBe(`[G]${after('G')}[D]`);
        expect(removeAtCursor(t, { pos: c }).lineRemoved).toBe(false);
    });
    it('removing a chord from a lyric line only takes the chord', () => {
        const t = 'a[C]b';
        expect(apply(t, removeAtCursor(t, { pos: 4 }).change)).toBe('ab');
    });
});

describe('carrying a chord', () => {
    it('to another letter', () => {
        const t = 'Amazing [G]grace';
        const out = carryChord(t, { pos: 11 }, { pos: 14 });
        expect(out.text).toBe('Amazing gra[G]ce');
        expect(chordAtPosOf(out.text, out.cursor.pos)).toBe('G');
    });
    it('to the slot after the words', () => {
        const t = 'a [G]b';
        const out = carryChord(t, { pos: 5 }, { pos: 6, after: 1 });
        expect(out.text).toBe('a b  [G]');
        expect(out.cursor).toEqual({ pos: 8 });
    });
    it('out of the slots after the words: the chords left behind stay evenly spaced', () => {
        const G = ' '.repeat(AFTER_GAP);
        const t = `a b${G}[C#7]${after('C#7')}[D]`;
        const out = carryChord(t, { pos: t.indexOf('[C#7]') + 5 }, { pos: 0 });
        expect(out.text).toBe(`[C#7]a b${G}[D]`);
    });
    it('a chord line\'s only chord takes the line along when it leaves for another line', () => {
        const t = 'one\n[G]\ntwo';
        const out = carryChord(t, { pos: 7 }, { pos: 10 });
        expect(out.text).toBe('one\ntw[G]o');
    });
    it('but not when it moves within its own line', () => {
        const t = 'one\n[G]';
        const out = carryChord(t, { pos: 7 }, { pos: 7, after: 1 });
        expect(out.text).toBe('one\n[G]');
    });
});

describe('↵ chord line: from any stop', () => {
    it('sits below the cursor\'s line whatever the stop (syllable, gap, after slot)', () => {
        const t = 'many years since\nnext';
        for (const pos of [0, 10, 16]) expect(chordLineCursor(t, pos)).toEqual({ pos: 16, newLine: true });
        expect(chordLineCursor(t, 17)).toEqual({ pos: 21, newLine: true });
    });
    it('G C D7 G from a gap stop is an evenly spaced chords-only line below, and it is its own line', () => {
        let t = 'many years since\nnext';
        let c = chordLineCursor(t, 10);
        for (const ch of ['G', 'C', 'D7', 'G']) { const r = placeAtCursor(t, c, ch); t = apply(t, r.change); c = r.cursor; }
        expect(t).toBe(`many years since\n[G]${after('G')}[C]${after('C')}[D7]${after('D7')}[G]\nnext`);
        expect(isChordOnlyLine(t.split('\n')[1])).toBe(true);
    });
});
