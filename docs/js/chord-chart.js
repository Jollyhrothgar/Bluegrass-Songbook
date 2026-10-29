// Chord chart logic for Bluegrass Songbook (G18b)
//
// Pure module: no DOM, no fetch. Works on the published chart JSON
// (docs/data/charts/<work-id>.json, built by scripts/lib/chord_chart.py) and
// on the sections parseChordPro() (renderers/chordpro.js) returns for the same song's lyric chart.
//
// Chart shape: {key, meter, sections: [{name, repeat, lines: [[{slots, meter?}]]}], form?, by?}
// where a slot is a chord string or null (a hold: keep playing).
//
// Comparing a chart with its lyric chart is key-relative and spells a chord as
// "degree + major/minor/dim": a chart can't spell a 7th the lyric chart has,
// and the Key pill moves only one side, so neither may ever read as a mismatch.

import {
    parseLineWithChords, transposeChord, getChordQuality, getSemitonesBetweenKeys,
    extractChords, detectKey
} from './chords.js';

const NOT_MUSICAL = new Set(['comment', 'abc', 'tab', 'grid']);

// parseChordPro marks an in-section {comment: ...} line with \u0001
function isCommentLine(line) { return line.charCodeAt(0) === 1; }

/**
 * The parsed sections that carry lyric or chord lines: not comments, ABC,
 * tab or grid blocks. These are what line up with the chart's `form`.
 */
export function musicalSections(sections) {
    return (sections || []).filter(s =>
        !NOT_MUSICAL.has(s.type) && !s.preformatted && s.lines &&
        s.lines.some(l => !isCommentLine(l)));
}

/**
 * Pair each musical lyric section with the chart section its `form` entry
 * names, in order. Aligned only when the counts are equal.
 * -> {aligned: true, pairs: [{lyric, chart}]}
 *  | {aligned: false, reason: 'no-form' | 'count', formCount?, lyricCount}
 */
export function alignForm(chart, lyricSections) {
    const lyric = musicalSections(lyricSections);
    if (!chart.form) return { aligned: false, reason: 'no-form', lyricCount: lyric.length };
    if (chart.form.length !== lyric.length) {
        return { aligned: false, reason: 'count', formCount: chart.form.length, lyricCount: lyric.length };
    }
    const byName = new Map(chart.sections.map(s => [s.name, s]));
    return {
        aligned: true,
        pairs: chart.form.map((name, i) => ({ lyric: lyric[i], chart: byName.get(name) })),
    };
}

// ---------------------------------------------------------------------------
// Chord sequences
// ---------------------------------------------------------------------------

