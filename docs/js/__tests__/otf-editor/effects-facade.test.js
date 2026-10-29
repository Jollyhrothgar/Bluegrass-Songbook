// TablEdit's per-note effects (`fx`) and grace notes (`grace`) — the
// facade half. docs/schema/otf.md: `fx` is a SET stored in
// FX_ORDER and omitted when empty (never `[]`); `grace` is
// `{f: 0..24, kind?}` hanging on the main note.
//
// Every op here is the fingering ops' shape: validate the vocabulary
// (throw), refuse a no-op (false, no history), one undo step — and a
// range op is one undo step for the whole phrase.
import { describe, it, expect, beforeEach } from 'vitest';

import {
    EditingFacade, FX_ORDER, GRACE_KINDS, isGrace,
} from '../../otf-editor/facade.js';
import { FX_ORDER as IMPORTER_FX_ORDER } from '../../tef-import/otf.js';

function banjoDoc() {
    return {
        otf_version: '1.0',
        metadata: { title: 'Test', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [{
            id: 'banjo', instrument: '5-string-banjo',
            tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead',
        }],
        notation: {
            banjo: [1, 2].map(m => ({ measure: m, events: [] })),
        },
    };
}

describe('the fx vocabulary', () => {
    it('is the importer’s list, in the importer’s order', () => {
        // The facade owns its own copy (it stays UI- and importer-free);
        // this is what keeps the two from drifting apart.
        expect(FX_ORDER).toEqual(IMPORTER_FX_ORDER);
    });

    it('names TablEdit’s seven grace connections', () => {
        expect(GRACE_KINDS).toEqual(
            ['hp', 'slide', 'bend', 'mordent', 'double', 'gruppetto', 'trill']);
    });

    it('isGrace accepts 0..24 with an optional known kind, nothing else', () => {
        expect(isGrace({ f: 0 })).toBe(true);
        expect(isGrace({ f: 24, kind: 'trill' })).toBe(true);
        expect(isGrace({ f: 25 })).toBe(false);
        expect(isGrace({ f: -1 })).toBe(false);
        expect(isGrace({ f: 2.5 })).toBe(false);
        expect(isGrace({ f: 2, kind: 'wobble' })).toBe(false);
        expect(isGrace(null)).toBe(false);
    });
});

describe('EditingFacade — setEffect / toggleEffect', () => {
    let f;
    const pos = { measure: 1, tick: 0, string: 3 };
    const empty = { measure: 1, tick: 480, string: 3 };
    const note = () => f._findNote(pos).note;

    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        f.clearHistory();
    });

    it('adds an effect as a one-element set', () => {
        expect(f.setEffect(pos, 'brush', true)).toBe(true);
        expect(note().fx).toEqual(['brush']);
    });

    it('stores the set in canonical order, whatever order it was typed', () => {
        f.setEffect(pos, 'slap', true);
        f.setEffect(pos, 'ghost', true);
        f.setEffect(pos, 'brush', true);
        f.setEffect(pos, 'let-ring', true);
        expect(note().fx).toEqual(['brush', 'ghost', 'let-ring', 'slap']);
    });

    it('accepts every value in FX_ORDER', () => {
        for (const fx of FX_ORDER) f.setEffect(pos, fx, true);
        expect(note().fx).toEqual(FX_ORDER);
    });

    it('removes one effect and deletes the key when the set empties (never [])', () => {
        f.setEffect(pos, 'roll', true);
        f.setEffect(pos, 'ghost', true);
        expect(f.setEffect(pos, 'roll', false)).toBe(true);
        expect(note().fx).toEqual(['ghost']);
        expect(f.setEffect(pos, 'ghost', false)).toBe(true);
        expect('fx' in note()).toBe(false);
    });

    it('refuses a no-op with no history entry', () => {
        f.setEffect(pos, 'choke', true);
        const depth = f._history.length;
        expect(f.setEffect(pos, 'choke', true)).toBe(false);
        expect(f.setEffect(pos, 'tap', false)).toBe(false);
        expect(f.setEffect(empty, 'tap', true)).toBe(false);
        expect(f._history.length).toBe(depth);
    });

    it('throws on an effect outside the vocabulary, document untouched', () => {
        expect(() => f.setEffect(pos, 'wah', true)).toThrow(RangeError);
        expect(() => f.setEffect(pos, 'Brush', true)).toThrow(RangeError);
        expect(() => f.setEffect(pos, 'x', true)).toThrow(RangeError);
        expect(note().fx).toBeUndefined();
    });

    it('never touches tech, tie, fingering or grace', () => {
        f.setArticulation(pos, 'h');
        f.setFingering(pos, 'T');
        f.setGrace(pos, { f: 0, kind: 'hp' });
        f.setEffect(pos, 'staccato', true);
        f.setEffect(pos, 'staccato', false);
        expect(note()).toMatchObject({ tech: 'h', finger: 'T', grace: { f: 0, kind: 'hp' } });
    });

    it('is one undo step each way', () => {
        f.setEffect(pos, 'vibrato', true);
        f.setEffect(pos, 'tremolo', true);
        f.undo();
        expect(note().fx).toEqual(['vibrato']);
        f.undo();
        expect(note().fx).toBeUndefined();
        f.redo();
        expect(note().fx).toEqual(['vibrato']);
    });

    it('toggleEffect flips the one effect and leaves the rest of the set', () => {
        f.setEffect(pos, 'harmonic', true);
        expect(f.toggleEffect(pos, 'brush')).toBe(true);
        expect(note().fx).toEqual(['brush', 'harmonic']);
        expect(f.toggleEffect(pos, 'brush')).toBe(true);
        expect(note().fx).toEqual(['harmonic']);
        expect(f.toggleEffect(empty, 'brush')).toBe(false);
    });

    it('setEffect with "toggle" is the same toggle', () => {
        expect(f.setEffect(pos, 'ghost', 'toggle')).toBe(true);
        expect(note().fx).toEqual(['ghost']);
        expect(f.setEffect(pos, 'ghost', 'toggle')).toBe(true);
        expect(note().fx).toBeUndefined();
    });

    it('re-sorts a hand-written out-of-order set when it touches it', () => {
        // A document from elsewhere may carry an unsorted set; the first
        // edit puts it back in canonical order rather than appending.
        note().fx = ['slap', 'brush'];
        f.setEffect(pos, 'ghost', true);
        expect(note().fx).toEqual(['brush', 'ghost', 'slap']);
    });
});

