// The chord chart view (docs/js/chord-chart-view.js) against a frozen copy of
// the published Old Home Place chart and lyric chart (fixtures/, 2026-10-29),
// plus small synthetic charts for the cases Old Home Place doesn't have.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseChordPro } from '../renderers/chordpro.js';
import { regroupBars } from '../chord-chart.js';
import {
    buildModel, chartSectionHtml, chartLineHtml, sungCaption, drawPanel, DEFAULT_LAYOUT,
} from '../chord-chart-view.js';

const FIX = resolve(process.cwd(), 'docs/js/__tests__/fixtures');
const chart = JSON.parse(readFileSync(resolve(FIX, 'old-home-place.chord-chart.json'), 'utf8'));
const pro = readFileSync(resolve(FIX, 'old-home-place.pro'), 'utf8');
const sections = parseChordPro(pro).sections.filter(s => s.type !== 'abc');
const OPTS = { key: 'A', transposeTo: 'A', nashville: false, chordMode: 'all', compact: false, sectionLabels: true };
const ctx = (opts = {}) => ({ chart, sections, opts: { ...OPTS, ...opts } });

const html = (s) => { const el = document.createElement('div'); el.innerHTML = s; return el; };
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

const L = (cells = 4, bars = 1, order = 'once') => ({ cells, bars, order });

