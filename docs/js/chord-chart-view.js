// Chord chart view for the song page (G18b2)
//
// Lazy module: song-view.js import()s it only for a work whose index row has
// `chord_chart`. chord-chart.js has the logic (alignment, mismatches, bars,
// carried chords, transposition); this file draws it.
//
//   mountLeadSheetChart  the lead-sheet part: notes under lyric lines, and the
//                        chart as a second column (CSS shows it on wide screens)
//   renderChartTab       the narrow screens' "Chart" part tab
//
// ctx = {chart, sections, opts, fontScale}: the published chart JSON, the
// lyric chart's parsed sections (the list renderSectionsHtml was given) and
// the display options it used ({key, transposeTo, nashville, ...}), so the
// chart always shows what the lyrics show.

import { chordGlyphHtml, toNashville, transposeChord, getSemitonesBetweenKeys } from './chords.js';
import {
    alignForm, compareSections, regroupBars, carriedChords, transposeChart, practiceOrder,
} from './chord-chart.js';
import { renderSectionsHtml } from './renderers/chordpro.js';
import { escapeHtml } from './utils.js';

const BARS_KEY = 'bgb-chart-bars';

// Chart | Practice, per page load (a reload starts on the chart)
let mode = 'chart';

export const getMode = () => mode;
export function setMode(next) { mode = next === 'practice' ? 'practice' : 'chart'; }

/** Cells a printed bar holds: 1 or 2, remembered on this device. */
export function getBars() {
    try { return globalThis.localStorage?.getItem(BARS_KEY) === '2' ? 2 : 1; } catch { return 1; }
}
export function setBars(n) {
    try { globalThis.localStorage?.setItem(BARS_KEY, n === 2 ? '2' : '1'); } catch { /* private mode */ }
}

// ---------------------------------------------------------------------------
// Model: the chart as the Key pill has it, aligned with the lyric chart
// ---------------------------------------------------------------------------

/**
 * -> {chart (moved to the displayed key), alignment, mismatches, show, showLyric}
 * `show` draws a chart chord, `showLyric` a chord spelled like the lyric chart
 * (what compareSections reports); both follow the Nashville toggle.
 */
export function buildModel({ chart, sections, opts }) {
    const lyricKey = opts.key || null;
    const shown = opts.transposeTo || lyricKey || chart.key;
    const toShown = getSemitonesBetweenKeys(chart.key, shown);
    const moved = toShown ? transposeChart(chart, toShown) : chart;
    const alignment = alignForm(moved, sections);
    const mismatches = compareSections(moved, alignment, lyricKey ? { lyricKey } : {});
    const lyricShift = getSemitonesBetweenKeys(lyricKey, shown);
    const nashville = c => (opts.nashville && shown ? toNashville(c, shown) : c);
    return {
        chart: moved, alignment, mismatches, sections, opts,
        show: nashville,
        showLyric: c => nashville(lyricShift ? transposeChord(c, lyricShift) : c),
    };
}

// ---------------------------------------------------------------------------
// HTML builders (pure; exported for tests)
// ---------------------------------------------------------------------------

function slotHtml(slot, carried, model) {
    if (slot !== null) return `<span class="cc-slot">${chordGlyphHtml(model.show(slot))}</span>`;
    if (carried) return `<span class="cc-slot cc-carry">${chordGlyphHtml(model.show(carried))}</span>`;
    return '<span class="cc-slot cc-hold">\\</span>';
}

/** One chart line: bars (from regroupBars) of cells of equal sub-cells, one per slot. */
export function chartLineHtml(bars, carried, model) {
    let first = true;
    const cols = bars.map(b => `minmax(0, ${b.cells.length}fr)`).join(' ');
    const html = bars.map(bar => {
        const cells = bar.cells.map(cell => `<div class="cc-cell">${cell.slots.map(slot => {
            const c = first ? carried : null;
            first = false;
            return slotHtml(slot, c, model);
        }).join('')}</div>`).join('');
        return `<div class="cc-bar${bar.half ? ' cc-half' : ''}">${cells}</div>`;
    }).join('');
    return `<div class="cc-line" style="grid-template-columns: ${cols}">${html}</div>`;
}

/** A section's chart lines as separate HTML strings. */
export function chartLinesHtml(section, cellsPerBar, model) {
    const carried = carriedChords(section);
    return regroupBars(section, cellsPerBar).map((bars, i) => chartLineHtml(bars, carried[i], model));
}

