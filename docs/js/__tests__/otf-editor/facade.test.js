// Unit tests for the OTF editing facade — the UI-free API both the
// mouse/touch UI and the vim-style keyboard drive.
//
// Instrument-agnostic by design: string counts come from track tuning
// data, measure math is ts-aware via measure-timing.js (mid-tune 2/4
// measures in a 2/2 tune, like 27493, must never corrupt edits).
import { describe, it, expect, beforeEach } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';

/** Uniform 4/4 five-string banjo doc, 4 empty measures. */
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
            banjo: [1, 2, 3, 4].map(m => ({ measure: m, events: [] })),
        },
    };
}

/**
 * Multi-track 2/2 doc with a mid-tune 2/4 measure (m3) — the 27493
 * shape. Guitar (6 strings) + bass (4 strings).
 * Measure ticks: m1=1920, m2=1920, m3=960, m4=1920, m5=1920.
 * Measure start abs ticks: 0, 1920, 3840, 4800, 6720.
 */
function tsChangeDoc() {
    return {
        otf_version: '1.0',
        metadata: {
            title: 'TS test', time_signature: '2/2', tempo: 100,
            time_signature_changes: [{ measure: 3, time_signature: '2/4' }],
        },
        timing: { ticks_per_beat: 480 },
        tracks: [
            {
                id: 'guitar', instrument: '6-string-guitar',
                tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0,
            },
            {
                id: 'bass', instrument: 'upright-bass',
                tuning: ['G2', 'D2', 'A1', 'E1'], capo: 0,
            },
        ],
        notation: {
            guitar: [1, 2, 3, 4, 5].map(m => ({ measure: m, events: [] })),
            bass: [1, 2, 3, 4, 5].map(m => ({ measure: m, events: [] })),
        },
    };
}

describe('EditingFacade — timing (ts-aware measure math)', () => {
    let f;
    beforeEach(() => { f = new EditingFacade(tsChangeDoc()); });

    it('measure tick lengths respect mid-tune signature changes', () => {
        expect(f.ticksFor(1)).toBe(1920); // 2/2
        expect(f.ticksFor(3)).toBe(960);  // 2/4
        expect(f.ticksFor(4)).toBe(1920); // reverts
    });

    it('signatureFor reports the effective signature', () => {
        expect(f.signatureFor(1)).toBe('2/2');
        expect(f.signatureFor(3)).toBe('2/4');
    });

    it('toAbs accumulates per-measure lengths', () => {
        expect(f.toAbs(1, 0)).toBe(0);
        expect(f.toAbs(3, 0)).toBe(3840);
        expect(f.toAbs(4, 0)).toBe(4800);  // after the short measure
        expect(f.toAbs(4, 480)).toBe(5280);
    });

    it('locate inverts toAbs across the change', () => {
        expect(f.locate(3840)).toMatchObject({ measure: 3, tick: 0 });
        expect(f.locate(4799)).toMatchObject({ measure: 3, tick: 959 });
        expect(f.locate(4800)).toMatchObject({ measure: 4, tick: 0 });
    });

    it('locate extrapolates past the last measure with the default length', () => {
        // 5 measures end at 8640; next measure is 2/2 default
        expect(f.locate(8640)).toMatchObject({ measure: 6, tick: 0 });
        expect(f.locate(8640 + 1920)).toMatchObject({ measure: 7, tick: 0 });
    });

    it('timing invalidates when the document is mutated past the end', () => {
        f.insertNote({ measure: 8, tick: 0, string: 1, fret: 0 });
        expect(f.toAbs(8, 0)).toBe(8640 + 2 * 1920);
    });
});

describe('EditingFacade — tracks (instrument-agnostic)', () => {
    it('defaults to the first track and derives string count from tuning', () => {
        const f = new EditingFacade(tsChangeDoc());
        expect(f.trackId).toBe('guitar');
        expect(f.stringCount()).toBe(6);
        expect(f.stringCount('bass')).toBe(4);
    });

    it('setTrack switches the notation being edited', () => {
        const f = new EditingFacade(tsChangeDoc());
        f.setTrack('bass');
        expect(f.trackId).toBe('bass');
        f.insertNote({ measure: 1, tick: 0, string: 4, fret: 0 });
        expect(f.getMeasure(1, 'bass').events).toHaveLength(1);
        expect(f.getMeasure(1, 'guitar').events).toHaveLength(0);
    });

    it('setTrack rejects unknown tracks', () => {
        const f = new EditingFacade(tsChangeDoc());
        expect(() => f.setTrack('kazoo')).toThrow();
    });

    it('does not deep-share the caller document', () => {
        const doc = banjoDoc();
        const f = new EditingFacade(doc);
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        expect(doc.notation.banjo[0].events).toHaveLength(0);
    });
});

describe('EditingFacade — insertNote', () => {
    let f;
    beforeEach(() => { f = new EditingFacade(banjoDoc()); });

    it('inserts a note with duration at the position', () => {
        f.insertNote({ measure: 1, tick: 240, string: 3, fret: 2, duration: 240 });
        const ev = f.getMeasure(1).events[0];
        expect(ev.tick).toBe(240);
        expect(ev.notes).toEqual([{ s: 3, f: 2, dur: 240 }]);
    });

    it('duration is optional (site OTFs mostly omit dur)', () => {
        f.insertNote({ measure: 1, tick: 0, string: 1, fret: 0 });
        expect(f.getMeasure(1).events[0].notes[0]).toEqual({ s: 1, f: 0 });
    });

    it('keeps events sorted and notes sorted by string', () => {
        f.insertNote({ measure: 1, tick: 480, string: 2, fret: 1 });
        f.insertNote({ measure: 1, tick: 0, string: 5, fret: 0 });
        f.insertNote({ measure: 1, tick: 0, string: 1, fret: 3 });
        const evs = f.getMeasure(1).events;
        expect(evs.map(e => e.tick)).toEqual([0, 480]);
        expect(evs[0].notes.map(n => n.s)).toEqual([1, 5]);
    });

    it('replaces an existing note on the same string', () => {
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 5 });
        expect(f.getMeasure(1).events[0].notes).toEqual([{ s: 3, f: 5 }]);
    });

    it('carries tech through', () => {
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2, tech: 'h' });
        expect(f.getMeasure(1).events[0].notes[0].tech).toBe('h');
    });

    it('rejects out-of-range strings for the instrument', () => {
        expect(() => f.insertNote({ measure: 1, tick: 0, string: 6, fret: 0 })).toThrow(RangeError);
        expect(() => f.insertNote({ measure: 1, tick: 0, string: 0, fret: 0 })).toThrow(RangeError);
    });

    it('creates measures when inserting past the end', () => {
        f.insertNote({ measure: 6, tick: 0, string: 1, fret: 0 });
        expect(f.getMeasure(6).events).toHaveLength(1);
    });

    it('splits at the barline into tie-continued notes', () => {
        // quarter starting 240 before the barline of a 4/4 measure
        f.insertNote({ measure: 1, tick: 1680, string: 3, fret: 2, duration: 480 });
        const first = f.getMeasure(1).events[0].notes[0];
        const second = f.getMeasure(2).events[0].notes[0];
        expect(first).toMatchObject({ s: 3, f: 2, dur: 240 });
        expect(second).toMatchObject({ s: 3, f: 2, dur: 240, tie: true });
    });

    it('tie-splits across measures of different lengths (ts change)', () => {
        const g = new EditingFacade(tsChangeDoc());
        // whole note (1920) starting 480 before the end of m2; m3 is 2/4 (960)
        g.insertNote({ measure: 2, tick: 1440, string: 1, fret: 0, duration: 1920 });
        const n2 = g.getMeasure(2).events[0].notes[0];
        const n3 = g.getMeasure(3).events[0].notes[0];
        const n4 = g.getMeasure(4).events[0].notes[0];
        expect(n2).toMatchObject({ dur: 480 });
        expect(n3).toMatchObject({ dur: 960, tie: true });   // fills the short measure
        expect(n4).toMatchObject({ dur: 480, tie: true });
        expect(n4.tie).toBe(true);
    });
});

