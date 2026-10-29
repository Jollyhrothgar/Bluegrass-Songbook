// The chord chart view (docs/js/chord-chart-view.js) against a frozen copy of
// the published Old Home Place chart and lyric chart (fixtures/, 2026-10-29),
// plus small synthetic charts for the cases Old Home Place doesn't have.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseChordPro, renderSectionsHtml } from '../renderers/chordpro.js';
import { regroupBars } from '../chord-chart.js';
import {
    buildModel, chartSectionHtml, chartLineHtml, sungCaption, mismatchNoteHtml,
    addMismatchNotes, drawPanel, setMode, getBars, setBars,
} from '../chord-chart-view.js';

const FIX = resolve(process.cwd(), 'docs/js/__tests__/fixtures');
const chart = JSON.parse(readFileSync(resolve(FIX, 'old-home-place.chord-chart.json'), 'utf8'));
const pro = readFileSync(resolve(FIX, 'old-home-place.pro'), 'utf8');
const sections = parseChordPro(pro).sections.filter(s => s.type !== 'abc');
const OPTS = { key: 'A', transposeTo: 'A', nashville: false, chordMode: 'all', compact: false, sectionLabels: true };
const ctx = (opts = {}) => ({ chart, sections, opts: { ...OPTS, ...opts } });

const html = (s) => { const el = document.createElement('div'); el.innerHTML = s; return el; };
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => { localStorage.clear(); setMode('chart'); });

describe('chart section HTML', () => {
    const model = buildModel(ctx());
    const verse = model.chart.sections[0];

    it('draws one cell per bar by default and halves the bars with two', () => {
        const one = html(chartSectionHtml(verse, '', 1, model));
        const two = html(chartSectionHtml(verse, '', 2, model));
        expect(one.querySelectorAll('.cc-line')).toHaveLength(4);
        expect(one.querySelectorAll('.cc-bar')).toHaveLength(16);
        expect(one.querySelectorAll('.cc-bar .cc-cell')).toHaveLength(16);
        expect(two.querySelectorAll('.cc-bar')).toHaveLength(8);
        expect(two.querySelectorAll('.cc-bar:has(.cc-cell + .cc-cell)')).toHaveLength(8);
    });

    it('gives each slot its own sub-cell: the chord or a hold, centered', () => {
        const cell = html(chartSectionHtml(verse, '', 1, model)).querySelector('.cc-cell');
        expect([...cell.children].map(c => c.className)).toEqual(['cc-slot', 'cc-slot cc-hold']);
        expect(cell.children[1].textContent).toBe('\\');
    });

    it('repeats the carried chord faintly in a line\'s first slot, only where it is a hold', () => {
        const lines = html(chartSectionHtml(verse, '', 1, model)).querySelectorAll('.cc-line');
        const first = (i) => lines[i].querySelector('.cc-slot');
        expect(first(0).className).toBe('cc-slot');                    // a chord of its own
        expect(first(1).className).toBe('cc-slot cc-carry');           // A rings on from line 1
        expect(first(1).textContent).toBe('A');
        expect(first(3).className).toBe('cc-slot cc-carry');
        expect(lines[1].querySelectorAll('.cc-carry')).toHaveLength(1);  // only the first slot
    });

    it('draws chords through chordGlyphHtml', () => {
        const el = html(chartSectionHtml(verse, '', 1, model));
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
        const slots = [...html(chartSectionHtml(model.chart.sections[0], '', 1, model)).querySelectorAll('.cc-slot')];
        expect(slots[0].textContent).toBe('G');
        expect(text(slots[2])).toBe('B⁷'.replace('⁷', '7'));
    });

    it('shows Nashville numbers when the lyrics do', () => {
        const model = buildModel(ctx({ nashville: true }));
        const slots = [...html(chartSectionHtml(model.chart.sections[0], '', 1, model)).querySelectorAll('.cc-slot')];
        expect(slots[0].textContent).toBe('I');
        expect(slots[2].textContent).toBe('III7');
    });
});

describe('mismatch notes', () => {
    it('finds only verse 2 line 3 and writes it as glyphs, there and here', () => {
        const model = buildModel(ctx());
        expect(model.mismatches).toHaveLength(1);
        const note = html(mismatchNoteHtml(model.mismatches[0], model)).firstChild;
        expect(note.getAttribute('role')).toBe('note');
        expect(text(note)).toBe('Differs from the chart: A C♯7 D A there, A C♯7 A D here.');
        expect(note.innerHTML).toContain('<sup>7</sup>');
    });

    it('goes under the lyric line it is about', () => {
        const model = buildModel(ctx());
        const root = html(renderSectionsHtml(sections, OPTS));
        addMismatchNotes(root, model);
        const notes = root.querySelectorAll('.cc-mis');
        expect(notes).toHaveLength(1);
        const section = notes[0].closest('.song-section');
        expect(section.querySelector('.section-label').textContent).toBe('Verse 2');
        const prev = notes[0].previousElementSibling;
        expect(prev.textContent).toContain('Charlottesville');
    });

    it('follows the Key pill and Nashville', () => {
        const g = buildModel(ctx({ transposeTo: 'G' }));
        expect(text(html(mismatchNoteHtml(g.mismatches[0], g)))).toContain('G B7 C G there, G B7 G C here');
        const n = buildModel(ctx({ nashville: true }));
        expect(text(html(mismatchNoteHtml(n.mismatches[0], n)))).toContain('I III7 IV I there, I III7 I IV here');
    });

    it('a section-level mismatch goes under the section label', () => {
        // a one-line chart section against a two-line lyric section
        const syn = { key: 'G', meter: 'duple', form: ['V'], sections: [
            { name: 'V', repeat: 1, lines: [[{ slots: ['G', null] }, { slots: ['C', null] }, { slots: ['D', null] }]] }] };
        const lyric = parseChordPro('{start_of_verse: V}\n[G]one [C]two\n[G]three [D]four\n{end_of_verse}').sections;
        const model = buildModel({ chart: syn, sections: lyric, opts: { key: 'G', transposeTo: 'G' } });
        expect(model.mismatches).toHaveLength(1);
        expect(model.mismatches[0].line).toBeNull();
        const root = html(renderSectionsHtml(lyric, { key: 'G' }));
        addMismatchNotes(root, model);
        expect(root.querySelector('.section-label').nextElementSibling.className).toBe('cc-mis');
    });
});

