// G21a (OTF 1.3): a placed text belongs to a track and sits above or below its staff.
// The editor stamps the current track on every text it adds; renaming a track renames
// its texts, deleting one deletes them; "Text at cursor" never reaches another track's
// text; the popover's Above / Below choice sets `place`. Every op is one undo step.
import { describe, it, expect, beforeEach } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';
import { EditorState } from '../../otf-editor/state.js';
import { validateOTF } from '../../otf-editor/otf-validate.js';
import { serializeOTF } from '../../otf-format.js';

const note = (s, f) => ({ tick: 0, notes: [{ s, f, dur: 480 }] });

function doc(annotations) {
    return {
        otf_version: '1.0',
        metadata: { title: 'T', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [
            { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead' },
            { id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0, role: 'rhythm' },
        ],
        notation: {
            banjo: [1, 2, 3].map(m => ({ measure: m, events: [note(1, m)] })),
            guitar: [1, 2, 3].map(m => ({ measure: m, events: [note(6, m)] })),
        },
        annotations,
    };
}
const THREE = () => [
    { measure: 1, tick: 0, text: 'old, no track' },
    { measure: 1, tick: 0, text: 'G', track: 'guitar' },
    { measure: 2, tick: 0, text: 'banjo banner', track: 'banjo' },
];
const texts = (f) => f.annotations().map(a => [a.text, a.track]);

describe('adding a text', () => {
    let state;
    beforeEach(() => { state = new EditorState({ otf: doc(THREE()), trackId: 'banjo' }); });

    it('carries the current track and lifts the document to 1.3', () => {
        state.cursor.measure = 3; state.cursor.tick = 0;
        expect(state.setAnnotationAtCursor('Outro')).toBe(true);
        expect(state.otf.annotations.at(-1)).toEqual({ measure: 3, tick: 0, text: 'Outro', track: 'banjo' });
        expect(state.otf.otf_version).toBe('1.3');
        expect(validateOTF(state.otf).errors).toEqual([]);
    });

    it('follows the track the editor is on', () => {
        state.setTrack('guitar');
        state.cursor.measure = 3; state.cursor.tick = 0;
        state.setAnnotationAtCursor('Bridge');
        expect(state.otf.annotations.at(-1).track).toBe('guitar');
    });

    it('below is stored as place; above stores nothing', () => {
        state.cursor.measure = 3; state.cursor.tick = 0;
        state.setAnnotationAtCursor('m', 'below');
        expect(state.otf.annotations.at(-1)).toEqual({ measure: 3, tick: 0, text: 'm', track: 'banjo', place: 'below' });
        state.cursor.tick = 960;
        state.setAnnotationAtCursor('i', 'above');
        expect(Object.keys(state.otf.annotations.find(a => a.text === 'i'))).toEqual(['measure', 'tick', 'text', 'track']);
    });

    it('writes keys in the schema\'s order', () => {
        const f = new EditingFacade(doc(undefined));
        f.addAnnotation({ measure: 1, tick: 0, text: 'x', place: 'below', kind: 'chord', track: 'banjo' });
        expect(Object.keys(f.annotations()[0])).toEqual(['measure', 'tick', 'text', 'track', 'kind', 'place']);
        expect(serializeOTF(f.otf)).toContain('"text": "x", "track": "banjo", "kind": "chord", "place": "below"');
    });

    it('refuses a track the document does not have', () => {
        const f = new EditingFacade(doc(undefined));
        expect(() => f.addAnnotation({ measure: 1, text: 'x', track: 'fiddle' })).toThrow(/Unknown track/);
        expect(f.annotations()).toEqual([]);
    });

    it('a file that never gets a track-carrying text keeps its version and bytes', () => {
        const f = new EditingFacade(doc([{ measure: 1, tick: 0, text: 'old' }]));
        f.setAnnotationText(0, 'older');
        f.addAnnotation({ measure: 2, tick: 0, text: 'plain, no track' });
        expect(f.otf.otf_version).toBe('1.0');
    });

    it('is one undo step', () => {
        state.cursor.measure = 3; state.cursor.tick = 0;
        const before = JSON.stringify(state.otf);
        state.setAnnotationAtCursor('Outro', 'below');
        state.undo();
        expect(JSON.stringify(state.otf)).toBe(before);
        expect(state.otf.otf_version).toBe('1.0');
    });
});

describe('"Text at cursor" finds this track\'s text or a track-less one, never another track\'s', () => {
    it('on the banjo, the track-less text answers; the guitar\'s does not', () => {
        const state = new EditorState({ otf: doc(THREE()), trackId: 'banjo' });
        state.cursor.measure = 1; state.cursor.tick = 0;
        expect(state.getAnnotationAtCursor().annotation.text).toBe('old, no track');
    });

    it('on the guitar, its own text is found (the nearest one at the spot)', () => {
        const state = new EditorState({ otf: doc([{ measure: 1, tick: 0, text: 'G', track: 'guitar' }]), trackId: 'guitar' });
        state.cursor.measure = 1; state.cursor.tick = 0;
        expect(state.getAnnotationAtCursor().annotation.text).toBe('G');
    });

    it('with only another track\'s text there, nothing is found and a new text is added beside it', () => {
        const state = new EditorState({ otf: doc([{ measure: 1, tick: 0, text: 'G', track: 'guitar' }]), trackId: 'banjo' });
        state.cursor.measure = 1; state.cursor.tick = 0;
        expect(state.getAnnotationAtCursor()).toBe(null);
        state.setAnnotationAtCursor('A');
        expect(texts(state.facade)).toEqual([['G', 'guitar'], ['A', 'banjo']]);
    });

    it('editing leaves the other track\'s text alone', () => {
        const state = new EditorState({ otf: doc(THREE()), trackId: 'banjo' });
        state.cursor.measure = 2; state.cursor.tick = 0;
        state.setAnnotationAtCursor('banjo banner 2');
        expect(texts(state.facade)).toEqual([['old, no track', undefined], ['G', 'guitar'], ['banjo banner 2', 'banjo']]);
    });

    it('moving a text below changes only its place, and undo puts it back', () => {
        const state = new EditorState({ otf: doc(THREE()), trackId: 'banjo' });
        state.cursor.measure = 2; state.cursor.tick = 0;
        const before = JSON.stringify(state.otf);
        expect(state.setAnnotationAtCursor('banjo banner', 'below')).toBe(true);
        expect(state.otf.annotations[2]).toEqual({ measure: 2, tick: 0, text: 'banjo banner', track: 'banjo', place: 'below' });
        expect(state.setAnnotationAtCursor('banjo banner', 'below')).toBe(false);      // already there: no history entry
        expect(state.setAnnotationAtCursor('banjo banner', 'above')).toBe(true);
        expect('place' in state.otf.annotations[2]).toBe(false);
        state.undo(); state.undo();
        expect(JSON.stringify(state.otf)).toBe(before);
    });
});

describe('renaming and deleting a track', () => {
    let f;
    beforeEach(() => { f = new EditingFacade(doc(THREE())); });

    it('rename renames the track\'s texts, in one undo step', () => {
        const before = JSON.stringify(f.otf);
        f.renameTrack('guitar', 'rhythm-guitar');
        expect(texts(f)).toEqual([['old, no track', undefined], ['G', 'rhythm-guitar'], ['banjo banner', 'banjo']]);
        expect(validateOTF(f.otf).errors).toEqual([]);
        f.undo();
        expect(JSON.stringify(f.otf)).toBe(before);
    });

    it('delete removes the track\'s texts and keeps the track-less ones, in one undo step', () => {
        const before = JSON.stringify(f.otf);
        f.deleteTrack('guitar');
        expect(texts(f)).toEqual([['old, no track', undefined], ['banjo banner', 'banjo']]);
        expect(validateOTF(f.otf).errors).toEqual([]);
        f.undo();
        expect(JSON.stringify(f.otf)).toBe(before);
    });

    it('deleting the last text of a tab drops the annotations key', () => {
        const only = new EditingFacade(doc([{ measure: 1, tick: 0, text: 'G', track: 'guitar' }]));
        only.deleteTrack('guitar');
        expect('annotations' in only.otf).toBe(false);
    });
});

describe('paste', () => {
    it('gives texts a clipboard carries the target track (a selection holds notes only today)', () => {
        const f = new EditingFacade(doc(undefined));
        const payload = { type: 'notes', span: 960, data: [{ relativeTick: 0, notes: [{ s: 1, f: 0, dur: 480 }] }],
            annotations: [{ relativeTick: 0, text: 'G', kind: 'chord' }, { relativeTick: 480, text: 'm', place: 'below' }] };
        expect(f.paste(f.toAbs(2, 0), payload, { trackId: 'guitar' })).toBe(true);
        expect(f.annotations()).toEqual([
            { measure: 2, tick: 0, text: 'G', track: 'guitar', kind: 'chord' },
            { measure: 2, tick: 480, text: 'm', track: 'guitar', place: 'below' }]);
        expect(f.otf.otf_version).toBe('1.3');
        f.undo();
        expect(f.annotations()).toEqual([]);
    });

    it('a note-only payload adds no texts', () => {
        const f = new EditingFacade(doc(undefined));
        f.paste(f.toAbs(2, 0), f.copyRange(f.toAbs(1, 0), f.toAbs(2, 0), { trackId: 'banjo' }), { trackId: 'guitar' });
        expect(f.annotations()).toEqual([]);
    });
});
