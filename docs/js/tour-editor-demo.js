// The lyrics & chords demo inside the feature tour (G14). Three tour steps
// play "Will the Circle Be Unbroken" into the REAL editor: the words typed in,
// sorted into sections with the section bar, then chorded in Chords mode with
// the chord picker. Each phase rings a real control and then presses it, so
// the visitor sees where the buttons are. Only two things go through the
// editor's `present` hooks, because a pointer does them and code cannot: a
// selection that shows the section bar without raising a phone's keyboard,
// and the chord box on a syllable.
//
// The words are the 1907 hymn (Ada R. Habershon, Charles H. Gabriel), public
// domain. The book also carries A.P. Carter's 1935 rewrite ("I was standing by
// my window"), which is likely still in copyright, and this copy ships in the
// site's code (Mike, 2026-10-27).
//
// Each phase starts from its own known state, so Back replays it and Next can
// skip ahead before the last one finished. Nothing is saved: the tour resets
// the editor when it leaves (main.js hands it resetEditorForNewSong).
//
// Lazy, like tour.js, which imports it. No module-level side effects.

export const DEMO_SONG = {
    title: 'Will the Circle Be Unbroken',
    writer: 'Ada R. Habershon, Charles H. Gabriel',
    key: 'G',
    verse: [
        'There are loved ones in the glory',
        'Whose dear forms you often miss',
        'When you close your earthly story',
        'Will you join them in their bliss?',
    ],
    // Chords written in place; the demo places them one at a time.
    chorus: [
        '[G]Will the circle be unbroken',
        'By and [C]by, by and [G]by?',
        'Is a better home awaiting',
        'In the sky, [D]in the [G]sky?',
    ],
};

const TYPE_MS = 70;      // per word
const LINE_MS = 160;     // per line break
const LOOK_MS = 900;     // a ring held on a control before it is pressed

/** A chorded line as its words plus where each chord goes: `{ lyric, marks: [{ at, chord }] }`. */
export function chordMarks(line) {
    const marks = [];
    let lyric = '';
    for (const part of line.split(/(\[[^\]]*\])/)) {
        if (part.startsWith('[') && part.endsWith(']')) marks.push({ at: lyric.length, chord: part.slice(1, -1) });
        else lyric += part;
    }
    return { lyric, marks };
}

const plain = (line) => chordMarks(line).lyric;

/** The song with its words typed and nothing else: the first phase's end, the second's start. */
export function typedText(song = DEMO_SONG) {
    return `{key: ${song.key}}\n${song.verse.join('\n')}\n\n${song.chorus.map(plain).join('\n')}`;
}

/** Document offsets [from, to) of a run of lines, found by the first line's words. */
export function linesRange(text, firstLine, count) {
    const lines = text.split('\n');
    const strip = (l) => l.replace(/\[[^\]]*\]/g, '');
    const i = lines.findIndex(l => strip(l) === firstLine);
    if (i < 0) return null;
    const from = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    const to = from + lines.slice(i, i + count).join('\n').length;
    return { from, to };
}

/**
 * Where the chord box goes for a chord at lyric offset `at` of the line whose
 * words are `lyric`: the document position of that letter, after any chord
 * already written there (chords placed earlier in the line shift the text).
 */
export function seamPos(text, lyric, at) {
    const lines = text.split('\n');
    let start = 0;
    for (const line of lines) {
        if (line.replace(/\[[^\]]*\]/g, '') === lyric) {
            let seen = 0;
            for (let i = 0; i <= line.length; i++) {
                if (line[i] === '[') { i = line.indexOf(']', i); continue; }
                if (seen === at) return start + i;
                seen++;
            }
            return null;
        }
        start += line.length + 1;
    }
    return null;
}

const typingField = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
};

/** The end of the document, where typing goes. */
const end = (lead) => lead.getText().length;

/** The screen box of document positions [from, to], with room for the chord row drawn above the lyric. */
function rangeRect(lead, from, to = from) {
    const view = lead.editor.view;
    const a = view.coordsAtPos(from);
    const b = view.coordsAtPos(to) || a;
    if (!a) return null;
    return { top: a.top - (a.bottom - a.top) * 1.4, bottom: b.bottom };
}

/**
 * The box around whole lines [from, to], for the tour's ring: the editor
 * draws no selection while it has no focus, and the demo must not focus it
 * (a phone would raise its keyboard), so the ring shows what is selected.
 */
function linesBox(lead, from, to) {
    const view = lead.editor.view;
    const doc = view.state.doc;
    let left = Infinity;
    let right = -Infinity;
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
        const line = doc.line(n);
        const s = view.coordsAtPos(line.from);
        const e = view.coordsAtPos(line.to);
        if (s) left = Math.min(left, s.left);
        if (e) right = Math.max(right, e.right);
    }
    const a = view.coordsAtPos(from);
    const b = view.coordsAtPos(to);
    if (!a || !b || left === Infinity) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    return { left, top: a.top, right, bottom: b.bottom, width: right - left, height: b.bottom - a.top };
}

