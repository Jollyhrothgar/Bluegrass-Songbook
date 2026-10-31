// Typed fingering becomes `finger`, chord names become kind "chord" (G21b, G21d).
//
// assignTextRoles(doc, rows) runs at the end of tefToOtf; rows[i] is the 1-based
// string, on the text's own track, of doc.annotations[i] (null when the text sits
// on no track). Python counterpart: tests/parser/test_tef_typed_text.py. The corpus
// proof is tef-import-typed-fingering-fmb.test.js.
import { describe, it, expect } from 'vitest';
import { assignTextRoles, toOtfDict } from '../tef-import/otf.js';

const note = (s, extra = {}) => ({ s, f: 0, tech: null, finger: null, lh: null, tie: false, ...extra });
function docWith(notesAtZero, texts) {
    return {
        notation: { banjo: [{ measure: 1, events: [
            { tick: 0, notes: notesAtZero }, { tick: 240, notes: [note(2)] }] }] },
        annotations: texts.map(([measure, tick, text, track, place]) => {
            const a = { measure, tick, text };
            if (track) a.track = track;
            if (place) a.place = place;
            return a;
        }),
    };
}
const run = (doc, rows) => { assignTextRoles(doc, rows || doc.annotations.map(() => null)); return doc; };
const fingers = doc => doc.notation.banjo[0].events[0].notes.map(n => n.finger);

describe('typed fingering (G21b)', () => {
    it('a letter on a note becomes its finger and leaves the annotations', () => {
        const doc = run(docWith([note(5)], [[1, 0, 'm', 'banjo', 'below']]), [5]);
        expect(fingers(doc)).toEqual(['M']);
        expect(doc.annotations).toEqual([]);
    });

    it.each([['t', 'T'], ['I', 'I'], [' m ', 'M'], ['R', 'R'], ['p', 'P']])('any case and padding: %j', (typed, finger) => {
        expect(fingers(run(docWith([note(1)], [[1, 0, typed, 'banjo']]), [1]))).toEqual([finger]);
    });

    it.each(['mi', 'x', 'a', '', 'm.'])('only the five letters count: %j', typed => {
        const doc = run(docWith([note(1)], [[1, 0, typed, 'banjo']]), [1]);
        expect(fingers(doc)).toEqual([null]);
        expect(doc.annotations.map(a => a.text)).toEqual([typed]);
    });

    it('a letter with no track stays text', () => {
        const doc = run(docWith([note(1)], [[1, 0, 'm', null]]), [null]);
        expect(fingers(doc)).toEqual([null]);
        expect(doc.annotations).toHaveLength(1);
    });

    it('no note at that tick keeps the text with its track and place', () => {
        const doc = run(docWith([note(1)], [[1, 120, 'i', 'banjo', 'below'], [2, 0, 'i', 'banjo', 'below']]), [1, 1]);
        expect(doc.annotations).toEqual([
            { measure: 1, tick: 120, text: 'i', track: 'banjo', place: 'below' },
            { measure: 2, tick: 0, text: 'i', track: 'banjo', place: 'below' }]);
    });

    it("another track's note does not match", () => {
        expect(run(docWith([note(1)], [[1, 0, 'm', 'bass']]), [1]).annotations).toHaveLength(1);
    });

    it('several notes: the letter goes on the note on its string row', () => {
        const doc = run(docWith([note(1), note(3), note(5)], [[1, 0, 'i', 'banjo', 'below']]), [3]);
        expect(fingers(doc)).toEqual([null, 'I', null]);
        expect(doc.annotations).toEqual([]);
    });

    it('several notes and none on the row: stays text', () => {
        const doc = run(docWith([note(1), note(3)], [[1, 0, 'i', 'banjo', 'below']]), [2]);
        expect(fingers(doc)).toEqual([null, null]);
        expect(doc.annotations).toHaveLength(1);
    });

    it('a single note takes the letter wherever the text sits', () => {
        expect(fingers(run(docWith([note(4)], [[1, 0, 't', 'banjo', 'below']]), [1]))).toEqual(['T']);
    });

    it('a note that has a finger keeps it; the text stays text', () => {
        const doc = run(docWith([note(4, { finger: 'T' })], [[1, 0, 'm', 'banjo', 'below']]), [4]);
        expect(fingers(doc)).toEqual(['T']);
        expect(doc.annotations.map(a => a.text)).toEqual(['m']);
    });

    it('two letters on one note: the first wins, the second stays text', () => {
        const doc = run(docWith([note(4)], [[1, 0, 'm', 'banjo'], [1, 0, 'i', 'banjo']]), [4, 4]);
        expect(fingers(doc)).toEqual(['M']);
        expect(doc.annotations.map(a => a.text)).toEqual(['i']);
    });
});

describe('chord kind (G21d)', () => {
    it('chord text gets kind chord; other text gets none', () => {
        const texts = ['G', 'em', 'A (G)', '(D)', 'D/F#', 'Part A', 'etc.', 'A1'];
        const doc = run(docWith([note(1)], texts.map(t => [1, 0, t, 'banjo'])));
        expect(doc.annotations.map(a => [a.text, a.kind])).toEqual([
            ['G', 'chord'], ['em', 'chord'], ['A (G)', 'chord'], ['(D)', 'chord'], ['D/F#', 'chord'],
            ['Part A', undefined], ['etc.', undefined], ['A1', undefined]]);
    });

    it('a letter that stays text is not a chord', () => {
        const doc = run(docWith([], [[1, 0, 'm', 'banjo'], [1, 0, 'i', 'banjo']]));
        expect(doc.annotations.map(a => a.kind)).toEqual([undefined, undefined]);
    });

    it('toOtfDict keeps key order and omits kind for text', () => {
        const doc = run(docWith([note(1)], [[1, 0, 'G', 'banjo', 'below'], [1, 0, 'Hi', 'banjo']]));
        const full = { otf_version: '1.3', metadata: { title: 't', time_signature: '4/4', tempo: 100 },
            timing: { ticks_per_beat: 480 }, tracks: [], ...doc };
        const out = toOtfDict(full).annotations;
        expect(Object.keys(out[0])).toEqual(['measure', 'tick', 'text', 'track', 'kind', 'place']);
        expect('kind' in out[1]).toBe(false);
    });
});
