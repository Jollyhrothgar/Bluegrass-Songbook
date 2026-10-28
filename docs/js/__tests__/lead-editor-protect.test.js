// @vitest-environment jsdom
// Triage fixes, at the document level: (1) user deletes never touch metadata or section directives,
// (2) the chord box never stands just BEFORE a chord token.
import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection, history, undo, redo } from '../../vendor/codemirror.js';
import { boxField, setBoxEffect, protectDirectivesFilter, typingRulesFilter } from '../lead-editor/cm-editor.js';
import { analyzeDocument, protectedSpans, backspaceRange, deleteForwardRange, normalizeCursor, chordAt } from '../lead-editor/doc-model.js';

const DOC = '{meta: title Old Home}\n{key: G}\n{start_of_verse: Verse 1}\nAma[G]zing grace\nhow sweet\n{end_of_verse}\n\n{start_of_chorus}\nsing it\n{end_of_chorus}';
const make = (doc) => EditorState.create({ doc, extensions: [boxField, history(), typingRulesFilter(() => true), protectDirectivesFilter(() => true)] });
const protectedLines = (text) => analyzeDocument(text).lines.filter((l) => l.kind === 'hidden' || l.kind === 'label' || l.kind === 'locked').map((l) => l.text);
const send = (st, spec, userEvent) => st.update({ ...spec, userEvent }).state;

describe('protectedSpans', () => {
    it('covers directive lines and the newlines that join them to their neighbours', () => {
        const spans = protectedSpans('{meta: title X}\nlyric\n{end_of_verse}');
        expect(spans).toEqual([[0, 16], [21, 36]]);
        const t = '{meta: title X}\nlyric\n{end_of_verse}';
        expect(t.slice(16, 21)).toBe('lyric');
    });
    it('a meta line is anchored: a lyric that merely contains "{meta: a b}" stays a lyric', () => {
        const a = analyzeDocument('hello {meta: a b} world');
        expect(a.lines[0].kind).toBe('lyric');
    });
});

describe('Backspace / Delete ranges stop at protected boundaries', () => {
    it('Backspace at the first lyric of a section does nothing', () => {
        const at = DOC.indexOf('Ama');
        expect(backspaceRange(DOC, at)).toBe(null);
    });
    it('Delete at the end of the last lyric of a section does nothing', () => {
        const at = DOC.indexOf('how sweet') + 'how sweet'.length;
        expect(deleteForwardRange(DOC, at)).toBe(null);
    });
    it('inside a lyric they still delete a letter', () => {
        const at = DOC.indexOf('grace') + 2;
        expect(backspaceRange(DOC, at)).toEqual({ from: at - 1, to: at });
    });
});