describe('EditingFacade — delete / move / note edits', () => {
    let f;
    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2, tech: 'h' });
        f.insertNote({ measure: 1, tick: 0, string: 1, fret: 0 });
        f.insertNote({ measure: 1, tick: 240, string: 5, fret: 0 });
    });

    it('deleteNote removes one note and leaves siblings', () => {
        expect(f.deleteNote({ measure: 1, tick: 0, string: 3 })).toBe(true);
        expect(f.getMeasure(1).events[0].notes).toEqual([{ s: 1, f: 0 }]);
    });

    it('deleteNote drops the event when it empties', () => {
        f.deleteNote({ measure: 1, tick: 240, string: 5 });
        expect(f.getMeasure(1).events).toHaveLength(1);
    });

    it('deleteNote returns false when nothing is there', () => {
        expect(f.deleteNote({ measure: 3, tick: 0, string: 1 })).toBe(false);
    });

    it('deleteTick removes every note at the tick', () => {
        expect(f.deleteTick({ measure: 1, tick: 0 })).toBe(true);
        expect(f.getMeasure(1).events.map(e => e.tick)).toEqual([240]);
    });

    it('moveNote relocates and preserves fields (tech survives)', () => {
        expect(f.moveNote(
            { measure: 1, tick: 0, string: 3 },
            { measure: 2, tick: 480, string: 2 },
        )).toBe(true);
        expect(f.getMeasure(1).events[0].notes.map(n => n.s)).toEqual([1]);
        const moved = f.getMeasure(2).events[0].notes[0];
        expect(moved).toEqual({ s: 2, f: 2, tech: 'h' });
    });

    it('setArticulation sets and clears tech', () => {
        expect(f.setArticulation({ measure: 1, tick: 0, string: 1 }, 'p')).toBe(true);
        expect(f.getMeasure(1).events[0].notes[0].tech).toBe('p');
        expect(f.setArticulation({ measure: 1, tick: 0, string: 1 }, null)).toBe(true);
        expect(f.getMeasure(1).events[0].notes[0].tech).toBeUndefined();
    });

    it('setNoteDuration updates dur', () => {
        expect(f.setNoteDuration({ measure: 1, tick: 240, string: 5 }, 480)).toBe(true);
        expect(f.getMeasure(1).events[1].notes[0].dur).toBe(480);
    });
});

describe('EditingFacade — tick-range copy/paste (the phrase workflow)', () => {
    let f;
    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        // a two-beat phrase in m1: forward roll shape
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2, duration: 240 });
        f.insertNote({ measure: 1, tick: 240, string: 2, fret: 1, duration: 240 });
        f.insertNote({ measure: 1, tick: 480, string: 5, fret: 0, duration: 240 });
    });

    it('copyRange is half-open [start, end) with relative ticks', () => {
        const clip = f.copyRange(0, 480);
        expect(clip.span).toBe(480);
        expect(clip.data).toHaveLength(2); // tick 480 excluded
        expect(clip.data.map(d => d.relativeTick)).toEqual([0, 240]);
    });

    it('copyRange can filter to a string subset', () => {
        const clip = f.copyRange(0, 720, { strings: [5] });
        expect(clip.data).toHaveLength(1);
        expect(clip.data[0].notes[0].s).toBe(5);
    });

    it('paste re-buckets at the target and merges per string', () => {
        const clip = f.copyRange(0, 720);
        expect(f.paste(f.toAbs(2, 0), clip)).toBe(true);
        const m2 = f.getMeasure(2);
        expect(m2.events.map(e => e.tick)).toEqual([0, 240, 480]);
        expect(m2.events[0].notes[0]).toMatchObject({ s: 3, f: 2 });
    });

    it('paste across a barline splits into the right measures', () => {
        const clip = f.copyRange(0, 720);
        f.paste(f.toAbs(1, 1680), clip); // last eighth of m1 + spill into m2
        expect(f.getMeasure(1).events.map(e => e.tick)).toContain(1680);
        expect(f.getMeasure(2).events.map(e => e.tick)).toEqual(expect.arrayContaining([0, 240]));
    });

    it('paste is ts-aware: relative time is preserved across short measures', () => {
        const g = new EditingFacade(tsChangeDoc());
        g.insertNote({ measure: 1, tick: 0, string: 1, fret: 3, duration: 480 });
        g.insertNote({ measure: 1, tick: 480, string: 2, fret: 0, duration: 480 });
        const clip = g.copyRange(0, 960);
        // paste starting mid-m3 (the 2/4 measure): second note must land in m4
        g.paste(g.toAbs(3, 720), clip);
        expect(g.getMeasure(3).events.map(e => e.tick)).toEqual([720]);
        expect(g.getMeasure(4).events.map(e => e.tick)).toEqual([240]); // 720+480-960
    });

    it('paste without an explicit payload uses the internal clipboard', () => {
        f.copyRange(0, 480);
        expect(f.paste(f.toAbs(3, 0))).toBe(true);
        expect(f.getMeasure(3).events).toHaveLength(2);
    });

    it('paste returns false with an empty clipboard', () => {
        expect(f.paste(0)).toBe(false);
    });

    it('deleteRange clears only the range (and honors string filters)', () => {
        f.deleteRange(0, 480, { strings: [3] });
        expect(f.getMeasure(1).events.map(e => e.tick)).toEqual([240, 480]);
        f.deleteRange(0, 1920);
        expect(f.getMeasure(1).events).toEqual([]);
    });

    it('cutRange copies then deletes', () => {
        const clip = f.cutRange(0, 720);
        expect(clip.data).toHaveLength(3);
        expect(f.getMeasure(1).events).toEqual([]);
        f.paste(f.toAbs(4, 0), clip);
        expect(f.getMeasure(4).events).toHaveLength(3);
    });
});

