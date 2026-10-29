// Score ▸ Delete track… and Score ▸ Add track… (G15c).
//
// Delete removes a track's `tracks[]` entry AND its `notation` key in one
// undo step, and refuses the last pitched track (and, in a correction, the
// take's own track). Add appends an instrument's empty track, with NO
// `notation` key, so adding one changes nothing but `tracks[]`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { EditingFacade } from '../../otf-editor/facade.js';
import { OTFEditor } from '../../otf-editor/editor.js';
import { makeTrack, createMultiTrackOTF } from '../../otf-editor/new-otf.js';

const note = (s, f) => ({ tick: 0, notes: [{ s, f, dur: 480 }] });

function doc() {
    return {
        otf_version: '1.0',
        metadata: { title: 'T', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [
            { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead' },
            { id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0, role: 'rhythm' },
            { id: 'drums', instrument: 'percussion', percussion: true, tuning: ['A', 'B', 'C'], capo: 0, role: 'rhythm' },
        ],
        notation: {
            banjo: [{ measure: 1, events: [note(1, 0), { tick: 480, notes: [{ s: 2, f: 1, dur: 480 }] }] }],
            guitar: [{ measure: 1, events: [note(6, 3)] }, { measure: 2, events: [note(5, 2)] }],
            drums: [{ measure: 1, events: [] }],
        },
    };
}

describe('EditingFacade.deleteTrack', () => {
    let f;
    beforeEach(() => { f = new EditingFacade(doc(), { trackId: 'guitar' }); });

    it('removes the track and its notation as one undo step; undo restores both exactly', () => {
        const before = JSON.stringify(f.otf);
        f.deleteTrack('guitar');
        expect(f.getTracks().map(t => t.id)).toEqual(['banjo', 'drums']);
        expect(Object.keys(f.otf.notation)).toEqual(['banjo', 'drums']);
        expect(f.undo()).toBe(true);
        expect(JSON.stringify(f.otf)).toBe(before);       // position and key order too
        expect(f.canUndo()).toBe(false);                   // exactly one step
    });

    it('moves the cursor to the first remaining pitched track', () => {
        f.deleteTrack('guitar');
        expect(f.trackId).toBe('banjo');
    });

    it('deleting a track you are not on leaves the current track alone', () => {
        f.deleteTrack('banjo');
        expect(f.trackId).toBe('guitar');
    });

    it('refuses the last pitched track (percussion never counts)', () => {
        f.deleteTrack('banjo');
        expect(f.trackDeleteBlocker('guitar')).toMatch(/at least one instrument/);
        expect(() => f.deleteTrack('guitar')).toThrow();
        expect(f.getTracks().map(t => t.id)).toEqual(['guitar', 'drums']);
    });

    it('refuses the take\'s own track in a correction session', () => {
        const c = new EditingFacade(doc(), { trackId: 'banjo', protectedTrackId: 'banjo' });
        expect(c.trackDeleteBlocker('banjo')).toMatch(/correction/);
        expect(() => c.deleteTrack('banjo')).toThrow();
        expect(c.trackDeleteBlocker('guitar')).toBe('');
        c.deleteTrack('guitar');
        expect(c.getTracks().map(t => t.id)).toEqual(['banjo', 'drums']);
    });

    it('the protection follows a rename of the protected track', () => {
        const c = new EditingFacade(doc(), { trackId: 'banjo', protectedTrackId: 'banjo' });
        c.renameTrack('banjo', 'lead banjo');
        expect(c.trackDeleteBlocker('lead banjo')).toMatch(/correction/);
    });

    it('counts the notes that would go', () => {
        expect(f.noteCountIn('banjo')).toBe(2);
        expect(f.noteCountIn('guitar')).toBe(2);
        expect(f.noteCountIn('drums')).toBe(0);
    });
});

describe('EditingFacade.addTrack / makeTrack', () => {
    it('appends the track with no notation key, as one undo step', () => {
        const f = new EditingFacade(doc(), { trackId: 'banjo' });
        const before = JSON.stringify(f.otf);
        const id = f.addTrack(makeTrack('mandolin', f.getTracks().map(t => t.id)));
        expect(id).toBe('mandolin');
        const t = f.getTracks().at(-1);
        expect(t).toMatchObject({ id: 'mandolin', capo: 0, role: 'rhythm',
            tuning: ['E5', 'A4', 'D4', 'G3'] });
        expect(Object.keys(f.otf.notation)).not.toContain('mandolin');
        f.undo();
        expect(JSON.stringify(f.otf)).toBe(before);
    });

    it('de-duplicates ids with the same rule as the new-tab flow', () => {
        expect(makeTrack('5-string-banjo', ['banjo']).id).toBe('banjo-2');
        expect(makeTrack('5-string-banjo', ['banjo', 'banjo-2']).id).toBe('banjo-3');
        const multi = createMultiTrackOTF({ instruments: ['5-string-banjo', '5-string-banjo'] });
        expect(multi.tracks.map(t => t.id)).toEqual(['banjo', 'banjo-2']);
    });

    it('refuses a duplicate id', () => {
        const f = new EditingFacade(doc());
        expect(() => f.addTrack(makeTrack('5-string-banjo', []))).toThrow(/already in use/);
    });
});

describe('the editor: Score ▸ Delete track… / Add track…', () => {
    let container;
    let editor;
    const popover = () => container.querySelector('.otf-track-overlay[style*="flex"] .otf-track-popover');
    const scoreItem = (label) => {
        editor.menuBar.open('score');
        return [...editor.menuBar.popup.querySelectorAll('.menu-item')]
            .find(b => b.textContent.startsWith(label));
    };
    const make = (opts = {}) => {
        editor = new OTFEditor({ container, otf: doc(), trackId: 'guitar', ...opts });
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });
    afterEach(() => { editor?.destroy(); container.remove(); });

    it('asks inline, naming what goes; Cancel changes nothing', () => {
        make();
        scoreItem('Delete track…').click();
        expect(popover().textContent).toContain('Delete the guitar track and its 2 notes?');
        popover().querySelector('.cancel-btn').click();
        expect(editor.state.getTracks()).toHaveLength(3);
    });

    it('confirming deletes, lands on the first pitched track, updates the switcher; Undo brings it back', () => {
        make();
        scoreItem('Delete track…').click();
        popover().querySelector('.confirm-btn').click();
        expect(editor.state.getTracks().map(t => t.id)).toEqual(['banjo', 'drums']);
        expect(editor.state.trackId).toBe('banjo');
        expect(editor.state.cursor.trackId).toBe('banjo');
        const buttons = () => [...container.querySelectorAll('.track-button')].map(b => b.dataset.trackId);
        expect(buttons()).toEqual(['banjo', 'drums']);
        editor.state.undo();
        expect(editor.state.getTracks().map(t => t.id)).toEqual(['banjo', 'guitar', 'drums']);
        expect(editor.state.otf.notation.guitar).toHaveLength(2);
        expect(buttons()).toEqual(['banjo', 'guitar', 'drums']);
    });

    it('the item is disabled, with the reason, when deletion is not allowed', () => {
        make({ trackId: 'banjo', protectedTrackId: 'banjo' });
        const item = scoreItem('Delete track…');
        expect(item.disabled).toBe(true);
        expect(item.title).toMatch(/correction/);
    });

    it('is disabled on the last pitched track', () => {
        make();
        editor.state.deleteTrack('banjo');
        expect(scoreItem('Delete track…').disabled).toBe(true);
    });

    it('Add track ▸ mandolin appends it, switches to it, and Undo drops it', () => {
        make();
        scoreItem('Add track…').click();
        const select = popover().querySelector('.track-add-instrument');
        expect([...select.options].map(o => o.value))
            .toEqual(['banjo', 'guitar', 'mandolin', 'fiddle', 'dobro', 'bass', 'tenor-banjo']);
        select.value = 'mandolin';
        popover().querySelector('.confirm-btn').click();
        expect(editor.state.getTracks().at(-1).id).toBe('mandolin');
        expect(editor.state.trackId).toBe('mandolin');
        expect(Object.keys(editor.state.otf.notation)).not.toContain('mandolin');
        editor.state.undo();
        expect(editor.state.getTracks().map(t => t.id)).toEqual(['banjo', 'guitar', 'drums']);
        expect(editor.state.trackId).not.toBe('mandolin');
    });

    it('Add track ▸ fiddle is a fiddle track (mandolin stave, its own name)', () => {
        make();
        for (let i = 0; i < 2; i++) {
            scoreItem('Add track…').click();
            popover().querySelector('.track-add-instrument').value = 'fiddle';
            popover().querySelector('.confirm-btn').click();
        }
        const [a, b] = editor.state.getTracks().slice(-2);
        expect([a.id, a.instrument, b.id, b.instrument]).toEqual(['fiddle', 'fiddle', 'fiddle-2', 'fiddle']);
        expect(a.tuning).toEqual(makeTrack('mandolin').tuning);   // GDAE, the mandolin stave
    });

    it('never uses a native dialog', () => {
        make();
        const src = [OTFEditor.prototype.addTrackPrompt, OTFEditor.prototype.deleteTrackPrompt]
            .map(f => f.toString()).join('');
        expect(src).not.toMatch(/window\.(prompt|confirm|alert)|\bconfirm\(/);
    });
});
