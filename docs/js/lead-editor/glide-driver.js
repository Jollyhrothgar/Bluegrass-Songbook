// The in-flight cursor. A glide moves a virtual POINT (page px) by the pointer's movement times a
// gain (chord-motion.js), hit-tests it with the same function a tap uses, and then:
//
//   SYNCHRONOUSLY, in the pointermove handler   draws the overlay (a lightweight element moved with
//                                                `transform`) on the hit's `ring` (the letter under the
//                                                point: continuous) or, without one, on the hit itself;
//   at most once per animation frame             hands the hit to `onCommit` (the heavy part: the
//                                                CodeMirror change, the strip, the sheet).
//
// Two entry points. RELATIVE `move(dx, dy, dt)` (a trackpad: the held sheet, the magnifier strip) adds the pointer's
// movement x gain to a point that starts at the cursor. ABSOLUTE `moveTo(x, y, t)` (the chart itself) IS the finger,
// viewport px, no gain and no accumulated state: the glide responds to the physical screen area. The chart is clamped
// only for the hit-test, never in stored state, so overshoot cannot become a permanent offset.
//
// With event times (`moveTo`, `end(t)`) a short history of stops is kept; a lift commits the stop that was current
// SETTLE_MS earlier when a newer one appeared inside that window (the thumb slid as it left the glass).
//
// Pure of CodeMirror: `pick`, `overlay`, `schedule` and `onCommit` are injected, so it unit-tests with
// a fake layout. Coordinates handed to `pick` are viewport px (the page scroll is added back here).

import { createPointGlide, clampPoint, SETTLE_MS } from './chord-motion.js';

/**
 * @param {object} o
 * @param {(x:number, y:number, prev:object|null)=>object|null} o.pick   hit-test a viewport point -> a STOP hit with {left,right,top,bottom} and optionally `ring` (the rect to draw); `prev` is the previous hit (hysteresis)
 * @param {{show(rect:object):void, hide():void}} o.overlay                   draws the cursor; called synchronously
 * @param {(fn:()=>void)=>any} [o.schedule]                                    requestAnimationFrame by default
 * @param {(hit:object)=>void} o.onCommit                                      once per frame, with the latest hit
 * @param {()=>{left:number,right:number,top:number,bottom:number}} o.bounds   the chart's content box (viewport px)
 * @param {()=>{x:number,y:number}} [o.scroll]                                 page scroll (default window's)
 */
export function createGlideDriver({ pick, overlay, schedule, onCommit, bounds, scroll }) {
    const raf = schedule || ((fn) => requestAnimationFrame(fn));
    const scr = scroll || (() => ({ x: window.scrollX, y: window.scrollY }));
    let glide = null;
    let pt = null;          // the point in PAGE px (relative path: the accumulated point; absolute path: the finger)
    let pending = null;     // the latest hit not yet committed
    let queued = false;
    let last = null;
    let history = [];       // [{t, hit}]: a stop and when it first appeared (event time); the seed has t = -Infinity
    const sameStop = (a, b) => !!a && !!b && a.pos === b.pos && !!a.after === !!b.after;

    const flush = () => {
        queued = false;
        const hit = pending;
        pending = null;
        if (hit && glide) onCommit(hit);
    };
    const reset = () => { pending = null; glide = null; pt = null; last = null; history = []; };
    /** Draw `hit`, queue its commit and remember it in the history (only when the STOP changed). */
    const take = (hit, t) => {
        last = hit;
        overlay.show(hit.ring || hit);
        pending = hit;
        if (Number.isFinite(t) && !sameStop(history[history.length - 1]?.hit, hit)) history.push({ t, hit });
        if (!queued) { queued = true; raf(flush); }
    };
    return {
        get active() { return !!glide; },
        get point() { return pt && { ...pt }; },
        /**
         * Start. Relative path: at a viewport point (the cursor's drawn position). Absolute path: no point needed;
         * pass `seed` (the cursor's stop {pos, after}) so a lift with no other stop old enough returns to it.
         */
        begin(x, y, seed) {
            const s = scr();
            glide = createPointGlide();
            pt = Number.isFinite(x) ? { x: x + s.x, y: y + s.y } : null;
            pending = null;
            last = null;
            history = seed ? [{ t: -Infinity, hit: seed }] : [];
        },
        /** RELATIVE pointer movement. Draws the overlay NOW and queues the commit. Returns the hit (or null). */
        move(dx, dy, dt) {
            if (!glide || !pt) return null;
            const r = glide.feed(dx, dy, dt);
            const s = scr();
            const b = bounds();
            const p = clampPoint({ x: pt.x + r.dx, y: pt.y + r.dy }, { left: b.left + s.x, right: b.right + s.x, top: b.top + s.y, bottom: b.bottom + s.y });
            pt = p;
            const hit = pick(p.x - s.x, p.y - s.y, last);
            if (hit) take(hit);
            return hit;
        },
        /** ABSOLUTE: the finger is at viewport (x, y) at event time t. Clamped for the hit-test only. */
        moveTo(x, y, t) {
            if (!glide) return null;
            const s = scr();
            const b = bounds();
            pt = { x: x + s.x, y: y + s.y };
            const c = clampPoint({ x, y }, b);
            const hit = pick(c.x, c.y, last);
            if (hit) take(hit, t);
            return hit;
        },
        /** The latest hit drawn (for the commit on lift). */
        get lastHit() { return last; },
        /**
         * Commit on lift and stop. With the lift's event time `t`, a stop that appeared less than SETTLE_MS before it
         * is not committed: the one current at t - SETTLE_MS is (the seed, when nothing older was seen).
         */
        end(t) {
            if (glide) {
                let hit = pending;
                if (Number.isFinite(t) && history.length > 1) {
                    const latest = history[history.length - 1];
                    if (latest.t > t - SETTLE_MS) {
                        let shown = null;
                        for (const h of history) if (h.t <= t - SETTLE_MS) shown = h;
                        // nothing older than the window: the stop before the newest one (it was shown first)
                        hit = (shown || history[history.length - 2]).hit;
                    }
                }
                if (hit) onCommit(hit);
            }
            reset();
        },
        /** Drop everything without committing (cancel, mode switch). */
        cancel() {
            reset();
            overlay.hide();
        },
    };
}