describe('EditingFacade — moveRange (drag a phrase somewhere else)', () => {
    let f;
    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2, duration: 240 });
        f.insertNote({ measure: 1, tick: 240, string: 2, fret: 1, duration: 240 });
        f.insertNote({ measure: 1, tick: 480, string: 5, fret: 0, duration: 240 });
    });

    it('relocates the range wholesale', () => {
        expect(f.moveRange(0, 720, f.toAbs(3, 0))).toBe(true);
        expect(f.getMeasure(1).events).toEqual([]);
        expect(f.getMeasure(3).events.map(e => e.tick)).toEqual([0, 240, 480]);
        expect(f.getMeasure(3).events[0].notes[0]).toMatchObject({ s: 3, f: 2 });
    });

    it('is ONE undo step', () => {
        const before = f.export();
        f.moveRange(0, 720, f.toAbs(2, 480));
        expect(f.undo()).toBe(true);
        expect(f.export()).toEqual(before);
        expect(f.canUndo()).toBe(true); // only the setup inserts remain
    });

    it('handles overlapping source and destination', () => {
        // shift right by one grid step: 0..720 → 240..960
        expect(f.moveRange(0, 720, 240)).toBe(true);
        expect(f.getMeasure(1).events.map(e => e.tick)).toEqual([240, 480, 720]);
        expect(f.getMeasure(1).events[0].notes[0]).toMatchObject({ s: 3, f: 2 });
    });

    it('does not clobber the clipboard', () => {
        f.copyRange(480, 720); // user's copied lick
        const clip = f.clipboard;
        f.moveRange(0, 240, f.toAbs(4, 0));
        expect(f.clipboard).toBe(clip);
    });

    it('moves across a signature seam ts-aware', () => {
        const g = new EditingFacade(tsChangeDoc());
        g.insertNote({ measure: 1, tick: 0, string: 1, fret: 3, duration: 480 });
        g.insertNote({ measure: 1, tick: 480, string: 2, fret: 0, duration: 480 });
        // drop starting mid-m3 (the 2/4 measure): second note re-buckets into m4
        g.moveRange(0, 960, g.toAbs(3, 720));
        expect(g.getMeasure(1).events).toEqual([]);
        expect(g.getMeasure(3).events.map(e => e.tick)).toEqual([720]);
        expect(g.getMeasure(4).events.map(e => e.tick)).toEqual([240]);
    });

    it('returns false for an empty source range', () => {
        expect(f.moveRange(960, 1920, 0)).toBe(false);
        expect(f.canUndo()).toBe(true); // setup only; no move entry
    });
});

describe('EditingFacade — copyRange clipboard control', () => {
    it('updateClipboard:false leaves the clipboard alone', () => {
        const f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        f.copyRange(0, 240);
        const clip = f.clipboard;
        const payload = f.copyRange(0, 1920, { updateClipboard: false });
        expect(payload.data).toHaveLength(1);
        expect(f.clipboard).toBe(clip);
    });
});

describe('EditingFacade — repeats & endings (reading_list ops)', () => {
    // Repeat signs/endings are DERIVED from reading_list (play-order
    // ranges); editing repeats = editing the ranges. The ops work on
    // the expanded play sequence and recompress.
    let f;
    beforeEach(() => { f = new EditingFacade(banjoDoc()); }); // 4 measures, no reading list

    it('repeatSpan duplicates the span in play order', () => {
        expect(f.repeatSpan(1, 2)).toBe(true);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 2 },
            { from_measure: 1, to_measure: 4 },
        ]);
    });

    it('repeatSpan mid-document splits ranges correctly', () => {
        f.repeatSpan(2, 3);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 3 },
            { from_measure: 2, to_measure: 4 },
        ]);
    });

    it('repeatSpan is undoable in one step', () => {
        const before = f.export();
        f.repeatSpan(1, 2);
        f.undo();
        expect(f.export()).toEqual(before);
    });

    it('removeRepeat deletes the SECOND occurrence', () => {
        f.repeatSpan(1, 2);
        expect(f.removeRepeat(1, 2)).toBe(true);
        // back to a plain read-through (empty list = identity)
        expect(f.otf.reading_list || []).toEqual([]);
    });

    it('removeRepeat returns false when there is no repeat', () => {
        expect(f.removeRepeat(1, 2)).toBe(false);
        expect(f.canUndo()).toBe(false);
    });

    it('repeatSpanWithEndings produces the TablEdit range shape', () => {
        // body 1-2, 1st ending 3, 2nd ending 4:
        // play 1,2,3 | 1,2 | 4
        expect(f.repeatSpanWithEndings(1, 3, 3, 4)).toBe(true);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 3 },
            { from_measure: 1, to_measure: 2 },
            { from_measure: 4, to_measure: 4 },
        ]);
    });

    it('endings validate their boundaries', () => {
        expect(f.repeatSpanWithEndings(3, 1, 2, 4)).toBe(false); // ending before body
        expect(f.repeatSpanWithEndings(1, 3, 3, 3)).toBe(false); // no 2nd ending room
        expect(f.canUndo()).toBe(false);
    });

    it('repeat of an unplayed span is rejected', () => {
        f.repeatSpanWithEndings(1, 3, 3, 4);
        // measure 3 now only occurs inside the first pass; 3..4 is not
        // contiguous anywhere in the play order
        expect(f.repeatSpan(3, 4)).toBe(false);
    });

    it('playback timeline reflects the repeat (player-facing)', () => {
        f.repeatSpan(1, 2);
        // play order 1,2,1,2,3,4 → six slots
        const seq = f.readingSequence();
        expect(seq).toEqual([1, 2, 1, 2, 3, 4]);
    });
});

describe('EditingFacade — undo that never lies', () => {
    let f;
    beforeEach(() => { f = new EditingFacade(banjoDoc()); });

    it('undo restores the exact prior document', () => {
        const before = f.export();
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        expect(f.undo()).toBe(true);
        expect(f.export()).toEqual(before);
    });

    it('redo reapplies exactly', () => {
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        const after = f.export();
        f.undo();
        expect(f.redo()).toBe(true);
        expect(f.export()).toEqual(after);
    });

    it('every mutation is one undo step (delete, paste, move, range ops)', () => {
        const s0 = f.export();
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        const s1 = f.export();
        f.copyRange(0, 1920);
        f.paste(f.toAbs(2, 0));
        const s2 = f.export();
        f.deleteRange(0, 1920);
        expect(f.undo()).toBe(true);
        expect(f.export()).toEqual(s2);
        expect(f.undo()).toBe(true);
        expect(f.export()).toEqual(s1);
        expect(f.undo()).toBe(true);
        expect(f.export()).toEqual(s0);
        expect(f.canUndo()).toBe(false);
    });

    it('copyRange alone is not an undo step (reads are free)', () => {
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        f.copyRange(0, 1920);
        f.undo();
        expect(f.canUndo()).toBe(false);
    });

    it('transact groups many ops into one step', () => {
        const before = f.export();
        f.transact('enter a roll', () => {
            f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
            f.insertNote({ measure: 1, tick: 240, string: 2, fret: 1 });
            f.insertNote({ measure: 1, tick: 480, string: 5, fret: 0 });
        });
        expect(f.getMeasure(1).events).toHaveLength(3);
        expect(f.undo()).toBe(true);
        expect(f.export()).toEqual(before);
        expect(f.canUndo()).toBe(false);
    });

    it('a failed op inside transact still leaves a consistent doc', () => {
        const before = f.export();
        expect(() => f.transact('bad', () => {
            f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
            f.insertNote({ measure: 1, tick: 0, string: 9, fret: 0 }); // throws
        })).toThrow(RangeError);
        expect(f.export()).toEqual(before); // rolled back
        expect(f.canUndo()).toBe(false);
    });

    it('new edits clear the redo stack', () => {
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        f.undo();
        f.insertNote({ measure: 1, tick: 0, string: 1, fret: 0 });
        expect(f.canRedo()).toBe(false);
    });

    it('no-op mutations do not pollute history', () => {
        f.deleteNote({ measure: 2, tick: 0, string: 1 }); // nothing there
        expect(f.canUndo()).toBe(false);
    });

    it('undo restores timing after a ts-relevant document change', () => {
        const g = new EditingFacade(tsChangeDoc());
        g.insertNote({ measure: 9, tick: 0, string: 1, fret: 0 });
        const absM9 = g.toAbs(9, 0);
        g.undo();
        g.redo();
        expect(g.toAbs(9, 0)).toBe(absM9);
    });
});

