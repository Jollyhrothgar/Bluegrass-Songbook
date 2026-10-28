// Pure text-level model of a ChordPro lead sheet for the CodeMirror editor.
// The document IS the ChordPro text; everything here reads positions off that
// text (no DOM, no CodeMirror) so the decoration rules and the editing rules
// unit-test without layout. The scanner mirrors renderers/chordpro.js
// `parseChordPro` rule for rule, so what Visual mode shows is what the song
// page shows.

import { isValidChord, extractChords, detectKey, getSemitonesBetweenKeys } from '../chords.js';
import { tokenizeLine } from '../visual-editor/syllables.js';

const SECTION_START_RE = /^\{start_of_(\w+)(?::\s*([^}]*?))?\s*\}$/i;
const SHORT_START_RE = /^\{so([vcbtg])(?::\s*([^}]*?))?\s*\}$/i;
const SECTION_END_RE = /^\{(?:end_of_\w+|eo[vcbtg])\s*\}$/i;
const COMMENT_RE = /^\{(?:comment|c)(?::\s*|\s+)([^}]*?)\s*\}$/i;
const SHORT_TYPES = { v: 'verse', c: 'chorus', b: 'bridge', t: 'tab', g: 'grid' };
const PREFORMATTED = new Set(['tab', 'grid']);

// ---------------------------------------------------------------------------
// The song's key: ONE owner for the toolbar, the chord sheet and the submit
// ---------------------------------------------------------------------------