/** "sung 4 times" when the chart lines up with the lyrics, else its repeat count. */
export function sungCaption(section, model) {
    if (model.alignment.aligned) {
        const n = model.alignment.pairs.filter(p => p.chart === section).length;
        return n === 1 ? 'sung once' : `sung ${n} times`;
    }
    return section.repeat > 1 ? `×${section.repeat}` : '';
}

export function chartSectionHtml(section, caption, cellsPerBar, model) {
    return `<div class="cc-sec"><div class="cc-cap"><b>${escapeHtml(section.name)}</b>`
        + `<span>${escapeHtml(caption)}</span></div>`
        + `${chartLinesHtml(section, cellsPerBar, model).join('')}</div>`;
}

const glyphs = (chords, show) => chords.map(c => chordGlyphHtml(show(c))).join(' ');

/** "Differs from the chart: X there, Y here." for one mismatch from compareSections. */
export function mismatchNoteHtml(m, model) {
    return `<div class="cc-mis" role="note">Differs from the chart: `
        + `<b>${glyphs(m.chart, model.showLyric)}</b> there, `
        + `<b>${glyphs(m.lyric, model.showLyric)}</b> here.</div>`;
}

const LEGEND = 'Dashed line: cell. Faint <i>\\</i>: keep playing. '
    + 'Faint chord at the start of a line: carried over from the line above.';

function chartBodyHtml(model, cellsPerBar) {
    const { chart, alignment } = model;
    const parts = chart.sections.map(s => chartSectionHtml(s, sungCaption(s, model), cellsPerBar, model));
    if (chart.form) {
        parts.push(`<p class="cc-form">Form: ${chart.form.map(n => `<b>${escapeHtml(n)}</b>`).join(' · ')}</p>`);
    }
    if (!alignment.aligned && alignment.reason === 'count') {
        parts.push(`<p class="cc-note">This chart's form has ${alignment.formCount} sections and the lyrics have `
            + `${alignment.lyricCount}, so they are not compared and Practice follows the chart's own form.</p>`);
    }
    parts.push(`<p class="cc-legend">${LEGEND}</p>`);
    if (chart.by) parts.push(`<p class="cc-by">Chart by ${escapeHtml(chart.by)}</p>`);
    return parts.join('');
}

function headHtml(model, state) {
    const seg = (attr, value, label, on) =>
        `<button type="button" class="cc-seg-btn${on ? ' on' : ''}" data-cc-${attr}="${value}" aria-pressed="${on}">${label}</button>`;
    return `<div class="cc-head"><span class="cc-head-lyrics">Lyrics</span><div class="cc-head-chart">`
        + '<span class="cc-title">Chart</span>'
        + `<span class="cc-seg" role="group" aria-label="View">${seg('mode', 'chart', 'Chart', state.mode === 'chart')}`
        + `${seg('mode', 'practice', 'Practice', state.mode === 'practice')}</span>`
        + `<span class="cc-bars-tg">Bars <span class="cc-seg" role="group" aria-label="Bars">`
        + `${seg('bars', 1, 'One cell', state.bars === 1)}${seg('bars', 2, 'Two cells', state.bars === 2)}`
        + '</span></span></div></div>';
}

// ---------------------------------------------------------------------------
// Notes under lyric lines (DOM)
// ---------------------------------------------------------------------------

/** The `.song-line`s of a rendered lyric section, comments left out. */
const lyricLines = el => [...el.querySelectorAll('.section-content > .song-line:not(.song-comment)')];

/**
 * Put each mismatch under its lyric line (or under the section label when it
 * is section-level) in the rendered lyric chart `root`.
 */
export function addMismatchNotes(root, model) {
    for (const m of model.mismatches) {
        const section = model.alignment.pairs[m.index].lyric;
        const at = model.sections.indexOf(section);
        const el = root.querySelector(`.song-section[data-section-index="${at}"]`);
        if (!el) continue;                       // compact mode folded this repeat away
        const note = mismatchNoteHtml(m, model);
        if (m.line === null) {
            const label = el.querySelector('.section-label');
            if (label) label.insertAdjacentHTML('afterend', note);
            else el.insertAdjacentHTML('afterbegin', note);
        } else {
            lyricLines(el)[m.line - 1]?.insertAdjacentHTML('afterend', note);
        }
    }
}

// ---------------------------------------------------------------------------
// Practice mode: the chart unrolled in the lyric chart's playing order
// ---------------------------------------------------------------------------

function div(className, html = '') {
    const el = document.createElement('div');
    el.className = className;
    if (html) el.innerHTML = html;
    return el;
}