const chordRoot = chord => (chord.match(/^[A-G][#b]?/) || [null])[0];

/**
 * A chord as degree + quality relative to `key`: 'E7' in A and 'E' in A are
 * both '7' (the fifth), 'C#m' in A is '4m'. Slash basses are ignored.
 */
export function chordToken(chord, key) {
    const root = chordRoot(chord);
    if (!root) return chord;
    const q = getChordQuality(chord);
    return getSemitonesBetweenKeys(key, root) + (q === 'minor' ? 'm' : q === 'dim' ? 'o' : '');
}

/**
 * Run lines of chords through the shared line rule: consecutive repeats
 * collapse, then a leading chord is dropped when it equals the chord already
 * sounding at the end of the previous line (`sounding`, a token or null).
 * `lines` is an array of chord-name arrays. -> {lines, sounding}, where each
 * kept chord is {chord, token}.
 */
export function lineChords(lines, key, sounding = null) {
    const out = [];
    for (const chords of lines) {
        const kept = [];
        for (const chord of chords) {
            const token = chordToken(chord, key);
            if (kept.length && kept[kept.length - 1].token === token) continue;
            kept.push({ chord, token });
        }
        const last = kept.length ? kept[kept.length - 1].token : null;
        if (kept.length && kept[0].token === sounding) kept.shift();
        out.push(kept);
        if (last !== null) sounding = last;
    }
    return { lines: out, sounding };
}

/** A chart line's chords in order, holds skipped. */
function chartLineChords(line) {
    return line.flatMap(cell => cell.slots.filter(s => s !== null));
}

/** A lyric line's chords in order. */
function lyricLineChords(line) {
    return parseLineWithChords(line).chords.map(c => c.chord);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** The lyric chart's key: declared, else detected from its chords, else the chart's. */
function lyricKeyOf(pairs, opts, chart) {
    if (opts.lyricKey) return opts.lyricKey;
    const chords = pairs.flatMap(p => p.lyric.lines.filter(l => !isCommentLine(l))
        .flatMap(l => extractChords(l)));
    return detectKey(chords).key || chart.key;
}

/**
 * Compare each aligned pair's chords, flagging never fixing. Sounding chords
 * carry from section to section down the aligned order on both sides.
 * Equal line counts compare line by line; otherwise the whole section's
 * chord sequence. Key-relative: each side is read from its own key
 * (`chart.key`; `opts.lyricKey`, else detected from the lyric chords).
 * -> [{label, index, line, chart, lyric}]: the lyric section's label and
 * its position in the pairs, the 1-based line (null for a section-level
 * mismatch), and both chord lists in the lyric chart's spelling.
 *
 * Not used by the song page: Mike removed the notes it fed (2026-10-29).
 * Before reusing it, find why the live page showed a note on many lines
 * ("D7 E♭ B♭ there, C♯7 D A here": the chart spelled a semitone up from
 * the lyrics), which points at `lyricKey` not being the key the lyric chart
 * is written in. Not reproduced locally (G18 checklist, G18b3).
 */
export function compareSections(chart, alignment, opts = {}) {
    if (!alignment.aligned) return [];
    const { pairs } = alignment;
    const lyricKey = lyricKeyOf(pairs, opts, chart);
    const shift = getSemitonesBetweenKeys(chart.key, lyricKey);
    const spell = chord => transposeChord(chord, shift);
    const names = kept => kept.map(k => k.chord);

    const mismatches = [];
    let chartSounding = null;
    let lyricSounding = null;
    pairs.forEach(({ lyric, chart: section }, index) => {
        const chartRun = lineChords(section.lines.map(chartLineChords), chart.key, chartSounding);
        const lyricLines = lyric.lines.filter(l => !isCommentLine(l));
        const lyricRun = lineChords(lyricLines.map(lyricLineChords), lyricKey, lyricSounding);
        chartSounding = chartRun.sounding;
        lyricSounding = lyricRun.sounding;

        const report = (line, c, l) => {
            if (c.map(k => k.token).join() === l.map(k => k.token).join()) return;
            mismatches.push({
                label: lyric.label, index, line,
                chart: c.map(k => spell(k.chord)), lyric: names(l),
            });
        };
        if (chartRun.lines.length === lyricRun.lines.length) {
            chartRun.lines.forEach((c, i) => report(i + 1, c, lyricRun.lines[i]));
        } else {
            report(null, chartRun.lines.flat(), lyricRun.lines.flat());
        }
    });
    return mismatches;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/**
 * Regroup a chart section's cells into bars of 1 or 2 cells. Pairing restarts
 * at each chart line; an odd cell at the end of a line is a half bar.
 * -> lines of bars, a bar being {cells, half}.
 */
export function regroupBars(section, cellsPerBar) {
    return section.lines.map(cells => {
        const bars = [];
        for (let i = 0; i < cells.length; i += cellsPerBar) {
            const group = cells.slice(i, i + cellsPerBar);
            bars.push({ cells: group, half: cellsPerBar === 2 && group.length === 1 });
        }
        return bars;
    });
}

/**
 * The chord sounding at the start of each line (the one still ringing from the
 * line before), for the faint chord in a line's first slot when it is a hold.
 * Line 1 has none: a section opens on a chord.
 */
export function carriedChords(section) {
    let sounding = null;
    return section.lines.map(cells => {
        const carried = sounding;
        const chords = chartLineChords(cells);
        if (chords.length) sounding = chords[chords.length - 1];
        return carried;
    });
}

/** A copy of the chart moved by `semitones`; the key moves too. */
export function transposeChart(chart, semitones) {
    const move = chord => (chord === null ? null : transposeChord(chord, semitones));
    return {
        ...chart,
        key: transposeChord(chart.key, semitones),
        sections: chart.sections.map(s => ({
            ...s,
            lines: s.lines.map(cells => cells.map(c => ({ ...c, slots: c.slots.map(move) }))),
        })),
    };
}

/**
 * The unrolled list of chart sections to play through: the aligned lyric
 * order when there is one, else `form`, else each section `repeat` times in
 * order.
 */
export function practiceOrder(chart, alignment) {
    if (alignment && alignment.aligned) return alignment.pairs.map(p => p.chart);
    const byName = new Map(chart.sections.map(s => [s.name, s]));
    if (chart.form) return chart.form.map(name => byName.get(name));
    return chart.sections.flatMap(s => Array(s.repeat || 1).fill(s));
}