describe('user edits are clipped to the unprotected text', () => {
    const before = protectedLines(DOC);
    it('delete.backward at the first lyric, 50 times: nothing is merged or eaten', () => {
        let st = make(DOC);
        const at = DOC.indexOf('Ama');
        for (let i = 0; i < 50; i++) st = send(st, { changes: { from: at - 1, to: at } }, 'delete.backward');
        expect(st.doc.toString()).toBe(DOC);
        expect(protectedLines(st.doc.toString())).toEqual(before);
    });
    it('delete.forward at the end of the last lyric, repeatedly', () => {
        let st = make(DOC);
        const at = DOC.indexOf('how sweet') + 9;
        for (let i = 0; i < 50; i++) st = send(st, { changes: { from: at, to: at + 1 } }, 'delete.forward');
        expect(st.doc.toString()).toBe(DOC);
    });
    it('the keymap path: repeated backspaceRange at the first lyric deletes nothing', () => {
        let text = DOC;
        const at = DOC.indexOf('Ama');
        for (let i = 0; i < 50; i++) { const r = backspaceRange(text, at); if (r) text = text.slice(0, r.from) + text.slice(r.to); }
        expect(text).toBe(DOC);
    });
    it('select-all + Delete removes whole sections (labels too) and keeps only the metadata', () => {
        const st = send(make(DOC), { changes: { from: 0, to: DOC.length } }, 'delete.selection');
        expect(st.doc.toString()).toBe('{meta: title Old Home}\n{key: G}');
    });
    it('select-all + Delete with no metadata leaves an empty song', () => {
        const d = '{start_of_verse: Verse 1}\nline\n{end_of_verse}\n\n{start_of_chorus}\nsing\n{end_of_chorus}';
        expect(send(make(d), { changes: { from: 0, to: d.length } }, 'delete.selection').doc.toString()).toBe('');
    });
    it('select-all + paste replaces the old sections and keeps the metadata', () => {
        const st = send(make(DOC), { changes: { from: 0, to: DOC.length, insert: 'new words' } }, 'input.paste');
        expect(st.doc.toString()).toBe('{meta: title Old Home}\n{key: G}\nnew words');
    });
    it('select-all + Delete keeps locked blocks', () => {
        const d = '{meta: title X}\n{start_of_verse}\nhi\n{end_of_verse}\n\n{start_of_abc}\nX:1\n{end_of_abc}';
        const t = send(make(d), { changes: { from: 0, to: d.length } }, 'delete.selection').doc.toString();
        expect(t).toContain('{start_of_abc}');
        expect(t).toContain('{end_of_abc}');
        expect(t).not.toContain('start_of_verse');
        expect(t).not.toMatch(/\n{3,}/);
    });
    it('deleting one whole section in the middle leaves no pile of blank lines', () => {
        const from = DOC.indexOf('{start_of_verse');
        const to = DOC.indexOf('{end_of_verse}') + '{end_of_verse}'.length;
        const t = send(make(DOC), { changes: { from, to } }, 'delete.selection').doc.toString();
        expect(t).not.toContain('Verse 1');
        expect(t).toContain('{start_of_chorus}');
        expect(t).not.toMatch(/\n{3,}/);
    });
    it('a partial deletion keeps the labels: all lyric lines but not the label line', () => {
        const from = DOC.indexOf('Ama');
        const to = DOC.indexOf('{end_of_verse}');
        const t = send(make(DOC), { changes: { from, to } }, 'delete.selection').doc.toString();
        expect(protectedLines(t)).toEqual(before);
        expect(t).not.toMatch(/Ama|sweet/);
    });
    it('undo restores the removed sections', () => {
        let st = send(make(DOC), { changes: { from: 0, to: DOC.length } }, 'delete.selection');
        undo({ state: st, dispatch: (tr) => { st = tr.state; } });
        expect(st.doc.toString()).toBe(DOC);
    });
    it('cut of a selection spanning a directive removes only the lyrics in it', () => {
        const from = DOC.indexOf('grace');
        const to = DOC.indexOf('sing it') + 4;
        const st = send(make(DOC), { changes: { from, to } }, 'delete.cut');
        const text = st.doc.toString();
        expect(protectedLines(text)).toEqual(before);
        expect(text).toContain('Ama[G]zing ');
        expect(text).toContain(' it');
        expect(text).not.toContain('grace');
        expect(text).not.toContain('how sweet');
    });
    it('paste over a selection spanning a directive: the directive stays, the text lands where the selection began', () => {
        const from = DOC.indexOf('sweet');
        const to = DOC.indexOf('sing');
        const st = send(make(DOC), { changes: { from, to, insert: 'NEW' } }, 'input.paste');
        const text = st.doc.toString();
        expect(protectedLines(text)).toEqual(before);
        expect(text).toContain('how NEW');
        expect(text).toContain('{end_of_verse}');
    });
    it('typing inside a directive line is refused; typing at the end of a lyric is not', () => {
        const inside = DOC.indexOf('Verse 1');
        expect(send(make(DOC), { changes: { from: inside, insert: 'x' } }, 'input.type').doc.toString()).toBe(DOC);
        const end = DOC.indexOf('how sweet') + 9;
        expect(send(make(DOC), { changes: { from: end, insert: '!' } }, 'input.type').doc.toString()).toContain('how sweet!');
    });
    it('an unannotated edit of the {key:} line is clipped (programmatic edits carry Programmatic and are exempt)', () => {
        const from = DOC.indexOf('{key');
        let st = make(DOC);
        st = st.update({ changes: { from, to: from + 9, insert: '{key: D}' }, annotations: [], userEvent: 'input.key' }).state;
        // unannotated -> clipped: the key line is protected
        expect(st.doc.toString()).toBe(DOC);
    });
});

