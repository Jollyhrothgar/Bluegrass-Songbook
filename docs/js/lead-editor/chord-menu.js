// The chord panel: always docked, never floating. Two parts in ONE root:
//   the magnifier (`.chm-strip`: the current line, enlarged, you drag it to move the box seam by
//   seam; OFF by default, an accessibility toggle, and when off it is not in the DOM) and the picker
//   (`.chm-body`: header with the ONE nav row of arrows / undo / redo / magnifier toggle, decorations,
//   the two chord rows, More roots / Add chord line).
// layout 'split'  (phones, and any window too narrow for a side panel): the magnifier is a fixed
//                 bar at the top, the picker a fixed bar at the bottom (CSS positions both; the root
//                 is `display: contents`).
// layout 'side'   (wide desktop): one sticky panel beside the chart, magnifier above picker.
// ONE content layout (chord-menu-model.js). This file is only drawing and events.

import { chordGlyphHtml, isValidChord } from '../chords.js';
import { chordMenuModel, applyBass } from './chord-menu-model.js';
import { HOLD_MS, HOLD_SLOP_PX } from './chord-motion.js';

/** The decoration marks are bare superscripts in the model (⁷ ⁶⁄₉ sus²); in the buttons they are drawn at full size. */
const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁄': '/' };
export const readableMark = (label) => String(label).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀-₉⁄]/g, (c) => SUPERSCRIPTS[c] || c);


const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
};

/**
 * @param {object} o
 * @param {() => {key:string, keySet?:boolean, used:string[], current:string, moving:boolean}} o.getContext  read fresh on every update
 * @param {(chord:string)=>void} o.onPick       a cell, a decoration, "any chord"
 * @param {()=>void} o.onRemove
 * @param {()=>void} o.onMove                    toggles carry mode
 * @param {()=>void} o.onClose
 * @param {(dir:'next'|'prev'|'up'|'down')=>void} o.onStep   the arrow buttons
 * @param {() => HTMLElement|null} o.getStrip    a clone of the current line
 * @param {(d:{dx:number,dy:number,dt:number}|null, phase:'start'|'move'|'end')=>void} o.onGlide  the strip drag and the hold-to-trackpad drag: RAW pointer movement (the controller owns the glide point)
 * @param {()=>void} [o.onAddChordLine]
 * @param {(mode:'lyrics'|'chords'|'chordpro')=>void} [o.onMode]   the picker's mode switch (the SAME setMode as the editor header's)
 * @param {() => boolean} [o.getMagnifier]    whether the top magnifier is on (read fresh on every render)
 * @param {(on:boolean)=>void} [o.onMagnifier]  the nav row's toggle
 * @param {()=>void} [o.onUndo]
 * @param {()=>void} [o.onRedo]
 * @param {() => {undo:number, redo:number}} [o.getHistory]        drives the disabled state of the two buttons
 */