describe('EditingFacade — load', () => {
    it('replaces the document, resets track, clears history + clipboard', () => {
        const f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        f.copyRange(0, 1920);
        f.load(tsChangeDoc());
        expect(f.trackId).toBe('guitar');
        expect(f.stringCount()).toBe(6);
        expect(f.canUndo()).toBe(false);
        expect(f.clipboard).toBeNull();
        expect(f.ticksFor(3)).toBe(960); // new doc's timing in effect
    });

    it('emits load and change', () => {
        const f = new EditingFacade(banjoDoc());
        const seen = [];
        f.on('load', () => seen.push('load'));
        f.on('change', () => seen.push('change'));
        f.load(banjoDoc());
        expect(seen).toEqual(['load', 'change']);
    });
});

describe('EditingFacade — change events', () => {
    it('emits change on mutations, not on reads', () => {
        const f = new EditingFacade(banjoDoc());
        let n = 0;
        f.on('change', () => n++);
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        f.getMeasure(1);
        f.copyRange(0, 480);
        expect(n).toBe(1);
        f.undo();
        expect(n).toBe(2);
    });

    it('transact emits a single change', () => {
        const f = new EditingFacade(banjoDoc());
        let n = 0;
        f.on('change', () => n++);
        f.transact('roll', () => {
            f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
            f.insertNote({ measure: 1, tick: 240, string: 2, fret: 1 });
        });
        expect(n).toBe(1);
    });
});

describe('EditingFacade — insertMeasure (structural, all tracks)', () => {
    it('shifts measures on EVERY track, not just the active one', () => {
        const f = new EditingFacade(tsChangeDoc(), { trackId: 'guitar' });
        f.insertNote({ measure: 4, tick: 0, string: 3, fret: 2, trackId: 'bass' });
        f.insertMeasure(3);
        // bass m4 note moved to m5 along with the guitar structure
        expect(f.getMeasure(5, 'bass').events).toHaveLength(1);
        expect(f.getMeasure(3, 'guitar')).toBeNull(); // new measure is empty
    });

    it('renumbers reading_list ranges past the split and grows straddlers', () => {
        const otf = banjoDoc();
        otf.notation.banjo = [1, 2, 3, 4, 5, 6, 7, 8].map(m => ({ measure: m, events: [] }));
        otf.reading_list = [
            { from_measure: 1, to_measure: 4 },  // straddles the insert at 3
            { from_measure: 1, to_measure: 4 },
            { from_measure: 5, to_measure: 8 },  // fully after it
        ];
        const f = new EditingFacade(otf);
        f.insertMeasure(3);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 5 },
            { from_measure: 1, to_measure: 5 },
            { from_measure: 6, to_measure: 9 },
        ]);
    });

    it('renumbers time_signature_changes and invalidates timing', () => {
        const f = new EditingFacade(tsChangeDoc());
        expect(f.ticksFor(3)).toBe(960); // the 2/4 measure
        f.insertMeasure(2);
        expect(f.otf.metadata.time_signature_changes[0].measure).toBe(4);
        expect(f.ticksFor(3)).toBe(1920); // timing cache refreshed
        expect(f.ticksFor(4)).toBe(960);
    });

    it('is one undoable step and emits one change', () => {
        const f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 2, tick: 0, string: 3, fret: 7 });
        let n = 0;
        f.on('change', () => n++);
        f.insertMeasure(2);
        expect(n).toBe(1);
        expect(f.getMeasure(3).events).toHaveLength(1); // note shifted
        f.undo();
        expect(f.getMeasure(2).events).toHaveLength(1); // back where it was
    });

    it('rejects nonsense measure numbers', () => {
        const f = new EditingFacade(banjoDoc());
        expect(f.insertMeasure(0)).toBe(false);
        expect(f.insertMeasure(NaN)).toBe(false);
        expect(f.canUndo()).toBe(false);
    });
});

describe('EditingFacade — setTempo / setFingering', () => {
    it('setTempo is undoable and no-ops on the same value', () => {
        const f = new EditingFacade(banjoDoc());
        expect(f.setTempo(160)).toBe(true);
        expect(f.otf.metadata.tempo).toBe(160);
        expect(f.setTempo(160)).toBe(false); // no history spam
        f.undo();
        expect(f.otf.metadata.tempo).toBe(120);
    });

    it('setTempo rejects garbage', () => {
        const f = new EditingFacade(banjoDoc());
        expect(f.setTempo('fast')).toBe(false);
        expect(f.setTempo(0)).toBe(false);
        expect(f.otf.metadata.tempo).toBe(120);
    });

    it('setFingering is undoable and clears with null', () => {
        const f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        const pos = { measure: 1, tick: 0, string: 3 };
        expect(f.setFingering(pos, 'T')).toBe(true);
        expect(f._findNote(pos).note.finger).toBe('T');
        f.undo();
        expect(f._findNote(pos).note.finger).toBeUndefined();
        f.redo();
        f.setFingering(pos, null);
        expect(f._findNote(pos).note.finger).toBeUndefined();
    });

    it('setFingering on empty position is a no-op', () => {
        const f = new EditingFacade(banjoDoc());
        expect(f.setFingering({ measure: 1, tick: 0, string: 3 }, 'T')).toBe(false);
    });
});

// ----------------------------------------------------------------------
// Fingering, BOTH hands. The vocabulary is the TEF importer's
// (`sources/banjo-hangout/src/tef_parser/otf.py`): picking hand
// T I M R P, fretting hand 0..4 — anything else would write a file
// nothing on the site draws.
// ----------------------------------------------------------------------

