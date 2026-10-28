// Section operations on the ChordPro TEXT (the label menu in Visual mode).
// Each returns the new document text, or null for a no-op. Pure: positions
// come from analyzeDocument, so they agree with what Visual mode draws.

import { analyzeDocument } from './doc-model.js';
import { wrapSelectionAsSection } from '../visual-editor/wrap-section.js';

export const SECTION_TYPES = ['verse', 'chorus', 'bridge', 'intro', 'outro', 'tag'];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function sectionAt(text, startLine) {
    const a = analyzeDocument(text);
    const idx = a.sections.findIndex((s) => s.startLine === startLine);
    return { a, idx, section: a.sections[idx], lines: text.split('\n') };
}

/** [first, last] source lines of a section, directives included. */
function span(section, lines, nextStart) {
    let last = section.endLine;
    if (section.explicit && !/^\s*\{(?:end_of_|eo[vcbtg])/i.test(lines[last] || '')) last = Math.min(last, lines.length - 1);
    if (nextStart != null && last >= nextStart) last = nextStart - 1;
    return [section.startLine, last];
}

/** The label a section of `type` gets when it lands after `above` sections of that type. */
export function defaultLabel(type, above) {
    return type === 'verse' ? `Verse ${above + 1}` : (above ? `${cap(type)} ${above + 1}` : cap(type));
}

export function renameSection(text, startLine, label) {
    const { section, lines } = sectionAt(text, startLine);
    if (!section?.explicit || !label.trim()) return null;
    lines[startLine] = `{start_of_${section.type}: ${label.trim()}}`;
    return lines.join('\n');
}

/** Change a section's type: relabel it for the new type and fix its end directive. */
export function setSectionTypeText(text, startLine, type) {
    const { a, idx, section, lines } = sectionAt(text, startLine);
    if (!section || !SECTION_TYPES.includes(type)) return null;
    if (!section.explicit) {
        // an implicit verse becomes explicit by wrapping its lines
        const first = a.lines.find((l) => l.section === section && l.kind === 'lyric');
        const last = [...a.lines].reverse().find((l) => l.section === section && l.kind === 'lyric');
        if (!first) return null;
        const res = wrapSelectionAsSection(text, first.from, last.to, type);
        return res ? res.text : null;
    }
    const above = a.sections.slice(0, idx).filter((s) => s.type === type).length;
    lines[startLine] = `{start_of_${type}: ${defaultLabel(type, above)}}`;
    if (section.endLine != null && /^\s*\{(?:end_of_\w+|eo[vcbtg])\s*\}/i.test(lines[section.endLine] || '')) {
        lines[section.endLine] = `{end_of_${type}}`;
    }
    return lines.join('\n');
}

function endOf(section, lines, nextStart) {
    const [, last] = span(section, lines, nextStart);
    return last;
}

export function duplicateSectionText(text, startLine) {
    const { a, idx, section, lines } = sectionAt(text, startLine);
    if (!section) return null;
    const last = endOf(section, lines, a.sections[idx + 1]?.startLine);
    const block = lines.slice(startLine, last + 1);
    lines.splice(last + 1, 0, '', ...block);
    return lines.join('\n');
}

/** Swap a section with its neighbour (delta -1 up, +1 down). */
export function moveSectionText(text, startLine, delta) {
    const { a, idx, section, lines } = sectionAt(text, startLine);
    const other = a.sections[idx + delta];
    if (!section || !other) return null;
    const [first, second] = delta < 0 ? [other, section] : [section, other];
    const fEnd = endOf(first, lines, second.startLine);
    const sEnd = endOf(second, lines, a.sections[a.sections.indexOf(second) + 1]?.startLine);
    const A = lines.slice(first.startLine, fEnd + 1);
    const gap = lines.slice(fEnd + 1, second.startLine);
    const B = lines.slice(second.startLine, sEnd + 1);
    lines.splice(first.startLine, sEnd - first.startLine + 1, ...B, ...gap, ...A);
    return lines.join('\n');
}

/** Drop the start/end directives; the lines stay, as plain lyrics. */
export function unlabelSection(text, startLine) {
    const { a, idx, section, lines } = sectionAt(text, startLine);
    if (!section?.explicit) return null;
    const last = endOf(section, lines, a.sections[idx + 1]?.startLine);
    const hasEnd = /^\s*\{(?:end_of_\w+|eo[vcbtg])\s*\}/i.test(lines[last] || '');
    if (hasEnd) lines.splice(last, 1);
    lines.splice(startLine, 1);
    return lines.join('\n');
}

export function deleteSectionText(text, startLine) {
    const { a, idx, section, lines } = sectionAt(text, startLine);
    if (!section) return null;
    let last = endOf(section, lines, a.sections[idx + 1]?.startLine);
    if (!section.explicit) {
        const lastLyric = a.lines.filter((l) => l.section === section).map((l) => l.index);
        last = Math.max(...lastLyric);
    }
    let count = last - startLine + 1;
    if (lines[last + 1] !== undefined && lines[last + 1].trim() === '') count++;
    lines.splice(startLine, count);
    return lines.join('\n');
}

/** Section the lines covered by a selection (floating bar). */
export function markSelection(text, from, to, type) {
    return wrapSelectionAsSection(text, from, to, type);
}

// ---------------------------------------------------------------------------
// Copy / cut / paste of whole sections (Lyrics mode)
// ---------------------------------------------------------------------------
// In Lyrics mode the {start_of_*} / {end_of_*} lines are hidden widgets, so a
// selection of the lyrics never holds them and the browser's copy took the
// words alone: a copied chorus pasted back as a verse (Mike, 2026-10-27).

const END_LINE = /^\s*\{(?:end_of_\w+|eo[vcbtg])\s*\}\s*$/i;
const START_LINE = /^\s*\{(?:start_of_\w+|so[vcbtg])\b/im;
const LEADING_CHORDS = /^(?:\[[^\]\n]*\])+/;
const TRAILING_CHORDS = /(?:\[[^\]\n]*\])+$/;

