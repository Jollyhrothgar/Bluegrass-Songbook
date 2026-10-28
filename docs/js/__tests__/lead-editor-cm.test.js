// @vitest-environment jsdom
// Visual-mode decoration building and the typing rule, on a bare EditorState
// (no view, no layout): which ranges become segments / labels / hidden.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorState } from '../../vendor/codemirror.js';
import { buildVisual, buildSource, boxField, setBoxEffect, typingRulesFilter } from '../lead-editor/cm-editor.js';

const ctx = { display: (c) => c, onSectionLabel() {} };

function spans(set) {
    const out = [];
    set.between(0, 1e6, (from, to, v) => { out.push({ from, to, spec: v.spec }); });
    return out;
}
const state = (doc) => EditorState.create({ doc, extensions: [boxField] });

describe('buildVisual', () => {
    const doc = '{meta: title X}\n{start_of_chorus: Chorus}\nAma[G]zing [D]grace\nplain line\n{end_of_chorus}';
    const { deco, atomic } = buildVisual(state(doc), ctx);
    const all = spans(deco);
    const classOf = (s) => s.spec.class || '';

    it('hides the meta and end directives and replaces the start with a label', () => {
        const blocks = all.filter((s) => s.spec.block && s.spec.widget);
        expect(blocks.map((b) => doc.slice(b.from, b.to))).toEqual([
            '{meta: title X}', '{start_of_chorus: Chorus}', '{end_of_chorus}',
        ]);
    });
    it('wraps each chord-to-next-chord range in a segment, prefix text included', () => {
        const segs = all.filter((s) => classOf(s) === 'cl-segment').map((s) => doc.slice(s.from, s.to));
        expect(segs).toEqual(['Ama', '[G]zing ', '[D]grace']);
    });
    it('replaces each chord token with a label widget', () => {
        const chordRanges = all.filter((s) => s.spec.widget && !s.spec.block && s.to > s.from).map((s) => doc.slice(s.from, s.to));
        expect(chordRanges).toEqual(['[G]', '[D]']);
    });
    it('lines with chords get .cl-line; chordless lines are plain; chorus lines indent', () => {
        const lines = all.filter((s) => classOf(s).includes('song-line'));
        expect(lines.length).toBe(2);
        expect(classOf(lines[0])).toContain('cl-line');
        expect(classOf(lines[0])).toContain('section-indent');
        expect(classOf(lines[1])).not.toContain('cl-line');
        expect(classOf(lines[1])).toContain('cl-last');
    });
    it('hidden ranges are atomic (the caret skips them)', () => {
        const n = spans(atomic).length;
        expect(n).toBe(5); // 3 directive blocks + 2 chords
    });
    it('locks ABC blocks and comments as blocks, drawn in place', () => {
        const d = '{start_of_abc}\nX:1\n{end_of_abc}\n{comment: Capo 2}\nWords';
        const b = spans(buildVisual(state(d), ctx).deco).filter((s) => s.spec.block && s.to > s.from);
        expect(b.map((x) => d.slice(x.from, x.to))).toEqual(['{start_of_abc}\nX:1\n{end_of_abc}', '{comment: Capo 2}']);
    });
    it('draws a label above the first line of an untagged verse', () => {
        const widgets = spans(buildVisual(state('Just words\n\nMore'), ctx).deco).filter((s) => s.spec.block);
        expect(widgets.length).toBe(2);
    });
});

describe('buildSource', () => {
    it('colours chords and dims directives', () => {
        const set = buildSource(state('{key: G}\n[G]hi'));
        const cls = spans(set).map((s) => s.spec.class);
        expect(cls).toEqual(['cm-directive', 'cm-chordtok']);
    });
});

describe('typing rule: text typed at a chord goes before it', () => {
    const filter = typingRulesFilter(() => true);
    const make = (doc) => EditorState.create({ doc, extensions: [filter] });
    it('moves an insertion that lands after a chord in front of it', () => {
        const s = make('Ama[G]zing');
        const caret = 'Ama[G]'.length;
        const next = s.update({ changes: { from: caret, insert: 'x' }, selection: { anchor: caret + 1 }, userEvent: 'input.type' }).state;
        expect(next.doc.toString()).toBe('Amax[G]zing');
        expect(next.selection.main.head).toBe(4);
    });
    it('leaves other insertions alone', () => {
        const s = make('Ama[G]zing');
        const next = s.update({ changes: { from: 2, insert: 'x' }, userEvent: 'input.type' }).state;
        expect(next.doc.toString()).toBe('Amxa[G]zing');
    });
    it('does not apply to programmatic edits (placing a chord)', () => {
        const s = make('Ama[G]zing');
        const next = s.update({ changes: { from: 6, insert: '[D]' } }).state;
        expect(next.doc.toString()).toBe('Ama[G][D]zing');
    });
    it('a typed line break goes before the chord too (the chord stays with its syllable)', () => {
        const s = make('Ama[G]zing');
        const next = s.update({ changes: { from: 6, insert: '\n' }, userEvent: 'input.type' }).state;
        expect(next.doc.toString()).toBe('Ama\n[G]zing');
    });
});

