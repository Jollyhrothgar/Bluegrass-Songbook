// OTF Editor — automation handle
//
// One object that lets a script drive the editor the way a person does and
// then ask what is ON SCREEN, so a test (Playwright, or Claude in Chrome on
// the live site) can catch "the ruler runs past the barline" without
// eyeballing a screenshot:
//
//   const auto = document.querySelector('.otf-editor').__otfEditor.automation;
//   auto.press('5'); auto.press('ArrowRight'); auto.exec('edit.undo');
//   auto.doc();                       // the document, as Download would save it
//   auto.cursor();                    // {measure, tick, string, mode}
//   auto.layout();                    // what is drawn, in client pixels
//   auto.check();                     // [] or a list of broken layout rules
//
// Everything that changes the document goes through the same binding table
// the keyboard uses (`press` synthesizes the keydown, `exec` runs an action
// by id), so undo covers it and nothing here can reach around the facade.
//
// `layout()` measures the DRAWN elements (ruler lines, fret digits, rest
// glyphs, the cursor box) against the barlines, which the renderer places at
// each measure's own `x` — independent of the tick→x mapping. That is the
// point: notes, ruler and cursor share one mapping, so they always agree
// with EACH OTHER; what can go wrong is the mapping itself drifting off the
// measure (it did: per-measure note centering put tick 0 mid-bar).

import { ACTIONS } from './bindings.js';

/**
 * `'Ctrl+z'` → a KeyboardEvent init for the editor's matcher
 * (`bindings.eventToKeyString`): digits carry `DigitN` as their code, Alt
 * letters carry `KeyX`, and a letter's case decides Shift.
 */
export function keyEventInit(chord) {
    const parts = String(chord).split('+');
    const key = parts.pop();
    const mods = new Set(parts.map(p => p.toLowerCase()));
    const init = {
        key,
        bubbles: true,
        cancelable: true,
        ctrlKey: mods.has('ctrl'),
        metaKey: mods.has('meta') || mods.has('cmd'),
        altKey: mods.has('alt'),
        shiftKey: mods.has('shift'),
    };
    if (/^[0-9]$/.test(key)) init.code = `Digit${key}`;
    else if (/^[a-zA-Z]$/.test(key)) init.code = `Key${key.toUpperCase()}`;
    else if (key === 'Space') { init.key = ' '; init.code = 'Space'; }
    return init;
}

/**
 * Rules every editor layout must satisfy, checked against measured
 * positions (client px). Pure, so it is unit-tested on hand-built layouts
 * and run unchanged against a live page.
 *
 * @param {Object} layout - what `automation.layout()` returns
 * @param {Object} [opts]
 * @param {number} [opts.tol=1.5] - px slack for anti-aliasing / rounding
 * @returns {Array<{rule: string, measure?: number, detail: string}>}
 */
