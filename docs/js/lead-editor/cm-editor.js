// The lead-sheet editor surface: ONE CodeMirror 6 view whose document is the
// ChordPro text. Lyrics and Chords modes are the same 'visual' decorations (Chords is just
// not editable); ChordPro mode is `chordpro`. Two decoration sets are the same document with different decorations:
//
//   visual   (Lyrics and Chords modes) [G] hidden and drawn as the book's .cl-chord label, each
//            chord-to-next-chord range wrapped in the book's .cl-segment,
//            section directives drawn as the book's .section-label, meta and
//            end directives hidden, ABC / comments / tab locked. Reusing the
//            book's classes and stylesheet is what makes it look like the
//            song page by construction.
//   chordpro the source, lightly highlighted.
//
// A Compartment swaps the mode, so switching keeps the document, the undo
// history and the caret. See doc-model.js for the (pure) rules this applies.

import {
    EditorState, EditorSelection, Compartment, StateField, StateEffect, Annotation, Transaction, Prec,
    EditorView, Decoration, WidgetType, keymap,
    history, historyKeymap, defaultKeymap, undo, redo, undoDepth, redoDepth,
} from '../../vendor/codemirror.js';
import { chordGlyphHtml } from '../chords.js';
import {
    analyzeDocument, countChords, insertionPoint, backspaceRange, deleteForwardRange,
    chordAt, lineSeams, syllableEnd, snapCursor, stopKindAt, unprotectedPieces, protectedSpans, clipDeletion, CHORD_TOKEN,
} from './doc-model.js';

/** The userEvent of one step of a cursor drag that carries a chord (see `dragJoin` in createLeadEditor). */
export const DRAG_EVENT = 'input.type.chorddrag';

/** Transactions the editor itself makes: exempt from the typing rules. */
export const Programmatic = Annotation.define();

export const setBoxEffect = StateEffect.define();      // { pos, active, ghost } | null
const refreshEffect = StateEffect.define();     // rebuild decorations (display change)

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

class ChordWidget extends WidgetType {
    constructor(chord, display, boxed, pad, beforeChord) { super(); this.chord = chord; this.display = display; this.boxed = boxed; this.pad = pad; this.beforeChord = !!beforeChord; }
    eq(o) { return o.chord === this.chord && o.display === this.display && o.boxed === this.boxed && o.pad === this.pad && o.beforeChord === this.beforeChord; }
    toDOM() {
        const el = document.createElement('span');
        el.className = 'cl-chord' + (this.boxed ? ' cl-box-chord' : '');
        el.dataset.chord = this.chord;
        // the glyph sits in its own inline span: the box highlight paints just the
        // chord's letters, not the book's full-width block
        const glyph = document.createElement('span');
        glyph.className = 'cl-chord-glyph';
        glyph.innerHTML = chordGlyphHtml(this.display);   // the ONLY path chord text takes into HTML (escapes it)
        el.appendChild(glyph);
        if (!this.pad) return el;
        // a segment with no text of its own (CodeMirror drops a mark that covers
        // only a replaced range): the widget is the whole segment, one text row tall as in the book
        const wrap = document.createElement('span');
        // right before another chord (`[A][D]...`) it keeps a gap, as the book's renderer marks it
        wrap.className = this.beforeChord ? 'cl-segment cl-before-chord' : 'cl-segment';
        wrap.append(el, '\u00A0');
        return wrap;
    }
    ignoreEvent() { return false; }
}

/** The empty chord row over text that precedes a line's first chord. */
class GapWidget extends WidgetType {
    eq() { return true; }
    toDOM() {
        const el = document.createElement('span');
        el.className = 'cl-chord cl-chord-gap';
        el.textContent = ' ';
        return el;
    }
    ignoreEvent() { return false; }
}

/** Keeps a segment whose text is empty as wide as the book draws it. */
class PadWidget extends WidgetType {
    eq() { return true; }
    toDOM() { const el = document.createElement('span'); el.textContent = ' '; return el; }
}

