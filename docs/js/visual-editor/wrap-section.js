// Make-verse/chorus from a textarea selection: pure text transform that
// wraps the selected lines of a ChordPro document in {start_of_X}/{end_of_X}
// directives. No DOM — the host (editor.js) owns the textarea and the
// selection-toolbar UI; this module only rewrites text so it unit-tests
// without layout.
//
// Rules (mirroring the model's addSection semantics):
// - the selection extends to whole lines (a partial-line selection wraps
//   the full lines it touches; a selection ending exactly at a line start
//   does NOT swallow that next line)
// - existing section start/end directives inside the range are stripped,
//   so re-wrapping a section (or a span across sections) yields ONE clean
//   section instead of nested/dangling directives
// - blank lines at the edges of the range stay OUTSIDE the new section
//   (they keep separating it from its neighbors); interior blanks survive
// - the label auto-numbers like model.addSection (Verse N always numbered,
//   other types bare until a second one exists: Chorus, then Chorus 2),
//   counting sections of the type ABOVE the selection
// - empty / blank-only / directive-only selections are a no-op (null)

import { parseSong } from './model.js';
import { analyzeDocument } from '../lead-editor/doc-model.js';

// start/end of any section, long or short form ({sov}/{eoc}...), any label
const SECTION_DIRECTIVE_RE =
    /^\{(?:start_of_\w+(?::[^}]*)?|end_of_\w+|so[vcb](?::[^}]*)?|eo[vcb])\s*\}$/i;
const END_DIRECTIVE_RE = /^\{(?:end_of_\w+|eo[vcbtg])\s*\}$/i;
const AUTO_VERSE_RE = /^Verse \d+$/i;

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
const isBlank = (l) => l.trim() === '';
function trimBlanks(lines) {
    const out = [...lines];
    while (out.length && isBlank(out[0])) out.shift();
    while (out.length && isBlank(out[out.length - 1])) out.pop();
    return out;
}

/**
 * Wrap the lines covered by [selStart, selEnd] in a new section of `type`.
 * Returns { text, selStart, selEnd } - the new document text plus a
 * selection spanning the inserted block - or null for a no-op.
 *
 * A selection that crosses section boundaries re-sections the document: the
 * section open where the selection starts is CLOSED before it, every boundary
 * inside the selection is dropped, and the rest of a partly covered section is
 * re-opened after it with its own type and label. Auto-numbered verse labels
 * from the new section on are renumbered so they stay unique and positional.
 */
export function wrapSelectionAsSection(text, selStart, selEnd, type) {
    if (typeof text !== 'string' || !/^[a-z]+$/i.test(type || '')) return null;
    let start = Math.max(0, Math.min(selStart, selEnd));
    let end = Math.min(text.length, Math.max(selStart, selEnd));
    if (start === end) return null;   // empty selection

    // extend to whole lines; an end sitting right after a newline belongs
    // to the previous line, not the next one
    start = text.lastIndexOf('\n', start - 1) + 1;
    if (end > start && text[end - 1] === '\n') end -= 1;
    const nl = text.indexOf('\n', end);
    end = nl === -1 ? text.length : nl;

    const all = text.split('\n');
    const S = text.slice(0, start).split('\n').length - 1;      // first selected line
    const E = S + text.slice(start, end).split('\n').length - 1; // last selected line
    const { sections } = analyzeDocument(text);
    const explicitAt = (i) => sections.find((s) => s.explicit && !s.preformatted && s.startLine <= i && i <= s.endLine);

    // the selected lines: boundaries dropped, blanks kept off the edges
    const lines = trimBlanks(all.slice(S, E + 1).filter((l) => !SECTION_DIRECTIVE_RE.test(l.trim())));
    if (lines.length === 0) return null;   // nothing but blanks/directives

    // head: a section left open where the selection starts is closed first
    let headLines = all.slice(0, S);
    const openStart = explicitAt(S);
    if (openStart && openStart.startLine < S) {
        const body = headLines.slice(openStart.startLine + 1);
        if (trimBlanks(body).length === 0) {
            headLines = headLines.slice(0, openStart.startLine);   // nothing left in it: no empty section
        } else {
            headLines = trimBlanks(headLines);
            headLines.push(`{end_of_${openStart.type}}`);
        }
    }
    headLines = trimBlanks(headLines);

    // tail: the rest of a partly covered section is re-opened with its own type and label
    let tailLines = all.slice(E + 1);
    const openEnd = explicitAt(E);
    let reopened = false;
    if (openEnd && E < openEnd.endLine) {
        const hasEnd = END_DIRECTIVE_RE.test((all[openEnd.endLine] || '').trim());
        const contentEnd = hasEnd ? openEnd.endLine - 1 : openEnd.endLine;
        const rest = all.slice(E + 1, contentEnd + 1);
        const after = all.slice(openEnd.endLine + 1);
        const restBody = trimBlanks(rest);
        if (restBody.length) {
            reopened = true;
            tailLines = [
                `{start_of_${openEnd.type}: ${openEnd.label}}`, ...restBody,
                hasEnd ? all[openEnd.endLine].trim() : `{end_of_${openEnd.type}}`,
                // blank lines that trailed an un-terminated section still separate it from what follows
                ...(hasEnd ? [] : rest.slice(rest.findLastIndex((l) => !isBlank(l)) + 1)),
                ...after,
            ];
        } else {
            tailLines = after;
        }
    }

    // auto-number positionally: count sections of this type ABOVE the
    // selection (implicit ones included), so wrapping the first lines gives
    // Verse 1 and wrapping below an existing verse gives Verse 2
    const lcType = type.toLowerCase();
    const headText = headLines.join('\n');
    const count = parseSong(headText).sections.filter((s) => s.type === lcType).length;
    const base = capitalize(lcType);
    const label = lcType === 'verse'
        ? `Verse ${count + 1}`
        : (count ? `${base} ${count + 1}` : base);

    // blank-line separation on both sides (serializeSong's convention):
    // exactly one blank line between the new section and its neighbors
    const head = headLines.length ? `${headText}\n\n` : '';
    const rest = reopened ? tailLines : (() => { const t = [...tailLines]; while (t.length && isBlank(t[0])) t.shift(); return t; })();
    const tailBody = rest.join('\n');
    const tail = tailBody.trim() === '' ? '\n' : `\n\n${tailBody}`;

    const block = `{start_of_${lcType}: ${label}}\n${lines.join('\n')}\n{end_of_${lcType}}`;
    const out = renumberVerses(head + block + tail, head.length);
    return {
        text: out,
        selStart: head.length,
        selEnd: head.length + block.length + (out.length - (head + block + tail).length)
    };
}

/** Auto-numbered `Verse N` labels from line `fromOffset` on become positional (1, 2, 3 ...). */
function renumberVerses(text, fromOffset) {
    const lines = text.split('\n');
    const { sections } = analyzeDocument(text);
    const fromLine = text.slice(0, fromOffset).split('\n').length - 1;
    let n = 0;
    for (const s of sections) {
        if (s.type !== 'verse') continue;
        n++;
        if (!s.explicit || s.startLine < fromLine || !AUTO_VERSE_RE.test(s.label)) continue;
        lines[s.startLine] = lines[s.startLine].replace(/:\s*[^}]*\}/, `: Verse ${n}}`);
    }
    return lines.join('\n');
}