export function createChordMenu({ getContext, onPick, onRemove, onMove, onClose, onStep, getStrip, onGlide, onAddChordLine, onMode, onUndo, onRedo, getHistory, getMagnifier, onMagnifier }) {
    const root = el('div', 'chm-menu hidden');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Chords');
    // Pressing a button must not steal focus: the box's keys live on the document
    root.addEventListener('mousedown', (e) => { if (!e.target.closest('input, select')) e.preventDefault(); });
    let moreOpen = false;     // More roots
    let bassOpen = false;     // the bass row
    let extraOpen = null;     // the second decorations row: true / false once the user toggled it, null = open only while a rare mark is on
    let layout = 'split';

    // ---- the trackpad strip: built once, never re-created, so a drag survives updates
    const strip = el('div', 'chm-strip');
    const stripView = el('div', 'chm-strip-view');
    stripView.setAttribute('aria-label', 'Drag to move the box along the line');
    const stripLine = el('div', 'chm-strip-line song-body');
    stripView.appendChild(stripLine);
    const arrow = (cls, glyph, label, dir) => {
        const b = el('button', `chm-step ${cls}`, glyph);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        b.addEventListener('click', () => onStep(dir));
        return b;
    };
    strip.append(stripView);
    const magnifierOn = () => !!getMagnifier?.();
    // the top bar is NOT RENDERED while the magnifier is off (render() adds / removes it)
    const body = el('div', 'chm-body');
    root.appendChild(body);

    // ---- gestures: the strip, and holding anywhere on the sheet. Both feed ONE glide (chord-motion.js)
    // `g` is the gesture in progress: { id, kind: 'strip'|'hold', x, y, t, glide, armed }
    let g = null;
    let holdTimer = null;
    let noClickUntil = 0;
    const startGlide = (id, kind, e) => {
        g = { id, kind, x: e.clientX, y: e.clientY, t: e.timeStamp, x0: e.clientX, y0: e.clientY, armed: kind === 'strip' };
    };
    stripView.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        if (g) cancelGesture();      // a stale gesture (its pointerup was lost) must not block a new press
        startGlide(e.pointerId, 'strip', e);
        stripView.classList.add('dragging');
        onGlide?.(null, 'start');
        e.preventDefault();
    });
    // holding still on the sheet (a finger, not a mouse) turns it into a trackpad, like the iPhone space bar
    root.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' || e.button > 0) return;
        if (e.target.closest('.chm-strip-view, input, select, textarea')) return;
        if (g) cancelGesture();
        startGlide(e.pointerId, 'hold', e);
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
            if (!g || g.kind !== 'hold') return;
            g.armed = true;
            root.classList.add('is-trackpad');
            try { navigator.vibrate?.(8); } catch { /* no haptics */ }
            onGlide?.(null, 'start');
        }, HOLD_MS);
    });
    // once it is a trackpad the page must not scroll under the finger
    root.addEventListener('touchmove', (e) => { if (g?.armed) e.preventDefault(); }, { passive: false });
    // lifting a trackpad drag must not press the button under the finger
    root.addEventListener('click', (e) => {
        if (Date.now() < noClickUntil) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    const onPointerMove = (e) => {
        if (!g || e.pointerId !== g.id) return;
        if (!g.armed) {
            // still deciding: a real movement before the hold fires is a scroll or a tap-slide, not a trackpad
            if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > HOLD_SLOP_PX) { clearTimeout(holdTimer); g = null; }
            return;
        }
        // a mouse that was released outside the window never sends pointerup: no button held = over
        if (e.pointerType === 'mouse' && e.buttons === 0) { endGesture(e); return; }
        const d = { dx: e.clientX - g.x, dy: e.clientY - g.y, dt: e.timeStamp - g.t };
        g.x = e.clientX; g.y = e.clientY; g.t = e.timeStamp;
        if (d.dx || d.dy) onGlide?.(d, 'move');
    };
    const endGesture = (e) => {
        if (!g || e.pointerId !== g.id) return;
        clearTimeout(holdTimer);
        const was = g;
        g = null;
        stripView.classList.remove('dragging');
        root.classList.remove('is-trackpad');
        if (was.armed) {
            if (was.kind === 'hold') noClickUntil = Date.now() + 400;
            onGlide?.(null, 'end');
        }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    // a stale gesture must never outlive its pointer (it would swallow later taps): drop it on any loss of capture too
    const onLostCapture = (e) => { if (!e.buttons) endGesture(e); };
    window.addEventListener('lostpointercapture', onLostCapture, true);
    /** Forget any gesture in flight (mode switch, close, a new press): hold timer, trackpad class, click swallow. */
    function cancelGesture() {
        clearTimeout(holdTimer);
        const was = g;
        g = null;
        noClickUntil = 0;
        stripView.classList.remove('dragging');
        root.classList.remove('is-trackpad');
        if (was?.armed) onGlide?.(null, 'end');
    }

    let lastShift = 0;
    let lastLine = null;
    function refreshStrip() {
        if (!magnifierOn() || !strip.isConnected) return;
        const clone = getStrip?.();
        stripLine.replaceChildren();
        strip.classList.toggle('empty', !clone);
        if (!clone) { lastLine = null; return; }
        stripLine.appendChild(clone);
        // the cursor sits mid-strip when it can, and is always fully in view: measure with no transform,
        // then slide from where the last line was (so the line glides under the cursor)
        const target = clone.querySelector('.cl-gap-bar, .cl-box-chord .cl-chord-glyph, .cl-slot-pill, .cl-box-text');
        const view = stripView.getBoundingClientRect();
        let shift = 0;
        clone.style.transition = 'none';
        clone.style.transform = 'none';
        if (target && view.width) {
            const t = target.getBoundingClientRect();
            const l = clone.getBoundingClientRect();
            const lineLeft = l.left - view.left;                    // where the line starts in the strip
            const c = lineLeft + (t.left + t.right) / 2 - l.left;   // the cursor's centre, in strip coordinates
            const half = (t.right - t.left) / 2 + 8;                // the cursor plus a margin
            // centred, but never closer to an edge than the cursor's own half-width
            shift = Math.max(half - c, Math.min(view.width / 2 - c, view.width - half - c));
        }
        const key = clone.dataset.key || '';
        const from = key === lastLine ? lastShift : shift;
        clone.style.transform = `translateX(${Math.round(from)}px)`;
        void clone.offsetWidth;                                       // commit the start before sliding
        clone.style.transition = '';
        clone.style.transform = `translateX(${Math.round(shift)}px)`;
        lastShift = shift;
        lastLine = key;
    }

    function render() {
        const ctx = getContext();
        const model = chordMenuModel({ key: ctx.key, used: ctx.used, current: ctx.current });
        root.className = `chm-menu chm-${layout}${root.classList.contains('hidden') ? ' hidden' : ''}${g?.armed ? ' is-trackpad' : ''}`;
        body.innerHTML = '';
        if (magnifierOn()) { if (!strip.isConnected) root.insertBefore(strip, body); }
        else if (strip.isConnected) { strip.remove(); lastLine = null; }

        // Two rows, each a FIXED height whatever the cursor holds (CSS: .chm-row1 / .chm-row2):
        //   row 1: Key ▾ ............ Lyrics | Chords | ChordPro   (Done is gone: Lyrics does that)
        //   row 2: the function line ... Move  ✕ Remove
        //   row 3: the nav row (◀ ▲ ▼ ▶ ... ↶ ↷ magnifier)
        const head = el('div', 'chm-head');
        const row1 = el('div', 'chm-row chm-row1');
        // the song's key, shown, not chosen here: one key per song, changed in ONE place (the editor toolbar), and that
        // moves the whole song. Any chord is still reachable (More roots, typing), so a real key change mid-song can be charted
        const keySel = el('span', 'chm-key');
        keySel.textContent = ctx.keySet === false ? 'Key: not set' : `Key of ${model.key}`;
        keySel.title = 'The song\u2019s key. Change it in the toolbar: that moves every chord.';
        row1.append(keySel, el('span', 'chm-sp'));
        if (onMode) {
            const sw = el('div', 'le-modeswitch chm-modeswitch');
            sw.setAttribute('role', 'group');
            sw.setAttribute('aria-label', 'Editor mode');
            for (const [m, label] of [['lyrics', 'Lyrics'], ['chords', 'Chords'], ['chordpro', 'ChordPro']]) {
                const b = el('button', m === 'chords' ? 'on' : '', label);   // the picker is only on screen in Chords mode
                b.type = 'button';
                b.dataset.pickerMode = m;
                b.setAttribute('aria-pressed', String(m === 'chords'));
                b.addEventListener('click', () => onMode(m));
                sw.appendChild(b);
            }
            row1.appendChild(sw);
        }
        head.appendChild(row1);

        const row2 = el('div', 'chm-row chm-row2');
        if (model.func) {
            // the chord in the box and what it does in the key, ONCE: "A⁷ · II⁷ (V⁷/V)"
            const f = model.func;
            const fn = el('span', 'chm-func');
            fn.innerHTML = `${chordGlyphHtml(ctx.current)} · ${chordGlyphHtml(f.numeral)}${f.secondary ? ` (${chordGlyphHtml(f.secondary)})` : ''}`;
            fn.setAttribute('aria-label', `${ctx.current}, ${f.text}`);
            row2.appendChild(fn);
        }
        else {
            // keeps the row in place with an empty box
            const ph = el('span', 'chm-func-ph', '&nbsp;');
            ph.setAttribute('aria-hidden', 'true');
            row2.appendChild(ph);
        }
        row2.appendChild(el('span', 'chm-sp'));
        if (ctx.current) {
            const mv = el('button', `chm-move${ctx.moving ? ' on' : ''}`, ctx.moving ? 'Moving: drop' : 'Move');
            mv.type = 'button';
            mv.setAttribute('aria-pressed', String(!!ctx.moving));
            mv.addEventListener('click', onMove);
            row2.appendChild(mv);
            const rm = el('button', 'chm-remove', '✕ Remove');
            rm.type = 'button';
            rm.addEventListener('click', onRemove);
            row2.appendChild(rm);
        }
        head.appendChild(row2);

        // ONE nav row, the same in split and side: ◀ ▲ ▼ ▶ ... ↶ ↷ [magnifier]. Every target is 40px.
        const row3 = el('div', 'chm-row chm-row3 chm-nav');
        row3.append(
            arrow('chm-prev', '◀', 'Previous spot', 'prev'), arrow('chm-up', '▲', 'Line above', 'up'),
            arrow('chm-down', '▼', 'Line below', 'down'), arrow('chm-next', '▶', 'Next spot', 'next'),
            el('span', 'chm-sp'));
        if (onUndo || onRedo) {
            const h = getHistory?.() || { undo: 0, redo: 0 };
            const hb = (cls, glyph, label, fn, n) => {
                const b = el('button', `chm-hist ${cls}`, glyph);
                b.type = 'button';
                b.setAttribute('aria-label', label);
                b.title = label;
                b.disabled = n === 0;
                b.addEventListener('click', () => fn?.());
                return b;
            };
            row3.append(hb('chm-undo', '↶', 'Undo', onUndo, h.undo), hb('chm-redo', '↷', 'Redo', onRedo, h.redo));
        }
        if (onMagnifier) {
            const mg = el('button', `chm-mag${magnifierOn() ? ' on' : ''}`,
                '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/></svg>');
            mg.type = 'button';
            mg.setAttribute('aria-label', 'Magnifier');
            mg.title = 'Magnifier: show the current line enlarged above the chart';
            mg.setAttribute('aria-pressed', String(magnifierOn()));
            mg.addEventListener('click', () => onMagnifier(!magnifierOn()));
            row3.appendChild(mg);
        }
        head.appendChild(row3);
        body.appendChild(head);

        // decorations: the ONLY place extensions live. With an empty box the row is still there, disabled and
        // dimmed, at the same height: the docked sheet must not change height as the cursor moves (its top
        // edge, with the arrows, would jump under the finger).
        if (!model.decorations.length) {
            bassOpen = false;
            const decos = el('div', 'chm-decos idle');
            decos.setAttribute('aria-disabled', 'true');
            for (const d of model.idleDecorations) {
                const b = el('button', 'chm-deco chm-outside idle');
                b.textContent = readableMark(d.label);
                b.type = 'button';
                b.disabled = true;
                b.tabIndex = -1;
                b.title = d.name;
                decos.appendChild(b);
            }
            const dots = el('button', 'chm-deco chm-extra idle', '⋯');
            dots.type = 'button';
            dots.disabled = true;
            dots.tabIndex = -1;
            decos.appendChild(dots);
            body.appendChild(decos);
        }
        if (model.decorations.length) {
            const decos = el('div', 'chm-decos');
            const mark = (d) => {
                const b = el('button', `chm-deco ${d.inKey ? 'chm-inkey' : 'chm-outside'}${d.on ? ' on' : ''}${d.rare ? ' rare' : ''}`);
                b.textContent = readableMark(d.label);
                b.type = 'button';
                b.dataset.id = d.id;
                b.dataset.apply = d.chord;     // what it gives; deliberately NOT data-chord (that names the grid cells)
                b.title = d.name;
                b.setAttribute('aria-label', `${d.name}${d.inKey ? ', in key' : ', outside the key'}`);
                b.setAttribute('aria-pressed', String(d.on));
                b.addEventListener('click', () => onPick(d.chord, { decoration: d.id }));
                return b;
            };
            for (const d of model.decorations.filter((x) => !x.rare)) decos.appendChild(mark(d));
            const rare = model.decorations.filter((x) => x.rare);
            // open by hand, else open on its own while one of its marks is on the chord (the user can still close it)
            const showRare = extraOpen ?? rare.some((d) => d.on);
            const dots = el('button', `chm-deco chm-extra${showRare ? ' on' : ''}`, '⋯');
            dots.type = 'button';
            dots.dataset.id = 'extra';
            dots.setAttribute('aria-label', 'More extensions');
            dots.setAttribute('aria-expanded', String(showRare));
            dots.addEventListener('click', () => { extraOpen = !showRare; render(); });
            decos.appendChild(dots);
            body.appendChild(decos);
            if (showRare) {
                // the second row: the rarer marks, then /bass, which opens the row of bass notes under it
                const decos2 = el('div', 'chm-decos chm-decos2');
                for (const d of rare) decos2.appendChild(mark(d));
                const bassBtn = el('button', `chm-deco chm-bass${model.bass.on || bassOpen ? ' on' : ''}`);
                // textContent, never HTML: the bass is whatever followed '/' in the song's own chord text
                bassBtn.textContent = model.bass.on ? `/${model.bass.note}` : '/ bass';
                bassBtn.type = 'button';
                bassBtn.dataset.id = 'bass';
                bassBtn.setAttribute('aria-expanded', String(bassOpen));
                bassBtn.addEventListener('click', () => { bassOpen = !bassOpen; render(); });
                decos2.appendChild(bassBtn);
                body.appendChild(decos2);
            }
            else bassOpen = false;
            if (bassOpen) {
                const notes = el('div', 'chm-basses');
                for (const n of model.bass.notes) {
                    const b = el('button', `chm-root ${n.inKey ? 'chm-inkey' : 'chm-outside'}${n.on ? ' on' : ''}`, chordGlyphHtml(n.note));
                    b.type = 'button';
                    b.dataset.bass = n.note;
                    b.addEventListener('click', () => onPick(applyBass(ctx.current, n.note)));
                    notes.appendChild(b);
                }
                body.appendChild(notes);
            }
        }

        const cellButton = (cell) => {
            const b = el('button', ['chm-cell', cell.outside ? 'chm-outside' : 'chm-inkey', cell.used && 'used', cell.selected && 'sel', cell.quiet && 'quiet'].filter(Boolean).join(' '),
                `<span class="c">${chordGlyphHtml(cell.chord)}</span><span class="n">${chordGlyphHtml(cell.numeral)}</span>`);
            b.type = 'button';
            b.dataset.chord = cell.chord;
            b.setAttribute('aria-label', `${cell.chord}, ${cell.numeral}, ${cell.outside ? 'outside the key' : 'in key'}`);
            b.addEventListener('click', () => onPick(cell.chord));
            return b;
        };
        for (const row of model.rows) {
            const grid = el('div', `chm-grid chm-row-${row.id}`);
            grid.setAttribute('role', 'group');
            grid.setAttribute('aria-label', row.label);
            for (const cell of row.cells) grid.appendChild(cellButton(cell));
            body.appendChild(grid);
        }

        const foot = el('div', 'chm-foot');
        foot.appendChild(el('span', 'chm-sp'));
        if (onAddChordLine) {
            // ↵ continues onto a new chords-only line below the cursor's line, like Enter while typing
            const add = el('button', 'chm-addline chm-enter', '↵ Chord line');
            add.type = 'button';
            add.setAttribute('aria-label', 'New chord line below this line');
            add.title = 'Chord line — continue on a new row of chords with no words (intro / break). Turnarounds at the end of a line: step past its last word instead.';
            add.addEventListener('click', onAddChordLine);
            foot.appendChild(add);
        }
        const more = el('button', 'chm-more', moreOpen ? 'More roots ▾' : 'More roots ▸');
        more.type = 'button';
        more.setAttribute('aria-expanded', String(moreOpen));
        more.addEventListener('click', () => { moreOpen = !moreOpen; render(); });
        foot.appendChild(more);
        body.appendChild(foot);

        if (moreOpen) body.appendChild(renderMore(model, cellButton));
    }

    /** More roots: only the chromatic roots on neither row, each as a major and a minor cell (outside), then the last-resort field. */
    function renderMore(model, cellButton) {
        const wrap = el('div', 'chm-morepanel');
        const n = Math.max(1, model.moreRoots.length);
        const majors = el('div', 'chm-grid chm-row-more');
        const minors = el('div', 'chm-grid chm-row-more');
        majors.style.gridTemplateColumns = minors.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
        for (const r of model.moreRoots) { majors.appendChild(cellButton(r.major)); minors.appendChild(cellButton(r.minor)); }
        majors.setAttribute('role', 'group'); majors.setAttribute('aria-label', 'More roots, major');
        minors.setAttribute('role', 'group'); minors.setAttribute('aria-label', 'More roots, minor');
        wrap.append(majors, minors);
        const free = el('form', 'chm-free');
        const input = el('input');
        input.type = 'text';
        input.placeholder = 'Any chord, e.g. D/F#';
        input.setAttribute('aria-label', 'Any chord');
        input.autocapitalize = 'off';
        const go = el('button', 'chm-go', 'Add');
        go.type = 'submit';
        free.append(input, go);
        free.addEventListener('submit', (e) => {
            e.preventDefault();
            const v = input.value.trim();
            if (isValidChord(v)) { input.value = ''; onPick(v); } else input.classList.add('invalid');
        });
        input.addEventListener('input', () => input.classList.remove('invalid'));
        wrap.appendChild(free);
        return wrap;
    }

    return {
        el: root,
        /** The two docked parts, for measuring: the magnifier and the picker. */
        get parts() { return { strip, body }; },
        get magnifier() { return magnifierOn() && strip.isConnected; },
        get layout() { return layout; },
        get isOpen() { return !root.classList.contains('hidden'); },
        /** Show it. `layout` is 'split' (top magnifier + bottom picker) or 'side' (one sticky panel). */
        open({ layout: l = layout } = {}) {
            layout = l;
            root.classList.remove('hidden');
            render();
            refreshStrip();
        },
        /** Change the layout of an open or closed panel (the window crossed a breakpoint). */
        setLayout(l) {
            if (l === layout) return;
            layout = l;
            root.classList.remove('chm-split', 'chm-side');
            root.classList.add(`chm-${layout}`);
            if (this.isOpen) refreshStrip();
        },
        /** Re-read the context (box moved, chord changed). */
        update() {
            if (!this.isOpen) return;
            render();
            refreshStrip();
        },
        refreshStrip() { if (this.isOpen) refreshStrip(); },
        destroy() { clearTimeout(holdTimer); window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', endGesture); window.removeEventListener('pointercancel', endGesture); window.removeEventListener('lostpointercapture', onLostCapture, true); root.remove(); },
        cancelGesture,
        close() { cancelGesture(); root.classList.add('hidden'); moreOpen = false; bassOpen = false; extraOpen = null; },
    };
}