/** The box where no chord sits yet: a dashed pill above the syllable (ghost text while typing). */
class SlotWidget extends WidgetType {
    constructor(ghost, invalid, after, gap) { super(); this.ghost = ghost || ''; this.invalid = !!invalid; this.after = !!after; this.gap = !!gap; }
    eq(o) { return o.ghost === this.ghost && o.invalid === this.invalid && o.after === this.after && o.gap === this.gap; }
    toDOM() {
        const el = document.createElement('span');
        el.className = 'cl-slot' + (this.invalid ? ' cl-slot-invalid' : '') + (this.after ? ' cl-slot-after' : '') + (this.gap ? ' cl-slot-gap' : '');
        if (this.gap) {
            // the cursor between two words: a slim bar across the chord row and the lyric row (no text outline)
            const bar = document.createElement('span');
            bar.className = 'cl-gap-bar';
            el.appendChild(bar);
        }
        const pill = document.createElement('span');
        pill.className = 'cl-slot-pill';
        pill.innerHTML = this.ghost ? chordGlyphHtml(this.ghost) : '';
        el.appendChild(pill);
        if (this.after) {
            // the empty place after the words is outlined on the LYRIC row too, as a syllable is (absolute: it takes no
            // width and cannot wrap the line, so the stops measure the same with the cursor here or not)
            const text = document.createElement('span');
            text.className = 'cl-slot-text';
            el.appendChild(text);
        }
        return el;
    }
    ignoreEvent() { return true; }
}

/**
 * An empty chord line the cursor is on (Add chord line): drawn as the book draws a chord-only
 * row, with the slot pill in its first place. Virtual: the document has no such line yet.
 * Vertical space is PADDING (the height map ignores margins).
 */
class NewLineWidget extends WidgetType {
    constructor(ghost, invalid, indent) { super(); this.ghost = ghost || ''; this.invalid = !!invalid; this.indent = !!indent; }
    eq(o) { return o.ghost === this.ghost && o.invalid === this.invalid && o.indent === this.indent; }
    toDOM() {
        const root = document.createElement('div');
        root.className = 'cl-newline' + (this.indent ? ' section-indent' : '');
        const line = document.createElement('div');
        line.className = 'song-line cl-line cl-has-box';
        const seg = document.createElement('span');
        seg.className = 'cl-segment';
        const chord = document.createElement('span');
        chord.className = 'cl-chord';
        chord.appendChild(new SlotWidget(this.ghost, this.invalid, true).toDOM());
        seg.append(chord, '\u00A0');
        line.appendChild(seg);
        root.appendChild(line);
        return root;
    }
    ignoreEvent() { return true; }
}

class EmptyWidget extends WidgetType {
    eq() { return true; }
    toDOM() { const el = document.createElement('div'); el.className = 'cl-hidden'; return el; }
}

class LabelWidget extends WidgetType {
    constructor(section, ctx) { super(); this.s = section; this.ctx = ctx; }
    eq(o) { return o.s.label === this.s.label && o.s.indent === this.s.indent && o.s.startLine === this.s.startLine && o.s.explicit === this.s.explicit; }
    toDOM() {
        const wrap = document.createElement('div');
        wrap.className = 'song-section cl-label-row' + (this.s.indent ? ' section-indent' : '');
        const el = document.createElement('div');
        el.className = 'section-label';
        el.textContent = this.s.label;
        el.setAttribute('role', 'button');
        el.title = 'Section options';
        el.addEventListener('mousedown', (e) => e.preventDefault());
        el.addEventListener('click', (e) => { e.preventDefault(); this.ctx.onSectionLabel?.(this.s, el); });
        wrap.appendChild(el);
        return wrap;
    }
    ignoreEvent() { return true; }
}

class LockedWidget extends WidgetType {
    constructor(block) { super(); this.b = block; }
    eq(o) { return o.b.type === this.b.type && o.b.text === this.b.text; }
    toDOM() {
        // vertical space is PADDING on the widget root, never a margin: CodeMirror's
        // height map measures boxes, and margins are not in the box
        const root = document.createElement('div');
        root.className = 'cl-locked';
        const el = document.createElement('div');
        root.appendChild(el);
        if (this.b.type === 'comment') {
            el.className = 'song-comment';
            el.textContent = this.b.text;
            return root;
        }
        el.className = 'cl-locked-block';
        const title = document.createElement('div');
        title.className = 'cl-locked-title';
        title.textContent = (this.b.type === 'abc' ? 'Notation' : this.b.type === 'tab' ? 'Tab' : 'Grid')
            + ' — edit in ChordPro';
        const pre = document.createElement('pre');
        pre.className = 'section-preformatted';
        pre.textContent = this.b.text;
        el.append(title, pre);
        return root;
    }
    ignoreEvent() { return true; }
}