/**
 * Phase 1: Add Song opens the editor; the words are typed in.
 *   ctx: { lead, reset, point, reveal, wait, reduced } (tour.js play())
 */
export async function writeIn({ lead, reset, point, reveal, wait, reduced }) {
    point(null);
    reset();
    lead.setMode('lyrics', { persist: false });
    typingField('editor-title', DEMO_SONG.title);
    typingField('editor-writer', DEMO_SONG.writer);
    lead.editor.change({ changes: { from: 0, insert: `{key: ${DEMO_SONG.key}}\n` } }, { userEvent: 'input.type' });

    const lines = [...DEMO_SONG.verse, '', ...DEMO_SONG.chorus.map(plain)];
    for (const [n, line] of lines.entries()) {
        const words = reduced ? [line] : line.split(/(?<= )/);
        for (const word of words) {
            if (word) lead.editor.change({ changes: { from: end(lead), insert: word } }, { userEvent: 'input.type' });
            if (!reduced && !await wait(TYPE_MS)) return;
        }
        if (n < lines.length - 1) {
            lead.editor.change({ changes: { from: end(lead), insert: '\n' } }, { userEvent: 'input.type' });
            if (!await wait(reduced ? 0 : LINE_MS)) return;
            reveal(rangeRect(lead, end(lead)));   // the line being typed stays out from under the card
        }
    }
}

/** Make sure the editor holds the typed words (a phase may start before the last one finished). */
function ensureTyped(lead) {
    lead.setMode('lyrics', { persist: false });
    typingField('editor-title', DEMO_SONG.title);
    typingField('editor-writer', DEMO_SONG.writer);
    if (lead.getText() !== typedText()) lead.setText(typedText());
}

/** Select a run of lines, ring the section bar's button for `type`, press it. */
async function markSection(lead, { point, reveal, wait }, firstLine, count, type, { fast = false } = {}) {
    const range = linesRange(lead.getText(), firstLine, count);
    if (!range) return false;
    lead.present.select(range.from, range.to);
    const button = `.le-selbar:not(.hidden) [data-wrap="${type}"]`;
    if (!fast) {
        if (!await wait(120)) return false;   // the bar places itself on the next frame
        reveal(rangeRect(lead, range.from, range.to));
        point({ rect: () => linesBox(lead, range.from, range.to) });   // "these lines"
        if (!await wait(LOOK_MS)) return false;
        point(button);
        if (!await wait(LOOK_MS)) return false;
    }
    document.querySelector(button)?.click();
    lead.present.end();
    point(null);
    return fast || await wait(600);
}

/** Phase 2: select the lines and tap Verse, then Chorus. */
export async function sortSections(ctx, { fast = false } = {}) {
    const { lead } = ctx;
    ensureTyped(lead);
    if (!await markSection(lead, ctx, DEMO_SONG.verse[0], DEMO_SONG.verse.length, 'verse', { fast })) return false;
    const chorusFirst = plain(DEMO_SONG.chorus[0]);
    if (!await markSection(lead, ctx, chorusFirst, DEMO_SONG.chorus.length, 'chorus', { fast })) return false;
    if (!fast) {
        ctx.point('#editor-lead .section-label');
        await ctx.wait(LOOK_MS);
        ctx.point(null);
    }
    return true;
}

/** Phase 3: switch to Chords, put the box on a syllable, tap a chord; down the chorus. */
export async function addChords(ctx) {
    const { lead, point, reveal, wait } = ctx;
    if (!/\{start_of_chorus/.test(lead.getText()) || /\[[^\]]*\]/.test(lead.getText())) {
        await sortSections(ctx, { fast: true });
    }
    point('#editor-mode-chords');
    if (!await wait(LOOK_MS)) return;
    // The demo's own mode change is not the reader's choice, so it is not remembered
    lead.setMode('chords', { persist: false });
    if (!await wait(500)) return;

    for (const line of DEMO_SONG.chorus) {
        const { lyric, marks } = chordMarks(line);
        for (const { at, chord } of marks) {
            const pos = seamPos(lead.getText(), lyric, at);
            if (pos == null) return;
            point(null);
            lead.present.boxAt(pos);
            if (!await wait(120)) return;      // the editor scrolls the box into view first
            reveal(rangeRect(lead, pos));
            if (!await wait(330)) return;
            const cell = `.chm-menu:not(.hidden) .chm-cell[data-chord="${chord}"]`;
            point(cell);
            if (!await wait(650)) return;
            document.querySelector(cell)?.click();
            if (!await wait(350)) return;
        }
    }
    point(null);
}
