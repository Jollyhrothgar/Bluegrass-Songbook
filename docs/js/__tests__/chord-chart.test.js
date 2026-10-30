// Chart logic (docs/js/chord-chart.js) against a frozen copy of the published
// Old Home Place chart and lyric chart (fixtures/), plus small synthetic charts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseChordPro } from '../renderers/chordpro.js';
import { transposeChord } from '../chords.js';
import {
    musicalSections, alignForm, compareSections, regroupBars, carriedChords,
    transposeChart, practiceOrder, lineChords, wrapCells,
} from '../chord-chart.js';

const FIX = resolve(process.cwd(), 'docs/js/__tests__/fixtures');
const chart = JSON.parse(readFileSync(resolve(FIX, 'old-home-place.chord-chart.json'), 'utf8'));
const proText = readFileSync(resolve(FIX, 'old-home-place.pro'), 'utf8');

const cell = (...slots) => ({ slots });
const section = (name, lines, repeat = 1) => ({ name, repeat, lines });
const synth = (over = {}) => ({ key: 'G', meter: 'duple', sections: [], ...over });
const lyric = (label, lines) => ({ type: 'verse', label, lines });

// Move every chord in a ChordPro text, as the Key pill would.
const transposePro = (text, n) =>
    text.replace(/\[([^\]]+)\]/g, (_, c) => `[${transposeChord(c, n)}]`);

const EXPECTED = [{
    label: 'Verse 2', index: 1, line: 3,
    chart: ['A', 'C#7', 'D', 'A'], lyric: ['A', 'C#7', 'A', 'D'],
}];

describe('Old Home Place', () => {
    const sections = parseChordPro(proText).sections;

    it('aligns 7 for 7 and finds exactly the verse 2 line 3 mismatch', () => {
        const alignment = alignForm(chart, sections);
        expect(alignment.aligned).toBe(true);
        expect(alignment.pairs).toHaveLength(7);
        expect(compareSections(chart, alignment, { lyricKey: 'A' })).toEqual(EXPECTED);
    });

    it('detects the lyric key when none is given', () => {
        expect(compareSections(chart, alignForm(chart, sections))).toEqual(EXPECTED);
    });

    it('is unchanged after transposing the lyric chart (+2)', () => {
        const moved = parseChordPro(transposePro(proText, 2)).sections;
        const found = compareSections(chart, alignForm(chart, moved), { lyricKey: 'B' });
        expect(found).toEqual([{
            ...EXPECTED[0], chart: ['B', 'D#7', 'E', 'B'], lyric: ['B', 'D#7', 'B', 'E'],
        }]);
    });

    it('is unchanged after transposing the chart (+5)', () => {
        const moved = transposeChart(chart, 5);
        expect(moved.key).toBe('D');
        expect(compareSections(moved, alignForm(moved, sections), { lyricKey: 'A' })).toEqual(EXPECTED);
    });

    it('credits the author', () => {
        expect(chart.by).toBe('Mike Beaumier');
    });
});

describe('musicalSections', () => {
    it('keeps sections with lyric or chord lines, not comments, ABC, tab or grid', () => {
        const kept = musicalSections([
            { type: 'comment', label: 'Capo 2', lines: [] },
            { type: 'abc', label: 'Notation', abc: 'X:1' },
            { type: 'tab', label: 'Tab', lines: ['e|--0--|'], preformatted: true },
            { type: 'grid', label: 'Grid', lines: ['| A |'], preformatted: true },
            lyric('Verse 1', ['[G]Hello']),
            lyric('Empty', ['\u0001just a note']),
        ]);
        expect(kept.map(s => s.label)).toEqual(['Verse 1']);
    });
});

describe('alignForm', () => {
    const c = synth({
        sections: [section('A', [[cell('G', null)]]), section('B', [[cell('C', null)]])],
        form: ['A', 'B', 'A'],
    });

    it('does not align when the counts differ', () => {
        const r = alignForm(c, [lyric('V1', ['[G]x']), lyric('V2', ['[C]y'])]);
        expect(r).toEqual({ aligned: false, reason: 'count', formCount: 3, lyricCount: 2 });
        expect(compareSections(c, r)).toEqual([]);
    });

    it('says so when the chart has no form', () => {
        const r = alignForm(synth({ sections: c.sections }), [lyric('V1', ['[G]x'])]);
        expect(r.aligned).toBe(false);
        expect(r.reason).toBe('no-form');
    });
});

describe('compareSections', () => {
    const one = lines => synth({ sections: [section('A', lines)], form: ['A'] });

    it('compares the whole section when the line counts differ', () => {
        const c = one([[cell('G', null), cell('C', null)], [cell('D', null), cell('G', null)]]);
        const same = alignForm(c, [lyric('V', ['[G]a [C]b [D]c [G]d'])]);
        expect(compareSections(c, same, { lyricKey: 'G' })).toEqual([]);
        const off = alignForm(c, [lyric('V', ['[G]a [C]b [G]c [D]d'])]);
        expect(compareSections(c, off, { lyricKey: 'G' })).toEqual([{
            label: 'V', index: 0, line: null,
            chart: ['G', 'C', 'D', 'G'], lyric: ['G', 'C', 'G', 'D'],
        }]);
    });

    it('does not flag a line starting on the chord already sounding', () => {
        const c = one([[cell('G', null), cell('C', null)], [cell('C', null), cell('D', null)]]);
        const a = alignForm(c, [lyric('V', ['[G]a [C]b', 'c [D]d'])]);
        expect(compareSections(c, a, { lyricKey: 'G' })).toEqual([]);
    });

    it('collapses consecutive repeats on the lyric side', () => {
        const c = one([[cell('G', null), cell('C', null)]]);
        const a = alignForm(c, [lyric('V', ['[G]a [G]b [C]c [C]d'])]);
        expect(compareSections(c, a, { lyricKey: 'G' })).toEqual([]);
    });

    it('reads a seventh as the same chord, a minor as a different one', () => {
        const c = one([[cell('G', null), cell('D', null)]]);
        expect(compareSections(c, alignForm(c, [lyric('V', ['[G]a [D7]b'])]), { lyricKey: 'G' })).toEqual([]);
        expect(compareSections(c, alignForm(c, [lyric('V', ['[G]a [Dm]b'])]), { lyricKey: 'G' })).toHaveLength(1);
    });
});

