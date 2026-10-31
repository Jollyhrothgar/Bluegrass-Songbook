// G20b: the facade setters behind Score ▸ Tab setup… — title, composer, key,
// time signature, a track's instrument, tuning and capo, and applyTabSetup,
// which is all of them as ONE undo step. Every refusal is a sentence and
// changes nothing.
import { describe, it, expect } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';

const note = (s, f, d = 480) => ({ s, f, d });

/** A 4/4 banjo with notes in measures 2 and 3; a mandolin beside it. */
function doc() {
    return {
        otf_version: '1.0',
        metadata: { title: 'Test', time_signature: '4/4', tempo: 120, composer: '', key: '' },
        timing: { ticks_per_beat: 480 },
        tracks: [
            { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead' },
            { id: 'mandolin', instrument: 'mandolin', tuning: ['E5', 'A4', 'D4', 'G3'], capo: 0, role: 'rhythm' },
        ],
        notation: {
            banjo: [
                { measure: 1, events: [] },
                { measure: 2, events: [{ tick: 0, notes: [note(2, 3), note(5, 0)] }, { tick: 480, notes: [note(1, 2)] }] },
                { measure: 3, events: [{ tick: 960, notes: [note(5, 7)] }] },
                { measure: 4, events: [] },
            ],
            mandolin: [
                { measure: 1, events: [{ tick: 0, notes: [note(4, 5)] }] },
            ],
        },
    };
}

const fresh = () => new EditingFacade(doc());

describe('title, composer, key', () => {
    it('set the metadata, trimmed, one undo step each, and redo', () => {
        const f = fresh();
        expect(f.setTitle('  Cripple Creek ')).toBe(true);
        expect(f.otf.metadata.title).toBe('Cripple Creek');
        expect(f.setComposer('Trad.')).toBe(true);
        expect(f.setKey('G')).toBe(true);
        expect(f.otf.metadata).toMatchObject({ title: 'Cripple Creek', composer: 'Trad.', key: 'G' });

        f.undo();
        expect(f.otf.metadata.key).toBe('');
        f.undo();
        expect(f.otf.metadata.composer).toBe('');
        f.undo();
        expect(f.otf.metadata.title).toBe('Test');
        expect(f.canUndo()).toBe(false);
        f.redo();
        expect(f.otf.metadata.title).toBe('Cripple Creek');
    });

    it('answer false, with no history, when nothing changes', () => {
        const f = fresh();
        expect(f.setTitle('Test')).toBe(false);
        expect(f.setComposer('')).toBe(false);
        expect(f.setKey('  ')).toBe(false);
        expect(f.canUndo()).toBe(false);
    });

    it('drop a blank composer or key from the file (an old file never had them)', () => {
        const f = fresh();
        f.setKey('Am');
        f.setKey('');
        f.setComposer('A. Nonymous');
        f.setComposer('');
        expect('key' in f.otf.metadata).toBe(false);
        expect('composer' in f.otf.metadata).toBe(false);
    });

    it('refuse text over the limit (a throw, like every value setter)', () => {
        const f = fresh();
        expect(() => f.setTitle('x'.repeat(201))).toThrow(RangeError);
        expect(() => f.setComposer('x'.repeat(201))).toThrow(RangeError);
        expect(() => f.setKey('x'.repeat(21))).toThrow(RangeError);
        expect(f.canUndo()).toBe(false);
    });
});

describe('setTimeSignature', () => {
    it('changes the whole tab, the bar length follows, undo and redo', () => {
        const f = new EditingFacade({ ...doc(), notation: { banjo: [{ measure: 1, events: [] }], mandolin: [] } });
        expect(f.ticksFor(1)).toBe(1920);
        expect(f.setTimeSignature('3/4')).toBe(true);
        expect(f.otf.metadata.time_signature).toBe('3/4');
        expect(f.ticksFor(1)).toBe(1440);
        f.undo();
        expect(f.otf.metadata.time_signature).toBe('4/4');
        expect(f.ticksFor(1)).toBe(1920);
        f.redo();
        expect(f.ticksFor(1)).toBe(1440);
    });

    it('is a no-op for the same signature, and throws on a shape that is not n/d', () => {
        const f = fresh();
        expect(f.setTimeSignature('4/4')).toBe(false);
        expect(() => f.setTimeSignature('four four')).toThrow(RangeError);
        expect(() => f.setTimeSignature('0/4')).toThrow(RangeError);
        expect(f.canUndo()).toBe(false);
    });

    it('widening always fits', () => {
        const d = doc();
        d.metadata.time_signature = '2/4';
        d.notation.banjo = [{ measure: 1, events: [{ tick: 480, notes: [note(1, 0)] }] }];
        const f = new EditingFacade(d);
        expect(f.timeSignatureBlocker('4/4')).toBe('');
        expect(f.setTimeSignature('6/8')).toBe(true);
    });

    it('refuses a signature some notes do not fit, naming the first measure and the count', () => {
        const f = fresh();
        // m2 has a note at 480 for 480 (fits 2/4: ends at 960), m2 tick 0 too; m3's note at 960 does not
        expect(f.timeSignatureBlocker('3/4')).toBe('');                       // all end by 1440
        expect(f.timeSignatureBlocker('2/4')).toBe(
            '1 measure has notes that do not fit 2/4; the first is measure 3.');
        expect(() => f.setTimeSignature('2/4')).toThrow(
            '1 measure has notes that do not fit 2/4; the first is measure 3.');
        expect(f.otf.metadata.time_signature).toBe('4/4');
        expect(f.canUndo()).toBe(false);
    });

    it('counts every measure that does not fit, and names the first', () => {
        const d = doc();
        d.notation.banjo[3].events.push({ tick: 1440, notes: [note(1, 0)] });   // m4, beat 4
        d.notation.mandolin.push({ measure: 5, events: [{ tick: 1920 - 480, notes: [note(1, 0)] }] });
        const f = new EditingFacade(d);
        expect(f.timeSignatureBlocker('3/4')).toBe(
            '2 measures have notes that do not fit 3/4; the first is measure 4.');
    });

    it('a note that starts inside the bar but runs past its end does not fit', () => {
        const d = doc();
        d.notation.banjo = [{ measure: 1, events: [{ tick: 960, notes: [note(1, 0, 960)] }] }];
        const f = new EditingFacade(d);
        expect(f.timeSignatureBlocker('3/4')).toMatch(/measure 1\./);
    });

    it('leaves a mid-piece change alone, and does not test the measure it governs', () => {
        const d = doc();
        d.metadata.time_signature_changes = [{ measure: 3, time_signature: '4/4' }];
        d.metadata.time_signature = '4/4';
        const f = new EditingFacade(d);
        // m3 is governed by its own 4/4, so 2/4 is judged on m2 alone (it fits: ends 960)
        expect(f.setTimeSignature('2/4')).toBe(true);
        expect(f.otf.metadata.time_signature_changes).toEqual([{ measure: 3, time_signature: '4/4' }]);
        expect(f.ticksFor(2)).toBe(960);
        expect(f.ticksFor(3)).toBe(1920);
    });

    it('also refuses when a chord diagram would fall outside the bar', () => {
        const d = doc();
        d.chords = [{ name: 'G' }];
        d.chord_diagrams = [{ measure: 1, tick: 1500, track: 'banjo', chord: 0 }];
        const f = new EditingFacade(d);
        expect(f.timeSignatureBlocker('3/4')).toContain('measure 1');
    });
});

describe('setTrackTuning', () => {
    it('sets the tuning, undo and redo, and keeps every note\'s string and fret', () => {
        const f = fresh();
        const before = JSON.stringify(f.otf.notation);
        expect(f.setTrackTuning(['D4', 'C4', 'G3', 'C3', 'G4'], 'banjo')).toBe(true);
        expect(f.getTrack('banjo').tuning).toEqual(['D4', 'C4', 'G3', 'C3', 'G4']);
        expect(JSON.stringify(f.otf.notation)).toBe(before);
        f.undo();
        expect(f.getTrack('banjo').tuning).toEqual(['D4', 'B3', 'G3', 'D3', 'G4']);
        f.redo();
        expect(f.getTrack('banjo').tuning[1]).toBe('C4');
        expect(JSON.stringify(f.otf.notation)).toBe(before);
    });

    it('defaults to the current track', () => {
        const f = fresh();
        f.setTrack('mandolin');
        f.setTrackTuning(['D5', 'A4', 'D4', 'G3']);
        expect(f.getTrack('mandolin').tuning[0]).toBe('D5');
        expect(f.getTrack('banjo').tuning[0]).toBe('D4');
    });

    it('is a no-op for the same tuning', () => {
        const f = fresh();
        expect(f.setTrackTuning(['D4', 'B3', 'G3', 'D3', 'G4'], 'banjo')).toBe(false);
        expect(f.canUndo()).toBe(false);
    });

    it('can add strings (notes stay where they were)', () => {
        const f = fresh();
        f.setTrackTuning(['D4', 'B3', 'G3', 'D3', 'G4', 'D2'], 'banjo');
        expect(f.stringCount('banjo')).toBe(6);
    });

    it('can take a string off when no note is on it', () => {
        const d = doc();
        d.notation.banjo = [{ measure: 1, events: [{ tick: 0, notes: [note(1, 0), note(4, 2)] }] }];
        const f = new EditingFacade(d);
        expect(f.setTrackTuning(['D4', 'B3', 'G3', 'D3'], 'banjo')).toBe(true);
        expect(f.stringCount('banjo')).toBe(4);
    });

    it('refuses to drop a string notes are on: the count and the first measure', () => {
        const f = fresh();
        // banjo has notes on string 5 in m2 (one) and m3 (one)
        const sentence = 'This tuning has 4 strings, but 2 notes are on string 5; the first is in measure 2.'
            + ' Move or delete them first.';
        expect(f.tuningBlocker(['D4', 'B3', 'G3', 'D3'], 'banjo')).toBe(sentence);
        expect(() => f.setTrackTuning(['D4', 'B3', 'G3', 'D3'], 'banjo')).toThrow(sentence);
        expect(f.getTrack('banjo').tuning).toHaveLength(5);
        expect(f.canUndo()).toBe(false);
    });

    it('says "notes are on strings 4 to 5" when several strings go', () => {
        const d = doc();
        d.notation.banjo[1].events.push({ tick: 960, notes: [note(4, 1)] });
        const f = new EditingFacade(d);
        expect(f.tuningBlocker(['D4', 'B3', 'G3'], 'banjo'))
            .toBe('This tuning has 3 strings, but 3 notes are on strings 4 to 5; the first is in measure 2.'
                + ' Move or delete them first.');
    });

    it('throws on a pitch it cannot read, or an empty or oversized tuning', () => {
        const f = fresh();
        expect(() => f.setTrackTuning(['D4', 'B3', 'G3', 'D3', 'H4'], 'banjo')).toThrow(RangeError);
        expect(() => f.setTrackTuning(['D4', 'B3', 'G3', 'D3', 'Bb4'], 'banjo')).toThrow(RangeError);
        expect(() => f.setTrackTuning([], 'banjo')).toThrow(RangeError);
        expect(() => f.setTrackTuning(new Array(13).fill('E2'), 'banjo')).toThrow(RangeError);
        expect(f.canUndo()).toBe(false);
    });

    it('refuses a drum track, which has lines and no tuning', () => {
        const d = doc();
        d.tracks.push({ id: 'drums', instrument: 'percussion', tuning: [], capo: 0, role: 'percussion', percussion: true, lines: 3 });
        const f = new EditingFacade(d);
        expect(() => f.setTrackTuning(['E2'], 'drums')).toThrow('A drum track has no tuning.');
    });
});

describe('setTrackInstrument and setTrackCapo', () => {
    it('instrument: set, undo, redo; the strings and notes are untouched', () => {
        const f = fresh();
        expect(f.setTrackInstrument('tenor-banjo', 'banjo')).toBe(true);
        expect(f.getTrack('banjo').instrument).toBe('tenor-banjo');
        expect(f.getTrack('banjo').tuning).toHaveLength(5);
        f.undo();
        expect(f.getTrack('banjo').instrument).toBe('5-string-banjo');
        f.redo();
        expect(f.getTrack('banjo').instrument).toBe('tenor-banjo');
        expect(f.setTrackInstrument('tenor-banjo', 'banjo')).toBe(false);
    });

    it('instrument: refuses text that is not a plain name', () => {
        const f = fresh();
        expect(() => f.setTrackInstrument('', 'banjo')).toThrow(RangeError);
        expect(() => f.setTrackInstrument('<b>x</b>', 'banjo')).toThrow(RangeError);
        expect(() => f.setTrackInstrument('x'.repeat(41), 'banjo')).toThrow(RangeError);
    });

    it('capo: set, undo, redo, no-op', () => {
        const f = fresh();
        expect(f.setTrackCapo(2, 'banjo')).toBe(true);
        expect(f.getTrack('banjo').capo).toBe(2);
        expect(f.setTrackCapo(2, 'banjo')).toBe(false);
        f.undo();
        expect(f.getTrack('banjo').capo).toBe(0);
        f.redo();
        expect(f.getTrack('banjo').capo).toBe(2);
    });

    it('capo: a whole number from 0 to 12 (what a .tef holds)', () => {
        const f = fresh();
        for (const bad of [-1, 13, 1.5, 'two', NaN]) {
            expect(() => f.setTrackCapo(bad, 'banjo')).toThrow(RangeError);
        }
        expect(f.canUndo()).toBe(false);
        expect(f.setTrackCapo('3', 'banjo')).toBe(true);        // the panel hands over a typed string
        expect(f.getTrack('banjo').capo).toBe(3);
    });

    it('unknown track throws', () => {
        const f = fresh();
        expect(() => f.setTrackCapo(1, 'nope')).toThrow('Unknown track: nope');
    });
});

describe('applyTabSetup', () => {
    const everything = {
        title: 'Soldier\'s Joy',
        composer: 'Trad.',
        key: 'D',
        timeSignature: '3/4',
        tempo: 96,
        track: { instrument: 'mandolin', tuning: ['E5', 'A4', 'D4', 'A3'], capo: 2 },
    };

    it('applies the lot as ONE undo step, and one redo', () => {
        const g = fresh();
        g.setTrack('mandolin');
        expect(g.applyTabSetup(everything)).toBe(true);
        expect(g.otf.metadata).toMatchObject({
            title: 'Soldier\'s Joy', composer: 'Trad.', key: 'D', time_signature: '3/4', tempo: 96,
        });
        expect(g.getTrack('mandolin')).toMatchObject({ instrument: 'mandolin', capo: 2 });
        expect(g.getTrack('mandolin').tuning).toEqual(['E5', 'A4', 'D4', 'A3']);
        expect(g.ticksFor(1)).toBe(1440);

        g.undo();
        expect(g.canUndo()).toBe(false);          // exactly one step
        expect(g.otf.metadata).toMatchObject({ title: 'Test', time_signature: '4/4', tempo: 120, key: '' });
        expect(g.getTrack('mandolin').capo).toBe(0);
        expect(g.getTrack('mandolin').tuning[3]).toBe('G3');
        expect(g.ticksFor(1)).toBe(1920);
        g.redo();
        expect(g.otf.metadata.title).toBe('Soldier\'s Joy');
        expect(g.getTrack('mandolin').capo).toBe(2);
        expect(g.ticksFor(1)).toBe(1440);
    });

    it('only the fields given change; an unchanged setup is false with no history', () => {
        const f = fresh();
        expect(f.applyTabSetup({})).toBe(false);
        expect(f.applyTabSetup({
            title: 'Test', timeSignature: '4/4', tempo: 120,
            track: { instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0 },
        })).toBe(false);
        expect(f.canUndo()).toBe(false);
    });

    it('a refusal anywhere changes nothing, not even the fields before it', () => {
        const f = fresh();
        const before = JSON.stringify(f.export());
        // the title is fine; the tuning would orphan banjo's string-5 notes
        expect(() => f.applyTabSetup({
            title: 'Changed', key: 'A', track: { tuning: ['D4', 'B3', 'G3', 'D3'] },
        })).toThrow(/string 5/);
        expect(JSON.stringify(f.export())).toBe(before);
        expect(f.canUndo()).toBe(false);

        expect(() => f.applyTabSetup({ title: 'Changed', timeSignature: '2/4' })).toThrow(/measure 3/);
        expect(JSON.stringify(f.export())).toBe(before);
        expect(f.canUndo()).toBe(false);
    });

    it('applies to the track it is given, else the current one', () => {
        const f = fresh();
        f.applyTabSetup({ track: { capo: 4 } }, 'mandolin');
        expect(f.getTrack('mandolin').capo).toBe(4);
        expect(f.getTrack('banjo').capo).toBe(0);
        f.applyTabSetup({ track: { capo: 5 } });
        expect(f.getTrack('banjo').capo).toBe(5);
    });

    it('rejects a tempo below 1, like setTempo', () => {
        const f = fresh();
        expect(f.applyTabSetup({ tempo: 0 })).toBe(false);
        expect(f.canUndo()).toBe(false);
    });
});