export function layoutViolations(layout, { tol = 1.5 } = {}) {
    const out = [];
    const byMeasure = new Map(layout.measures.map(m => [m.measure, m]));
    const rulerOf = new Map();
    for (const r of layout.ruler) {
        if (!rulerOf.has(r.measure)) rulerOf.set(r.measure, []);
        rulerOf.get(r.measure).push(r);
    }

    for (const [measure, lines] of rulerOf) {
        const m = byMeasure.get(measure);
        if (!m) continue;
        lines.sort((a, b) => a.tick - b.tick);
        const xs = lines.map(l => l.x);
        // The ruler is periodic inside a measure...
        if (xs.length > 1) {
            const period = xs[1] - xs[0];
            for (let i = 2; i < xs.length; i++) {
                const gap = xs[i] - xs[i - 1];
                if (Math.abs(gap - period) > tol) {
                    out.push({ rule: 'ruler-periodic', measure,
                        detail: `gap ${gap.toFixed(1)} vs ${period.toFixed(1)} at tick ${lines[i].tick}` });
                    break;
                }
            }
            // ...and the whole bar fits between its own barlines: the
            // first line after the left one, and one more period after the
            // last line still at or before the right one.
            const first = xs[0];
            const pastLast = xs[xs.length - 1] + period;
            if (first < m.left - tol || pastLast > m.right + tol) {
                out.push({ rule: 'ruler-inside-measure', measure,
                    detail: `ruler ${first.toFixed(1)}..${pastLast.toFixed(1)} vs bar ${m.left.toFixed(1)}..${m.right.toFixed(1)}` });
            }
        }
    }

    // Everything drawn for a measure stays inside its barlines.
    for (const n of layout.notes) {
        const m = byMeasure.get(n.measure);
        if (m && (n.x < m.left - tol || n.x > m.right + tol)) {
            out.push({ rule: 'note-inside-measure', measure: n.measure,
                detail: `tick ${n.tick} string ${n.string} at ${n.x.toFixed(1)}` });
        }
        // A note on a ruler tick sits ON that ruler line.
        const line = (rulerOf.get(n.measure) || []).find(l => l.tick === n.tick);
        if (line && Math.abs(line.x - n.x) > tol) {
            out.push({ rule: 'note-on-ruler', measure: n.measure,
                detail: `tick ${n.tick}: note ${n.x.toFixed(1)}, ruler ${line.x.toFixed(1)}` });
        }
    }
    for (const r of layout.rests) {
        const m = byMeasure.get(r.measure);
        if (m && (r.left < m.left - tol || r.right > m.right + tol)) {
            out.push({ rule: 'rest-inside-measure', measure: r.measure,
                detail: `rest ${r.left.toFixed(1)}..${r.right.toFixed(1)} vs bar ${m.left.toFixed(1)}..${m.right.toFixed(1)}` });
        }
    }

    // Every row is drawn at the zoom the reader chose. A row laid out wider
    // than its container gets shrunk by CSS (max-width) and draws small:
    // what a 1/32 cursor step did before A20.
    for (const r of layout.rows || []) {
        if (Math.abs(r.scale - (layout.zoom ?? 1)) > 0.02) {
            out.push({ rule: 'row-squeezed',
                detail: `row ${r.row} drawn at ${r.scale.toFixed(3)}x, zoom ${(layout.zoom ?? 1).toFixed(3)}` });
        }
    }

    const c = layout.cursor;
    if (c) {
        const m = byMeasure.get(c.measure);
        if (m && (c.x < m.left - tol || c.x > m.right + tol)) {
            out.push({ rule: 'cursor-inside-measure', measure: c.measure,
                detail: `cursor ${c.x.toFixed(1)} vs bar ${m.left.toFixed(1)}..${m.right.toFixed(1)}` });
        }
        const line = (rulerOf.get(c.measure) || []).find(l => l.tick === c.tick);
        if (line && Math.abs(line.x - c.x) > tol) {
            out.push({ rule: 'cursor-on-ruler', measure: c.measure,
                detail: `tick ${c.tick}: cursor ${c.x.toFixed(1)}, ruler ${line.x.toFixed(1)}` });
        }
    }
    return out;
}

const centerX = (el) => {
    const r = el.getBoundingClientRect();
    return (r.left + r.right) / 2;
};

/**
 * Build the automation handle for one editor. Reads the editor lazily, so
 * it stays valid across re-renders; after `destroy()` every call throws.
 */
