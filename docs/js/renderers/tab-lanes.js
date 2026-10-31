// Lanes for a tab staff's annotations (G21c): pure layout, no DOM.
//
// A staff row has bands above and below it, nearest the staff first (Mike,
// 2026-10-31: "the closer to the staff, the more important it is to read
// while playing"). Each band exists only when something is in it, so a tab
// with none of these lays out exactly as it did before.
//
//   above, outward   marks on the fret / staff (not a band) -> articulation
//                    (effects) lanes -> left-hand fretting numbers -> text
//                    lanes -> chord diagrams -> chord names -> section name
//   below, outward   right-hand fingering (beside the beams) -> text lanes
//
// `laneStack` turns "what this tab holds" into the one set of y values the
// renderer, the editor's cursor and its grid all share, through
// `options.topMargin`. `assignLanes` places text so that no two overprint.
// The text widths are ESTIMATES (an SVG text has no layout engine in jsdom);
// they err wide.
import { chordGlyphHtml } from '../chords.js';

/** Height of one effects (articulation) lane, one text lane, and the others. */
export const FX_LANE_H = 11;
export const TEXT_LANE_H = 12;
export const LH_LANE_H = 14;       // a circled digit, r = 6
export const CHORD_NAME_H = 16;
export const SECTION_H = 16;
/** The zone just above the staff: measure numbers, endings, jump marks. */
export const BASE_ZONE = 27;
/** Headroom above a stack with no section name (the tab has always had it). */
export const LEGACY_PAD = 13;

/** Advance of one character, by font size (Helvetica-ish, wide). */
const CHAR_W = 0.55;
export const TEXT_FONT = 10;
export const CHORD_FONT = 12;
export const MIN_GAP = 6;

export function estimateTextWidth(text, fontSize = TEXT_FONT) {
    return String(text ?? '').length * fontSize * CHAR_W;
}

/**
 * Put items on lanes so no two on a lane overprint. Items are placed in
 * left-to-right order (ties by their order in the input), each on the
 * lowest lane that is free there; lane 0 is the nearest the staff.
 *
 * An item that would run past `max` slides left to end there, and one before
 * `min` stays at `min`: the lanes are chosen from where the items finally
 * sit, so the guarantee holds for what is drawn.
 *
 * @param {{x: number, w: number}[]} items   left edge and width
 * @param {{gap?: number, min?: number, max?: number}} [opts]
 * @returns {{lane: number[], x: number[], count: number}} per input item, and the lanes used
 */
export function assignLanes(items, { gap = MIN_GAP, min = -Infinity, max = Infinity } = {}) {
    const x = items.map(it => Math.max(min, Math.min(it.x, max - it.w)));
    const order = items.map((_, i) => i).sort((a, b) => x[a] - x[b] || a - b);
    const ends = [];
    const lane = new Array(items.length);
    for (const i of order) {
        let l = ends.findIndex(end => x[i] >= end + gap);
        if (l === -1) { l = ends.length; ends.push(-Infinity); }
        ends[l] = x[i] + items[i].w;
        lane[i] = l;
    }
    return { lane, x, count: ends.length };
}

/**
 * The vertical stack for a tab, from what it holds. Every y is measured from
 * the top of the row; `topMargin` is where the first string goes.
 *
 * @param {{section?: boolean, chordNames?: number, chordDiagrams?: number,
 *          textAbove?: number, lh?: boolean, fx?: number, textBelow?: number}} needs
 *   `chordNames` / `textAbove` / `fx` / `textBelow` are LANE counts;
 *   `chordDiagrams` is the height of the diagram row (0 for none).
 */
export function laneStack({
    section = false, chordNames = 0, chordDiagrams = 0, textAbove = 0, lh = false,
    fx = 0, textBelow = 0,
} = {}) {
    let y = section ? SECTION_H : LEGACY_PAD;
    const out = {
        sectionBaseline: 12,
        chordNames: [], chordDiagramTop: null, chordDiagramH: chordDiagrams,
        textAbove: [], lhCenter: null, fx: [], textBelow: 0,
    };

    // outermost first: chord names, chord diagrams, text lanes, lh, effects
    for (let i = chordNames - 1; i >= 0; i--) {          // lane 0 nearest the staff
        out.chordNames[i] = y + CHORD_NAME_H - 4;
        y += CHORD_NAME_H;
    }
    if (chordDiagrams) { out.chordDiagramTop = y + 1; y += chordDiagrams; }
    for (let i = textAbove - 1; i >= 0; i--) {
        out.textAbove[i] = y + TEXT_LANE_H - 3;
        y += TEXT_LANE_H;
    }
    if (lh) { out.lhCenter = y + LH_LANE_H / 2; y += LH_LANE_H; }
    for (let i = fx - 1; i >= 0; i--) {
        out.fx[i] = y + FX_LANE_H - 3;
        y += FX_LANE_H;
    }
    out.topMargin = y + BASE_ZONE;
    out.textBelow = textBelow;
    out.belowExtra = textBelow * TEXT_LANE_H;
    return out;
}

