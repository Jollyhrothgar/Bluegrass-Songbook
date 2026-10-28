// The glide's point -> position mapping (pure: a fake layout), the driver's synchronous overlay,
// and the one-place-per-letter invariant.
import { describe, it, expect } from 'vitest';
import { pickItem, pickStop } from '../lead-editor/chords-touch.js';
import { createGlideDriver } from '../lead-editor/glide-driver.js';
import { normalizeCursor, snapCursor } from '../lead-editor/doc-model.js';
import { HYSTERESIS, SETTLE_MS } from '../lead-editor/chord-motion.js';

// A line that wraps onto two visual rows (phone): "Amazing grace how" / "sweet the sound", then the next line.
// Rows are 20px tall lyric rows with a chord row above; letters are 10px wide; seams at word starts.
const row = (top, text, base, startS, withAfter) => {
    const items = [...text].map((ch, i) => ({
        s: startS + i, after: 0, seam: i === 0 || text[i - 1] === ' ', left: base + i * 10, top, bottom: top + 20,
    }));
    if (withAfter) items.push({ s: startS + text.length, after: 1, seam: true, left: base + text.length * 10, top, bottom: top + 20 });
    return items;
};
const wrapped = [...row(100, 'Amazing grace how ', 0, 0, false), ...row(160, 'sweet the sound', 0, 18, true)];

describe('pickItem: a point on a drawn line', () => {
    it('over letters (what the ring follows): the letter under the point', () => {
        const p = pickItem(wrapped, 47, 110);
        expect(p).toMatchObject({ pos: 4, after: 0 });             // 'i' of Amazing
    });
    it('a point past the end of the LAST row is the slot after the words', () => {
        const p = pickItem(wrapped, 400, 170);
        expect(p).toMatchObject({ pos: 33, after: 1 });
        const q = pickItem(wrapped, 400, 170);
        expect(q).toMatchObject({ pos: 33, after: 1 });
    });
    it('a point past the end of a wrapped (non-last) row stays on that row, not the slot after the words', () => {
        const p = pickItem(wrapped, 400, 110);
        expect(p.after).toBe(0);
        expect(p.pos).toBe(17);                                    // the row's last drawn letter
    });
    it('a point left of everything is the first item of its row', () => {
        expect(pickItem(wrapped, -30, 170).pos).toBe(18);
    });
    it('moving DOWN from row 1 of a wrapped line reaches its row 2', () => {
        const ys = [105, 120, 140, 160, 175];
        const seen = ys.map((y) => pickItem(wrapped, 47, y).top);
        expect(seen[0]).toBe(100);
        expect(seen.at(-1)).toBe(160);
        expect(seen).toEqual([...seen].sort((a, b) => a - b));     // monotonic: never skips back
    });
    it('between two rows the nearer row wins; the chord row above a row belongs to it', () => {
        expect(pickItem(wrapped, 47, 122).top).toBe(100);   // just under row 1
        expect(pickItem(wrapped, 47, 140).top).toBe(160);   // in row 2's chord row
    });
    it('reports the drawn rect of the hit (for the overlay)', () => {
        const p = pickItem(wrapped, 47, 110);
        expect(p).toMatchObject({ left: 40, right: 50, top: 100, bottom: 120 });
    });
    it('an empty layout is null', () => {
        expect(pickItem([], 1, 1)).toBe(null);
    });
});