// ---------------------------------------------------------------------------
// Decorations
// ---------------------------------------------------------------------------

/**
 * Build Visual mode's decorations from the text. Returns { deco, atomic }:
 * `atomic` is the set of replaced ranges the caret must skip as one unit.
 * Pure of the DOM (widgets are lazy), exported for tests.
 */
export function buildVisual(state, ctx) {
    const text = state.doc.toString();
    const a = analyzeDocument(text);
    const rawBox = state.field(boxField);
    const box = rawBox && !rawBox.newLine ? rawBox : null;     // the box on a lyric line
    const decos = [];
    const atomic = [];
    const replace = (from, to, spec) => {
        if (to <= from) return;
        const d = Decoration.replace(spec);
        decos.push(d.range(from, to));
        atomic.push(d.range(from, to));
    };

    const blockLines = new Set();
    for (const b of a.blocks) {
        replace(b.from, b.to, { widget: new LockedWidget(b), block: true });
        for (const l of a.lines) if (l.from >= b.from && l.to <= b.to) blockLines.add(l.index);
    }

    for (const line of a.lines) {
        if (blockLines.has(line.index)) continue;
        if (line.kind === 'hidden') {
            replace(line.from, line.to, { widget: new EmptyWidget(), block: true });
        } else if (line.kind === 'label') {
            replace(line.from, line.to, { widget: new LabelWidget(line.section, ctx), block: true });
        } else if (line.kind === 'blank') {
            decos.push(Decoration.line({ class: 'cl-blank' }).range(line.from));
        } else if (line.kind === 'lyric') {
            if (line.implicitLabel) {
                decos.push(Decoration.widget({ widget: new LabelWidget(line.implicitLabel, ctx), block: true, side: -1 }).range(line.from));
            }
            decodeLyricLine(state, line, ctx, decos, replace, box);
        }
    }

    // the box on a syllable with no chord yet, or in the empty slot after the words; between two words
    // (a GAP stop) it is always drawn, as a slim bar (the dashed pill only appears for typed-entry ghost text)
    if (box && box.pos != null && box.pos <= text.length) {
        const gap = !box.after && stopKindAt(text, box.pos) === 'gap';
        if (gap || box.after || box.ghost || !chordAt(text, box.pos)) {
            decos.push(Decoration.widget({ widget: new SlotWidget(box.ghost, box.invalid, box.after, gap), side: -1 }).range(box.pos));
        }
    }
    // the box on an empty chord line, drawn below the line that ends at box.pos
    if (rawBox?.newLine && rawBox.pos != null && rawBox.pos <= text.length) {
        const host = a.lines.find((l) => rawBox.pos >= l.from && rawBox.pos <= l.to);
        decos.push(Decoration.widget({
            widget: new NewLineWidget(rawBox.ghost, rawBox.invalid, !!host?.section?.indent), block: true, side: 1,
        }).range(rawBox.pos));
    }
    return { deco: Decoration.set(decos, true), atomic: Decoration.set(atomic, true) };
}

function decodeLyricLine(state, line, ctx, decos, replace, box) {
    const text = state.doc.toString();
    const chords = [...line.text.matchAll(CHORD_TOKEN)];
    const section = line.section;
    const cls = ['song-line'];
    const hasBox = !!box && box.pos != null && box.pos >= line.from && box.pos <= line.to;
    if (chords.length || hasBox) cls.push('cl-line');
    if (hasBox) cls.push('cl-has-box');
    if (section?.indent) cls.push('section-indent');
    if (line.sectionLast) cls.push('cl-last');
    decos.push(Decoration.line({ class: cls.join(' ') }).range(line.from));
    if (!chords.length) {
        if (box && box.pos != null && box.pos >= line.from && box.pos <= line.to) boxText(text, box, decos);
        return;
    }

    // inclusiveStart: the chord widget at a segment's start belongs INSIDE the span
    const segment = Decoration.mark({ class: 'cl-segment', inclusiveStart: true });
    const firstFrom = line.from + chords[0].index;
    if (firstFrom > line.from) {
        decos.push(segment.range(line.from, firstFrom));
        decos.push(Decoration.widget({ widget: new GapWidget(), side: 1 }).range(line.from));
    }
    chords.forEach((m, i) => {
        const from = line.from + m.index;
        const to = from + m[0].length;
        const end = i + 1 < chords.length ? line.from + chords[i + 1].index : line.to;
        const boxed = !!box && !box.after && box.pos === to;
        replace(from, to, { widget: new ChordWidget(m[1], ctx.display(m[1]), boxed, end === to, end === to && i + 1 < chords.length) });
        if (end > to) decos.push(segment.range(from, end));
    });
    if (box && box.pos != null && box.pos >= line.from && box.pos <= line.to) boxText(text, box, decos);
}

