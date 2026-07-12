// Reading-view playback interactions for rendered tablature:
//
//   click        -> ARM a play cursor at the clicked BEAT (quantized;
//                   not anchored to a note). Playback starts on Play.
//   click + drag -> ARM a whole-measure phrase selection for looping.
//
// Neither starts audio by itself — the Play button executes whatever
// is armed (Mike: 'playback should not start automatically').
//
// Geometry comes from TabRenderer.rowData (the same ts-true source the
// editor's cursor uses); display->playback tick mapping handles both
// the unrolled view (visual timeline == playback timeline) and the
// compact "Repeats" view (display measures are WRITTEN measures — we
// map to their first pass in the reading list).

import { positionFromSvgPoint } from './otf-editor/cursor.js';

/** Playback tick for a point in a display measure. Null when the
 *  written measure never plays (not in the reading list). */
export function playbackTickForPoint(playback, compact, displayMeasure, tickInMeasure) {
    if (!compact) {
        return playback.startTick(displayMeasure) + tickInMeasure;
    }
    const slot = playback.slots.find(s => s.original === displayMeasure);
    return slot ? slot.startTick + tickInMeasure : null;
}

/** Playback {startTick, endTick} covering display measures
 *  fromDisplay..toDisplay (inclusive, whole measures). In compact mode
 *  the range maps to its first contiguous pass through the reading
 *  list. Null when nothing in the range ever plays. */
export function playbackRangeForMeasures(playback, compact, fromDisplay, toDisplay) {
    if (fromDisplay > toDisplay) [fromDisplay, toDisplay] = [toDisplay, fromDisplay];
    if (!compact) {
        return {
            startTick: playback.startTick(fromDisplay),
            endTick: playback.startTick(toDisplay) + playback.ticksAt(toDisplay),
        };
    }
    const s0 = playback.slots.find(s => s.original === fromDisplay);
    if (!s0) return null;
    const s1 = playback.slots.find(
        s => s.display >= s0.display && s.original === toDisplay);
    const last = s1 || s0;
    return { startTick: s0.startTick, endTick: last.startTick + last.ticks };
}

const DRAG_THRESHOLD_PX = 6;
const CLICK_DEBOUNCE_MS = 350;

/**
 * Wire click-to-play and drag-to-loop onto a rendered TabRenderer.
 *
 * @param {TabRenderer} renderer - already rendered (rowData populated)
 * @param {Object} o
 * @param {number} o.beatTicks - click quantization (a beat)
 * @param {(tick: number) => void} o.onPlayFrom - playback-timeline tick
 * @param {(fromDisplay: number, toDisplay: number) => void} o.onLoopMeasures
 * @returns {{ destroy(): void, clearHighlight(): void }}
 */
