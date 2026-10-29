// G15d4: the facade keeps measure_marks (repeat signs) on their measures
// through every op, and keeps reading-list section names through
// _setSequence. Marks are read-only in the editor: no op creates or edits one.
import { describe, it, expect } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';
import { validateOTF } from '../../otf-editor/otf-validate.js';

const note = (s, f) => ({ s, f, dur: 480 });
const mark = (measure, raw, fields) => ({ measure, ...fields, raw });

function doc(measures = 8) {
    return {
        otf_version: '1.2',
        metadata: { title: 'Marks', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [
            { id: 'banjo', instrument: '5-string-banjo',
              tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead' },
            { id: 'guitar', instrument: '6-string-guitar',
              tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0 },
        ],
        notation: {
            banjo: Array.from({ length: measures }, (_, i) => ({
                measure: i + 1, events: [{ tick: 0, notes: [note(1, i % 5)] }] })),
            guitar: Array.from({ length: measures }, (_, i) => ({
                measure: i + 1, events: [{ tick: 0, notes: [note(2, 3)] }] })),
        },
        measure_marks: [
            mark(1, 0x40, { repeat_start: true }),
            mark(4, 0x81, { repeat_end: true, ending: 1 }),
            mark(5, 0x0a, { ending: 2, end_bar: true }),
            mark(8, 0x80, { repeat_end: true }),
        ],
    };
}
const marksOf = (f) => f.otf.measure_marks.map(m => [m.measure, m.raw]);

describe('measure_marks through measure ops', () => {
    it('insertMeasure moves the marks at and after the new measure', () => {
        const f = new EditingFacade(doc());
        expect(f.insertMeasure(4)).toBe(true);
        expect(marksOf(f)).toEqual([[1, 0x40], [5, 0x81], [6, 0x0a], [9, 0x80]]);
        expect(f.otf.measure_marks[1]).toMatchObject({ repeat_end: true, ending: 1 });
        expect(validateOTF(f.export()).errors).toEqual([]);
    });

    it('insertMeasure before the first mark moves them all', () => {
        const f = new EditingFacade(doc());
        f.insertMeasure(1);
        expect(f.otf.measure_marks.map(m => m.measure)).toEqual([2, 5, 6, 9]);
    });

    it('deleteMeasure deletes that measure\'s marks and shifts later ones', () => {
        const f = new EditingFacade(doc());
        expect(f.deleteMeasure(4)).toBe(true);
        expect(marksOf(f)).toEqual([[1, 0x40], [4, 0x0a], [7, 0x80]]);
        expect(f.otf.measure_marks.find(m => m.raw === 0x81)).toBeUndefined();
        expect(validateOTF(f.export()).errors).toEqual([]);
    });

    it('deleting the last marked measure removes the key', () => {
        const f = new EditingFacade(doc());
        f.otf.measure_marks = [mark(3, 0x08, { end_bar: true })];
        f.deleteMeasure(3);
        expect(f.otf.measure_marks).toBeUndefined();
    });

    it('undo restores the marks after insert and after delete, redo redoes', () => {
        const f = new EditingFacade(doc());
        const before = JSON.stringify(f.otf.measure_marks);
        f.insertMeasure(2);
        f.undo();
        expect(JSON.stringify(f.otf.measure_marks)).toBe(before);
        f.deleteMeasure(4);
        const after = JSON.stringify(f.otf.measure_marks);
        f.undo();
        expect(JSON.stringify(f.otf.measure_marks)).toBe(before);
        f.redo();
        expect(JSON.stringify(f.otf.measure_marks)).toBe(after);
    });

    it('insert then delete the same measure is a round trip', () => {
        const f = new EditingFacade(doc());
        const before = JSON.stringify(f.otf.measure_marks);
        f.insertMeasure(3);
        f.deleteMeasure(3);
        expect(JSON.stringify(f.otf.measure_marks)).toBe(before);
    });
});

describe('measure_marks through every other op', () => {
    const before = () => JSON.stringify(doc().measure_marks);

    it('copy, cut, paste and move leave the marks where they are', () => {
        const f = new EditingFacade(doc());
        f.setTrack('banjo');
        const payload = f.copyRange(0, 1920);
        expect(JSON.stringify(f.otf.measure_marks)).toBe(before());
        f.paste(1920 * 5, payload);
        f.moveRange(1920 * 5, 1920 * 5 + 480, 1920 * 6);
        f.cutRange(0, 1920);
        expect(JSON.stringify(f.otf.measure_marks)).toBe(before());
    });

    it('track rename, reorder and delete leave the marks alone', () => {
        const f = new EditingFacade(doc());
        f.renameTrack('guitar', 'rhythm');
        f.moveTrack('rhythm', 0);
        f.deleteTrack('banjo');
        expect(JSON.stringify(f.otf.measure_marks)).toBe(before());
        f.undo(); f.undo(); f.undo();
        expect(JSON.stringify(f.otf.measure_marks)).toBe(before());
    });

    it('no op invents marks on a document without them', () => {
        const d = doc();
        delete d.measure_marks;
        const f = new EditingFacade(d);
        f.insertMeasure(2);
        f.deleteMeasure(3);
        f.repeatSpan(1, 2);
        expect(f.otf.measure_marks).toBeUndefined();
    });
});

describe('_setSequence keeps reading-list section names', () => {
    const named = () => {
        const f = new EditingFacade(doc());
        f.otf.reading_list = [
            { from_measure: 1, to_measure: 4, name: 'Intro' },
            { from_measure: 5, to_measure: 8, name: 'Part A' },
        ];
        return f;
    };

    it('repeating a named span keeps the names of the ranges that survive', () => {
        const f = named();
        expect(f.repeatSpan(5, 8)).toBe(true);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 4, name: 'Intro' },
            { from_measure: 5, to_measure: 8, name: 'Part A' },
            { from_measure: 5, to_measure: 8 },          // the repeat is not a new section
        ]);
    });

    it('a repeat inside a named range: the name stays on the whole range, not the copy', () => {
        const f = named();
        f.repeatSpan(1, 2);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 2 },
            { from_measure: 1, to_measure: 4, name: 'Intro' },
            { from_measure: 5, to_measure: 8, name: 'Part A' },
        ]);
    });

    it('repeatSpanWithEndings and removeRepeat keep survivors\' names', () => {
        const f = named();
        f.repeatSpanWithEndings(1, 3, 3, 4);
        expect(f.otf.reading_list.find(r => r.name === 'Part A'))
            .toEqual({ from_measure: 5, to_measure: 8, name: 'Part A' });
        expect(f.removeRepeat(1, 2)).toBe(true);
        expect(f.otf.reading_list.map(r => r.name).filter(Boolean)).toContain('Part A');
    });

    it('a list that returns to identity keeps its names; an unnamed one is dropped', () => {
        const f = named();
        f.repeatSpan(5, 8);
        expect(f.removeRepeat(5, 8)).toBe(true);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 4, name: 'Intro' },
            { from_measure: 5, to_measure: 8, name: 'Part A' },
        ]);
        const plain = new EditingFacade(doc());
        plain.repeatSpan(1, 2);
        plain.removeRepeat(1, 2);
        expect(plain.otf.reading_list).toBeUndefined();
    });

    it('unnamed lists behave as before', () => {
        const f = new EditingFacade(doc());
        f.repeatSpan(1, 4);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 4 },
            { from_measure: 1, to_measure: 8 },
        ]);
    });

    it('undo brings the names back', () => {
        const f = named();
        const before = JSON.stringify(f.otf.reading_list);
        f.repeatSpan(5, 8);
        f.undo();
        expect(JSON.stringify(f.otf.reading_list)).toBe(before);
    });
});