describe('EditingFacade — fingering, both hands', () => {
    let f;
    const pos = { measure: 1, tick: 0, string: 3 };
    const pos2 = { measure: 1, tick: 240, string: 2 };

    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 2 });
        f.insertNote({ measure: 1, tick: 240, string: 2, fret: 0 });
    });

    it('accepts the whole picking-hand vocabulary, ring and pinky included', () => {
        for (const finger of ['T', 'I', 'M', 'R', 'P']) {
            expect(f.setFingering(pos, finger)).toBe(true);
            expect(f._findNote(pos).note.finger).toBe(finger);
        }
    });

    it('throws on a letter that is not in the vocabulary', () => {
        expect(() => f.setFingering(pos, 'X')).toThrow(RangeError);
        expect(() => f.setFingering(pos, 't')).toThrow(RangeError);
        expect(f._findNote(pos).note.finger).toBeUndefined();
    });

    it('refuses (false, no history) when the note already reads that', () => {
        expect(f.setFingering(pos, 'M')).toBe(true);
        expect(f.setFingering(pos, 'M')).toBe(false);
        expect(f.setFingering(pos2, null)).toBe(false); // nothing to clear
    });

    it('setLeftHand takes 0..4 and nothing else', () => {
        for (const digit of [0, 1, 2, 3, 4]) {
            expect(f.setLeftHand(pos, digit)).toBe(true);
            expect(f._findNote(pos).note.lh).toBe(digit);
        }
        expect(() => f.setLeftHand(pos, 5)).toThrow(RangeError);
        expect(() => f.setLeftHand(pos, -1)).toThrow(RangeError);
        expect(() => f.setLeftHand(pos, '2')).toThrow(RangeError);
        expect(f._findNote(pos).note.lh).toBe(4);
    });

    it('keeps the two hands independent', () => {
        f.setFingering(pos, 'T');
        f.setLeftHand(pos, 2);
        expect(f._findNote(pos).note).toMatchObject({ finger: 'T', lh: 2 });
        f.setFingering(pos, null);
        expect(f._findNote(pos).note.finger).toBeUndefined();
        expect(f._findNote(pos).note.lh).toBe(2);
        f.setLeftHand(pos, null);
        expect(f._findNote(pos).note.lh).toBeUndefined();
    });

    it('lh 0 is a real value, not a cleared one', () => {
        expect(f.setLeftHand(pos, 0)).toBe(true);
        expect(f._findNote(pos).note.lh).toBe(0);
        expect(f.setLeftHand(pos, 0)).toBe(false);
        expect(f.setLeftHand(pos, null)).toBe(true);
        expect('lh' in f._findNote(pos).note).toBe(false);
    });

    it('is undoable in one step, per hand', () => {
        f.setFingering(pos, 'R');
        f.setLeftHand(pos, 3);
        f.undo();
        expect(f._findNote(pos).note.lh).toBeUndefined();
        expect(f._findNote(pos).note.finger).toBe('R');
        f.undo();
        expect(f._findNote(pos).note.finger).toBeUndefined();
        f.redo();
        expect(f._findNote(pos).note.finger).toBe('R');
    });

    it('setRangeFingering marks a phrase in ONE undo step', () => {
        expect(f.setRangeFingering(0, 480, 'I')).toBe(true);
        expect(f._findNote(pos).note.finger).toBe('I');
        expect(f._findNote(pos2).note.finger).toBe('I');
        f.undo();
        expect(f._findNote(pos).note.finger).toBeUndefined();
        expect(f._findNote(pos2).note.finger).toBeUndefined();
    });

    it('setRangeFingering honours `strings`', () => {
        expect(f.setRangeFingering(0, 480, 'P', { strings: [3] })).toBe(true);
        expect(f._findNote(pos).note.finger).toBe('P');
        expect(f._findNote(pos2).note.finger).toBeUndefined();
    });

    it('setRangeLeftHand honours `strings`, clears, and refuses a no-op', () => {
        expect(f.setRangeLeftHand(0, 480, 4, { strings: [2] })).toBe(true);
        expect(f._findNote(pos2).note.lh).toBe(4);
        expect(f._findNote(pos).note.lh).toBeUndefined();
        expect(f.setRangeLeftHand(0, 480, null)).toBe(true);
        expect(f._findNote(pos2).note.lh).toBeUndefined();
        expect(f.setRangeLeftHand(0, 480, null)).toBe(false);
    });

    it('the range ops validate their vocabulary too', () => {
        expect(() => f.setRangeFingering(0, 480, 'Z')).toThrow(RangeError);
        expect(() => f.setRangeLeftHand(0, 480, 9)).toThrow(RangeError);
    });

    it('an empty range changes nothing', () => {
        const depth = f._history.length;
        expect(f.setRangeFingering(1920, 2400, 'T')).toBe(false);
        expect(f.setRangeLeftHand(1920, 2400, 1)).toBe(false);
        expect(f._history.length).toBe(depth);
    });
});

// ----------------------------------------------------------------------
// Duration editing (TablEdit's `*`, `<`/`>`) — plan §3 P1-2
// ----------------------------------------------------------------------

describe('EditingFacade — duration editing', () => {
    let f;
    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 0, duration: 240 });
        f.insertNote({ measure: 1, tick: 240, string: 2, fret: 1, duration: 240 });
        f.insertNote({ measure: 1, tick: 480, string: 1, fret: 2, duration: 240 });
    });

    it('setNoteDuration re-times one note and is undoable', () => {
        const pos = { measure: 1, tick: 0, string: 3 };
        expect(f.setNoteDuration(pos, 480)).toBe(true);
        expect(f._findNote(pos).note.dur).toBe(480);
        f.undo();
        expect(f._findNote(pos).note.dur).toBe(240);
    });

    it('setNoteDuration is a no-op when the note already has it', () => {
        expect(f.setNoteDuration({ measure: 1, tick: 0, string: 3 }, 240)).toBe(false);
    });

    it('setRangeDuration applies to every note in the range', () => {
        expect(f.setRangeDuration(0, 480, 120)).toBe(true);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(120);
        expect(f._findNote({ measure: 1, tick: 240, string: 2 }).note.dur).toBe(120);
        // the note at 480 is outside [0, 480)
        expect(f._findNote({ measure: 1, tick: 480, string: 1 }).note.dur).toBe(240);
    });

    it('setRangeDuration honours a string filter and is one undo step', () => {
        expect(f.setRangeDuration(0, 1920, 60, { strings: [3] })).toBe(true);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(60);
        expect(f._findNote({ measure: 1, tick: 240, string: 2 }).note.dur).toBe(240);
        f.undo();
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(240);
    });

    it('setRangeDuration on an empty range changes nothing', () => {
        expect(f.setRangeDuration(1920, 3840, 120)).toBe(false);
    });

    it('scaleDuration halves and doubles', () => {
        const pos = { measure: 1, tick: 0, string: 3 };
        expect(f.scaleDuration(pos, 0.5)).toBe(true);
        expect(f._findNote(pos).note.dur).toBe(120);
        expect(f.scaleDuration(pos, 2)).toBe(true);
        expect(f._findNote(pos).note.dur).toBe(240);
    });

    it('scaleDuration clamps to [60, 1920]', () => {
        const pos = { measure: 1, tick: 0, string: 3 };
        f.setNoteDuration(pos, 60);
        expect(f.scaleDuration(pos, 0.5)).toBe(false);  // already at the floor
        f.setNoteDuration(pos, 1920);
        expect(f.scaleDuration(pos, 2)).toBe(false);    // already at the ceiling
        f.setNoteDuration(pos, 1440);
        expect(f.scaleDuration(pos, 2)).toBe(true);
        expect(f._findNote(pos).note.dur).toBe(1920);
    });

    it('scaleDuration scales an un-timed note from the column rule', () => {
        const g = new EditingFacade(banjoDoc());
        g.insertNote({ measure: 1, tick: 0, string: 3, fret: 0 });   // no dur
        g.insertNote({ measure: 1, tick: 240, string: 2, fret: 1 });
        const pos = { measure: 1, tick: 0, string: 3 };
        expect(g.autoDurationAt(pos)).toBe(240);
        expect(g.scaleDuration(pos, 2)).toBe(true);
        expect(g._findNote(pos).note.dur).toBe(480);
    });

    it('scaleRangeDuration scales a whole phrase in one step', () => {
        expect(f.scaleRangeDuration(0, 1920, 2)).toBe(true);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(480);
        expect(f._findNote({ measure: 1, tick: 480, string: 1 }).note.dur).toBe(480);
        f.undo();
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(240);
    });

    it('scaleDuration on an empty slot is a no-op', () => {
        expect(f.scaleDuration({ measure: 2, tick: 0, string: 3 }, 2)).toBe(false);
    });
});

// ----------------------------------------------------------------------
// Note fixes: fret transpose and pitch-preserving re-stringing
// ----------------------------------------------------------------------

