// Bends in the editor (G15d2). A note carrying fx `bend` / `bend-release`
// bends into the next note on its string, which is marked `tech: 'b'`. The
// amount is the target's fret minus the source's, so editing the target's
// fret edits the bend. It must survive every facade op.
import { describe, it, expect, beforeEach } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';

function doc() {
    return {
        otf_version: '1.2',
        metadata: { title: 'Test', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [{
            id: 'banjo', instrument: '5-string-banjo',
            tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead',
        }],
        notation: { banjo: [1, 2, 3].map(m => ({ measure: m, events: [] })) },
    };
}

const SRC = { measure: 1, tick: 0, string: 3 };
const TGT = { measure: 1, tick: 480, string: 3 };
const TICKS = 1920;

describe('bends in the editor', () => {
    let f;
    const at = (pos) => f._findNote(pos).note;
    beforeEach(() => {
        f = new EditingFacade(doc());
        f.insertNote({ ...SRC, fret: 5, duration: 480 });
        f.insertNote({ ...TGT, fret: 6, duration: 480 });
        f.clearHistory();
    });

    it('Bend (up and hold) marks the next note on the string as the target', () => {
        expect(f.setEffect(SRC, 'bend', true)).toBe(true);
        expect(at(SRC).fx).toEqual(['bend']);
        expect(at(TGT).tech).toBe('b');
        expect(at(TGT).tie).toBeUndefined();
    });

    it('is one undo step, and undo unmarks the target', () => {
        f.setEffect(SRC, 'bend', true);
        expect(f._history.length).toBe(1);
        f.undo();
        expect(at(SRC).fx).toBeUndefined();
        expect(at(TGT).tech).toBeUndefined();
        f.redo();
        expect(at(TGT).tech).toBe('b');
    });

    it('turning the bend off unmarks the target', () => {
        f.setEffect(SRC, 'bend', true);
        f.setEffect(SRC, 'bend', false);
        expect(at(TGT).tech).toBeUndefined();
    });

    it('finds the target in a later measure, skipping other strings', () => {
        f.insertNote({ measure: 1, tick: 960, string: 2, fret: 0, duration: 480 });
        f.insertNote({ measure: 3, tick: 0, string: 3, fret: 7, duration: 480 });
        f.deleteNote(TGT);
        f.setEffect(SRC, 'bend-release', true);
        expect(at({ measure: 3, tick: 0, string: 3 }).tech).toBe('b');
        expect(at({ measure: 1, tick: 960, string: 2 }).tech).toBeUndefined();
    });

    it('a bend with no next note on the string has no target', () => {
        f.deleteNote(TGT);
        expect(f.setEffect(SRC, 'bend', true)).toBe(true);
        expect(at(SRC).fx).toEqual(['bend']);
    });

    it('does not override a technique or mark a same-fret note', () => {
        f.setArticulation(TGT, 'h');
        f.setEffect(SRC, 'bend', true);
        expect(at(TGT).tech).toBe('h');
        f.setArticulation(TGT, null);
        f.setArticulation(TGT, null);
        f.transposeFret(TGT, -1);          // 6 -> 5, same fret as the source
        f.setEffect(SRC, 'bend-release', true);
        expect(at(TGT).tech).toBeUndefined();
    });

    it('editing the target fret edits the amount', () => {
        f.setEffect(SRC, 'bend', true);
        f.transposeFret(TGT, 1);
        expect(at(TGT).f - at(SRC).f).toBe(2);
        expect(at(TGT).tech).toBe('b');
    });

    it('a range effect marks every target, in one undo step', () => {
        f.insertNote({ measure: 1, tick: 960, string: 2, fret: 3, duration: 480 });
        f.insertNote({ measure: 1, tick: 1440, string: 2, fret: 4, duration: 480 });
        f.clearHistory();
        f.setRangeEffect(0, 1440, 'bend', true);
        expect(at({ measure: 1, tick: 480, string: 3 }).tech).toBe('b');
        expect(at({ measure: 1, tick: 1440, string: 2 }).tech).toBe('b');
        expect(f._history.length).toBe(1);
    });

    describe('survives', () => {
        beforeEach(() => { f.setEffect(SRC, 'bend', true); f.clearHistory(); });

        it('copy and paste (both notes)', () => {
            f.copyRange(0, 960);
            f.paste(TICKS);
            expect(at({ measure: 2, tick: 0, string: 3 }).fx).toEqual(['bend']);
            expect(at({ measure: 2, tick: 480, string: 3 }).tech).toBe('b');
        });

        it('cut and paste elsewhere', () => {
            f.cutRange(0, 960);
            f.paste(TICKS * 2);
            expect(at({ measure: 3, tick: 0, string: 3 }).fx).toEqual(['bend']);
            expect(at({ measure: 3, tick: 480, string: 3 }).tech).toBe('b');
            expect(f._findNote(SRC).note).toBeNull();
        });

        it('moveRange', () => {
            f.moveRange(0, 960, TICKS);
            expect(at({ measure: 2, tick: 0, string: 3 }).fx).toEqual(['bend']);
            expect(at({ measure: 2, tick: 480, string: 3 }).tech).toBe('b');
        });

        it('inserting a measure before both', () => {
            f.insertMeasure(1);
            expect(at({ measure: 2, tick: 0, string: 3 }).fx).toEqual(['bend']);
            expect(at({ measure: 2, tick: 480, string: 3 }).tech).toBe('b');
        });

        it('deleting an earlier measure', () => {
            f.insertMeasure(1);
            f.deleteMeasure(1);
            expect(at(SRC).fx).toEqual(['bend']);
            expect(at(TGT).tech).toBe('b');
        });

        it('track rename, reorder and undo', () => {
            f.addTrack({ id: 'second', instrument: '5-string-banjo',
                tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'rhythm' });
            f.renameTrack('banjo', 'lead');
            f.moveTrack('lead', 1);
            const n = f.getNotation('lead')[0].events;
            expect(n[0].notes[0].fx).toEqual(['bend']);
            expect(n[1].notes[0].tech).toBe('b');
            f.undo(); f.undo();
            expect(f.getNotation('banjo')[0].events[1].notes[0].tech).toBe('b');
        });
    });

    describe('when the two notes are separated', () => {
        beforeEach(() => { f.setEffect(SRC, 'bend', true); f.clearHistory(); });

        it('deleting the source leaves the target a lone, still-marked note', () => {
            f.deleteNote(SRC);
            expect(at(TGT).tech).toBe('b');       // not rewritten; plays as a lone note
        });

        it('deleting the target leaves the bend with no target', () => {
            f.deleteNote(TGT);
            expect(at(SRC).fx).toEqual(['bend']);
        });

        it('a note inserted between them does not steal the bend', () => {
            f.insertNote({ measure: 1, tick: 240, string: 3, fret: 9, duration: 240 });
            expect(at({ measure: 1, tick: 240, string: 3 }).tech).toBeUndefined();
            expect(at(TGT).tech).toBe('b');
        });
    });
});