describe('pickStop: the stop the point is IN (like a tap), sticky at its edges', () => {
    // stops 100px apart on one row: x = 0, 100, 200 (each spans up to the next one's left edge)
    const stops = [0, 100, 200].map((left, i) => ({ s: i, after: 0, kind: 'syllable', left, top: 0, bottom: 20 }));
    const m = HYSTERESIS * 50;   // past an edge by HYSTERESIS x half the width of the stop being entered
    it('with no previous stop it is the stop whose span contains the point, exactly like a tap (pickItem)', () => {
        expect(pickStop(stops, 60, 10, null).pos).toBe(0);
        expect(pickStop(stops, 40, 10, null).pos).toBe(0);
        expect(pickStop(stops, 150, 10, null).pos).toBe(1);
        for (const x of [-5, 0, 30, 99, 100, 160, 250]) expect(pickStop(stops, x, 10, null).pos).toBe(pickItem(stops, x, 10).pos);
    });
    it('the constant is a fraction of the entered stop\'s half-width', () => {
        expect(HYSTERESIS).toBeGreaterThanOrEqual(0.3);
        expect(HYSTERESIS).toBeLessThanOrEqual(0.4);
    });
    it('going right it switches only once the point is that far into the next stop', () => {
        expect(pickStop(stops, 100, 10, { pos: 0, after: 0 }).pos).toBe(0);            // the edge alone does not switch
        expect(pickStop(stops, 100 + m - 1, 10, { pos: 0, after: 0 }).pos).toBe(0);
        expect(pickStop(stops, 100 + m + 1, 10, { pos: 0, after: 0 }).pos).toBe(1);
    });
    it('going back needs the same overshoot the other way', () => {
        expect(pickStop(stops, 99, 10, { pos: 1, after: 0 }).pos).toBe(1);
        expect(pickStop(stops, 100 - m + 1, 10, { pos: 1, after: 0 }).pos).toBe(1);
        expect(pickStop(stops, 100 - m - 1, 10, { pos: 1, after: 0 }).pos).toBe(0);
    });
    it('a jump over several stops lands on the one under the point at once', () => {
        expect(pickStop(stops, 205, 10, { pos: 0, after: 0 }).pos).toBe(2);
        expect(pickStop(stops, 190, 10, { pos: 0, after: 0 }).pos).toBe(1);
    });
    it('a wobble around an edge does not flicker', () => {
        let prev = { pos: 0, after: 0 };
        const seen = [];
        for (const x of [95, 102, 98, 105, 99, 110, 101]) { const h = pickStop(stops, x, 10, prev); seen.push(h.pos); prev = { pos: h.pos, after: h.after }; }
        expect(new Set(seen).size).toBe(1);
    });
    it('a previous stop on another row means no stickiness', () => {
        const rows = [...stops, { s: 9, after: 0, kind: 'syllable', left: 0, top: 60, bottom: 80 }];
        expect(pickStop(rows, 20, 70, { pos: 1, after: 0 }).pos).toBe(9);
    });
});

describe('createGlideDriver: the overlay is drawn in the move handler, the commit once per frame', () => {
    function setup() {
        const shown = [];
        const commits = [];
        const frames = [];
        const scroll = { x: 0, y: 0 };
        const driver = createGlideDriver({
            pick: (x, y, tier) => ({ left: Math.round(x), right: Math.round(x) + 10, top: Math.round(y), bottom: Math.round(y) + 20, tier }),
            overlay: { show: (h) => shown.push(h), hide: () => shown.push(null) },
            schedule: (fn) => frames.push(fn),
            onCommit: (h) => commits.push(h),
            bounds: () => ({ left: 0, right: 300, top: 0, bottom: 500 }),
            scroll: () => scroll,
        });
        return { driver, shown, commits, frames, scroll };
    }
    it('the overlay position updates SYNCHRONOUSLY inside move(); nothing is committed until the frame', () => {
        const { driver, shown, commits, frames } = setup();
        driver.begin(100, 100);
        expect(shown).toHaveLength(0);
        driver.move(10, 0, 16);
        expect(shown).toHaveLength(1);                       // drawn before move() returned
        expect(shown[0].left).toBeGreaterThan(100);
        expect(commits).toHaveLength(0);
        driver.move(10, 0, 16);
        driver.move(10, 0, 16);
        expect(shown).toHaveLength(3);                       // every move draws
        expect(commits).toHaveLength(0);
        expect(frames).toHaveLength(1);                      // but only ONE frame is queued
        frames.shift()();
        expect(commits).toHaveLength(1);                     // once per frame, with the latest hit
        expect(commits[0]).toBe(shown[2]);
    });
    it('lifting commits what is pending', () => {
        const { driver, commits } = setup();
        driver.begin(100, 100);
        driver.move(10, 0, 16);
        driver.end();
        expect(commits).toHaveLength(1);
        expect(driver.active).toBe(false);
    });
    it('cancel commits nothing and hides the overlay; a late frame does nothing', () => {
        const { driver, shown, commits, frames } = setup();
        driver.begin(100, 100);
        driver.move(10, 0, 16);
        driver.cancel();
        expect(shown.at(-1)).toBe(null);
        frames.shift()();
        expect(commits).toHaveLength(0);
        expect(driver.move(5, 5, 16)).toBe(null);            // inactive: ignored
    });
    it('the point is clamped to the chart', () => {
        const { driver } = setup();
        driver.begin(290, 490);
        driver.move(500, 500, 16);
        expect(driver.point).toEqual({ x: 300, y: 500 });
    });
    it('the point lives in page px: scrolling does not drag it along', () => {
        const { driver, scroll, shown } = setup();
        driver.begin(100, 100);
        scroll.y = 50;
        driver.move(0, 0.0001, 16);
        expect(shown.at(-1).top).toBe(50);                   // 100 page px - 50 scroll
    });
});