/**
 * One section of practice mode. Chart lines sit level with (wide) or under
 * (narrow) their lyric lines when both have the same number; otherwise the
 * chart section sits beside / under the lyric section. Layout is CSS.
 */
function practiceSection(section, n, total, cellsPerBar, model) {
    const { alignment, mismatches, opts } = model;
    const pair = alignment.aligned ? alignment.pairs[n] : null;
    const el = div('cc-psec');
    el.innerHTML = `<div class="cc-plabel"><span>${escapeHtml(pair ? pair.lyric.label : section.name)}</span>`
        + `<span class="cc-pcount">${n + 1} of ${total}</span></div>`;
    const mine = pair ? mismatches.filter(m => m.index === n) : [];
    for (const m of mine.filter(m => m.line === null)) el.insertAdjacentHTML('beforeend', mismatchNoteHtml(m, model));

    const chartLines = chartLinesHtml(section, cellsPerBar, model);
    if (!pair) {
        el.append(div('cc-prow', `<div class="cc-plyric"></div><div class="cc-pchart">${chartLines.join('')}</div>`));
        return el;
    }

    const body = div('');
    body.innerHTML = renderSectionsHtml([pair.lyric], { ...opts, sectionLabels: false, compact: false, twoColumn: false });
    const items = [...body.querySelectorAll('.section-content > *')];
    const lines = items.filter(i => !i.classList.contains('song-comment'));

    if (lines.length !== chartLines.length) {
        const row = div('cc-prow', '<div class="cc-plyric"></div><div class="cc-pchart"></div>');
        row.firstChild.append(...items);
        row.lastChild.innerHTML = chartLines.join('');
        el.append(row);
        return el;
    }
    let line = 0;
    for (const item of items) {
        if (item.classList.contains('song-comment')) { el.append(item); continue; }
        line += 1;
        const row = div('cc-prow', '<div class="cc-plyric"></div>');
        row.firstChild.append(item);
        for (const m of mine.filter(m => m.line === line)) {
            row.firstChild.insertAdjacentHTML('beforeend', mismatchNoteHtml(m, model));
        }
        row.append(div('cc-pchart', chartLines[line - 1]));
        el.append(row);
    }
    return el;
}

function practiceEl(model, cellsPerBar, fontScale) {
    const order = practiceOrder(model.chart, model.alignment);
    const el = div('cc-practice song-body');
    if (fontScale) el.style.fontSize = `${fontScale}em`;
    order.forEach((section, n) => el.append(practiceSection(section, n, order.length, cellsPerBar, model)));
    return el;
}

// ---------------------------------------------------------------------------
// The panel: header, toggles and either view
// ---------------------------------------------------------------------------

/** Draw the panel into `host`. The toggles redraw only the panel. */
export function drawPanel(host, ctx) {
    const model = buildModel(ctx);
    const state = { mode, bars: getBars() };
    host.innerHTML = headHtml(model, state);
    if (state.mode === 'practice') {
        host.append(practiceEl(model, state.bars, ctx.fontScale));
    } else {
        host.insertAdjacentHTML('beforeend', `<div class="cc-chart">${chartBodyHtml(model, state.bars)}</div>`);
    }
    host.closest('.cc-cols')?.classList.toggle('cc-practice-on', state.mode === 'practice');
    host.onclick = (e) => {
        const btn = e.target.closest('[data-cc-mode], [data-cc-bars]');
        if (!btn) return;
        if (btn.dataset.ccMode) setMode(btn.dataset.ccMode);
        else setBars(Number(btn.dataset.ccBars));
        drawPanel(host, ctx);
    };
    return model;
}

/**
 * The lead-sheet part: flag mismatches under the lyric lines and add the chart
 * column beside the lyrics. The column is always built; CSS shows it on wide
 * screens (the narrow ones get a Chart tab instead).
 */
export function mountLeadSheetChart(container, ctx) {
    const chordView = container.querySelector('#chord-view');
    if (!chordView) return;
    const cols = div('cc-cols');
    const lyrics = div('cc-lyrics', '<div class="cc-colhead">Lyrics</div>');
    const column = div('cc-chart-col');
    chordView.replaceWith(cols);
    lyrics.append(chordView);
    cols.append(lyrics, column);
    const model = drawPanel(column, ctx);
    addMismatchNotes(chordView, model);
}

/** The Chart part tab (narrow screens): the panel alone. */
export function renderChartTab(container, ctx) {
    container.innerHTML = '';
    const host = div('cc-tab');
    container.append(host);
    drawPanel(host, ctx);
}