export function attachTabPlaybackInteractions(renderer, {
    beatTicks = 480,
    onPlayFrom,
    onLoopMeasures,
} = {}) {
    let drag = null; // { row, startMeasure, lastMeasure, moved }
    let lastClickAt = 0;
    const cleanups = [];

    const opts = renderer.options;

    /** x for a (display measure, tick) in row-svg coords. */
    function xForTick(row, measure, tick) {
        const geom = row.measures.find(g => g.display === measure);
        if (!geom) return null;
        const noteX0 = (geom.noteX0 ?? geom.x + 15) + (geom.noteOffset ?? 0);
        const noteW = geom.noteW ?? geom.width - 30;
        return noteX0 + (tick / geom.ticks) * noteW;
    }

    function clearCaret(kind = '.play-caret') {
        for (const row of renderer.rowData || []) {
            row.svg?.querySelectorAll(kind).forEach(el => el.remove());
        }
    }

    /** Beat caret. kind '.play-caret' = hover preview (light),
     *  '.play-caret-armed' = committed cursor (solid, persists). */
    function showCaret(row, measure, tick, kind = 'play-caret') {
        clearCaret('.' + kind);
        const x = xForTick(row, measure, tick);
        if (x == null) return;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x);
        line.setAttribute('x2', x);
        line.setAttribute('y1', opts.topMargin - 10);
        line.setAttribute('y2', opts.topMargin
            + (renderer.numStrings - 1) * opts.stringSpacing + 10);
        line.setAttribute('class', kind);
        line.setAttribute('stroke', opts.highlightColor);
        line.setAttribute('stroke-width', kind === 'play-caret' ? '2' : '3');
        line.setAttribute('opacity', kind === 'play-caret' ? '0.45' : '0.9');
        line.setAttribute('pointer-events', 'none');
        row.svg.appendChild(line);
    }

    /** Draw the committed (armed) cursor at a display position. */
    function armCaretAt(measure, tick) {
        const row = (renderer.rowData || []).find(
            r => measure >= r.firstMeasure && measure <= r.lastMeasure);
        if (row) showCaret(row, measure, tick, 'play-caret-armed');
    }

    function localPoint(svg, evt) {
        const rect = svg.getBoundingClientRect();
        const vb = svg.viewBox?.baseVal;
        const sx = vb && rect.width ? vb.width / rect.width : 1;
        const sy = vb && rect.height ? vb.height / rect.height : 1;
        return {
            x: (evt.clientX - rect.left) * sx,
            y: (evt.clientY - rect.top) * sy,
        };
    }

    function hit(row, svg, evt) {
        const { x, y } = localPoint(svg, evt);
        const pos = positionFromSvgPoint(row.measures, x, y, {
            topMargin: opts.topMargin,
            stringSpacing: opts.stringSpacing,
            stringCount: renderer.numStrings,
            gridSubdivision: beatTicks,
        });
        return pos; // { measure: display, tick (quantized), string }
    }

    function clearHighlight() {
        for (const row of renderer.rowData || []) {
            row.svg?.querySelectorAll('.phrase-highlight')
                .forEach(el => el.remove());
        }
    }

    function highlightMeasures(fromDisplay, toDisplay) {
        clearHighlight();
        const [m0, m1] = fromDisplay <= toDisplay
            ? [fromDisplay, toDisplay] : [toDisplay, fromDisplay];
        for (const row of renderer.rowData || []) {
            for (const geom of row.measures) {
                if (geom.display < m0 || geom.display > m1) continue;
                const rect = document.createElementNS(
                    'http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', geom.x);
                rect.setAttribute('y', opts.topMargin - 8);
                rect.setAttribute('width', geom.width);
                rect.setAttribute('height',
                    (renderer.numStrings - 1) * opts.stringSpacing + 16);
                rect.setAttribute('class', 'phrase-highlight');
                rect.setAttribute('fill', opts.highlightColor);
                rect.setAttribute('opacity', '0.15');
                rect.setAttribute('pointer-events', 'none');
                row.svg.appendChild(rect);
            }
        }
    }

    function attachRow(row) {
        const svg = row.svg;
        if (!svg) return;
        svg.style.cursor = 'pointer';

        const down = (evt) => {
            if (evt.button !== 0) return;
            const pos = hit(row, svg, evt);
            if (!pos) return;
            drag = {
                startMeasure: pos.measure,
                lastMeasure: pos.measure,
                startTick: pos.tick,
                startX: evt.clientX,
                startY: evt.clientY,
                moved: false,
            };
            evt.preventDefault();
        };
        const move = (evt) => {
            if (!drag) {
                // hover: preview the beat playback would start from
                const pos = hit(row, svg, evt);
                if (pos) showCaret(row, pos.measure, pos.tick);
                return;
            }
            if (!drag.moved
                && Math.hypot(evt.clientX - drag.startX, evt.clientY - drag.startY)
                    < DRAG_THRESHOLD_PX) return;
            drag.moved = true;
            clearCaret();
            const pos = hit(row, svg, evt);
            if (pos && pos.measure !== drag.lastMeasure) {
                drag.lastMeasure = pos.measure;
            }
            highlightMeasures(drag.startMeasure, drag.lastMeasure);
        };
        const leave = () => { if (!drag) clearCaret(); };
        const up = (evt) => {
            if (!drag) return;
            const d = drag;
            drag = null;
            const now = Date.now();
            if (now - lastClickAt < CLICK_DEBOUNCE_MS) {
                evt.preventDefault();
                return; // debounce: rapid double-fires start ONE playback
            }
            lastClickAt = now;
            if (d.moved) {
                highlightMeasures(d.startMeasure, d.lastMeasure);
                clearCaret('.play-caret-armed');
                onLoopMeasures?.(
                    Math.min(d.startMeasure, d.lastMeasure),
                    Math.max(d.startMeasure, d.lastMeasure));
            } else {
                clearHighlight();
                clearCaret('.play-caret-armed');
                showCaret(row, d.startMeasure, d.startTick, 'play-caret-armed');
                onPlayFrom?.({ measure: d.startMeasure, tick: d.startTick });
            }
            evt.preventDefault();
        };

        svg.addEventListener('pointerdown', down);
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerup', up);
        svg.addEventListener('pointerleave', leave);
        cleanups.push(() => {
            svg.removeEventListener('pointerdown', down);
            svg.removeEventListener('pointermove', move);
            svg.removeEventListener('pointerup', up);
            svg.removeEventListener('pointerleave', leave);
        });
    }

    for (const row of renderer.rowData || []) attachRow(row);

    return {
        clearHighlight,
        highlightMeasures,
        armCaretAt,
        clearArmed() {
            clearHighlight();
            clearCaret('.play-caret-armed');
        },
        destroy() {
            clearHighlight();
            clearCaret('.play-caret');
            clearCaret('.play-caret-armed');
            cleanups.forEach(fn => fn());
            cleanups.length = 0;
        },
    };
}
