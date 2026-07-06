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
