// The selection is a RECTANGLE (TablEdit), not a column of every string.
//
// Two features live or die on this file:
//   1. a drag/extend from string 3 to string 5 selects 3,4,5 and NOTHING
//      else — every range op is filtered by `selectionRange().strings`
//   2. `+` / `-` move the whole block by a fret, atomically: one note
//      that would leave 0..24 refuses the entire op
import { describe, it, expect } from 'vitest';

import {
    EditorState, EditorMode, CursorPosition, SelectionRange, DURATIONS,
} from '../../otf-editor/state.js';
import { EditorCursor, selectionBand } from '../../otf-editor/cursor.js';
import { KeyboardHandler } from '../../otf-editor/keyboard.js';

/**
 * A 4-measure banjo document with notes at [measure, tick, string, fret].
 */
function docWith(notes) {
    const state = new EditorState();
    for (let m = 2; m <= 4; m++) state.getOrCreateMeasure(m);
    for (const [measure, tick, string, fret] of notes) {
        state.cursor.measure = measure;
        state.cursor.tick = tick;
        state.cursor.string = string;
        state.insertNote(fret);
    }
    state.cursor.measure = 1;
    state.cursor.tick = 0;
    state.cursor.string = 3;
    return state;
}

/** Select the rectangle (m1,t1,s1)..(m2,t2,s2). */
function select(state, [m1, t1, s1], [m2, t2, s2]) {
    state.setMode(EditorMode.VISUAL);
    state.selection = new SelectionRange(
        new CursorPosition(m1, t1, s1), new CursorPosition(m2, t2, s2));
    return state.selectionRange();
}

/** Every note in the document as `${measure}:${tick}:${string}=${fret}`. */
function notesOf(state) {
    const out = [];
    for (const measure of state.facade.getNotation(state.trackId)) {
        for (const event of measure.events) {
            for (const note of event.notes) {
                out.push(`${measure.measure}:${event.tick}:${note.s}=${note.f}`);
            }
        }
    }
    return out.sort();
}