describe('the panel', () => {
    const draw = (opts) => { const host = document.createElement('div'); drawPanel(host, ctx(opts)); return host; };

    it('starts on the chart: each section once, the form, and who drew it', () => {
        const host = draw();
        expect(host.querySelectorAll('.cc-sec')).toHaveLength(2);
        expect(text(host.querySelector('.cc-form'))).toBe('Form: Verse · Verse · Chorus · Verse · Verse · Chorus · Chorus');
        expect(text(host.querySelector('.cc-by'))).toBe('Chart by Mike Beaumier');
        expect(host.querySelector('.cc-seg-btn[data-cc-mode="chart"]').getAttribute('aria-pressed')).toBe('true');
        expect(host.querySelector('.cc-practice')).toBeNull();
    });

    it('says so, quietly, when the form does not line up', () => {
        const host = document.createElement('div');
        drawPanel(host, { chart, sections: sections.slice(0, 3), opts: OPTS });
        expect(text(host.querySelector('.cc-note'))).toContain('7 sections');
    });

    it('toggles are buttons that redraw the panel and remember the bars', () => {
        const host = draw();
        host.querySelector('[data-cc-bars="2"]').click();
        expect(getBars()).toBe(2);
        expect(host.querySelectorAll('.cc-chart .cc-bar')).toHaveLength(16);   // 32 cells
        host.querySelector('[data-cc-mode="practice"]').click();
        expect(host.querySelectorAll('.cc-psec')).toHaveLength(7);
        expect(draw().querySelectorAll('.cc-psec')).toHaveLength(7);            // the mode is for this page load
        host.querySelector('[data-cc-mode="chart"]').click();
        expect(host.querySelectorAll('.cc-psec')).toHaveLength(0);
        setBars(1);
        expect(getBars()).toBe(1);
    });

    it('practice: 7 sections in the lyrics\' order, each chart line level with its lyric line', () => {
        setMode('practice');
        const host = draw();
        const secs = host.querySelectorAll('.cc-psec');
        expect([...secs].map(s => s.querySelector('.cc-plabel span').textContent))
            .toEqual(['Verse 1', 'Verse 2', 'Chorus', 'Verse 3', 'Verse 4', 'Chorus', 'Chorus']);
        const rows = secs[0].querySelectorAll('.cc-prow');
        expect(rows).toHaveLength(4);
        rows.forEach(r => {
            expect(r.querySelectorAll('.cc-plyric .song-line')).toHaveLength(1);
            expect(r.querySelectorAll('.cc-pchart .cc-line')).toHaveLength(1);
        });
        // the mismatch note sits in verse 2's third row, with its lyric line
        expect(host.querySelectorAll('.cc-mis')).toHaveLength(1);
        expect(secs[1].querySelectorAll('.cc-prow')[2].querySelector('.cc-plyric .cc-mis')).not.toBeNull();
        // no playback yet
        expect(host.querySelector('.now, .cc-playing, .cc-transport')).toBeNull();
    });

    it('practice: the chart section beside the lyric section when the line counts differ', () => {
        setMode('practice');
        const lyric = parseChordPro('{start_of_verse: V}\n[G]one [C]two\n[G]three [D]four\n{end_of_verse}').sections;
        const syn = { key: 'G', meter: 'duple', form: ['V'], sections: [
            { name: 'V', repeat: 1, lines: [[{ slots: ['G', null] }, { slots: ['C', null] }]] }] };
        const host = document.createElement('div');
        drawPanel(host, { chart: syn, sections: lyric, opts: { key: 'G', transposeTo: 'G' } });
        const rows = host.querySelectorAll('.cc-prow');
        expect(rows).toHaveLength(1);
        expect(rows[0].querySelectorAll('.cc-plyric .song-line')).toHaveLength(2);
        expect(rows[0].querySelectorAll('.cc-pchart .cc-line')).toHaveLength(1);
    });

    it('practice follows the chart\'s own form when it does not line up with the lyrics', () => {
        setMode('practice');
        const host = document.createElement('div');
        drawPanel(host, { chart, sections: sections.slice(0, 3), opts: OPTS });
        expect(host.querySelectorAll('.cc-psec')).toHaveLength(7);
        expect(host.querySelectorAll('.cc-plyric .song-line')).toHaveLength(0);
    });
});
