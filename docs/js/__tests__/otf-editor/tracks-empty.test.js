// A track with no notes is still a track you can write on (G15c).
//
// OTF's contract is "absent means silent": a track with no `notation` key is
// valid (14809 "Red Haired Boy" opens with a guitar track like that). The
// editor used to size a track by its OWN measures, so an empty one was one
// bar long, drew "No notation for this track" and had no geometry to click.
// It is now as long as the DOCUMENT, and looking at it writes nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';
import { OTFEditor } from '../../otf-editor/editor.js';
import { positionFromSvgPoint } from '../../otf-editor/cursor.js';
import { densifyNotation } from '../../renderers/measure-timing.js';

const GUITAR = {
    id: 'guitar', instrument: '6-string-guitar',
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0, role: 'rhythm',
};
const BANJO = {
    id: 'banjo', instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead',
};
const BASS = {
    id: 'bass', instrument: 'upright-bass',
    tuning: ['G2', 'D2', 'A1', 'E1'], capo: 0, role: 'rhythm',
};
const note = (s, f) => ({ tick: 0, notes: [{ s, f, dur: 480 }] });

/** banjo runs 9 measures, bass stops at 3, guitar has NO notation key. */
function emptyGuitarDoc() {
    return {
        otf_version: '1.0',
        metadata: { title: 'T', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [{ ...BANJO }, { ...GUITAR }, { ...BASS }],
        notation: {
            banjo: [1, 5, 9].map(m => ({ measure: m, events: [note(1, 0)] })),
            bass: [{ measure: 1, events: [note(4, 0)] }, { measure: 3, events: [note(4, 2)] }],
        },
    };
}

describe('an empty track is as long as the document', () => {
    let facade;
    beforeEach(() => {
        facade = new EditingFacade(emptyGuitarDoc(), { trackId: 'guitar' });
    });

    it('getMeasureCount equals the document maximum and reading writes nothing', () => {
        const before = JSON.stringify(facade.otf);
        expect(facade.getMeasureCount('guitar')).toBe(9);
        expect(facade.getMeasureCount()).toBe(9);
        facade.getMeasure(2, 'guitar');
        facade.getNotation('guitar');
        expect(Object.keys(facade.otf.notation)).not.toContain('guitar');
        expect(JSON.stringify(facade.otf)).toBe(before);
    });

    it('a track that ends early reaches the last measure too', () => {
        expect(facade.getMeasureCount('bass')).toBe(9);
    });

    it('inserting at measure 1 then at measure N creates exactly those measures', () => {
        facade.getOrCreateMeasure(1, 'guitar');
        facade.getOrCreateMeasure(9, 'guitar');
        expect(facade.otf.notation.guitar.map(m => m.measure)).toEqual([1, 9]);
        expect(facade.getMeasureCount('guitar')).toBe(9);
    });

    it('a short track can be written on at the document\'s last measure', () => {
        facade.getOrCreateMeasure(9, 'bass');
        expect(facade.otf.notation.bass.map(m => m.measure)).toEqual([1, 3, 9]);
    });

    it('the shared densifyNotation([]) behaviour is untouched', () => {
        expect(densifyNotation([], 9)).toEqual([]);
    });
});

describe('the editor draws and navigates an empty track', () => {
    let container;
    let editor;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        editor = new OTFEditor({ container, otf: emptyGuitarDoc(), trackId: 'guitar' });
    });
    afterEach(() => {
        editor.destroy();
        container.remove();
    });

    it('draws every bar of the document and no "No notation" message', () => {
        expect(container.textContent).not.toContain('No notation');
        const bars = editor.renderer.rowData.reduce((n, r) => n + r.measures.length, 0);
        expect(bars).toBe(9);
    });

    it('a click on a later row resolves to a position on the track', () => {
        const row = editor.renderer.rowData[editor.renderer.rowData.length - 1];
        const m = row.measures[0];
        const pos = positionFromSvgPoint(row.measures, m.noteX0 + 5, 30, {
            topMargin: 30, stringSpacing: 15, stringCount: 6, gridSubdivision: 240,
        });
        expect(pos.measure).toBe(9);
    });

    it('the cursor can travel to the last measure', () => {
        editor.cursor.moveToMeasure(9);
        expect(editor.state.cursor.measure).toBe(9);
        expect(editor.state.getMeasureCount()).toBe(9);
    });

    it('switching to the empty track and back leaves the document unchanged', () => {
        const before = JSON.stringify(editor.save());
        editor.state.setTrack('banjo');
        editor.state.setTrack('guitar');
        editor.state.setTrack('bass');
        editor.state.setTrack('guitar');
        expect(JSON.stringify(editor.save())).toBe(before);
        expect(Object.keys(editor.state.otf.notation)).not.toContain('guitar');
        expect(editor.state.facade.canUndo()).toBe(false);
    });

    it('typing on the empty track creates just that measure', () => {
        editor.state.cursor.measure = 7;
        editor.state.getOrCreateMeasure(7);
        expect(editor.state.otf.notation.guitar.map(m => m.measure)).toEqual([7]);
        expect(editor.state.getMeasureCount()).toBe(9);
    });
});