function boxText(text, box, decos) {
    if (box.after) return;
    const end = syllableEnd(text, box.pos);
    if (end > box.pos) decos.push(Decoration.mark({ class: 'cl-box-text' }).range(box.pos, end));
}

/** ChordPro mode: chords coloured, directives dimmed. */
export function buildSource(state) {
    const decos = [];
    for (let n = 1; n <= state.doc.lines; n++) {
        const line = state.doc.line(n);
        const t = line.text.trim();
        if (t.startsWith('{') && t.endsWith('}')) {
            decos.push(Decoration.mark({ class: 'cm-directive' }).range(line.from, line.to));
            continue;
        }
        for (const m of line.text.matchAll(CHORD_TOKEN)) {
            decos.push(Decoration.mark({ class: 'cm-chordtok' }).range(line.from + m.index, line.from + m.index + m[0].length));
        }
    }
    return Decoration.set(decos, true);
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

/**
 * The single normalisation step (doc-model `snapCursor`): a real (non-virtual) cursor snaps to the nearest stop
 * (syllable start, gap between words, or the slot after the words), standing AFTER the chords there.
 */
function fixBox(box, doc) {
    if (!box || box.after || box.newLine || box.pos == null) return box;
    const snapped = snapCursor(doc.toString(), box.pos);
    if (snapped.pos === box.pos && !snapped.after) return box;
    return { ...box, pos: snapped.pos, ...(snapped.after ? { after: 1 } : {}) };
}

export const boxField = StateField.define({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setBoxEffect)) return fixBox(e.value, tr.state.doc);
        if (value && tr.docChanged) {
            // assoc 1: a chord inserted at the box leaves the box AFTER it
            return fixBox({ ...value, pos: tr.changes.mapPos(value.pos, 1) }, tr.state.doc);
        }
        return value;
    },
});

/**
 * Text typed where a chord sits goes BEFORE the chord, so the chord stays on
 * its syllable. A transaction filter: a single typed/pasted insertion that
 * lands right after chord tokens is moved in front of them.
 */
export function typingRulesFilter(isVisual) {
    return EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || tr.annotation(Programmatic) || !isVisual()) return tr;
        if (!(tr.isUserEvent('input') || tr.isUserEvent('paste'))) return tr;
        const changes = [];
        tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => changes.push({ fromA, toA, inserted }));
        if (changes.length !== 1 || changes[0].fromA !== changes[0].toA || !changes[0].inserted.length) return tr;
        const text = tr.startState.doc.toString();
        const p = insertionPoint(text, changes[0].fromA);
        if (p === changes[0].fromA) return tr;
        const insert = changes[0].inserted.toString();
        return {
            changes: { from: p, to: p, insert },
            selection: EditorSelection.cursor(p + insert.length),
            userEvent: tr.annotation(Transaction.userEvent) || 'input.type',
            scrollIntoView: true,
        };
    });
}

/**
 * Metadata and section directives are protected by the DOCUMENT, not by how they are drawn (atomicRanges
 * only affect caret motion; a phone's native delete, select-all+Delete, cut and paste-over bypass the
 * keymap). A user edit (input / delete / paste / cut / drop) is CLIPPED to the unprotected spans: the
 * lyrics a selection covers still go, the `{meta:}` / `{start_of_*}` / `{end_of_*}` lines and the newlines
 * that join them do not. Programmatic edits (section ops, chord ops, setText) and undo/redo are exempt.
 */