/** The index of the line holding `pos`. */
function lineIndexAt(lines, pos) {
    const i = lines.findIndex((l) => pos <= l.to);
    return i < 0 ? lines.length - 1 : i;
}

/** An explicit lyric section's line extent: [start, end] (end is its {end_of_*} line when it has one). */
function extentOf(section, lines) {
    const end = section.endLine ?? lines.length - 1;
    return { start: section.startLine, end, hasEnd: END_LINE.test(lines[end]?.text || '') };
}

/**
 * What a copy of [from, to) puts on the clipboard, when it is a copy of SECTIONS:
 * `{ text, from, to }`, where `from`/`to` is what a cut removes. Null when it is
 * a copy of LINES, which the browser does as it always did.
 *
 *  - Lines from inside one section (or plain, untagged lines) are LINES: a line
 *    repeated in a verse must not become a section of its own.
 *  - A selection that covers every lyric line of a section, or crosses from one
 *    section into another, is SECTIONS: every section it touches comes with its
 *    own start and end lines, balanced (an end line is written when the
 *    section had none), and a fully covered one is cut whole, label and all.
 */
export function sectionsForClipboard(text, from, to) {
    if (from >= to) return null;
    const { lines, sections } = analyzeDocument(text);
    let first = lineIndexAt(lines, from);
    let last = lineIndexAt(lines, to);
    // a selection that starts at the very end of a line, or ends at the very
    // start of one (a triple click), does not hold that line
    if (from === lines[first].to && first < last) { first++; from = lines[first].from; }
    if (to === lines[last].from && last > first) { last--; to = lines[last].to; }
    // a chord at the edge of a line is part of the line
    const lead = (l) => l.from + (l.text.match(LEADING_CHORDS)?.[0].length || 0);
    const trail = (l) => l.to - (l.text.match(TRAILING_CHORDS)?.[0].length || 0);
    if (from <= lead(lines[first])) from = lines[first].from;
    if (to >= trail(lines[last])) to = lines[last].to;

    const lyricSections = sections.filter((s) => s.explicit && !s.preformatted);
    const inSection = new Map();     // line index -> the explicit section whose content it is
    for (const s of lyricSections) {
        const { start, end, hasEnd } = extentOf(s, lines);
        for (let i = start + 1; i <= (hasEnd ? end - 1 : end); i++) inSection.set(i, s);
    }
    const selected = (l) => l.from < to && l.to > from;
    const lyricsOf = (s) => lines.filter((l) => l.kind === 'lyric' && l.section === s);
    const touched = lyricSections.filter((s) => lyricsOf(s).some(selected));
    if (!touched.length) return null;
    const covered = (s) => {
        const ly = lyricsOf(s);
        return ly.length > 0 && from <= ly[0].from && to >= ly[ly.length - 1].to;
    };
    const outside = lines.some((l) => l.kind === 'lyric' && selected(l) && !touched.includes(inSection.get(l.index)));
    if (touched.length === 1 && !covered(touched[0]) && !outside) return null;

    const out = [];
    let open = null;
    const close = () => {
        if (!open) return;
        const { end, hasEnd } = extentOf(open, lines);
        out.push(hasEnd ? lines[end].text : `{end_of_${open.type}}`);
        open = null;
    };
    for (let i = first; i <= last; i++) {
        const l = lines[i];
        // the markers of lyric sections are written fresh, balanced
        if ((l.kind === 'label' && l.section && !l.section.preformatted) || (l.kind === 'hidden' && END_LINE.test(l.text))) continue;
        const s = inSection.get(i) || null;
        if (s !== open) {
            close();
            if (s) { out.push(lines[s.startLine].text); open = s; }
        }
        out.push(text.slice(Math.max(l.from, from), Math.min(l.to, to)));
    }
    close();

    let cutFrom = from;
    let cutTo = to;
    for (const s of touched.filter(covered)) {
        const { end, hasEnd } = extentOf(s, lines);
        cutFrom = Math.min(cutFrom, lines[s.startLine].from);
        if (hasEnd) cutTo = Math.max(cutTo, lines[end].to);
    }
    return { text: out.join('\n'), from: cutFrom, to: cutTo };
}

