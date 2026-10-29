// The loupe: while a THUMB glides the cursor over the chart, the thumb covers the syllable it is placing a chord on.
// A bubble above the finger shows the cursor's line magnified, like the iPhone keyboard's key pop. It is a picture
// (a clone of the live line, `data-chord` stripped, pointer-events none), never built from chord text.
//
// `placeLoupe` is the pure placement (unit-tested); `createLoupe` is the DOM. Not the magnifier strip (that one is an
// accessibility toggle and a trackpad): the loupe lives only for the length of a chart glide by touch or pen.

export const LOUPE_SCALE = 1.6;
export const LOUPE_MAX_W = 280;
export const LOUPE_EDGE = 6;        // px kept from the viewport's edges
export const LOUPE_GAP = 56;        // px between the bubble's bottom edge and the finger
export const LOUPE_TAIL = 10;       // the tail's half-width: it never sits closer to a corner than this

/** What marks the cursor in a line, in the order `syncRing` prefers. */
const BOXED = ['.cl-box-chord .cl-chord-glyph', '.cl-slot-pill', '.cl-box-text'];
export function boxedEl(root) {
    for (const sel of BOXED) { const e = root.querySelector(sel); if (e) return e; }
    return null;
}

/**
 * Where the bubble goes (viewport px).
 * @param {object} o
 * @param {number} o.fingerX @param {number} o.fingerY
 * @param {number} o.vw            viewport width
 * @param {number} o.topLimit      the bubble never goes above this (bottom of the top band)
 * @param {number} o.height        the bubble's height
 * @param {number|null} o.chartBoxLeft   the cursor's boxed element, left, in the chart (viewport px)
 * @param {number|null} o.cloneBoxLeft   the same element's left in the clone, relative to the bubble's left edge, unshifted
 * @param {number} [o.scale]
 * @returns {{left:number, top:number, width:number, tailX:number, shift:number}}   tailX relative to the bubble; shift = the content's translateX
 */
export function placeLoupe({ fingerX, fingerY, vw, topLimit, height, chartBoxLeft, cloneBoxLeft, scale = LOUPE_SCALE }) {
    const width = Math.min(LOUPE_MAX_W, vw - 2 * LOUPE_EDGE);
    const left = Math.min(vw - LOUPE_EDGE - width, Math.max(LOUPE_EDGE, fingerX - width / 2));
    const top = Math.max(topLimit, fingerY - LOUPE_GAP - height);
    const tailX = Math.min(width - LOUPE_TAIL, Math.max(LOUPE_TAIL, fingerX - left));
    // the spot under the finger, in the clone, goes right above the tail
    const at = chartBoxLeft == null || cloneBoxLeft == null ? tailX : cloneBoxLeft + (fingerX - chartBoxLeft) * scale;
    return { left, top, width, tailX, shift: tailX - at };
}

/**
 * @param {object} o
 * @param {() => HTMLElement|null} o.getLine     a fresh clone of the cursor's line at font scale LOUPE_SCALE (null: nothing to show)
 * @param {() => HTMLElement|null} o.getChartBox the live line's boxed element (null: none)
 * @param {() => number} o.topLimit
 */
export function createLoupe({ getLine, getChartBox, topLimit }) {
    const root = document.createElement('div');
    root.className = 'le-loupe hidden';
    root.setAttribute('aria-hidden', 'true');
    const view = document.createElement('div');
    view.className = 'le-loupe-view';
    const tail = document.createElement('div');
    tail.className = 'le-loupe-tail';
    root.append(view, tail);
    document.body.appendChild(root);
    let finger = null;
    let content = null;

    function draw() {
        if (!finger) return;
        const clone = getLine();
        view.replaceChildren();
        content = clone;
        root.classList.toggle('empty', !clone);
        if (clone) view.appendChild(clone);
        position();
    }
    function position() {
        if (!finger) return;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        const width = Math.min(LOUPE_MAX_W, vw - 2 * LOUPE_EDGE);
        root.style.width = `${width}px`;
        let cloneBoxLeft = null;
        if (content) {
            content.style.transform = 'none';
            const b = boxedEl(content);
            if (b) cloneBoxLeft = b.getBoundingClientRect().left - view.getBoundingClientRect().left;
        }
        const chartBox = getChartBox?.();
        const p = placeLoupe({
            fingerX: finger.x, fingerY: finger.y, vw, topLimit: topLimit(), height: root.offsetHeight,
            chartBoxLeft: chartBox ? chartBox.getBoundingClientRect().left : null, cloneBoxLeft,
        });
        root.style.transform = `translate(${Math.round(p.left)}px, ${Math.round(p.top)}px)`;
        tail.style.left = `${Math.round(p.tailX)}px`;
        if (content) content.style.transform = `translateX(${p.shift.toFixed(1)}px)`;
        // pop in from the tail
        root.style.transformOrigin = '0 0';
        view.style.transformOrigin = `${Math.round(p.tailX)}px 100%`;
    }
    return {
        el: root,
        get visible() { return !root.classList.contains('hidden'); },
        show(x, y) {
            finger = { x, y };
            const was = root.classList.contains('hidden');
            root.classList.remove('hidden');
            draw();
            if (was) { root.classList.remove('pop'); void root.offsetWidth; root.classList.add('pop'); }
        },
        /** The finger moved: reposition only. */
        move(x, y) { if (!finger) return; finger = { x, y }; position(); },
        /** The committed cursor (or the line under it) changed: redraw from the live line. */
        refresh() { draw(); },
        hide() { finger = null; content = null; root.classList.add('hidden'); root.classList.remove('pop'); view.replaceChildren(); },
        destroy() { root.remove(); },
    };
}