describe('EditingFacade — transposeFret / moveNoteToString', () => {
    let f;
    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 5, duration: 240 });
    });

    it('transposeFret moves by delta and is undoable', () => {
        const pos = { measure: 1, tick: 0, string: 3 };
        expect(f.transposeFret(pos, 1)).toBe(true);
        expect(f._findNote(pos).note.f).toBe(6);
        f.undo();
        expect(f._findNote(pos).note.f).toBe(5);
    });

    it('transposeFret clamps to 0..24 and refuses when already there', () => {
        const pos = { measure: 1, tick: 0, string: 3 };
        f.setNoteDuration(pos, 240);
        expect(f.transposeFret(pos, -99)).toBe(true);
        expect(f._findNote(pos).note.f).toBe(0);
        expect(f.transposeFret(pos, -1)).toBe(false);
        expect(f.transposeFret(pos, 99)).toBe(true);
        expect(f._findNote(pos).note.f).toBe(24);
        expect(f.transposeFret(pos, 1)).toBe(false);
    });

    it('moveNoteToString keeps the pitch (G3 fret 5 → D3 fret 10)', () => {
        // banjo tuning D4 B3 G3 D3 G4: string 3 = G3 (55), string 4 = D3 (50)
        expect(f.moveNoteToString({ measure: 1, tick: 0, string: 3 }, 1)).toBe(true);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note).toBe(null);
        const moved = f._findNote({ measure: 1, tick: 0, string: 4 }).note;
        expect(moved.f).toBe(10);
        expect(moved.dur).toBe(240);
    });

    it('moveNoteToString refuses when the fret would leave 0..24', () => {
        f.insertNote({ measure: 2, tick: 0, string: 4, fret: 0, duration: 240 });
        // D3 open onto G3 would be fret -5
        expect(f.moveNoteToString({ measure: 2, tick: 0, string: 4 }, -1)).toBe(false);
        expect(f._findNote({ measure: 2, tick: 0, string: 4 }).note.f).toBe(0);
    });

    it('moveNoteToString refuses an occupied target slot', () => {
        f.insertNote({ measure: 1, tick: 0, string: 4, fret: 0, duration: 240 });
        expect(f.moveNoteToString({ measure: 1, tick: 0, string: 3 }, 1)).toBe(false);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.f).toBe(5);
    });

    it('moveNoteToString refuses past the last string, and off the neck', () => {
        expect(f.moveNoteToString({ measure: 1, tick: 0, string: 3 }, 2)).toBe(false);
        f.insertNote({ measure: 3, tick: 0, string: 5, fret: 0, duration: 240 });
        expect(f.moveNoteToString({ measure: 3, tick: 0, string: 5 }, 1)).toBe(false);
    });

    it('moveNoteToString is one undo step', () => {
        f.moveNoteToString({ measure: 1, tick: 0, string: 3 }, 1);
        f.undo();
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.f).toBe(5);
        expect(f._findNote({ measure: 1, tick: 0, string: 4 }).note).toBe(null);
    });
});

// ----------------------------------------------------------------------
// Techniques the corpus has and the editor could not produce (#184)
// ----------------------------------------------------------------------

describe('EditingFacade — technique vocabulary', () => {
    it('accepts x (dead note) and b (choke) on entry and after the fact', () => {
        const f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 2, fret: 0, duration: 240, tech: 'x' });
        expect(f._findNote({ measure: 1, tick: 0, string: 2 }).note.tech).toBe('x');
        f.insertNote({ measure: 1, tick: 240, string: 1, fret: 5, duration: 240 });
        const pos = { measure: 1, tick: 240, string: 1 };
        expect(f.setArticulation(pos, 'b')).toBe(true);
        expect(f._findNote(pos).note.tech).toBe('b');
    });

    it('rejects a tech the renderer and player have never seen', () => {
        const f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 0, duration: 240 });
        expect(() => f.setArticulation({ measure: 1, tick: 0, string: 3 }, 'q'))
            .toThrow(RangeError);
        expect(() => f.insertNote({
            measure: 1, tick: 480, string: 3, fret: 0, duration: 240, tech: 'zz',
        })).toThrow(RangeError);
    });
});

// ----------------------------------------------------------------------
// Ties: `tie: true` on the continuation, never `tech: '~'`
// ----------------------------------------------------------------------

describe('EditingFacade — ties', () => {
    let f;
    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 0, duration: 240 });
        f.insertNote({ measure: 1, tick: 240, string: 3, fret: 0, duration: 240 });
    });

    it('setTie marks the continuation note', () => {
        const pos = { measure: 1, tick: 240, string: 3 };
        expect(f.setTie(pos, true)).toBe(true);
        expect(f._findNote(pos).note.tie).toBe(true);
        f.undo();
        expect(f._findNote(pos).note.tie).toBeUndefined();
    });

    it('setTie refuses with no same-string predecessor', () => {
        // string 2 has nothing before it
        f.insertNote({ measure: 1, tick: 240, string: 2, fret: 1, duration: 240 });
        const pos = { measure: 1, tick: 240, string: 2 };
        expect(f.setTie(pos, true)).toBe(false);
        expect(f._findNote(pos).note.tie).toBeUndefined();
        expect(f.canUndo()).toBe(true);   // only the inserts are on the stack
        f.undo();
        expect(f._findNote(pos).note).toBe(null);
    });

    it('accepts a predecessor at the end of the previous measure', () => {
        f.insertNote({ measure: 2, tick: 0, string: 3, fret: 0, duration: 240 });
        expect(f.setTie({ measure: 2, tick: 0, string: 3 }, true)).toBe(true);
    });

    it('clearing a tie that is not set is a no-op', () => {
        expect(f.setTie({ measure: 1, tick: 240, string: 3 }, false)).toBe(false);
    });

    it('tie and tech are independent fields', () => {
        const pos = { measure: 1, tick: 240, string: 3 };
        f.setArticulation(pos, '/');
        f.setTie(pos, true);
        expect(f._findNote(pos).note).toMatchObject({ tech: '/', tie: true });
        f.setArticulation(pos, null);
        expect(f._findNote(pos).note.tie).toBe(true);
        f.setArticulation(pos, 'h');
        f.setTie(pos, false);
        expect(f._findNote(pos).note.tech).toBe('h');
        expect(f._findNote(pos).note.tie).toBeUndefined();
    });

    it("setArticulation('~') means tie, and never writes tech", () => {
        const pos = { measure: 1, tick: 240, string: 3 };
        expect(f.setArticulation(pos, '~')).toBe(true);
        expect(f._findNote(pos).note.tie).toBe(true);
        expect(f._findNote(pos).note.tech).toBeUndefined();
    });

    it("insertNote with tech '~' ties when it can, and never writes tech", () => {
        f.insertNote({ measure: 1, tick: 480, string: 3, fret: 0, duration: 240, tech: '~' });
        const tied = f._findNote({ measure: 1, tick: 480, string: 3 }).note;
        expect(tied.tie).toBe(true);
        expect(tied.tech).toBeUndefined();

        // Nothing before it on string 1 → placed, but not tied
        f.insertNote({ measure: 1, tick: 480, string: 1, fret: 7, duration: 240, tech: '~' });
        const lone = f._findNote({ measure: 1, tick: 480, string: 1 }).note;
        expect(lone.tie).toBeUndefined();
        expect(lone.tech).toBeUndefined();
    });

    it("load() converts legacy tech '~' to a tie, or drops it", () => {
        const doc = banjoDoc();
        doc.notation.banjo[0].events = [
            { tick: 0, notes: [{ s: 3, f: 0, dur: 240 }] },
            { tick: 240, notes: [{ s: 3, f: 0, dur: 240, tech: '~' }] },
            { tick: 480, notes: [{ s: 1, f: 5, dur: 240, tech: '~' }] },
        ];
        const g = new EditingFacade(doc);
        expect(g._findNote({ measure: 1, tick: 240, string: 3 }).note)
            .toEqual({ s: 3, f: 0, dur: 240, tie: true });
        expect(g._findNote({ measure: 1, tick: 480, string: 1 }).note)
            .toEqual({ s: 1, f: 5, dur: 240 });
    });

    it('a document without ~ round-trips byte-identical through load', () => {
        const doc = banjoDoc();
        doc.notation.banjo[0].events = [
            { tick: 0, notes: [{ s: 3, f: 0, dur: 240, tech: 'h' }] },
            { tick: 240, notes: [{ s: 3, f: 2, dur: 240, tie: true }] },
        ];
        const before = JSON.stringify(doc);
        const g = new EditingFacade(doc);
        expect(JSON.stringify(g.export())).toBe(before);
        g.load(JSON.parse(before));
        expect(JSON.stringify(g.export())).toBe(before);
    });
});