/** Does pasted text hold a section (a `{start_of_*}` line)? */
export function holdsSections(insert) {
    return START_LINE.test(insert);
}

/**
 * Where pasted text that holds sections lands, as one change `{ from, to, insert }`
 * (null when it holds none: an ordinary paste). Never inside a section, which
 * would nest one in another: a caret inside a section (or a plain paragraph)
 * pastes after it, a caret between sections pastes right there, always with
 * one blank line either side.
 */
export function placeSectionPaste(text, pos, insert) {
    if (!holdsSections(insert)) return null;
    const body = insert.replace(/^\n+|\n+$/g, '');
    const { lines, sections } = analyzeDocument(text);
    const i = lineIndexAt(lines, pos);
    const holder = sections.find((s) => {
        if (s.preformatted) return false;
        if (s.explicit) {
            const { start, end } = extentOf(s, lines);
            return i >= start && i <= end;
        }
        return i >= s.startLine && i <= (s.lastLyric ?? s.startLine);
    });
    let at;
    if (holder?.explicit) at = lines[extentOf(holder, lines).end].to;
    else if (holder) at = lines[holder.lastLyric ?? holder.startLine].to;
    else at = lines[i].to;
    let a = at;
    while (a > 0 && text[a - 1] === '\n') a--;
    let b = at;
    while (b < text.length && text[b] === '\n') b++;
    return { from: a, to: b, insert: `${a > 0 ? '\n\n' : ''}${body}${b < text.length ? '\n\n' : '\n'}` };
}

/** The smallest single replacement that turns `oldText` into `newText`. */
export function diffChange(oldText, newText) {
    let start = 0;
    const max = Math.min(oldText.length, newText.length);
    while (start < max && oldText[start] === newText[start]) start++;
    let endOld = oldText.length;
    let endNew = newText.length;
    while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) { endOld--; endNew--; }
    return { from: start, to: endOld, insert: newText.slice(start, endNew) };
}