export function protectDirectivesFilter(isVisual) {
    return EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || tr.annotation(Programmatic) || !isVisual()) return tr;
        if (tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr;
        if (!(tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('paste') || tr.isUserEvent('move') || tr.isUserEvent('drop'))) return tr;
        const text = tr.startState.doc.toString();
        const spans = protectedSpans(text);
        if (!spans.length) return tr;
        const out = [];
        let clipped = false;
        tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            const insert = inserted.toString();
            if (toA === fromA) {                                   // a pure insertion
                const inside = spans.some(([a, b]) => fromA > a && fromA < b);
                if (inside) { clipped = true; return; }
                out.push({ from: fromA, to: toA, insert });
                return;
            }
            const cs = clipDeletion(text, fromA, toA, insert);
            if (cs.length === 1 && cs[0].from === fromA && cs[0].to === toA && cs[0].insert === insert) { out.push(cs[0]); return; }
            clipped = true;
            out.push(...cs);
        });
        if (!clipped) return tr;
        return {
            changes: out,
            userEvent: tr.annotation(Transaction.userEvent) || 'delete',
            scrollIntoView: true,
        };
    });
}

/**
 * @param {object} o
 * @param {HTMLElement} o.parent
 * @param {string} [o.doc]
 * @param {'visual'|'chordpro'} [o.mode]
 * @param {(chord: string) => string} [o.displayChord]   Nashville etc., display only
 * @param {object} [o.hooks]  { onChange, onSelection, onSectionLabel, onChordsRemoved, onMouseDown, onClick, onPaste }
 */
