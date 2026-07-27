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

// start/end of any section, long or short form ({sov}/{eoc}...), any label
const SECTION_DIRECTIVE_RE =
    /^\{(?:start_of_\w+(?::[^}]*)?|end_of_\w+|so[vcb](?::[^}]*)?|eo[vcb])\s*\}$/i;

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Wrap the lines covered by [selStart, selEnd] in a new section of `type`.
 * Returns { text, selStart, selEnd } — the new document text plus a
 * selection spanning the inserted block — or null for a no-op.
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

    const before = text.slice(0, start);
    const after = text.slice(end);

    // strip section directives inside the range; keep blanks off the edges
    const lines = text.slice(start, end).split('\n')
        .filter(l => !SECTION_DIRECTIVE_RE.test(l.trim()));
    while (lines.length && lines[0].trim() === '') lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length === 0) return null;   // nothing but blanks/directives

    // auto-number positionally: count sections of this type ABOVE the
    // selection (implicit ones included), so wrapping the first lines gives
    // Verse 1 and wrapping below an existing verse gives Verse 2
    const lcType = type.toLowerCase();
    const count = parseSong(before)
        .sections.filter(s => s.type === lcType).length;
    const base = capitalize(lcType);
    const label = lcType === 'verse'
        ? `Verse ${count + 1}`
        : (count ? `${base} ${count + 1}` : base);

    // blank-line separation on both sides (serializeSong's convention):
    // exactly one blank line between the new section and its neighbors
    let head = before.trim() === '' ? '' : before.replace(/(\n[ \t]*)+$/, '\n') + '\n';
    let tail = after.replace(/^([ \t]*\n)+/, '');
    tail = tail.trim() === '' ? '\n' : '\n\n' + tail;

    const block = `{start_of_${lcType}: ${label}}\n${lines.join('\n')}\n{end_of_${lcType}}`;
    return {
        text: head + block + tail,
        selStart: head.length,
        selEnd: head.length + block.length
    };
}