describe('a {comment} row (e.g. "Interlude" from a pasted chord sheet) can be deleted', () => {
    const d = '{start_of_verse: Verse 1}\nline one\n{end_of_verse}\n{comment: Interlude}\n\n{start_of_verse: Verse 2}\nline two\n{end_of_verse}';
    it('a selection over the whole row deletes it, and leaves no pile of blank lines', () => {
        const from = d.indexOf('{comment');
        const to = d.indexOf('{start_of_verse: Verse 2}');
        const t = send(make(d), { changes: { from, to } }, 'delete.selection').doc.toString();
        expect(t).not.toContain('Interlude');
        expect(t).toContain('{end_of_verse}\n\n{start_of_verse: Verse 2}');       // one blank line between sections, as usual
        expect(t).not.toMatch(/\n{3,}/);
    });
    it('a selection from inside the verse across the row takes the row and the lyric, keeps the verse\'s end', () => {
        const from = d.indexOf('one');
        const to = d.indexOf('{start_of_verse: Verse 2}');
        const t = send(make(d), { changes: { from, to } }, 'delete.selection').doc.toString();
        expect(t).not.toContain('Interlude');
        expect(t).toContain('{end_of_verse}');
    });
    it('a selection over only part of the row leaves it alone', () => {
        const from = d.indexOf('Interlude');
        const t = send(make(d), { changes: { from, to: from + 4 } }, 'delete.selection').doc.toString();
        expect(t).toBe(d);
    });
    it('a tab block is still never deleted from Lyrics mode', () => {
        const t2 = '{start_of_tab}\ne|---|\n{end_of_tab}\n{comment: Interlude}';
        const t = send(make(t2), { changes: { from: 0, to: t2.length } }, 'delete.selection').doc.toString();
        expect(t).toContain('{start_of_tab}');
        expect(t).not.toContain('Interlude');
    });
});

describe('one place per letter: the box never stands just before a chord', () => {
    // a seeded fuzz over place / move / remove / undo / redo / jump
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    it('after every transaction text.slice(box.pos) never starts with "[" for a real box', () => {
        let st = EditorState.create({ doc: 'Over the hill [A]and\n[G]far away\nsing a song', extensions: [boxField, history()] });
        const check = () => {
            const b = st.field(boxField);
            if (!b || b.after || b.newLine) return;
            expect(st.doc.sliceString(b.pos).startsWith('[')).toBe(false);
        };
        for (let i = 0; i < 3000; i++) {
            const text = st.doc.toString();
            const b = st.field(boxField);
            const op = rnd(7);
            if (op === 0 || !b) {
                st = st.update({ effects: setBoxEffect.of({ pos: rnd(text.length + 1), active: true }) }).state;
            } else if (op === 1) {
                st = st.update({ changes: { from: b.pos, insert: `[${'ABCDEFG'[rnd(7)]}]` }, userEvent: 'input.chord' }).state;
            } else if (op === 2) {
                const at = chordAt(text, b.pos);
                if (at) st = st.update({ changes: { from: at.from, to: at.to }, userEvent: 'delete.chord' }).state;
            } else if (op === 3) {
                const at = chordAt(text, b.pos);
                if (at) {
                    const to = rnd(text.length + 1);
                    const removed = text.slice(0, at.from) + text.slice(at.to);
                    const tp = Math.min(to, removed.length);
                    st = st.update({ changes: [{ from: at.from, to: at.to }, { from: to, insert: at.to <= to || to <= at.from ? `[${at.chord}]` : '' }], userEvent: 'input.chord.move' }).state;
                    void tp;
                }
            } else if (op === 4) {
                undo({ state: st, dispatch: (tr) => { st = tr.state; } });
            } else if (op === 5) {
                redo({ state: st, dispatch: (tr) => { st = tr.state; } });
            } else {
                st = st.update({ effects: setBoxEffect.of({ pos: Math.max(0, b.pos - 1), active: true }) }).state;
            }
            check();
        }
    });
    it('normalizeCursor is idempotent', () => {
        const t = 'a[G][C]b\n[D]c';
        for (let p = 0; p <= t.length; p++) expect(normalizeCursor(t, normalizeCursor(t, p))).toBe(normalizeCursor(t, p));
    });
});