describe('the chord label is a block with an inner glyph (the box paints only the glyph)', () => {
    it('ChordWidget draws .cl-chord > .cl-chord-glyph, and escapes the chord text', () => {
        const { deco } = buildVisual(state('A[G]b [<img src=x onerror=alert(1)>]c'), ctx);
        const widgets = [];
        deco.between(0, 1e6, (f, t, v) => { if (v.spec.widget && !v.spec.block && t > f) widgets.push(v.spec.widget.toDOM()); });
        expect(widgets[0].classList.contains('cl-chord')).toBe(true);
        expect(widgets[0].querySelector('.cl-chord-glyph').textContent).toBe('G');
        expect(widgets[1].querySelector('img')).toBe(null);
    });
});

describe('the box after the words and on a pending chord line', () => {
    // buildVisual only reads state.doc and the box field: hand it a state whose box is `box`
    const withBox = (doc, box) => ({ doc: EditorState.create({ doc }).doc, field: () => box });
    const decos = (doc, box) => {
        const st = withBox(doc, box);
        const out = [];
        buildVisual(st, ctx).deco.between(0, 1e6, (from, to, v) => out.push({ from, to, spec: v.spec }));
        return out;
    };
    it('an `after` box draws the slot pill at the end of the line, and boxes no chord', () => {
        const d = decos('old home [D]', { pos: 12, active: true, after: 1 });
        const slot = d.find((x) => x.spec.widget?.after);
        expect(slot.from).toBe(12);
        expect(slot.spec.widget.toDOM().className).toContain('cl-slot-after');
        const chord = d.find((x) => x.spec.widget && x.spec.widget.chord === 'D');
        expect(chord.spec.widget.boxed).toBe(false);
    });
    it('a pending chord line is a block widget after its line, drawn like the book\'s chord row (and writes nothing)', () => {
        const doc = 'one\ntwo';
        const w = decos(doc, { pos: 3, active: true, newLine: true }).find((x) => x.spec.block && x.spec.side === 1);
        expect(w.from).toBe(3);
        const el = w.spec.widget.toDOM();
        expect(el.className).toContain('cl-newline');
        expect(el.querySelector('.cl-line .cl-segment .cl-chord .cl-slot-pill')).not.toBe(null);
    });
});

describe('no vertical margin inside the editor (it breaks CodeMirror\'s height map)', () => {
    const css = readFileSync(resolve(process.cwd(), 'docs/css/style.css'), 'utf8');
    const block = css.slice(css.indexOf('Lead-sheet editor (js/lead-editor/)'));
    const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const zero = (v) => /^0(px|rem|em)?$/.test(v);
    const nonZeroVerticalMargin = (body) => [...body.matchAll(/(?:^|[;\s])margin(-top|-bottom|-left|-right)?\s*:\s*([^;]+)/g)].some(([, side, value]) => {
        const v = value.trim().split(/\s+/);
        if (side === '-top' || side === '-bottom') return !zero(v[0]);
        if (side) return false;
        const [top, right = top, bottom = top] = v;   // shorthand: top, right/left, bottom
        return !zero(top) || !zero(bottom) || right === undefined;
    });
    it('the editor stylesheet gives .cm-line and the block widgets no vertical margin', () => {
        const offenders = rules.filter((r) => /\.le-cm/.test(r.sel) && /\.(cm-line|cl-label-row|cl-locked|cl-hidden)\b/.test(r.sel)
            && nonZeroVerticalMargin(r.body)).map((r) => r.sel);
        expect(offenders).toEqual([]);
    });
    it('the book\'s spacing is kept as padding', () => {
        const get = (sel) => rules.find((r) => r.sel === sel)?.body || '';
        expect(get('.le-cm .cm-line.song-line')).toMatch(/padding-bottom:\s*0\.25rem/);
        expect(get('.le-cm .cm-line.song-line.cl-last')).toMatch(/padding-bottom:\s*1\.5rem/);
    });
});

describe('the cursor only stands on stops', () => {
    const doc = 'Many long years ago';
    const boxOn = (pos, extra = {}) => {
        const st = EditorState.create({ doc, extensions: [boxField] }).update({ effects: setBoxEffect.of({ pos, active: true, ...extra }) }).state;
        return { st, deco: buildVisual(st, ctx).deco };
    };
    it('a box set mid-syllable snaps to the syllable start and outlines the whole syllable', () => {
        const mid = doc.indexOf('years') + 2;
        const { st, deco } = boxOn(mid);
        expect(st.field(boxField).pos).toBe(doc.indexOf('years'));
        const outlined = spans(deco).filter((x) => (x.spec.class || '') === 'cl-box-text');
        expect(outlined).toHaveLength(1);
        expect(doc.slice(outlined[0].from, outlined[0].to)).toBe('years');
    });
    it('a box in the gap between words has the bar and NO text outline', () => {
        const gapPos = doc.indexOf('years') + 5;
        const { st, deco } = boxOn(gapPos);
        expect(st.field(boxField).pos).toBe(gapPos);
        expect(spans(deco).filter((x) => (x.spec.class || '') === 'cl-box-text')).toHaveLength(0);
        const slot = spans(deco).find((x) => x.spec.widget?.gap);
        expect(slot).toBeTruthy();
        expect(slot.from).toBe(gapPos);
    });
    it('a box on a non-gap space snaps to a stop', () => {
        const t = 'a  b';
        const st = EditorState.create({ doc: t, extensions: [boxField] }).update({ effects: setBoxEffect.of({ pos: 2, active: true }) }).state;
        expect([1, 3]).toContain(st.field(boxField).pos);
    });
});