describe('lineChords', () => {
    it('carries the sounding chord across lines', () => {
        const r = lineChords([['G', 'C'], ['C', 'D']], 'G');
        expect(r.lines.map(l => l.map(k => k.chord))).toEqual([['G', 'C'], ['D']]);
    });
});

describe('carriedChords', () => {
    it('gives the chord sounding at the start of each line', () => {
        const s = section('A', [
            [cell('G', null), cell('C', null)],
            [cell(null, null), cell('D', null)],
            [cell(null, null), cell(null, null)],
        ]);
        expect(carriedChords(s)).toEqual([null, 'C', 'D']);
    });
});

describe('wrapCells', () => {
    const s = section('A', [
        [cell('G', null), cell('C', null), cell('D', null)],
        [cell(null, null), cell('C', null)],
    ]);

    it('runs the cells of a section on across its lines and wraps them into rows of N', () => {
        expect(wrapCells(s, 2).lines.map(l => l.length)).toEqual([2, 2, 1]);
        expect(wrapCells(s, 4).lines.map(l => l.length)).toEqual([4, 1]);
        expect(wrapCells(s, 8).lines.map(l => l.length)).toEqual([5]);
        expect(wrapCells(s, 2).lines.flat()).toEqual(s.lines.flat());
    });

    it('leaves the section alone and keeps its name and repeat', () => {
        const w = wrapCells(s, 2);
        expect(s.lines.map(l => l.length)).toEqual([3, 2]);
        expect([w.name, w.repeat]).toEqual(['A', 1]);
    });

    it('carries the sounding chord into each new row, so a wrapped row starts from what rings', () => {
        expect(carriedChords(wrapCells(s, 2))).toEqual([null, 'C', 'D']);
    });

    it('pairs into bars after wrapping: a row of N cells is N/2 two-cell bars', () => {
        const bars = regroupBars(wrapCells(s, 4), 2);
        expect(bars.map(l => l.map(b => b.cells.length))).toEqual([[2, 2], [1]]);
        expect(bars[1][0].half).toBe(true);
    });
});

describe('regroupBars', () => {
    const s = section('A', [
        [cell('G', null), cell('C', null), cell('D', null)],
        [cell('G', null), cell('C', null)],
    ]);

    it('pairs cells, restarts at each line, and marks an odd cell a half bar', () => {
        const bars = regroupBars(s, 2);
        expect(bars.map(l => l.map(b => b.cells.length))).toEqual([[2, 1], [2]]);
        expect(bars[0][1].half).toBe(true);
        expect(bars[1][0].half).toBe(false);
    });

    it('one cell a bar leaves no half bars', () => {
        const bars = regroupBars(s, 1);
        expect(bars.map(l => l.length)).toEqual([3, 2]);
        expect(bars.flat().some(b => b.half)).toBe(false);
    });
});

describe('transposeChart', () => {
    it('moves the key and every chord, keeps holds, and leaves the original alone', () => {
        const c = synth({ sections: [section('A', [[cell('G', null), { slots: ['D7', null], meter: '2/4' }]])] });
        const t = transposeChart(c, 2);
        expect(t.key).toBe('A');
        expect(t.sections[0].lines[0][0].slots).toEqual(['A', null]);
        expect(t.sections[0].lines[0][1]).toEqual({ slots: ['E7', null], meter: '2/4' });
        expect(c.key).toBe('G');
        expect(c.sections[0].lines[0][0].slots).toEqual(['G', null]);
    });
});

describe('practiceOrder', () => {
    const a = section('A', [[cell('G', null)]], 2);
    const b = section('B', [[cell('C', null)]], 2);

    it('unrolls repeats when there is no form', () => {
        const c = synth({ sections: [a, b] });
        expect(practiceOrder(c, null).map(s => s.name)).toEqual(['A', 'A', 'B', 'B']);
    });

    it('uses form when it is not aligned', () => {
        const c = synth({ sections: [a, b], form: ['A', 'B', 'A'] });
        const r = alignForm(c, []);
        expect(practiceOrder(c, r).map(s => s.name)).toEqual(['A', 'B', 'A']);
    });

    it('uses the aligned lyric order', () => {
        const c = synth({ sections: [a, b], form: ['B', 'A'] });
        const r = alignForm(c, [lyric('x', ['[C]x']), lyric('y', ['[G]y'])]);
        expect(practiceOrder(c, r).map(s => s.name)).toEqual(['B', 'A']);
    });
});