describe('EditingFacade — setRangeEffect (one step for the phrase)', () => {
    let f;
    const a = { measure: 1, tick: 0, string: 3 };
    const b = { measure: 1, tick: 240, string: 2 };
    const c = { measure: 1, tick: 480, string: 1 };
    const fx = (p) => f._findNote(p).note.fx;

    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ ...a, fret: 2 });
        f.insertNote({ ...b, fret: 0 });
        f.insertNote({ ...c, fret: 3 });
        f.clearHistory();
    });

    it('sets an effect on every note in range as ONE undo step', () => {
        expect(f.setRangeEffect(0, 960, 'brush', true)).toBe(true);
        expect([fx(a), fx(b), fx(c)]).toEqual([['brush'], ['brush'], ['brush']]);
        expect(f._history.length).toBe(1);
        f.undo();
        expect([fx(a), fx(b), fx(c)]).toEqual([undefined, undefined, undefined]);
    });

    it('honours the selection rectangle’s strings', () => {
        f.setRangeEffect(0, 960, 'ghost', true, { strings: [2, 3] });
        expect(fx(a)).toEqual(['ghost']);
        expect(fx(b)).toEqual(['ghost']);
        expect(fx(c)).toBeUndefined();
    });

    it('"toggle": they ALL already have it → turn it off', () => {
        f.setRangeEffect(0, 960, 'roll', true);
        expect(f.setRangeEffect(0, 960, 'roll', 'toggle')).toBe(true);
        expect([fx(a), fx(b), fx(c)]).toEqual([undefined, undefined, undefined]);
    });

    it('"toggle": some have it, some don’t → turn it ON for all', () => {
        f.setEffect(b, 'roll', true);
        expect(f.setRangeEffect(0, 960, 'roll', 'toggle')).toBe(true);
        expect([fx(a), fx(b), fx(c)]).toEqual([['roll'], ['roll'], ['roll']]);
    });

    it('refuses an empty range or a range where nothing changes', () => {
        expect(f.setRangeEffect(1920, 3840, 'tap', true)).toBe(false);
        f.setRangeEffect(0, 960, 'tap', true);
        const depth = f._history.length;
        expect(f.setRangeEffect(0, 960, 'tap', true)).toBe(false);
        expect(f._history.length).toBe(depth);
    });

    it('validates its vocabulary', () => {
        expect(() => f.setRangeEffect(0, 960, 'nope', true)).toThrow(RangeError);
    });
});