/** Baseline of below-the-staff text lane `i`, given the bottom the staff used to end at. */
export function belowBaseline(staffBottom, i) {
    return staffBottom + i * TEXT_LANE_H + 9;
}

/**
 * Bend SOURCES whose target is drawn: a note with `fx` bend / bend-release
 * whose next note on the same string (within `measures`, a row) is a
 * `tech: "b"` note. The target carries the arrow and the amount, so the
 * source needs no mark of its own in the effects band. A bend without a
 * target is not in the set and keeps its band mark.
 * @param {Array} measures  one row's notation entries, in order
 * @returns {Set<object>} the source note objects
 */
export function bendSources(measures) {
    const out = new Set();
    const last = new Map();
    for (const m of measures || []) {
        const events = [...(m.events || [])].sort((a, b) => (a.tick || 0) - (b.tick || 0));
        for (const e of events) {
            for (const n of e.notes || []) {
                const prev = last.get(n.s);
                if (n.tech === 'b' && prev && prev.fx
                        && (prev.fx.includes('bend') || prev.fx.includes('bend-release'))) {
                    out.add(prev);
                }
            }
            for (const n of e.notes || []) last.set(n.s, n);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Chord names in the chord lane
// ---------------------------------------------------------------------------

/**
 * What the shared tab-chord parser (docs/js/tab-chord.js, G21d) says about a
 * text, or the text as written when there is no parser or it does not take it.
 * This is the whole switch between the two: the renderer hands in the parser
 * when the module exists.
 * @param {string} text
 * @param {((text: string) => ({chord: string, optional: boolean, shape: string|null,
 *          ext: string|null})|null)|null} parser
 */
export function chordParts(text, parser) {
    const parsed = typeof parser === 'function' ? parser(text) : null;
    return parsed
        ? { chord: parsed.chord, optional: !!parsed.optional, shape: parsed.shape ?? null, ext: parsed.ext ?? null }
        : { chord: String(text ?? ''), optional: false, shape: null, ext: null, raw: true };
}

const UNESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

/**
 * `chordGlyphHtml`'s markup as flat runs: `main` (root, accidental glyph,
 * quality), `sup` (extension) and `small` (the slash bass). The same glyphs
 * the lyrics and the chord chart use, so a chord reads the same everywhere.
 */
export function chordGlyphRuns(symbol) {
    const html = chordGlyphHtml(symbol);
    const runs = [];
    const stack = [];
    const re = /<(\/?)(sup|span)([^>]*)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[4] != null) {
            const kind = stack.length ? stack[stack.length - 1] : 'main';
            const text = m[4].replace(/&(?:amp|lt|gt|quot);/g, e => UNESC[e]);
            const prev = runs[runs.length - 1];
            if (prev && prev.kind === kind) prev.text += text;
            else runs.push({ kind, text });
        } else if (m[1]) {
            stack.pop();
        } else {
            const inherit = stack.length ? stack[stack.length - 1] : 'main';
            stack.push(m[2] === 'sup' ? 'sup' : /\bbass\b/.test(m[3]) ? 'small' : inherit);
        }
    }
    return runs;
}

/**
 * A chord annotation as runs to draw: `main` / `sup` / `small` (the chord's
 * own parts) and `shape` (a capo spelling, after the chord, smaller and
 * lighter: "A (G)"). Optional wraps the chord in parentheses; an extension
 * is a superscript in parentheses.
 */
export function chordLaneRuns(parts) {
    if (parts.raw) return [{ kind: 'main', text: parts.chord }];
    const runs = [];
    if (parts.optional) runs.push({ kind: 'main', text: '(' });
    runs.push(...chordGlyphRuns(parts.chord));
    if (parts.ext) runs.push({ kind: 'sup', text: `(${parts.ext})` });
    if (parts.optional) runs.push({ kind: 'main', text: ')' });
    if (parts.shape) {
        runs.push({ kind: 'shape', text: ' (' },
            ...chordGlyphRuns(parts.shape).map(r => ({ ...r, kind: 'shape' })),
            { kind: 'shape', text: ')' });
    }
    return runs;
}

const RUN_SCALE = { main: 1, sup: 0.65, small: 0.75, shape: 0.75 };

/** Estimated width of runs drawn at `fontSize` (the main size). */
export function chordRunsWidth(runs, fontSize = CHORD_FONT) {
    let w = 0;
    for (const r of runs) w += r.text.length * fontSize * RUN_SCALE[r.kind] * 0.62;
    return w;
}

export const CHORD_RUN_SCALE = RUN_SCALE;