export function createLeadEditor({ parent, doc = '', mode = 'visual', displayChord, hooks = {} }) {
    const modeCompartment = new Compartment();
    const editableCompartment = new Compartment();
    let editable = true;
    let currentMode = mode;
    // The steps of one drag are one undo step. CodeMirror only joins `input.type*` / `delete*` events,
    // so the drag's userEvent is input.type.chorddrag; a step joins when the last one was just now.
    let dragJoin = false;
    let dragUntil = 0;
    let display = displayChord || ((c) => c);
    const ctx = { display: (c) => display(c), onSectionLabel: (...a) => hooks.onSectionLabel?.(...a) };

    const visualField = StateField.define({
        create: (state) => buildVisual(state, ctx),
        update(value, tr) {
            const boxChanged = tr.startState.field(boxField) !== tr.state.field(boxField);
            if (tr.docChanged || boxChanged || tr.effects.some((e) => e.is(refreshEffect))) return buildVisual(tr.state, ctx);
            return value;
        },
        provide: (f) => [
            EditorView.decorations.from(f, (v) => v.deco),
            EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
        ],
    });
    const sourceField = StateField.define({
        create: (state) => buildSource(state),
        update: (value, tr) => (tr.docChanged ? buildSource(tr.state) : value),
        provide: (f) => EditorView.decorations.from(f),
    });

    const typingRules = typingRulesFilter(() => currentMode === 'visual');
    const protectRules = protectDirectivesFilter(() => currentMode === 'visual');

    const run = (view, range, userEvent = 'delete') => {
        view.dispatch({ changes: { from: range.from, to: range.to }, selection: EditorSelection.cursor(range.from), userEvent, scrollIntoView: true });
        return true;
    };
    const visualKeys = Prec.high(keymap.of([
        {
            key: 'Backspace',
            run(view) {
                const sel = view.state.selection.main;
                if (!sel.empty) return false;
                const r = backspaceRange(view.state.doc.toString(), sel.head);
                return r ? run(view, r) : true;
            },
        },
        {
            key: 'Delete',
            run(view) {
                const sel = view.state.selection.main;
                if (!sel.empty) return false;
                const r = deleteForwardRange(view.state.doc.toString(), sel.head);
                return r ? run(view, r, 'delete.forward') : true;
            },
        },
    ]));

    const visualExt = [
        visualField, typingRules, protectRules, visualKeys,
        EditorView.contentAttributes.of({ class: 'song-body cl-visual' }),
    ];
    const sourceExt = [
        sourceField,
        EditorView.contentAttributes.of({ class: 'cl-source' }),
    ];
    const modeExt = (m) => (m === 'visual' ? visualExt : sourceExt);

    const extensions = (initialMode) => [
        boxField,
        modeCompartment.of(modeExt(initialMode)),
        editableCompartment.of(EditorView.editable.of(editable)),
        // every chord operation is its own undo step (CodeMirror would otherwise merge quick adjacent edits)
        history({ joinToEvent: (tr, adjacent) => (tr.isUserEvent(DRAG_EVENT) ? dragJoin : (adjacent && !tr.isUserEvent('input.chord') && !tr.isUserEvent('delete.chord'))) }),
        keymap.of([...historyKeymap, ...defaultKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Song lyrics and chords', autocapitalize: 'sentences' }),
        EditorView.updateListener.of((u) => {
            if (u.docChanged) {
                const removed = removedChordCount(u);
                hooks.onChange?.(u);
                if (removed) hooks.onChordsRemoved?.(removed);
            }
            if (u.docChanged || u.selectionSet) hooks.onSelection?.(u);
            if (u.docChanged || u.transactions.length) hooks.onHistory?.({ undo: undoDepth(u.state), redo: redoDepth(u.state) });
        }),
        Prec.highest(EditorView.domEventHandlers({
            mousedown: (e, view) => hooks.onMouseDown?.(e, view) || false,
            click: (e, view) => hooks.onClick?.(e, view) || false,
            paste: (e, view) => hooks.onPaste?.(e, view) || false,
            copy: (e, view) => hooks.onCopy?.(e, view, false) || false,
            cut: (e, view) => hooks.onCopy?.(e, view, true) || false,
        })),
    ];

    const view = new EditorView({
        parent,
        state: EditorState.create({ doc, extensions: extensions(mode) }),
    });

    function removedChordCount(u) {
        if (!u.transactions.some((t) => t.isUserEvent('delete') || t.isUserEvent('input.cut'))) return 0;
        let n = 0;
        u.changes.iterChangedRanges((fromA, toA) => { n += countChords(u.startState.doc.sliceString(fromA, toA)); });
        return n;
    }

    const editorApi = {
        view,
        get mode() { return currentMode; },
        getText: () => view.state.doc.toString(),
        /** Replace the document. `reset` drops undo history (a new song opened). */
        setText(text, { reset = false } = {}) {
            if (reset) {
                view.setState(EditorState.create({ doc: text, extensions: extensions(currentMode) }));
                hooks.onHistory?.({ undo: 0, redo: 0 });
                return;
            }
            const old = view.state.doc.toString();
            if (old === text) return;
            view.dispatch({ changes: { from: 0, to: old.length, insert: text }, annotations: Programmatic.of(true), userEvent: 'input.replace' });
        },
        /** Apply a single change as one undo step without the typing rules. */
        change(spec, extra = {}) {
            if (extra.userEvent === DRAG_EVENT) { dragJoin = Date.now() < dragUntil; dragUntil = Date.now() + 400; }
            view.dispatch({ ...spec, annotations: Programmatic.of(true), userEvent: extra.userEvent || 'input.programmatic', scrollIntoView: extra.scroll !== false });
        },
        setMode(next) {
            if (next === currentMode) return;
            const first = next === 'visual';
            currentMode = next;
            view.dispatch({ effects: modeCompartment.reconfigure(modeExt(next)) });
            // boxField lives in the visual extension; the source view has none
            if (!first) editorApi.setBox(null);
        },
        /** Chords mode: not editable, so there is no keyboard and no text selection. */
        setEditable(on) {
            if (on === editable) return;
            editable = on;
            view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(on)) });
        },
        get editable() { return editable; },
        setDisplay(fn) { display = fn || ((c) => c); view.dispatch({ effects: refreshEffect.of(null) }); },
        setBox(box) {
            view.dispatch({ effects: setBoxEffect.of(box), annotations: Programmatic.of(true) });
        },
        getBox: () => view.state.field(boxField, false) || null,
        undo: () => undo(view),
        redo: () => redo(view),
        history: () => ({ undo: undoDepth(view.state), redo: redoDepth(view.state) }),
        focus: () => view.focus(),
        destroy: () => view.destroy(),
        /** Seams of the line holding `pos`, as doc positions. */
        seams: (pos) => lineSeams(view.state.doc.toString(), pos),
    };
    return editorApi;
}