describe('EditingFacade — setGrace', () => {
    let f;
    const pos = { measure: 1, tick: 0, string: 3 };
    const note = () => f._findNote(pos).note;

    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ ...pos, fret: 2 });
        f.clearHistory();
    });

    it('hangs a plain grace note on the main note', () => {
        expect(f.setGrace(pos, { f: 0 })).toBe(true);
        expect(note().grace).toEqual({ f: 0 });
    });

    it('stores a kind when one is given, and drops a null kind', () => {
        f.setGrace(pos, { f: 1, kind: 'slide' });
        expect(note().grace).toEqual({ f: 1, kind: 'slide' });
        f.setGrace(pos, { f: 1, kind: null });
        expect(note().grace).toEqual({ f: 1 });
    });

    it('clears with null, deleting the key', () => {
        f.setGrace(pos, { f: 0, kind: 'hp' });
        expect(f.setGrace(pos, null)).toBe(true);
        expect('grace' in note()).toBe(false);
    });

    it('refuses a no-op: same grace, no grace to clear, no note', () => {
        f.setGrace(pos, { f: 4, kind: 'hp' });
        const depth = f._history.length;
        expect(f.setGrace(pos, { kind: 'hp', f: 4 })).toBe(false);
        expect(f.setGrace({ ...pos, tick: 480 }, { f: 1 })).toBe(false);
        f.setGrace(pos, null);
        expect(f.setGrace(pos, null)).toBe(false);
        expect(f._history.length).toBe(depth + 1);
    });

    it('throws on a fret off the neck or an unknown kind', () => {
        expect(() => f.setGrace(pos, { f: 25 })).toThrow(RangeError);
        expect(() => f.setGrace(pos, { f: -1 })).toThrow(RangeError);
        expect(() => f.setGrace(pos, { f: '2' })).toThrow(RangeError);
        expect(() => f.setGrace(pos, { f: 2, kind: 'shake' })).toThrow(RangeError);
        expect(() => f.setGrace(pos, 3)).toThrow(RangeError);
        expect(note().grace).toBeUndefined();
    });

    it('is undoable', () => {
        f.setGrace(pos, { f: 0, kind: 'hp' });
        f.setGrace(pos, { f: 1, kind: 'slide' });
        f.undo();
        expect(note().grace).toEqual({ f: 0, kind: 'hp' });
        f.undo();
        expect(note().grace).toBeUndefined();
    });

    it('stores a copy, not the caller’s object', () => {
        const g = { f: 2, kind: 'bend' };
        f.setGrace(pos, g);
        g.f = 9;
        expect(note().grace.f).toBe(2);
    });
});

describe('fx and grace travel with the note', () => {
    let f;
    const pos = { measure: 1, tick: 0, string: 3 };

    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ ...pos, fret: 2 });
        f.setEffect(pos, 'brush', true);
        f.setEffect(pos, 'let-ring', true);
        f.setGrace(pos, { f: 0, kind: 'hp' });
    });

    it('copy + paste carries both', () => {
        f.copyRange(0, 1);
        f.paste(1920);
        expect(f._findNote({ measure: 2, tick: 0, string: 3 }).note)
            .toMatchObject({ f: 2, fx: ['brush', 'let-ring'], grace: { f: 0, kind: 'hp' } });
    });

    it('moveRange carries both', () => {
        f.moveRange(0, 1, 960);
        expect(f._findNote({ measure: 1, tick: 960, string: 3 }).note)
            .toMatchObject({ fx: ['brush', 'let-ring'], grace: { f: 0, kind: 'hp' } });
    });

    it('moveNote carries both', () => {
        f.moveNote(pos, { measure: 1, tick: 480, string: 3 });
        expect(f._findNote({ measure: 1, tick: 480, string: 3 }).note)
            .toMatchObject({ fx: ['brush', 'let-ring'], grace: { f: 0, kind: 'hp' } });
    });

    it('a pasted copy is independent of the original', () => {
        f.copyRange(0, 1);
        f.paste(1920);
        const pasted = { measure: 2, tick: 0, string: 3 };
        f.setEffect(pasted, 'brush', false);
        expect(f._findNote(pos).note.fx).toEqual(['brush', 'let-ring']);
    });
});

describe('a grace note follows its main note', () => {
    // TablEdit's grace hangs on the main note, so the interval between them
    // is part of the note: +/- and re-stringing move the grace with it.
    let f;
    const pos = { measure: 1, tick: 0, string: 3 };
    const note = (p = pos) => f._findNote(p).note;

    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ ...pos, fret: 4 });
        f.setGrace(pos, { f: 2, kind: 'hp' });
        f.clearHistory();
    });

    it('moves by the same frets on + / -', () => {
        expect(f.transposeFret(pos, 1)).toBe(true);
        expect(note()).toMatchObject({ f: 5, grace: { f: 3, kind: 'hp' } });
    });

    it('keeps the block transpose all-or-nothing, grace included', () => {
        f.setGrace(pos, { f: 0, kind: 'hp' });
        expect(f.transposeRange(0, 480, -1)).toBe(false);   // grace would go to -1
        expect(note().f).toBe(4);
        expect(f.transposeRange(0, 480, 2)).toBe(true);
        expect(note()).toMatchObject({ f: 6, grace: { f: 2 } });
    });

    it('keeps its pitch interval when the main note is re-strung', () => {
        // string 3 (G3) fret 4 = B3 -> string 2 (B3) fret 0; grace G3+2 -> B3-2 invalid,
        // so move the other way: string 4 (D3) fret 9 = B3, grace A3 -> fret 7.
        expect(f.moveNoteToString(pos, 1)).toBe(true);
        expect(note({ ...pos, string: 4 })).toMatchObject({ f: 9, grace: { f: 7 } });
        // and refuses when the grace would fall below the nut
        expect(f.moveNoteToString({ ...pos, string: 4 }, -1)).toBe(true);
        expect(f.moveNoteToString(pos, -1)).toBe(false);    // B3 f0, grace would be -2
    });
});