describe('createGlideDriver: the chart path is absolute (the point IS the finger)', () => {
    function setup(bounds = { left: 0, right: 300, top: 0, bottom: 500 }) {
        const picks = [];
        const commits = [];
        const frames = [];
        // stops 100px apart on one row: the hit's pos is the stop index under x
        const driver = createGlideDriver({
            pick: (x, y) => { picks.push({ x, y }); return { pos: Math.round(x / 100), after: 0, left: x, right: x + 10, top: y, bottom: y + 20 }; },
            overlay: { show() {}, hide() {} },
            schedule: (fn) => frames.push(fn),
            onCommit: (h) => commits.push(h),
            bounds: () => bounds,
            scroll: () => ({ x: 0, y: 0 }),
        });
        return { driver, picks, commits, frames };
    }
    it('a fast 300px finger move moves the point exactly 300px (no gain)', () => {
        const { driver, picks } = setup({ left: 0, right: 2000, top: 0, bottom: 500 });
        driver.begin();
        driver.moveTo(100, 50, 0);
        driver.moveTo(400, 50, 20);                      // 15 px/ms: the relative path would gain this 2.4x
        expect(picks.at(-1)).toEqual({ x: 400, y: 50 });
        expect(driver.point).toEqual({ x: 400, y: 50 });
    });
    it('back and forth never drifts: returning to a place returns to the same point', () => {
        const { driver, picks } = setup();
        driver.begin();
        for (let i = 0; i < 20; i++) { driver.moveTo(250, 80, i * 20); driver.moveTo(50, 80, i * 20 + 10); }
        driver.moveTo(120, 80, 999);
        expect(picks.at(-1)).toEqual({ x: 120, y: 80 });
    });
    it('clamping hands pick a clamped point but never accumulates: coming back from outside is 1:1', () => {
        const { driver, picks } = setup();
        driver.begin();
        driver.moveTo(900, 80, 0);                       // way past the right edge
        expect(picks.at(-1).x).toBe(300);
        driver.moveTo(280, 80, 20);                      // 20px left of the edge is 280, not 900 - 20
        expect(picks.at(-1).x).toBe(280);
    });
    it('needs no cursor position to begin', () => {
        const { driver } = setup();
        expect(() => driver.begin()).not.toThrow();
        expect(driver.active).toBe(true);
    });
});