export function createAutomation(editor) {
    const live = () => {
        if (!editor.state) throw new Error('editor destroyed');
        return editor;
    };

    return {
        /** Every action id the binding table knows. */
        actions() {
            live();
            return Object.keys(ACTIONS);
        },

        /** Run an action by id, exactly as a menu item does. */
        exec(actionId, info = {}) {
            return live().keyboard.dispatchAction(actionId, info);
        },

        /**
         * Press one key chord (`'5'`, `'ArrowRight'`, `'Ctrl+z'`) or a
         * space-separated run of them, through the real keydown handler —
         * so two-digit frets, sequences and counts behave as typed.
         */
        press(keys) {
            const ed = live();
            for (const chord of String(keys).trim().split(/\s+/)) {
                ed.editorRoot.dispatchEvent(new KeyboardEvent('keydown', keyEventInit(chord)));
            }
        },

        /** The document as it would be saved (a deep copy). */
        doc() {
            return JSON.parse(JSON.stringify(live().state.export()));
        },

        /** The undo stack: where we are in it, and what each step was. */
        history() {
            const f = live().state.facade;
            return { index: f._historyIndex, steps: f._history.map(h => h.description) };
        },

        cursor() {
            const { cursor, mode } = live().state;
            return { measure: cursor.measure, tick: cursor.tick, string: cursor.string, mode };
        },

        /** Put the cursor somewhere without a click. */
        setCursor({ measure, tick = 0, string }) {
            // The same three writes a canvas click makes (_setCursorFromPoint)
            const ed = live();
            const c = ed.state.cursor;
            c.measure = measure;
            c.tick = tick;
            if (string != null) c.string = string;
            ed.cursor.update();
            ed.state._emit('cursorMove', c);
        },

        /** What is drawn, in client px (see layoutViolations for the rules). */
        layout() {
            const ed = live();
            const rows = ed.renderer?.rowData || [];
            const measures = [];
            const rowScales = [];
            const startToMeasure = [];
            const opt = ed.renderer?.options || {};
            const stringCount = ed.state.getStringCount();
            for (const row of rows) {
                const r = row.svg.getBoundingClientRect();
                const vb = row.svg.viewBox?.baseVal;
                const sx = vb?.width ? r.width / vb.width : 1;
                const sy = vb?.height ? r.height / vb.height : 1;
                rowScales.push({ row: row.rowIndex, scale: sx });
                // client y of each string line, string 1 first — where to
                // click to land on a string
                const strings = Array.from({ length: stringCount }, (_, i) =>
                    r.top + ((opt.topMargin ?? 30) + i * (opt.stringSpacing ?? 15)) * sy);
                for (const g of row.measures) {
                    measures.push({
                        measure: g.display, row: row.rowIndex, ticks: g.ticks,
                        left: r.left + g.x * sx,
                        right: r.left + (g.x + g.width) * sx,
                        strings,
                    });
                    startToMeasure.push([g.startTick, g.startTick + g.ticks, g.display]);
                }
            }
            const measureAt = (abs) => {
                const hit = startToMeasure.find(([a, b]) => abs >= a && abs < b);
                return hit ? { measure: hit[2], tick: abs - hit[0] } : null;
            };

            const root = ed.canvasContainer;
            const ruler = [...root.querySelectorAll('.editor-grid-overlay line[data-measure]')]
                .map(l => ({ measure: +l.dataset.measure, tick: +l.dataset.tick, x: centerX(l) }));
            const notes = [...root.querySelectorAll('.editor-renderer text.note-text[data-abs-tick]')]
                .map(t => ({ ...measureAt(+t.dataset.absTick), string: +t.dataset.string, x: centerX(t) }))
                .filter(n => n.measure != null);
            const rests = [...root.querySelectorAll('.editor-renderer .rest-glyph[data-measure]')]
                .map(t => {
                    const r = t.getBoundingClientRect();
                    return { measure: +t.dataset.measure, left: r.left, right: r.right };
                });

            let cursor = null;
            const box = ed.cursor?.cursorElement;
            if (box && box.style.display !== 'none') {
                const { measure, tick, string } = ed.state.cursor;
                cursor = { measure, tick, string, x: centerX(box) };
            }
            const zoom = ed.renderer?._scale || 1;
            return { measures, ruler, notes, rests, cursor, rows: rowScales, zoom };
        },

        /** `layoutViolations(layout())` — empty when the screen is sane. */
        check(opts) {
            return layoutViolations(this.layout(), opts);
        },
    };
}
