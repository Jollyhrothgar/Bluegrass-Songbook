// Dynamics (`note.dyn` against `tracks[].dyn`, default f) — the facade half.
// A note with no dyn plays at its track's level; note.dyn is stored only when
// it differs; a tied note carries none. Every op is one undo step and the
// field survives copy/paste/move, measure insert/delete, track ops and undo.
import { describe, it, expect, beforeEach } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';
import { validateOTF, DYN_LEVELS } from '../../otf-editor/otf-validate.js';

const TUNING = ['D4', 'B3', 'G3', 'D3', 'G4'];
function doc(extraTrack = {}) {
    const note = (s, f, extra = {}) => ({ s, f, dur: 480, ...extra });
    return {
        otf_version: '1.0',
        metadata: { title: 'T', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [
            { id: 'banjo', instrument: '5-string-banjo', tuning: TUNING, capo: 0, role: 'lead' },
            { id: 'guitar', instrument: '5-string-banjo', tuning: TUNING, capo: 0, role: 'rhythm',
                ...extraTrack },
        ],
        notation: {
            banjo: [
                { measure: 1, events: [
                    { tick: 0, notes: [note(1, 0)] },
                    { tick: 480, notes: [note(2, 1), note(3, 2)] },
                    { tick: 960, notes: [note(1, 0, { tie: true })] },
                ] },
                { measure: 2, events: [{ tick: 0, notes: [note(1, 3)] }] },
            ],
            guitar: [{ measure: 1, events: [{ tick: 0, notes: [note(4, 0)] }] }],
        },
    };
}
const at = (f, measure, tick, s, trackId = 'banjo') =>
    f.getNotation(trackId).find(m => m.measure === measure)
        .events.find(e => e.tick === tick).notes.find(n => n.s === s);

let f;
beforeEach(() => { f = new EditingFacade(doc()); f.setTrack('banjo'); });

describe('setDynamic', () => {
    it('sets a level, stamps 1.2, and is one undo step', () => {
        expect(f.setDynamic({ measure: 1, tick: 0, string: 1 }, 'mf')).toBe(true);
        expect(at(f, 1, 0, 1).dyn).toBe('mf');
        expect(f.otf.otf_version).toBe('1.2');
        f.undo();
        expect(at(f, 1, 0, 1).dyn).toBeUndefined();
        expect(f.otf.otf_version).toBe('1.0');
        f.redo();
        expect(at(f, 1, 0, 1).dyn).toBe('mf');
    });

    it('accepts every one of the seven levels, and the result validates', () => {
        DYN_LEVELS.forEach((lv, i) => {
            f.setDynamic({ measure: 1, tick: 0, string: 1 }, lv);
            expect(validateOTF(f.export()).errors ?? []).toEqual([]);
            expect(at(f, 1, 0, 1).dyn).toBe(lv === 'f' ? undefined : lv);
            expect(i).toBeLessThan(7);
        });
        expect(DYN_LEVELS).toHaveLength(7);
    });

    it('null ("Track default") clears it', () => {
        f.setDynamic({ measure: 1, tick: 0, string: 1 }, 'pp');
        expect(f.setDynamic({ measure: 1, tick: 0, string: 1 }, null)).toBe(true);
        expect(at(f, 1, 0, 1)).not.toHaveProperty('dyn');
    });

    it('setting the track\'s own level stores nothing (dyn only when it differs)', () => {
        expect(f.setDynamic({ measure: 1, tick: 0, string: 1 }, 'f')).toBe(false);
        f.setDynamic({ measure: 1, tick: 0, string: 1 }, 'ff');
        expect(f.setDynamic({ measure: 1, tick: 0, string: 1 }, 'f')).toBe(true);
        expect(at(f, 1, 0, 1)).not.toHaveProperty('dyn');
    });

    it('measures against the track level when the track has one', () => {
        const g = new EditingFacade(doc({ dyn: 'mp' }));
        g.setTrack('guitar');
        expect(g.setDynamic({ measure: 1, tick: 0, string: 4 }, 'mp')).toBe(false);
        expect(g.setDynamic({ measure: 1, tick: 0, string: 4 }, 'f')).toBe(true);
        expect(at(g, 1, 0, 4, 'guitar').dyn).toBe('f');
    });

    it('refuses no note, a no-op, a tied note, and an unknown level', () => {
        expect(f.setDynamic({ measure: 1, tick: 0, string: 5 }, 'mf')).toBe(false);
        expect(f.setDynamic({ measure: 1, tick: 0, string: 1 }, null)).toBe(false);
        expect(f.setDynamic({ measure: 1, tick: 960, string: 1 }, 'mf')).toBe(false);
        expect(() => f.setDynamic({ measure: 1, tick: 0, string: 1 }, 'ppp')).toThrow(RangeError);
        expect(f.canUndo()).toBe(false);
    });

    it('tying a note drops its dyn', () => {
        f.setDynamic({ measure: 2, tick: 0, string: 1 }, 'pp');
        // measure 1's last note on string 1 is the tie source for measure 2
        expect(f.setTie({ measure: 2, tick: 0, string: 1 }, true)).toBe(true);
        expect(at(f, 2, 0, 1)).not.toHaveProperty('dyn');
    });
});

describe('setRangeDynamic', () => {
    it('is one undo step over the range, honours strings, skips ties', () => {
        expect(f.setRangeDynamic(0, 1440, 'ff', { strings: [1, 2] })).toBe(true);
        expect(at(f, 1, 0, 1).dyn).toBe('ff');
        expect(at(f, 1, 480, 2).dyn).toBe('ff');
        expect(at(f, 1, 480, 3)).not.toHaveProperty('dyn');   // string filtered out
        expect(at(f, 1, 960, 1)).not.toHaveProperty('dyn');   // tied
        f.undo();
        expect(f.getNotation().flatMap(m => m.events.flatMap(e => e.notes)).some(n => n.dyn)).toBe(false);
    });

    it('returns false when nothing changes and leaves no history', () => {
        expect(f.setRangeDynamic(0, 1440, null)).toBe(false);
        expect(f.canUndo()).toBe(false);
    });
});

describe('dynamics survive the other facade ops', () => {
    beforeEach(() => {
        f.setDynamic({ measure: 1, tick: 0, string: 1 }, 'mf');
        f.setDynamic({ measure: 2, tick: 0, string: 1 }, 'fff');
    });

    it('copy / paste in the same track keeps dyn', () => {
        const payload = f.copyRange(0, 480);
        f.paste(f.toAbs(2, 960), payload);
        expect(at(f, 2, 960, 1).dyn).toBe('mf');
    });

    it('cut / paste and moveRange keep dyn', () => {
        const payload = f.cutRange(0, 480);
        expect(f.getNotation()[0].events.some(e => e.tick === 0)).toBe(false);
        f.paste(f.toAbs(1, 960), payload);
        expect(at(f, 1, 960, 1).dyn).toBe('mf');
        f.moveRange(f.toAbs(2, 0), f.toAbs(2, 480), f.toAbs(2, 1440));
        expect(at(f, 2, 1440, 1).dyn).toBe('fff');
    });

    it('moving a note to another string keeps dyn', () => {
        expect(f.moveNoteToString({ measure: 2, tick: 0, string: 1 }, 1)).toBe(true);
        expect(at(f, 2, 0, 2).dyn).toBe('fff');
    });

    it('insert and delete measure keep dyn', () => {
        f.insertMeasure(1);
        expect(at(f, 2, 0, 1).dyn).toBe('mf');
        expect(at(f, 3, 0, 1).dyn).toBe('fff');
        f.deleteMeasure(1);
        expect(at(f, 1, 0, 1).dyn).toBe('mf');
        expect(at(f, 2, 0, 1).dyn).toBe('fff');
        f.undo();
        expect(at(f, 3, 0, 1).dyn).toBe('fff');
    });

    it('track rename, reorder, add and delete keep dyn on tracks and notes', () => {
        const g = new EditingFacade(doc({ dyn: 'mp' }));
        g.setTrack('banjo');
        g.setDynamic({ measure: 1, tick: 0, string: 1 }, 'ff');
        g.renameTrack('guitar', 'rhythm');
        expect(g.getTrack('rhythm').dyn).toBe('mp');
        g.moveTrack('banjo', 1);
        expect(g.getTracks().map(t => t.id)).toEqual(['rhythm', 'banjo']);
        expect(g.getTrack('rhythm').dyn).toBe('mp');
        expect(at(g, 1, 0, 1, 'banjo').dyn).toBe('ff');
        g.addTrack({ id: 'mando', instrument: 'mandolin', tuning: ['E5', 'A4', 'D4', 'G3'], dyn: 'pp' });
        expect(g.otf.otf_version).toBe('1.2');
        expect(g.getTrack('mando').dyn).toBe('pp');
        g.deleteTrack('rhythm');
        expect(g.getTrack('mando').dyn).toBe('pp');
        expect(at(g, 1, 0, 1, 'banjo').dyn).toBe('ff');
        g.undo();
        expect(g.getTrack('rhythm').dyn).toBe('mp');
    });

    it('repeatMeasure copies dyn', () => {
        expect(f.repeatMeasure(3)).toBe(true);
        expect(at(f, 3, 0, 1).dyn).toBe('fff');
    });
});

describe('a pasted note keeps its sound across tracks at different levels', () => {
    it('no dyn at f pasted into an mf track becomes an explicit f', () => {
        const g = new EditingFacade(doc({ dyn: 'mf' }));
        g.setTrack('banjo');
        const payload = g.copyRange(0, 480);             // string-1 note, no dyn: plays f
        g.setTrack('guitar');
        g.paste(0, payload, { trackId: 'guitar' });
        const pasted = at(g, 1, 0, 1, 'guitar');
        expect(pasted.dyn).toBe('f');
        expect(g.otf.otf_version).toBe('1.2');
    });

    it('an explicit dyn equal to the target track\'s level is dropped', () => {
        const g = new EditingFacade(doc({ dyn: 'mf' }));
        g.setTrack('banjo');
        g.setDynamic({ measure: 1, tick: 0, string: 1 }, 'mf');
        const payload = g.copyRange(0, 480);
        g.paste(0, payload, { trackId: 'guitar' });
        expect(at(g, 1, 0, 1, 'guitar')).not.toHaveProperty('dyn');
    });

    it('an explicit dyn differing from the target is kept; no dyn into the same level stays none', () => {
        const g = new EditingFacade(doc({ dyn: 'mf' }));
        g.setTrack('banjo');
        g.setDynamic({ measure: 1, tick: 0, string: 1 }, 'pp');
        g.paste(0, g.copyRange(0, 480), { trackId: 'guitar' });
        expect(at(g, 1, 0, 1, 'guitar').dyn).toBe('pp');
        const h = new EditingFacade(doc());
        h.setTrack('banjo');
        h.paste(480, h.copyRange(480, 960), { trackId: 'guitar' });
        expect(at(h, 1, 480, 2, 'guitar')).not.toHaveProperty('dyn');
    });

    it('a tied note pasted across levels carries no dyn', () => {
        const g = new EditingFacade(doc({ dyn: 'mf' }));
        g.setTrack('banjo');
        g.paste(960, g.copyRange(960, 1440), { trackId: 'guitar' });
        expect(at(g, 1, 960, 1, 'guitar')).not.toHaveProperty('dyn');
    });
});