function makeRig(state, preset = 'tabledit') {
    const cursor = new EditorCursor(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    cursor.init(container);
    cursor.setLayoutInfo({
        leftMargin: 40, topMargin: 30, stringSpacing: 16, measureWidth: 200,
        measuresPerRow: 2, ticksPerMeasure: 1920, rowHeight: 120,
        noteAreaStart: 10, noteAreaWidth: 180, trackInfoOffset: 0,
    });
    const status = [];
    const keyboard = new KeyboardHandler(state, cursor, {
        preset, onStatus: (m) => status.push(m),
    });
    return {
        state, cursor, keyboard, status,
        press: (key, opts = {}) => keyboard.handleKeyDown(new KeyboardEvent('keydown', {
            key,
            code: opts.code || (/^[0-9]$/.test(key) ? `Digit${key}` : undefined),
            ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
            bubbles: true, cancelable: true,
        })),
        teardown: () => { keyboard.detach(); cursor.destroy(); container.remove(); },
    };
}

describe('selectionRange().strings — the rectangle', () => {
    it('is the inclusive span between the two endpoints, low → high', () => {
        const state = docWith([]);
        expect(select(state, [2, 0, 3], [4, 240, 5]).strings).toEqual([3, 4, 5]);
    });

    it('is the same span dragged the other way (5 up to 3)', () => {
        const state = docWith([]);
        expect(select(state, [4, 240, 5], [2, 0, 3]).strings).toEqual([3, 4, 5]);
    });

    it('is height-independent of tick order: a backwards-in-time drag keeps 3..5', () => {
        const state = docWith([]);
        // end is EARLIER in time but LOWER on the staff
        expect(select(state, [4, 0, 3], [2, 0, 5]).strings).toEqual([3, 4, 5]);
    });

    it('a drag that never changes string is a ONE-string selection', () => {
        const state = docWith([]);
        expect(select(state, [1, 0, 4], [3, 480, 4]).strings).toEqual([4]);
    });

    it('clamps to the track: string 9 on a 5-string banjo is string 5', () => {
        const state = docWith([]);
        expect(select(state, [1, 0, 4], [1, 240, 9]).strings).toEqual([4, 5]);
    });

    it('selectionStrings() is null with no selection, and selectionRange() too', () => {
        const state = docWith([]);
        expect(state.selectionStrings()).toBeNull();
        expect(state.selectionRange()).toBeNull();
    });

    it('Ctrl+A still selects the WHOLE column of the measure', () => {
        const rig = makeRig(docWith([]));
        rig.press('a', { ctrl: true });
        expect(rig.state.selectionRange().strings).toEqual([1, 2, 3, 4, 5]);
        rig.teardown();
    });
});

describe('range ops are filtered to the rectangle', () => {
    // One chord at (1,0) across all five strings, plus a second column.
    const chord = () => docWith([
        [1, 0, 1, 1], [1, 0, 2, 2], [1, 0, 3, 3], [1, 0, 4, 4], [1, 0, 5, 5],
        [1, 240, 3, 7], [1, 240, 1, 9],
    ]);

    it('delete removes only the selected strings', () => {
        const state = chord();
        select(state, [1, 0, 3], [1, 240, 4]);
        expect(state.deleteSelection()).toBe(true);
        expect(notesOf(state)).toEqual([
            '1:0:1=1', '1:0:2=2', '1:0:5=5', '1:240:1=9',
        ]);
    });

    it('copy takes only the selected strings', () => {
        const state = chord();
        select(state, [1, 0, 4], [1, 0, 5]);
        state.copy();
        const notes = state.facade.clipboard.data.flatMap(d => d.notes.map(n => n.s));
        expect(notes.sort()).toEqual([4, 5]);
    });

    it('paste puts each note back on its OWN string', () => {
        const state = chord();
        select(state, [1, 0, 4], [1, 0, 5]);
        state.copy();
        state.cursor.measure = 3;
        state.cursor.tick = 0;
        state.cursor.string = 1;   // the cursor's string is irrelevant
        state.selection = null;
        state.setMode(EditorMode.NORMAL);
        state.paste();
        expect(notesOf(state).filter(n => n.startsWith('3:')))
            .toEqual(['3:0:4=4', '3:0:5=5']);
    });

    it('applyDurationToSelection re-times only the selected strings', () => {
        const state = chord();
        select(state, [1, 0, 2], [1, 0, 3]);
        expect(state.applyDurationToSelection(DURATIONS.sixteenth)).toBe(true);
        const byString = {};
        for (const { string, note } of state.facade.notesInRange(0, 1)) byString[string] = note.dur;
        expect(byString[2]).toBe(DURATIONS.sixteenth);
        expect(byString[3]).toBe(DURATIONS.sixteenth);
        expect(byString[1]).not.toBe(DURATIONS.sixteenth);
        expect(byString[4]).not.toBe(DURATIONS.sixteenth);
    });

    it('scaleSelectionDuration scales only the selected strings', () => {
        const state = chord();
        const before = state.facade.notesInRange(0, 1)
            .find(h => h.string === 1).note.dur;
        select(state, [1, 0, 4], [1, 0, 5]);
        expect(state.scaleSelectionDuration(0.5)).toBe(true);
        const now = Object.fromEntries(
            state.facade.notesInRange(0, 1).map(h => [h.string, h.note.dur]));
        expect(now[4]).toBe(before / 2);
        expect(now[5]).toBe(before / 2);
        expect(now[1]).toBe(before);
    });

    it('an effect over the selection marks only the selected strings', () => {
        const rig = makeRig(chord());
        select(rig.state, [1, 0, 2], [1, 0, 3]);
        rig.keyboard.dispatchAction('effect.hammer');
        const techs = Object.fromEntries(
            rig.state.facade.notesInRange(0, 1).map(h => [h.string, h.note.tech || null]));
        expect(techs[2]).toBe('h');
        expect(techs[3]).toBe('h');
        expect(techs[1]).toBeNull();
        expect(techs[4]).toBeNull();
        expect(techs[5]).toBeNull();
        rig.teardown();
    });

    it('the whole-column selection still touches every string', () => {
        const state = chord();
        select(state, [1, 0, 1], [1, 240, 5]);
        expect(state.deleteSelection()).toBe(true);
        expect(notesOf(state)).toEqual([]);
    });
});

describe('facade.transposeRange — the block form of +/-', () => {
    const block = () => docWith([
        [1, 0, 3, 5], [1, 240, 4, 7], [1, 480, 5, 0], [1, 0, 1, 12],
    ]);

    it('moves every note in the block by delta, in ONE undo step', () => {
        const state = block();
        const strings = [3, 4, 5];
        expect(state.facade.transposeRange(0, 1920, 1, { strings })).toBe(true);
        expect(notesOf(state)).toEqual([
            '1:0:1=12', '1:0:3=6', '1:240:4=8', '1:480:5=1',
        ]);
        state.undo();
        expect(notesOf(state)).toEqual([
            '1:0:1=12', '1:0:3=5', '1:240:4=7', '1:480:5=0',
        ]);
    });

    it('refuses ATOMICALLY when one note would pass fret 24', () => {
        const state = docWith([[1, 0, 3, 24], [1, 240, 4, 7]]);
        const depth = state.facade._historyIndex;
        expect(state.facade.transposeRange(0, 1920, 1, { strings: [3, 4] })).toBe(false);
        expect(notesOf(state)).toEqual(['1:0:3=24', '1:240:4=7']);
        // no history entry either: a refusal is not an undoable no-op
        expect(state.facade._historyIndex).toBe(depth);
    });

    it('refuses ATOMICALLY when one note would fall below fret 0', () => {
        const state = docWith([[1, 0, 3, 0], [1, 240, 4, 7]]);
        expect(state.facade.transposeRange(0, 1920, -1, { strings: [3, 4] })).toBe(false);
        expect(notesOf(state)).toEqual(['1:0:3=0', '1:240:4=7']);
    });

    it('a blocking note OUTSIDE the rectangle does not block it', () => {
        const state = docWith([[1, 0, 1, 24], [1, 0, 3, 5]]);
        expect(state.facade.transposeRange(0, 1920, 1, { strings: [3, 4, 5] })).toBe(true);
        expect(notesOf(state)).toEqual(['1:0:1=24', '1:0:3=6']);
    });

    it('an empty block, and a zero delta, are both false', () => {
        const state = block();
        expect(state.facade.transposeRange(1920, 3840, 1, { strings: [3] })).toBe(false);
        expect(state.facade.transposeRange(0, 1920, 0, { strings: [3] })).toBe(false);
    });

    it('state.transposeSelection needs a selection and honours the rectangle', () => {
        const state = block();
        expect(state.transposeSelection(1)).toBe(false);
        select(state, [1, 0, 3], [1, 480, 4]);
        expect(state.transposeSelection(1)).toBe(true);
        expect(notesOf(state)).toEqual([
            '1:0:1=12', '1:0:3=6', '1:240:4=8', '1:480:5=0',
        ]);
    });
});

describe('+ / - through the keys', () => {
    it('with a selection, raises every note in the rectangle', () => {
        const rig = makeRig(docWith([
            [1, 0, 1, 3], [1, 0, 3, 5], [1, 240, 4, 7],
        ]));
        select(rig.state, [1, 0, 3], [1, 240, 4]);
        rig.press('+');
        expect(notesOf(rig.state)).toEqual(['1:0:1=3', '1:0:3=6', '1:240:4=8']);
        rig.teardown();
    });

    it('with no selection, moves only the note at the cursor', () => {
        const rig = makeRig(docWith([[1, 0, 3, 5], [1, 0, 4, 7]]));
        rig.state.cursor.string = 3;
        rig.press('+');
        expect(notesOf(rig.state)).toEqual(['1:0:3=6', '1:0:4=7']);
        rig.teardown();
    });

    it('- lowers the block, and one undo takes the whole block back', () => {
        const rig = makeRig(docWith([[1, 0, 3, 5], [1, 240, 4, 7]]));
        select(rig.state, [1, 0, 3], [1, 240, 4]);
        rig.press('-');
        expect(notesOf(rig.state)).toEqual(['1:0:3=4', '1:240:4=6']);
        rig.state.undo();
        expect(notesOf(rig.state)).toEqual(['1:0:3=5', '1:240:4=7']);
        rig.teardown();
    });

    it('says so in the status bar when the block refuses', () => {
        const rig = makeRig(docWith([[1, 0, 3, 24], [1, 240, 4, 7]]));
        select(rig.state, [1, 0, 3], [1, 240, 4]);
        rig.press('+');
        expect(notesOf(rig.state)).toEqual(['1:0:3=24', '1:240:4=7']);
        expect(rig.status.join(' ')).toMatch(/refused/i);
        rig.teardown();
    });

    it('works in VISUAL mode too (the mode a drag leaves you in)', () => {
        const rig = makeRig(docWith([[1, 0, 3, 5]]));
        select(rig.state, [1, 0, 3], [1, 240, 3]);
        expect(rig.state.mode).toBe(EditorMode.VISUAL);
        rig.press('+');
        expect(notesOf(rig.state)).toEqual(['1:0:3=6']);
        rig.teardown();
    });

    it('is bound in the vim preset too', () => {
        const rig = makeRig(docWith([[1, 0, 3, 5], [1, 240, 4, 7]]), 'vim');
        select(rig.state, [1, 0, 3], [1, 240, 4]);
        rig.press('+');
        expect(notesOf(rig.state)).toEqual(['1:0:3=6', '1:240:4=8']);
        rig.teardown();
    });
});

describe('Shift+Arrow extends the rectangle', () => {
    it('Shift+ArrowDown grows the selection downward a string at a time', () => {
        const rig = makeRig(docWith([]));
        rig.state.cursor.string = 3;
        rig.press('ArrowDown', { shift: true });
        expect(rig.state.selectionRange().strings).toEqual([3, 4]);
        rig.press('ArrowDown', { shift: true });
        expect(rig.state.selectionRange().strings).toEqual([3, 4, 5]);
        rig.teardown();
    });

    it('Shift+ArrowUp grows it upward from the same anchor', () => {
        const rig = makeRig(docWith([]));
        rig.state.cursor.string = 3;
        rig.press('ArrowUp', { shift: true });
        rig.press('ArrowUp', { shift: true });
        expect(rig.state.selectionRange().strings).toEqual([1, 2, 3]);
        rig.teardown();
    });

    it('Shift+ArrowRight extends the TICKS and leaves the height alone', () => {
        const rig = makeRig(docWith([]));
        rig.state.cursor.string = 3;
        rig.press('ArrowRight', { shift: true });
        const range = rig.state.selectionRange();
        expect(range.strings).toEqual([3]);
        expect(range.endAbs).toBeGreaterThan(range.startAbs + 1);
        rig.teardown();
    });

    it("vim's j/k drag the end string in VISUAL", () => {
        const rig = makeRig(docWith([]), 'vim');
        rig.state.cursor.string = 3;
        rig.press('v');
        rig.press('j');
        expect(rig.state.selectionRange().strings).toEqual([3, 4]);
        rig.press('k');
        rig.press('k');
        expect(rig.state.selectionRange().strings).toEqual([2, 3]);
        rig.teardown();
    });
});

describe('selectionBand — the highlight is clipped vertically', () => {
    const geom = { topMargin: 30, stringSpacing: 15, stringCount: 5 };

    it('covers only the selected strings', () => {
        // strings 3..5: from the 3rd line (30 + 2*15 = 60) to the 5th (90)
        expect(selectionBand([3, 4, 5], geom)).toEqual({ top: 54, height: 42 });
    });

    it('a one-string selection is a thin band on that string', () => {
        expect(selectionBand([2], geom)).toEqual({ top: 39, height: 12 });
    });

    it('never reaches the strings it excludes', () => {
        const band = selectionBand([4, 5], geom);
        const yOf = (s) => geom.topMargin + (s - 1) * geom.stringSpacing;
        expect(band.top).toBeGreaterThan(yOf(3));
        expect(band.top + band.height).toBeGreaterThanOrEqual(yOf(5));
    });

    it('no strings (or all of them) is the whole staff', () => {
        expect(selectionBand(null, geom)).toEqual({ top: 24, height: 72 });
        expect(selectionBand([1, 2, 3, 4, 5], geom)).toEqual({ top: 24, height: 72 });
    });

    it('clamps strings the track does not have', () => {
        expect(selectionBand([4, 5, 6, 7], geom)).toEqual(selectionBand([4, 5], geom));
    });
});
