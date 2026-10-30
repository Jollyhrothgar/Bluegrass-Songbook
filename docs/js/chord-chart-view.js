// Chord chart view for the song page (G18b2)
//
// Lazy module: song-view.js import()s it only for a work whose index row has
// `chord_chart`. chord-chart.js has the logic (alignment, bars, carried
// chords, transposition); this file draws it.
//
//   mountLeadSheetChart  the lead-sheet part: the chart as a second column
//                        (View ▸ Lyrics + Chart, wide screens)
//   renderChartTab       the chart alone (View ▸ Chart)
//
// ctx = {chart, sections, opts, fontScale, layout}: the published chart JSON,
// the lyric chart's parsed sections and the display options it used
// ({key, transposeTo, nashville, ...}), so the chart always shows what the
// lyrics show; the Size the page is at (the chart scales with it); and
// Display ▸ Chart's choices, layout = {cells per row, bars, order}.
// There is no chrome of its own: every choice lives in the dock.

import { chordGlyphHtml, toNashville, getSemitonesBetweenKeys } from './chords.js';
import {
    alignForm, regroupBars, carriedChords, transposeChart, practiceOrder, wrapCells,
} from './chord-chart.js';
import { escapeHtml } from './utils.js';

/** What Display ▸ Chart starts at. */
export const DEFAULT_LAYOUT = { cells: 4, bars: 1, order: 'once' };

// ---------------------------------------------------------------------------
// Model: the chart as the Key pill has it, aligned with the lyric chart
// ---------------------------------------------------------------------------

/**
 * -> {chart (moved to the displayed key), alignment, sections, opts, show}
 * `show` draws a chart chord; it follows the Nashville toggle.
 */
export function buildModel({ chart, sections, opts }) {
    const lyricKey = opts.key || null;
    const shown = opts.transposeTo || lyricKey || chart.key;
    const toShown = getSemitonesBetweenKeys(chart.key, shown);
    const moved = toShown ? transposeChart(chart, toShown) : chart;
    const alignment = alignForm(moved, sections);
    return {
        chart: moved, alignment, sections, opts,
        show: c => (opts.nashville && shown ? toNashville(c, shown) : c),
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

/** A section's chart lines as separate HTML strings: its cells wrapped into rows. */
export function chartLinesHtml(section, layout, model) {
    const wrapped = wrapCells(section, layout.cells);
    const carried = carriedChords(wrapped);
    return regroupBars(wrapped, layout.bars).map((bars, i) => chartLineHtml(bars, carried[i], model));
}

/** "sung 4 times" when the chart lines up with the lyrics, else its repeat count. */
export function sungCaption(section, model) {
    if (model.alignment.aligned) {
        const n = model.alignment.pairs.filter(p => p.chart === section).length;
        return n === 1 ? 'sung once' : `sung ${n} times`;
    }
    return section.repeat > 1 ? `×${section.repeat}` : '';
}

export function chartSectionHtml(section, caption, layout, model) {
    return `<div class="cc-sec"><div class="cc-cap"><b>${escapeHtml(section.name)}</b>`
        + `<span>${escapeHtml(caption)}</span></div>`
        + `${chartLinesHtml(section, layout, model).join('')}</div>`;
}

/**
 * "As sung": every section in the order it is sung, each drawn where it
 * falls, named as the lyrics name it ("Verse 3") and counted ("3 of 7").
 * The chart on its own, without lyrics.
 */
export function sungSectionsHtml(layout, model) {
    const { alignment } = model;
    const order = practiceOrder(model.chart, alignment);
    return order.map((section, n) => {
        const label = alignment.aligned ? alignment.pairs[n].lyric.label : section.name;
        return chartSectionHtml({ ...section, name: label }, `${n + 1} of ${order.length}`, layout, model);
    }).join('');
}

const LEGEND = 'Dashed line: cell. Faint <i>\\</i>: keep playing. '
    + 'Faint chord at the start of a line: carried over from the line above.';

function chartBodyHtml(model, layout) {
    const { chart, alignment } = model;
    const sung = layout.order === 'sung';
    const parts = [sung
        ? sungSectionsHtml(layout, model)
        : chart.sections.map(s => chartSectionHtml(s, sungCaption(s, model), layout, model)).join('')];
    if (chart.form && !sung) {
        parts.push(`<p class="cc-form">Form: ${chart.form.map(n => `<b>${escapeHtml(n)}</b>`).join(' · ')}</p>`);
    }
    if (sung && !alignment.aligned && alignment.reason === 'count') {
        parts.push(`<p class="cc-note">This chart's form has ${alignment.formCount} sections and the lyrics have `
            + `${alignment.lyricCount}, so As sung follows the chart's own form.</p>`);
    }
    parts.push(`<p class="cc-legend">${LEGEND}</p>`);
    if (chart.by) parts.push(`<p class="cc-by">Chart by ${escapeHtml(chart.by)}</p>`);
    return parts.join('');
}

function div(className, html = '') {
    const el = document.createElement('div');
    el.className = className;
    if (html) el.innerHTML = html;
    return el;
}

/**
 * Draw the chart into `host`. `ctx.column` adds the "Chart" column head the
 * lyrics column answers with. The chart's text is em-sized, so Size scales it.
 */
export function drawPanel(host, ctx) {
    const model = buildModel(ctx);
    const layout = { ...DEFAULT_LAYOUT, ...ctx.layout };
    host.innerHTML = ctx.column ? '<div class="cc-colhead">Chart</div>' : '';
    const body = div('cc-chart', chartBodyHtml(model, layout));
    if (ctx.fontScale) body.style.fontSize = `${ctx.fontScale}em`;
    host.append(body);
    return model;
}

/** The lead-sheet part with the chart as a column beside the lyrics (wide screens). */
export function mountLeadSheetChart(container, ctx) {
    const chordView = container.querySelector('#chord-view');
    if (!chordView) return;
    const cols = div('cc-cols');
    const lyrics = div('cc-lyrics', '<div class="cc-colhead">Lyrics</div>');
    const column = div('cc-chart-col');
    chordView.replaceWith(cols);
    lyrics.append(chordView);
    cols.append(lyrics, column);
    drawPanel(column, { ...ctx, column: true });
}

/** The Chart part: the chart alone. */
export function renderChartTab(container, ctx) {
    container.innerHTML = '';
    const host = div('cc-tab');
    container.append(host);
    drawPanel(host, ctx);
}