describe('chart section HTML', () => {
    const model = buildModel(ctx());
    const verse = model.chart.sections[0];

    it('draws one cell per bar by default and halves the bars with two', () => {
        const one = html(chartSectionHtml(verse, '', L(4, 1), model));
        const two = html(chartSectionHtml(verse, '', L(4, 2), model));
        expect(one.querySelectorAll('.cc-line')).toHaveLength(4);
        expect(one.querySelectorAll('.cc-bar')).toHaveLength(16);
        expect(one.querySelectorAll('.cc-bar .cc-cell')).toHaveLength(16);
        expect(two.querySelectorAll('.cc-bar')).toHaveLength(8);
        expect(two.querySelectorAll('.cc-bar:has(.cc-cell + .cc-cell)')).toHaveLength(8);
    });

    it('wraps the cells of a section into rows of 2, 4, 6 or 8', () => {
        const rows = (n) => [...html(chartSectionHtml(verse, '', L(n), model)).querySelectorAll('.cc-line')]
            .map(l => l.querySelectorAll('.cc-cell').length);
        expect(rows(4)).toEqual([4, 4, 4, 4]);      // 16 cells: the chart's own lines
        expect(rows(2)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
        expect(rows(6)).toEqual([6, 6, 4]);
        expect(rows(8)).toEqual([8, 8]);
    });

    it('keeps the carried chord honest after wrapping: each row starts from what rings', () => {
        const lines = html(chartSectionHtml(verse, '', L(2), model)).querySelectorAll('.cc-line');
        for (const line of [...lines].slice(1)) {
            const first = line.querySelector('.cc-slot');
            expect(['cc-slot', 'cc-slot cc-carry']).toContain(first.className);
        }
        expect(lines[0].querySelector('.cc-slot').className).toBe('cc-slot');
    });

    it('gives each slot its own sub-cell: the chord or a hold, centered', () => {
        const cell = html(chartSectionHtml(verse, '', L(), model)).querySelector('.cc-cell');
        expect([...cell.children].map(c => c.className)).toEqual(['cc-slot', 'cc-slot cc-hold']);
        expect(cell.children[1].textContent).toBe('\\');
    });

    it('repeats the carried chord faintly in a line\'s first slot, only where it is a hold', () => {
        const lines = html(chartSectionHtml(verse, '', L(), model)).querySelectorAll('.cc-line');
        const first = (i) => lines[i].querySelector('.cc-slot');
        expect(first(0).className).toBe('cc-slot');                    // a chord of its own
        expect(first(1).className).toBe('cc-slot cc-carry');           // A rings on from line 1
        expect(first(1).textContent).toBe('A');
        expect(first(3).className).toBe('cc-slot cc-carry');
        expect(lines[1].querySelectorAll('.cc-carry')).toHaveLength(1);  // only the first slot
    });

    it('draws chords through chordGlyphHtml', () => {
        const el = html(chartSectionHtml(verse, '', L(), model));
        expect(el.innerHTML).toContain('<span class="cg">C<span class="acc">♯</span><sup>7</sup></span>');
        expect(el.innerHTML).not.toContain('C#7');
    });

    it('sizes a line by its cells, and a half bar is one cell wide', () => {
        const odd = { name: 'X', repeat: 1, lines: [[{ slots: ['A', null] }, { slots: ['D', null] }, { slots: ['E', null] }]] };
        const bars = regroupBars(odd, 2)[0];
        const line = html(chartLineHtml(bars, null, model)).firstChild;
        expect(line.style.gridTemplateColumns).toBe('minmax(0, 2fr) minmax(0, 1fr)');
        expect(line.querySelectorAll('.cc-bar.cc-half')).toHaveLength(1);
    });

    it('captions a section with how often it is sung', () => {
        expect(sungCaption(model.chart.sections[0], model)).toBe('sung 4 times');
        expect(sungCaption(model.chart.sections[1], model)).toBe('sung 3 times');
    });

    it('falls back to the repeat count when the form does not line up', () => {
        const short = buildModel({ chart, sections: sections.slice(0, 3), opts: OPTS });
        expect(short.alignment.aligned).toBe(false);
        expect(sungCaption({ name: 'A', repeat: 2 }, short)).toBe('×2');
        expect(sungCaption({ name: 'A', repeat: 1 }, short)).toBe('');
    });
});

describe('the Key pill', () => {
    it('moves the chart to the displayed key', () => {
        const model = buildModel(ctx({ transposeTo: 'G' }));
        expect(model.chart.key).toBe('G');
        const slots = [...html(chartSectionHtml(model.chart.sections[0], '', L(), model)).querySelectorAll('.cc-slot')];
        expect(slots[0].textContent).toBe('G');
        expect(text(slots[2])).toBe('B⁷'.replace('⁷', '7'));
    });

    it('shows Nashville numbers when the lyrics do', () => {
        const model = buildModel(ctx({ nashville: true }));
        const slots = [...html(chartSectionHtml(model.chart.sections[0], '', L(), model)).querySelectorAll('.cc-slot')];
        expect(slots[0].textContent).toBe('I');
        expect(slots[2].textContent).toBe('III7');
    });
});

describe('the panel', () => {
    const draw = (opts, extra = {}) => { const host = document.createElement('div'); drawPanel(host, { ...ctx(opts), ...extra }); return host; };

    it('starts on the chart: each section once, the form, and who drew it, with no controls of its own', () => {
        const host = draw();
        expect(host.querySelectorAll('.cc-sec')).toHaveLength(2);
        expect(text(host.querySelector('.cc-form'))).toBe('Form: Verse · Verse · Chorus · Verse · Verse · Chorus · Chorus');
        expect(text(host.querySelector('.cc-by'))).toBe('Chart by Mike Beaumier');
        expect(host.querySelector('button, .cc-head, .cc-seg')).toBeNull();
        expect(host.querySelector('.cc-colhead')).toBeNull();
        expect(DEFAULT_LAYOUT).toEqual({ cells: 4, bars: 1, order: 'once' });
    });

    it('the column carries its own head', () => {
        expect(text(draw({}, { column: true }).querySelector('.cc-colhead'))).toBe('Chart');
    });

    it('scales with Size: the chart is em-sized from the page\'s font scale', () => {
        expect(draw({}, { fontScale: 1.25 }).querySelector('.cc-chart').style.fontSize).toBe('1.25em');
        expect(draw().querySelector('.cc-chart').style.fontSize).toBe('');
    });

    it('draws what Display ▸ Chart chose', () => {
        const host = draw({}, { layout: L(2, 2) });
        expect(host.querySelectorAll('.cc-sec:first-child .cc-line')).toHaveLength(8);
        expect(host.querySelectorAll('.cc-sec:first-child .cc-bar')).toHaveLength(8);
    });

    it('says so, quietly, when the form does not line up and the order is As sung', () => {
        const host = document.createElement('div');
        const short = { chart, sections: sections.slice(0, 3), opts: OPTS };
        drawPanel(host, { ...short, layout: L(4, 1, 'sung') });
        expect(text(host.querySelector('.cc-note'))).toContain('7 sections');
        drawPanel(host, short);
        expect(host.querySelector('.cc-note')).toBeNull();
    });

    it('As sung: 7 sections in the lyrics\' order, named as the lyrics name them, counted, without lyrics', () => {
        const host = draw({}, { layout: L(4, 1, 'sung') });
        const secs = [...host.querySelectorAll('.cc-sec')];
        expect(secs.map(s => s.querySelector('.cc-cap b').textContent))
            .toEqual(['Verse 1', 'Verse 2', 'Chorus', 'Verse 3', 'Verse 4', 'Chorus', 'Chorus']);
        expect(secs.map(s => s.querySelector('.cc-cap span').textContent))
            .toEqual(['1 of 7', '2 of 7', '3 of 7', '4 of 7', '5 of 7', '6 of 7', '7 of 7']);
        expect(secs[0].querySelectorAll('.cc-line')).toHaveLength(4);
        expect(host.querySelector('.song-line, .cc-form, .cc-prow, .cc-psec')).toBeNull();
    });

    it('As sung follows the chart\'s own form when it does not line up with the lyrics', () => {
        const host = document.createElement('div');
        drawPanel(host, { chart, sections: sections.slice(0, 3), opts: OPTS, layout: L(4, 1, 'sung') });
        expect([...host.querySelectorAll('.cc-cap b')].map(b => b.textContent))
            .toEqual(['Verse', 'Verse', 'Chorus', 'Verse', 'Verse', 'Chorus', 'Chorus']);
    });
});