/** `{key: G}` or `{meta: key G}` -> 'G' ('Em' for a minor key); null when the sheet declares none. */
export function declaredKey(text) {
    const m = String(text).match(/^\s*\{(?:key:\s*|meta:\s*key\s+)([A-G][#b]?(?:m|min)?)\s*\}/im);
    return m ? m[1].replace(/min$/, 'm') : null;
}

/**
 * The song's key as { key, mode }: the declared `{key:}` if there is one, else the
 * key detected from the chords. `key` is 'G' or 'Em'; both null when there is
 * neither a declaration nor a chord.
 */
export function currentSongKey(text) {
    const declared = declaredKey(text);
    if (declared) return { key: declared, mode: declared.endsWith('m') ? 'minor' : 'major' };
    const chords = extractChords(text);
    if (!chords.length) return { key: null, mode: null };
    const { key, mode } = detectKey(chords);
    if (!key) return { key: null, mode: null };
    return { key: mode === 'minor' && !key.endsWith('m') ? `${key}m` : key, mode };
}

/** The text with `{key: k}` written (replacing the declaration, else a new first line). */
export function withKey(text, k) {
    const re = /^(\s*)\{(?:key:\s*|meta:\s*key\s+)([A-G][#b]?(?:m|min)?)\s*\}/im;
    if (re.test(text)) return text.replace(re, (_, ws) => `${ws}{key: ${k}}`);
    return `{key: ${k}}\n${text}`;
}

/**
 * How far the chords move when the song goes from key `from` to key `to`, in semitones (-5..6, the nearer way).
 * Keys are compared through their relative major, so G -> A is +2, G -> Em is 0 (the same chords: only the key's
 * name was wrong) and G -> Am is +5 (to C's chords). 0 when either key is unknown.
 */
export function keyShift(from, to) {
    if (!from || !to) return 0;
    const minor = (k) => (/m$/.test(k) ? 3 : 0);
    const s = (getSemitonesBetweenKeys(from, to) + minor(to) - minor(from) + 24) % 12;
    return s > 6 ? s - 12 : s;
}

/** One chord token, `[G7]`: global, so always reset lastIndex or use matchAll. */
export const CHORD_TOKEN = /\[([^\]\n]+)\]/g;

/**
 * Break one source line into lyrics and chord tokens.
 * `chords[i] = { chord, from, to, lyricPos }` (from/to are offsets in the
 * line); `seamOffset(idx)` is the line offset of lyric index `idx`, AFTER any
 * chords that sit there (the start of the syllable the chords belong to).
 */
export function lineModel(line) {
    const chords = [];
    let lyrics = '';
    let last = 0;
    for (const m of line.matchAll(CHORD_TOKEN)) {
        lyrics += line.slice(last, m.index);
        chords.push({ chord: m[1], from: m.index, to: m.index + m[0].length, lyricPos: lyrics.length });
        last = m.index + m[0].length;
    }
    lyrics += line.slice(last);

    // lyric index -> line offset (chord-free char positions)
    const offsets = [];
    let ci = 0;
    let pos = 0;
    for (let i = 0; i <= lyrics.length; i++) {
        while (ci < chords.length && chords[ci].lyricPos === i) { pos = chords[ci].to; ci++; }
        offsets.push(pos);
        pos++;
    }
    return { lyrics, chords, seamOffset: (idx) => offsets[Math.max(0, Math.min(idx, lyrics.length))] };
}

/** How many chord tokens does this slice of text contain? */
export function countChords(text) {
    return [...String(text).matchAll(CHORD_TOKEN)].length;
}

/**
 * Whole-document scan. Returns
 *   lines:   one entry per source line { from, to, text, kind, ... }
 *            kind: 'lyric' | 'blank' | 'label' | 'hidden' | 'locked'
 *   blocks:  locked multi-line blocks { from, to, type, text } (ABC, tab,
 *            grid) and single {comment} rows; they replace their lines
 *   sections { startLine, endLine, type, label, explicit, indent }
 */
export function analyzeDocument(text) {
    const src = text.split('\n');
    const lines = [];
    const sections = [];
    const blocks = [];
    let offset = 0;
    let current = null;       // open section
    let implicit = false;
    let abc = null;           // { from, startLine, lines: [] }

    const closeSection = (lineIdx) => {
        if (current) current.endLine = lineIdx;
        current = null;
        implicit = false;
    };

    src.forEach((line, i) => {
        const from = offset;
        const to = offset + line.length;
        offset = to + 1;
        const entry = { from, to, text: line, kind: 'blank', index: i };
        lines.push(entry);

        if (abc) {
            entry.kind = 'locked';
            if (/\{end_of_abc\}/i.test(line)) {
                blocks.push({ from: abc.from, to, type: 'abc', text: abc.lines.join('\n') });
                abc = null;
            } else {
                abc.lines.push(line);
            }
            return;
        }
        if (/\{start_of_abc\}/i.test(line)) {
            closeSection(i - 1);
            entry.kind = 'locked';
            abc = { from, lines: [] };
            return;
        }

        const t = line.trim();
        if (/^\{meta:\s*\w+\s+[^}]+\}$/.test(t)) { entry.kind = 'hidden'; return; }

        const start = t.match(SECTION_START_RE);
        const short = start ? null : t.match(SHORT_START_RE);
        if (start || short) {
            closeSection(i - 1);
            const type = start ? start[1].toLowerCase() : SHORT_TYPES[short[1].toLowerCase()];
            const label = (start ? start[2] : short[2]) || type.charAt(0).toUpperCase() + type.slice(1);
            current = { startLine: i, endLine: null, type, label, explicit: true, indent: false };
            current.preformatted = PREFORMATTED.has(type);
            sections.push(current);
            entry.kind = current.preformatted ? 'locked' : 'label';
            entry.section = current;
            if (current.preformatted) current.blockFrom = from;
            return;
        }
        if (SECTION_END_RE.test(t)) {
            if (current?.preformatted) {
                blocks.push({ from: current.blockFrom, to, type: current.type,
                    text: src.slice(current.startLine + 1, i).join('\n') });
                entry.kind = 'locked';
            } else {
                entry.kind = 'hidden';
            }
            closeSection(i);
            return;
        }
        if (current?.preformatted) { entry.kind = 'locked'; return; }

        const comment = t.match(COMMENT_RE);
        if (comment) {
            const chordOnly = comment[1] && comment[1].split(/\s+/).every(tok => isValidChord(tok));
            if (comment[1] && !chordOnly) {
                if (!(current && !implicit)) closeSection(i - 1);
                blocks.push({ from, to, type: 'comment', text: comment[1] });
                entry.kind = 'locked';
            } else {
                entry.kind = 'hidden';
            }
            return;
        }
        if (t.startsWith('{') && t.endsWith('}')) { entry.kind = 'hidden'; return; }

        if (!t) {
            if (implicit) closeSection(i - 1);
            entry.kind = 'blank';
            return;
        }

        if (!current) {
            const n = sections.filter(s => s.type === 'verse').length + 1;
            current = { startLine: i, endLine: null, type: 'verse', label: `Verse ${n}`,
                explicit: false, indent: false };
            implicit = true;
            sections.push(current);
            entry.implicitLabel = current;
        }
        entry.kind = 'lyric';
        entry.section = current;
        current.lastLyric = i;
    });
    // An unterminated ABC / tab block still locks everything to the end
    if (abc) blocks.push({ from: abc.from, to: offset - 1, type: 'abc', text: abc.lines.join('\n') });
    if (current?.preformatted) {
        blocks.push({ from: current.blockFrom, to: offset - 1, type: current.type,
            text: src.slice(current.startLine + 1).join('\n') });
    }
    closeSection(src.length - 1);

    // The book's indent rule: choruses and any label that occurs twice
    const counts = {};
    for (const s of sections) if (!s.preformatted) counts[s.label] = (counts[s.label] || 0) + 1;
    for (const s of sections) s.indent = s.type === 'chorus' || counts[s.label] > 1;

    for (const entry of lines) {
        if (entry.kind === 'lyric' && entry.index === entry.section.lastLyric) entry.sectionLast = true;
    }
    return { lines, sections, blocks };
}

// ---------------------------------------------------------------------------
// Editing rules
// ---------------------------------------------------------------------------

/** Contiguous chord tokens that end exactly at `pos` (same line). */
function chordRunBefore(lineText, offset) {
    const m = lineText.slice(0, offset).match(/(\[[^\]\n]+\])+$/);
    return m ? m[0].length : 0;
}
function chordRunAfter(lineText, offset) {
    const m = lineText.slice(offset).match(/^(\[[^\]\n]+\])+/);
    return m ? m[0].length : 0;
}

/**
 * Text typed where a chord sits goes BEFORE the chord, so the chord stays on
 * its syllable. `pos` sitting right after chord token(s) moves to before them.
 */
export function insertionPoint(text, pos) {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    return pos - chordRunBefore(text.slice(ls, pos), pos - ls);
}

const isLowSurrogate = (c) => c >= 0xDC00 && c <= 0xDFFF;

/**
 * The spans of the text a USER delete must never touch: every line `analyzeDocument` calls hidden
 * (`{meta:}`, `{key:}`, `{end_of_*}`...), label (`{start_of_*}`) or locked (tab / ABC / comment blocks),
 * plus the newline that joins each to its neighbours (deleting that newline would merge a lyric into a
 * directive and make the lyric vanish). Sorted, merged [from, to) pairs.
 * `free` (a Set of line indexes, see `freedSectionLines`) lists label / end lines that are NOT protected.
 */
export function protectedSpans(text, free = null, analysis = analyzeDocument(text)) {
    const spans = [];
    for (const l of analysis.lines) {
        if (l.kind !== 'hidden' && l.kind !== 'label' && l.kind !== 'locked') continue;
        if (free?.has(l.index)) continue;
        const from = Math.max(0, l.from - 1);
        const to = Math.min(text.length, l.to + 1);
        const last = spans[spans.length - 1];
        if (last && from <= last[1]) last[1] = Math.max(last[1], to); else spans.push([from, to]);
    }
    return spans;
}

/**
 * The `{start_of_*}` / `{end_of_*}` line indexes of every explicit (non tab / ABC / grid) section whose WHOLE
 * extent, from its start line's first character to its last line's last character, lies inside [from, to).
 * Those directives go with the lyrics when a user deletes the whole section; metadata and locked blocks never.
 */
export function freedSectionLines(text, from, to, analysis = analyzeDocument(text)) {
    const free = new Set();
    for (const s of analysis.sections) {
        if (!s.explicit || s.preformatted || s.startLine == null) continue;
        const a = analysis.lines[s.startLine];
        const b = analysis.lines[s.endLine ?? analysis.lines.length - 1];
        if (!a || !b || a.from < from || b.to > to) continue;
        free.add(s.startLine);
        if (b.kind === 'hidden' && SECTION_END_RE.test(b.text.trim())) free.add(b.index);
    }
    return free;
}

/**
 * The changes ONE user deletion / replacement [from, to) (+ `insert`) becomes once protected text is respected:
 * clipped to the unprotected pieces (the insert lands at the first), except that a section lying wholly inside
 * the range goes too, label to `{end_of_*}`. When whole sections went, the blank lines they leave behind are
 * tidied (no run of blank lines, none at the ends the deletion reached), as ONE change. Returns the original
 * `{from, to, insert}` unchanged (same object) when nothing is protected in the range.
 */
export function clipDeletion(text, from, to, insert = '') {
    const analysis = analyzeDocument(text);
    const free = freedSectionLines(text, from, to, analysis);
    const pieces = unprotectedPieces(text, from, to, protectedSpans(text, free, analysis));
    if (!free.size && pieces.length === 1 && pieces[0][0] === from && pieces[0][1] === to) return [{ from, to, insert }];
    const changes = pieces.map(([a, b], i) => ({ from: a, to: b, insert: i === 0 ? insert : '' }));
    if (!free.size) return changes;
    // Tidy: apply, collapse the blank lines the removed sections leave, and diff back to one change.
    let out = '';
    let at = 0;
    for (const c of changes) { out += text.slice(at, c.from) + c.insert; at = c.to; }
    out += text.slice(at);
    out = out.replace(/\n{3,}/g, '\n\n');
    if (!insert && from === 0) out = out.replace(/^\n+/, '');
    if (!insert && to >= text.length) out = out.replace(/\n+$/, '');
    let p = 0;
    while (p < text.length && p < out.length && text[p] === out[p]) p++;
    let q = 0;
    while (q < text.length - p && q < out.length - p && text[text.length - 1 - q] === out[out.length - 1 - q]) q++;
    return [{ from: p, to: text.length - q, insert: out.slice(p, out.length - q) }];
}

/** The parts of [from, to) outside the protected spans, as [[from, to], ...] (a delete is clipped to these). */
export function unprotectedPieces(text, from, to, spans = protectedSpans(text)) {
    const out = [];
    let at = from;
    for (const [a, b] of spans) {
        if (b <= at) continue;
        if (a >= to) break;
        if (a > at) out.push([at, Math.min(a, to)]);
        at = Math.max(at, b);
        if (at >= to) break;
    }
    if (at < to) out.push([at, to]);
    return out;
}

const touchesProtected = (text, r) => unprotectedPieces(text, r.from, r.to).length !== 1
    || unprotectedPieces(text, r.from, r.to)[0][0] !== r.from || unprotectedPieces(text, r.from, r.to)[0][1] !== r.to;

/** Range Backspace removes from a caret at `pos`: the letter before, hopping over chords. Null at a protected boundary. */
export function backspaceRange(text, pos) {
    let p = insertionPoint(text, pos);
    if (p <= 0) return null;
    let from = p - 1;
    if (from > 0 && isLowSurrogate(text.charCodeAt(from))) from--;
    const r = { from, to: p };
    return touchesProtected(text, r) ? null : r;
}

/** Range Delete removes from a caret at `pos`: the letter after, hopping over chords. Null at a protected boundary. */
export function deleteForwardRange(text, pos) {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    const le = text.indexOf('\n', pos);
    const line = text.slice(ls, le === -1 ? text.length : le);
    const p = pos + chordRunAfter(line, pos - ls);
    if (p >= text.length) return null;
    const r = { from: p, to: p + (isLowSurrogate(text.charCodeAt(p + 1)) ? 2 : 1) };
    return touchesProtected(text, r) ? null : r;
}

// ---------------------------------------------------------------------------
// Chord placement
// ---------------------------------------------------------------------------

/** The chord token (if any) that belongs to the syllable starting at `pos`. */
export function chordAt(text, pos) {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    const before = text.slice(ls, pos);
    const m = before.match(/\[([^\]\n]+)\]$/);
    return m ? { chord: m[1], from: pos - m[0].length, to: pos } : null;
}

/** The line (without its newline) that starts at `ls`. */
const lineAt = (text, ls) => { const e = text.indexOf('\n', ls); return text.slice(ls, e === -1 ? text.length : e); };

/**
 * The cursor stops on the line starting at `ls`, in reading order. Letters are NEVER stops. Three kinds:
 *   syllable  a syllable start (the seams `tokenizeLine` makes, incl. a chord already sitting mid-word)
 *   gap       the whitespace between two words: ONE stop per run, at the offset of its first space (or, when a
 *             chord already sits in the run, just after that chord). `years[D] since` is the gap after `years`
 *   after     past the last word: each chord already trailing the words, then ONE virtual empty slot (`after: 1`,
 *             pos = the line end; nothing is written until a chord is picked)
 * Every stop is { pos, kind, after: 0|1, at, col, chord }. `pos` stands AFTER the chords at that offset (where
 * the book draws a chord's own box); `at` is where the stop starts being drawn (a trailing chord's own start);
 * `col` is a stand-in for x (the lyric index) when nothing is laid out.
 */
export function lineStops(text, ls) {
    const line = lineAt(text, ls);
    const le = ls + line.length;
    const model = lineModel(line);
    const lyrics = model.lyrics;
    const L = lyrics.length;
    const trimmed = lyrics.trimEnd().length;
    const stops = [];
    const chordAtPos = (pos) => chordAt(text, pos)?.chord || null;
    for (const tk of tokenizeLine(lyrics, model.chords.map((c) => c.lyricPos))) {
        const pos = ls + model.seamOffset(tk.start);
        stops.push({ pos, kind: 'syllable', after: 0, at: pos, col: tk.start, chord: chordAtPos(pos) });
    }
    // whitespace runs BETWEEN two words
    for (const m of lyrics.slice(0, trimmed).matchAll(/\s+/g)) {
        const a = m.index;
        const b = a + m[0].length;
        if (a === 0) continue;                                    // leading indent: not a gap
        const inRun = model.chords.find((c) => c.lyricPos >= a && c.lyricPos < b);
        const col = inRun ? inRun.lyricPos : a;
        const pos = ls + model.seamOffset(col);
        stops.push({ pos, kind: 'gap', after: 0, at: pos, col, chord: chordAtPos(pos) });
    }
    // chords already trailing the words
    for (const c of model.chords) {
        if (c.lyricPos < trimmed) continue;
        const pos = ls + c.to;
        stops.push({ pos, kind: 'after', after: 0, at: ls + c.from, col: c.lyricPos, chord: c.chord });
    }
    stops.sort((x, y) => x.pos - y.pos || x.at - y.at);
    const out = [];
    for (const s of stops) if (!out.length || out[out.length - 1].pos !== s.pos) out.push(s);   // one stop per place
    out.push({ pos: le, kind: 'after', after: 1, at: le, col: L + 1, chord: null });
    return out;
}

/** The kind of the real (non-virtual) stop at `pos`, or null. */
export function stopKindAt(text, pos) {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    return lineStops(text, ls).find((s) => !s.after && s.pos === pos)?.kind || null;
}

const isCursorLine = (line) => { const t = line.trim(); return !!t && !(t.startsWith('{') && t.endsWith('}')); };

/**
 * Snap ANY position to the nearest cursor stop: { pos, after }. First the one-place-per-letter rule (a
 * position at or inside chord tokens moves to the end of the run: the cursor never stands just before a
 * chord), then, on a lyric line, to the nearest stop: mid-syllable goes to the syllable start, a non-gap
 * space (a double space's second space, leading indent) to the nearest stop, and anything past the last word
 * to the slot after the words (`after: 1`). Ties go to the earlier stop. Non-lyric lines only get the first rule.
 */
export function snapCursor(text, pos) {
    if (pos == null || pos < 0 || pos > text.length) return { pos, after: 0 };
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    const line = lineAt(text, ls);
    let p = pos - ls;
    for (const m of line.matchAll(CHORD_TOKEN)) {
        if (m.index <= p && p < m.index + m[0].length) p = m.index + m[0].length;
    }
    if (!isCursorLine(line)) return { pos: ls + p, after: 0 };
    const stops = lineStops(text, ls);
    const real = stops.filter((s) => !s.after);
    const virtual = stops[stops.length - 1];
    const exact = real.find((s) => s.pos === ls + p);
    if (exact) return { pos: exact.pos, after: 0 };
    // lyric column of p (chord tokens before it take no room)
    const model = lineModel(line);
    let col = p;
    for (const c of model.chords) if (c.to <= p) col -= c.to - c.from;
    const trimmed = model.lyrics.trimEnd().length;
    if (col >= trimmed) return { pos: virtual.pos, after: 1 };   // at or past the last word's end: the slot after the words
    let best = null;
    for (const s of real) {
        if (s.kind === 'after') continue;
        const d = Math.abs(s.col - col);
        if (!best || d < best.d) best = { s, d };
    }
    return best ? { pos: best.s.pos, after: 0 } : { pos: virtual.pos, after: 1 };
}

/** The position of {@link snapCursor} (the single normalisation step; see there). */
export function normalizeCursor(text, pos) {
    return snapCursor(text, pos).pos;
}

/** The change that puts `chord` on the syllable at `pos` (replaces the one there). */
export function placeChordChange(text, pos, chord) {
    const at = chordAt(text, pos);
    return at
        ? { from: at.from, to: at.to, insert: `[${chord}]` }
        : { from: pos, to: pos, insert: `[${chord}]` };
}

/** The change that removes the chord on the syllable at `pos` (null if none). */
export function removeChordChange(text, pos) {
    const at = chordAt(text, pos);
    return at ? { from: at.from, to: at.to, insert: '' } : null;
}

/** Document positions where a chord can go on the line containing `pos`. */
export function lineSeams(text, pos) {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    const le = text.indexOf('\n', pos);
    const line = text.slice(ls, le === -1 ? text.length : le);
    const model = lineModel(line);
    const starts = new Set(tokenizeLine(model.lyrics, model.chords.map(c => c.lyricPos)).map(t => t.start));
    starts.add(model.lyrics.length);
    return [...starts].sort((a, b) => a - b).map(i => ls + model.seamOffset(i));
}

/** The end of the syllable token that `pos` starts or lies inside (for the box outline). A mid-syllable cursor (the glide's letter tier) outlines from the cursor to the syllable's end. */
export function syllableEnd(text, pos) {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    const le = text.indexOf('\n', pos);
    const line = text.slice(ls, le === -1 ? text.length : le);
    const model = lineModel(line);
    const tokens = tokenizeLine(model.lyrics, model.chords.map(c => c.lyricPos));
    const rel = pos - ls;
    for (const tk of tokens) {
        const from = model.seamOffset(tk.start);
        const to = model.seamOffset(tk.start + tk.text.length - 1) + 1;
        if (rel >= from && rel < to) return ls + to;
    }
    return pos;
}
