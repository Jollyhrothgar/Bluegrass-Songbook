// Chord diagrams (G15d3) through the editing facade. Diagrams are not created
// or edited here; they must only SURVIVE every operation that moves what they
// anchor to: inserted and deleted measures (like annotations), track renames
// and deletes. Every one is one undo step that restores them exactly.
import { describe, it, expect, beforeEach } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';
import { validateOTF } from '../../otf-editor/otf-validate.js';

const note = (s, f) => ({ tick: 0, notes: [{ s, f, dur: 480 }] });

function doc() {
    return {
        otf_version: '1.2',
        metadata: { title: 'T', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [
            { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead' },
            { id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0, role: 'rhythm' },
        ],
        notation: {
            banjo: [1, 2, 3, 4].map(m => ({ measure: m, events: [note(1, m)] })),
            guitar: [1, 2, 3, 4].map(m => ({ measure: m, events: [note(6, m)] })),
        },
        chords: [
            { name: 'G', frets: [3, 0, 0, 0, 2, 3] },
            { name: 'Am7' },
            { name: 'C7', frets: [0, 1, 0, 2, 3, null] },      // unused: the table keeps it
        ],
        chord_diagrams: [
            { measure: 1, tick: 0, track: 'guitar', chord: 0 },
            { measure: 2, tick: 480, track: 'banjo', chord: 1 },
            { measure: 3, tick: 960, track: 'guitar', chord: 0, dx: 2, dy: -5 },
            { measure: 4, tick: 0, track: 'banjo', chord: 1 },
        ],
    };
}
const diagrams = (f) => f.otf.chord_diagrams.map(d => [d.measure, d.track, d.chord]);

describe('chord diagrams: measure ops', () => {
    let f;
    beforeEach(() => { f = new EditingFacade(doc()); });

    it('insertMeasure moves later diagrams with their measures', () => {
        expect(f.insertMeasure(3)).toBe(true);
        expect(diagrams(f)).toEqual([[1, 'guitar', 0], [2, 'banjo', 1], [4, 'guitar', 0], [5, 'banjo', 1]]);
        expect(f.otf.chord_diagrams[2]).toMatchObject({ tick: 960, dx: 2, dy: -5 });   // nudges ride along
    });

    it('a diagram at the inserted measure moves up with it', () => {
        f.insertMeasure(1);
        expect(f.otf.chord_diagrams.map(d => d.measure)).toEqual([2, 3, 4, 5]);
    });

    it('deleteMeasure deletes the measure\'s diagrams and renumbers the rest', () => {
        expect(f.deleteMeasure(2)).toBe(true);
        expect(diagrams(f)).toEqual([[1, 'guitar', 0], [2, 'guitar', 0], [3, 'banjo', 1]]);
    });

    it('keeps the chord table whole, used or not', () => {
        const table = JSON.stringify(f.otf.chords);
        f.deleteMeasure(1); f.deleteMeasure(1); f.deleteMeasure(1);
        expect(JSON.stringify(f.otf.chords)).toBe(table);
    });

    it('drops the chord_diagrams key when the last diagram goes', () => {
        f.otf.chord_diagrams = [{ measure: 2, tick: 0, track: 'banjo', chord: 1 }];
        f.deleteMeasure(2);
        expect('chord_diagrams' in f.otf).toBe(false);
    });

    it('insert then delete is exact; each is one undo step that restores the diagrams', () => {
        const before = JSON.stringify(f.export());
        f.insertMeasure(2);
        f.deleteMeasure(2);
        expect(JSON.stringify(f.export())).toBe(before);

        f.deleteMeasure(3);
        expect(f.otf.chord_diagrams).toHaveLength(3);
        expect(f.undo()).toBe(true);
        expect(JSON.stringify(f.export())).toBe(before);
        f.insertMeasure(1);
        expect(f.undo()).toBe(true);
        expect(JSON.stringify(f.export())).toBe(before);
    });

    it('stays a valid document after each op', () => {
        f.insertMeasure(2);
        expect(validateOTF(f.export()).errors).toEqual([]);
        f.deleteMeasure(1);
        expect(validateOTF(f.export()).errors).toEqual([]);
    });
});

describe('chord diagrams: track ops', () => {
    let f;
    beforeEach(() => { f = new EditingFacade(doc(), { trackId: 'guitar' }); });

    it('renameTrack follows the track id, and undo takes it back', () => {
        const before = JSON.stringify(f.export());
        expect(f.renameTrack('guitar', 'rhythm guitar')).toBe(true);
        const renamed = f.otf.tracks[1].id;
        expect(renamed).not.toBe('guitar');
        expect(diagrams(f).map(d => d[1])).toEqual([renamed, 'banjo', renamed, 'banjo']);
        expect(f.otf.chord_diagrams.every(d => f.getTrack(d.track))).toBe(true);
        expect(validateOTF(f.export()).errors).toEqual([]);
        expect(f.undo()).toBe(true);
        expect(JSON.stringify(f.export())).toBe(before);
    });

    it('deleteTrack deletes that track\'s diagrams only; undo restores them in place', () => {
        const before = JSON.stringify(f.export());
        f.deleteTrack('guitar');
        expect(diagrams(f)).toEqual([[2, 'banjo', 1], [4, 'banjo', 1]]);
        expect(f.otf.chords).toHaveLength(3);
        expect(validateOTF(f.export()).errors).toEqual([]);
        expect(f.undo()).toBe(true);
        expect(JSON.stringify(f.export())).toBe(before);
        expect(f.canUndo()).toBe(false);
    });

    it('moveTrack leaves the diagrams alone (they are keyed by id, not position)', () => {
        const before = JSON.stringify(f.otf.chord_diagrams);
        f.moveTrack('guitar', 0);
        expect(JSON.stringify(f.otf.chord_diagrams)).toBe(before);
    });
});

describe('chord diagrams: note edits', () => {
    it('copy, cut, paste, move and delete of notes never touch them', () => {
        const f = new EditingFacade(doc(), { trackId: 'banjo' });
        const before = JSON.stringify(f.otf.chord_diagrams);
        const clip = f.copyRange(0, 1920);
        f.paste(f.toAbs(3, 0), clip);
        f.cutRange(0, 960);
        f.moveRange(f.toAbs(2, 0), f.toAbs(2, 480), f.toAbs(4, 0));
        f.insertNote({ measure: 2, tick: 960, string: 2, fret: 3, duration: 480 });
        f.deleteRange(0, 1920);
        expect(JSON.stringify(f.otf.chord_diagrams)).toBe(before);
    });
});
