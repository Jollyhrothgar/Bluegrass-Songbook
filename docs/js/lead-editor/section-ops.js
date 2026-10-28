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