// ----------------------------------------------------------------------
// Measures: delete, ripple, repeat
// ----------------------------------------------------------------------

describe('EditingFacade — deleteMeasure', () => {
    it('is the inverse of insertMeasure across all tracks', () => {
        const f = new EditingFacade(tsChangeDoc());
        f.insertNote({ measure: 4, tick: 0, string: 1, fret: 7, duration: 480, trackId: 'guitar' });
        f.insertNote({ measure: 4, tick: 0, string: 1, fret: 3, duration: 480, trackId: 'bass' });
        const before = JSON.stringify(f.export());

        f.insertMeasure(2);
        expect(f.getMeasure(5, 'guitar').events[0].notes[0].f).toBe(7);
        expect(f.deleteMeasure(2)).toBe(true);
        expect(JSON.stringify(f.export())).toBe(before);
    });

    it('renumbers reading_list, annotations and ts changes', () => {
        const f = new EditingFacade(tsChangeDoc());
        f.otf.reading_list = [
            { from_measure: 1, to_measure: 2 },
            { from_measure: 2, to_measure: 2 },
            { from_measure: 3, to_measure: 5 },
        ];
        f.otf.annotations = [
            { measure: 1, tick: 0, text: 'PART A' },
            { measure: 2, tick: 0, text: 'gone' },
            { measure: 4, tick: 0, text: 'PART B' },
        ];
        f._invalidateTiming();
        expect(f.deleteMeasure(2)).toBe(true);
        expect(f.otf.reading_list).toEqual([
            { from_measure: 1, to_measure: 1 },
            { from_measure: 2, to_measure: 4 },
        ]);
        expect(f.otf.annotations).toEqual([
            { measure: 1, tick: 0, text: 'PART A' },
            { measure: 3, tick: 0, text: 'PART B' },
        ]);
        // the 2/4 change at m3 follows its measure back to m2
        expect(f.otf.metadata.time_signature_changes).toEqual([
            { measure: 2, time_signature: '2/4' },
        ]);
        expect(f.ticksFor(2)).toBe(960);
    });

    it('every surviving measure keeps its signature when the deleted one had a change', () => {
        const f = new EditingFacade(tsChangeDoc());
        // m3 = 2/4, m4 = back to 2/2 via an explicit change
        f.otf.metadata.time_signature_changes = [
            { measure: 3, time_signature: '2/4' },
            { measure: 4, time_signature: '2/2' },
        ];
        f._invalidateTiming();
        expect(f.deleteMeasure(3)).toBe(true);
        expect(f.ticksFor(3)).toBe(1920);   // what used to be m4
        expect(f.otf.metadata.time_signature_changes).toEqual([
            { measure: 3, time_signature: '2/2' },
        ]);
    });

    it('drops reading_list entirely when nothing is left of it', () => {
        const f = new EditingFacade(banjoDoc());
        f.otf.reading_list = [{ from_measure: 2, to_measure: 2 }];
        expect(f.deleteMeasure(2)).toBe(true);
        expect(f.otf.reading_list).toBeUndefined();
    });

    it('refuses out-of-range numbers and the last measure standing', () => {
        const f = new EditingFacade(banjoDoc());
        expect(f.deleteMeasure(0)).toBe(false);
        expect(f.deleteMeasure(9)).toBe(false);
        f.deleteMeasure(4); f.deleteMeasure(3); f.deleteMeasure(2);
        expect(f.getMeasureCount()).toBe(1);
        expect(f.deleteMeasure(1)).toBe(false);
    });

    it('is one undo step', () => {
        const f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 3, tick: 0, string: 3, fret: 5, duration: 240 });
        const before = JSON.stringify(f.export());
        f.deleteMeasure(2);
        f.undo();
        expect(JSON.stringify(f.export())).toBe(before);
    });
});

describe('EditingFacade — shiftRight / shiftLeft', () => {
    let f;
    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 3, fret: 0, duration: 240 });
        f.insertNote({ measure: 1, tick: 240, string: 2, fret: 1, duration: 240 });
        f.insertNote({ measure: 1, tick: 480, string: 1, fret: 2, duration: 240 });
    });

    it('moves everything at or after the tick', () => {
        expect(f.shiftRight(1, 240, 240)).toBe(true);
        expect(f.getMeasure(1).events.map(e => e.tick)).toEqual([0, 480, 720]);
        expect(f._findNote({ measure: 1, tick: 480, string: 2 }).note.f).toBe(1);
    });

    it('shiftLeft closes the hole', () => {
        f.shiftRight(1, 240, 240);
        expect(f.shiftLeft(1, 480, 240)).toBe(true);
        expect(f.getMeasure(1).events.map(e => e.tick)).toEqual([0, 240, 480]);
    });

    it('refuses to push a note past the barline, with no mutation', () => {
        const before = JSON.stringify(f.export());
        expect(f.shiftRight(1, 0, 1680)).toBe(false);
        expect(JSON.stringify(f.export())).toBe(before);
    });

    it('refuses to pull a note before the barline', () => {
        expect(f.shiftLeft(1, 0, 240)).toBe(false);
        expect(f.getMeasure(1).events[0].tick).toBe(0);
    });

    it('refuses to land on an occupied slot', () => {
        // shifting the tail left by 240 would put it on tick 0
        expect(f.shiftLeft(1, 240, 240)).toBe(false);
    });

    it('returns false when there is nothing at or after the tick', () => {
        expect(f.shiftRight(1, 960, 240)).toBe(false);
        expect(f.shiftRight(2, 0, 240)).toBe(false);
    });

    it('is one undo step', () => {
        const before = JSON.stringify(f.export());
        f.shiftRight(1, 0, 240);
        f.undo();
        expect(JSON.stringify(f.export())).toBe(before);
    });
});