describe('createGlideDriver: a lift commits what was shown SETTLE_MS earlier', () => {
    function setup() {
        const commits = [];
        const frames = [];
        const driver = createGlideDriver({
            pick: (x) => ({ pos: Math.round(x / 100), after: 0, left: x, right: x + 10, top: 0, bottom: 20 }),
            overlay: { show() {}, hide() {} },
            schedule: (fn) => frames.push(fn),
            onCommit: (h) => commits.push(h.pos),
            bounds: () => ({ left: 0, right: 1000, top: 0, bottom: 100 }),
            scroll: () => ({ x: 0, y: 0 }),
        });
        return { driver, commits, frames };
    }
    it('a stop that appeared < SETTLE_MS before the lift is not committed; the earlier one is', () => {
        const { driver, commits, frames } = setup();
        driver.begin(undefined, undefined, { pos: 1, after: 0 });
        driver.moveTo(100, 10, 0);
        driver.moveTo(200, 10, 300);                     // the thumb slides onto stop 2 as it lifts
        frames.splice(0).forEach((f) => f());
        driver.end(300 + SETTLE_MS - 10);
        expect(commits.at(-1)).toBe(1);
    });
    it('a stop older than SETTLE_MS is committed', () => {
        const { driver, commits } = setup();
        driver.begin(undefined, undefined, { pos: 1, after: 0 });
        driver.moveTo(100, 10, 0);
        driver.moveTo(200, 10, 300);
        driver.end(300 + SETTLE_MS + 5);
        expect(commits.at(-1)).toBe(2);
    });
    it('with no older stop seen, the seed (where the glide began) is what was shown', () => {
        const { driver, commits } = setup();
        driver.begin(undefined, undefined, { pos: 1, after: 0 });
        driver.moveTo(200, 10, 500);
        driver.end(520);
        expect(commits.at(-1)).toBe(1);
    });
    it('the relative path (no times) commits the latest, as before', () => {
        const { driver, commits } = setup();
        driver.begin(100, 10);
        driver.move(100, 0, 16);
        driver.end();
        expect(commits.length).toBe(1);
    });
});

describe('normalizeCursor: one place per letter', () => {
    it('the offset just before a chord is the offset after it', () => {
        const t = 'Over the [A]hill';
        const before = t.indexOf('[A]');
        const after = before + 3;
        expect(normalizeCursor(t, before)).toBe(after);
        expect(normalizeCursor(t, after)).toBe(after);
    });
    it('consecutive chords: land after the last', () => {
        const t = 'a[G][C]b';
        expect(normalizeCursor(t, 1)).toBe(7);
        expect(normalizeCursor(t, 4)).toBe(7);
    });
    it('inside a token goes to its end', () => {
        expect(normalizeCursor('a[Am7]b', 3)).toBe(6);
    });
    it('plain stops, line ends and other lines are untouched', () => {
        const t = 'Hello world\n[G]Next';
        expect(normalizeCursor(t, 3)).toBe(3);                 // "Hel|lo"
        expect(normalizeCursor(t, 11)).toBe(11);
        expect(normalizeCursor(t, 12)).toBe(15);               // line start before a chord
        expect(normalizeCursor(t, 99)).toBe(99);
    });
    it('a trailing chord: the end of the words is before it, after it is the same place', () => {
        const t = 'home [D]';
        expect(normalizeCursor(t, 5)).toBe(8);
    });
});

describe('snapCursor: any position snaps to a stop', () => {
    const t = 'Many long years ago';
    it('mid-syllable goes to the syllable start', () => {
        expect(snapCursor(t, t.indexOf('years') + 2)).toEqual({ pos: t.indexOf('years'), after: 0 });
        expect(snapCursor(t, t.indexOf('long') + 1)).toEqual({ pos: t.indexOf('long'), after: 0 });
    });
    it('a double space has ONE gap stop, at the first space; the second space snaps to a stop', () => {
        const d = 'years  since';
        expect(snapCursor(d, 5)).toEqual({ pos: 5, after: 0 });
        const s6 = snapCursor(d, 6);
        expect([5, 7]).toContain(s6.pos);
    });
    it('the end of the last word and past it is the slot after the words', () => {
        expect(snapCursor(t, t.length)).toEqual({ pos: t.length, after: 1 });
        expect(snapCursor('home   ', 5)).toEqual({ pos: 7, after: 1 });
    });
    it('after an undo: a position left in the middle of a word snaps back to a stop', () => {
        // a chord at a mid-word seam was undone, leaving the cursor between two letters
        const after = 'Amazing grace';
        const s = snapCursor(after, 5);
        expect(after.slice(s.pos)).toMatch(/^(zing|ing| grace)/);
        expect(s.after).toBe(0);
    });
    it('never stands just before a chord token', () => {
        const c = 'years[D] since';
        expect(snapCursor(c, 5)).toEqual({ pos: 8, after: 0 });     // after the chord, the gap stop
        expect(snapCursor(c, 6)).toEqual({ pos: 8, after: 0 });
    });
});