describe('EditingFacade — repeatMeasure', () => {
    let f;
    beforeEach(() => {
        f = new EditingFacade(banjoDoc());
        f.insertNote({ measure: 1, tick: 0, string: 5, fret: 0, duration: 240 });
        f.insertNote({ measure: 1, tick: 240, string: 3, fret: 0, duration: 240 });
    });

    it('copies the previous measure into an empty one', () => {
        expect(f.repeatMeasure(2)).toBe(true);
        expect(f.getMeasure(2).events.map(e => e.tick)).toEqual([0, 240]);
        expect(f._findNote({ measure: 2, tick: 240, string: 3 }).note.dur).toBe(240);
        // a copy, not a shared reference
        f.setNoteDuration({ measure: 2, tick: 0, string: 5 }, 480);
        expect(f._findNote({ measure: 1, tick: 0, string: 5 }).note.dur).toBe(240);
    });

    it('creates the measure when it does not exist yet', () => {
        f.otf.notation.banjo = f.otf.notation.banjo.filter(m => m.measure === 1);
        f._invalidateTiming();
        expect(f.repeatMeasure(2)).toBe(true);
        expect(f.getMeasure(2).events.length).toBe(2);
    });

    it('refuses when the target already has notes', () => {
        f.insertNote({ measure: 2, tick: 0, string: 1, fret: 7, duration: 240 });
        expect(f.repeatMeasure(2)).toBe(false);
        expect(f.getMeasure(2).events.length).toBe(1);
    });

    it('refuses at measure 1, and when the source is empty', () => {
        expect(f.repeatMeasure(1)).toBe(false);
        expect(f.repeatMeasure(4)).toBe(false);  // m3 is empty
    });

    it('refuses when the source does not fit the destination', () => {
        const g = new EditingFacade(tsChangeDoc());
        // m2 is 1920 ticks, m3 is 960
        g.insertNote({ measure: 2, tick: 1440, string: 1, fret: 0, duration: 240, trackId: 'guitar' });
        expect(g.repeatMeasure(3, { trackId: 'guitar' })).toBe(false);
    });

    it('is one undo step', () => {
        const before = JSON.stringify(f.export());
        f.repeatMeasure(2);
        f.undo();
        expect(JSON.stringify(f.export())).toBe(before);
    });
});

// ----------------------------------------------------------------------
// Automatic duration — the column rule (plan §6)
// ----------------------------------------------------------------------

describe('EditingFacade — automatic duration', () => {
    const pins = () => new Set();
    /** Enter a note under auto, tracking the session sets. */
    function auto(f, measure, tick, string, fret, sets) {
        return f.insertNote({
            measure, tick, string, fret,
            autoDuration: true, pins: sets.pins, autoEntered: sets.autoEntered,
        });
    }
    const sets = () => ({ pins: pins(), autoEntered: new Set() });
    const durs = (f, measure = 1) => f.getMeasure(measure).events
        .flatMap(e => e.notes.map(n => n.dur));

    it('a Scruggs roll on a 1/8 grid comes out as eight eighths', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        const roll = [5, 3, 2, 5, 3, 2, 5, 3];   // strings, forward roll
        roll.forEach((string, i) => auto(f, 1, i * 240, string, 0, s));
        expect(durs(f)).toEqual(new Array(8).fill(240));
    });

    it('a triplet grid yields triplet eighths', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        // Three triplet eighths and the downbeat that closes them: on a
        // 160 grid the gaps ARE triplets, with no triplet MODE anywhere.
        [0, 160, 320, 480].forEach((tick, i) => auto(f, 1, tick, 3 - (i % 3), 0, s));
        expect(durs(f)).toEqual([160, 160, 160, 1440]);
    });

    it('a lone note fills the measure, and shortens when another lands', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 0, 3, 0, s);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(1920);
        auto(f, 1, 240, 2, 1, s);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(240);
        expect(f._findNote({ measure: 1, tick: 240, string: 2 }).note.dur).toBe(1680);
    });

    it('deleting the second note re-extends the first', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 0, 3, 0, s);
        auto(f, 1, 240, 2, 1, s);
        f.deleteNote({ measure: 1, tick: 240, string: 2 }, 'banjo',
            { autoDuration: true, ...s });
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(1920);
    });

    it('a chord at one tick shares one duration', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 0, 3, 0, s);
        auto(f, 1, 0, 2, 1, s);
        auto(f, 1, 480, 1, 2, s);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(480);
        expect(f._findNote({ measure: 1, tick: 0, string: 2 }).note.dur).toBe(480);
    });

    it('never ties across the barline: each measure is computed alone', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 1680, 3, 0, s);
        auto(f, 2, 0, 3, 0, s);
        expect(f._findNote({ measure: 1, tick: 1680, string: 3 }).note.dur).toBe(240);
        expect(f._findNote({ measure: 1, tick: 1680, string: 3 }).note.tie).toBeUndefined();
        expect(f._findNote({ measure: 2, tick: 0, string: 3 }).note.dur).toBe(1920);
    });

    it('a pinned note is never re-timed', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 0, 3, 0, s);
        s.pins.add('1:0:3');
        s.autoEntered.delete('1:0:3');
        f.setNoteDuration({ measure: 1, tick: 0, string: 3 }, 1920);
        auto(f, 1, 240, 2, 1, s);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(1920);
        expect(f._findNote({ measure: 1, tick: 240, string: 2 }).note.dur).toBe(1680);
    });

    it('a loaded document is never re-timed by auto', () => {
        const doc = banjoDoc();
        doc.notation.banjo[0].events = [
            { tick: 0, notes: [{ s: 3, f: 0, dur: 1920 }] },
        ];
        const f = new EditingFacade(doc);
        const s = sets();   // fresh session: no keys at all
        auto(f, 1, 240, 2, 1, s);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(1920);
    });

    it('one undo takes back the note AND the neighbour re-timing', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 0, 3, 0, s);
        auto(f, 1, 240, 2, 1, s);
        f.undo();
        expect(f._findNote({ measure: 1, tick: 240, string: 2 }).note).toBe(null);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(1920);
    });

    it('autoDurationAt predicts the slot before anything is typed', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 480, 3, 0, s);
        expect(f.autoDurationAt({ measure: 1, tick: 0 })).toBe(480);
        expect(f.autoDurationAt({ measure: 1, tick: 480 })).toBe(1440);
        expect(f.autoDurationAt({ measure: 2, tick: 0 })).toBe(1920);
    });

    it('fixDurations repairs a measure regardless of pins', () => {
        const doc = banjoDoc();
        doc.notation.banjo[0].events = [
            { tick: 0, notes: [{ s: 3, f: 0, dur: 1920 }] },
            { tick: 240, notes: [{ s: 2, f: 1, dur: 1920 }] },
            { tick: 480, notes: [{ s: 1, f: 2, dur: 60 }] },
        ];
        const f = new EditingFacade(doc);
        expect(f.fixDurations(1)).toBe(true);
        expect(durs(f)).toEqual([240, 240, 1440]);
        f.undo();
        expect(durs(f)).toEqual([1920, 1920, 60]);
    });

    it('fixDurations over a range only re-times what the range covers', () => {
        const doc = banjoDoc();
        doc.notation.banjo[0].events = [
            { tick: 0, notes: [{ s: 3, f: 0, dur: 1920 }] },
            { tick: 240, notes: [{ s: 2, f: 1, dur: 1920 }] },
        ];
        const f = new EditingFacade(doc);
        expect(f.fixDurations({ startAbs: 0, endAbs: 240 })).toBe(true);
        expect(durs(f)).toEqual([240, 1920]);
    });

    it('fixDurations on already-correct durations changes nothing', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 0, 3, 0, s);
        expect(f.fixDurations(1)).toBe(false);
    });

    it('paste under auto keeps its own rhythm but re-times the neighbours', () => {
        const f = new EditingFacade(banjoDoc());
        const s = sets();
        auto(f, 1, 0, 3, 0, s);           // fills the measure: 1920
        f.insertNote({ measure: 3, tick: 0, string: 1, fret: 7, duration: 120 });
        const payload = f.copyRange(f.toAbs(3, 0), f.toAbs(3, 120));
        f.paste(f.toAbs(1, 960), payload,
            { autoDuration: true, pins: s.pins, autoEntered: s.autoEntered });
        expect(f._findNote({ measure: 1, tick: 960, string: 1 }).note.dur).toBe(120);
        expect(f._findNote({ measure: 1, tick: 0, string: 3 }).note.dur).toBe(960);
    });
});
