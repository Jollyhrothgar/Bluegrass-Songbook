// Dynamics, the EDITOR half: Note ▸ Dynamics (menu-only), the state wrapper that
// honours the selection, and the status bar's `Dyn:` that shows only when the
// note differs from its track. The format half is in dynamics-facade.test.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { OTFEditor } from '../../otf-editor/editor.js';
import { DYN_LEVELS } from '../../otf-editor/otf-validate.js';
import {
    ACTIONS, PRESETS, DYNAMIC_ACTIONS, DYNAMIC_DEFAULT_ACTION, resetPreset,
} from '../../otf-editor/bindings.js';

describe('Note ▸ Dynamics', () => {
    let container;
    let editor;

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
        container = document.createElement('div');
        document.body.appendChild(container);
        editor = new OTFEditor({ container });
        editor.state.cursor.string = 3;
        editor.state.cursor.tick = 0;
        editor.state.insertNote(5);
        editor.state.cursor.tick = 0;
    });
    afterEach(() => { editor?.destroy(); container.remove(); });

    const item = (id) => editor.menuBar.popup.querySelector(`.menu-item[data-action="${id}"]`);
    const dynItem = () => editor.statusBar.querySelector('[data-field="dynamic-item"]');
    const dynText = () => editor.statusBar.querySelector('[data-field="dynamic"]').textContent;

    it('offers the seven levels loudest first and a "Track default", all menu-only', () => {
        expect(DYN_LEVELS).toEqual(['fff', 'ff', 'f', 'mf', 'mp', 'p', 'pp']);
        expect(Object.keys(DYNAMIC_ACTIONS)).toEqual(DYN_LEVELS);
        for (const id of [...Object.values(DYNAMIC_ACTIONS), DYNAMIC_DEFAULT_ACTION]) {
            expect(ACTIONS[id].menuOnly, id).toBe(true);
            for (const preset of Object.values(PRESETS)) {
                expect(Object.values(preset.bindings ?? preset.keys ?? {}).flat()
                    .includes(id), id).toBe(false);
            }
        }
        editor.menuBar.open('note');
        const labels = [...editor.menuBar.popup.querySelectorAll('.menu-item[data-action^="dynamic."]')]
            .map(el => el.querySelector('.menu-item-label').textContent.replace('✓ ', ''));
        expect(labels).toEqual([...DYN_LEVELS, 'Track default']);
        expect(item('dynamic.fff').querySelector('.menu-item-key').textContent).toBe('');
    });

    it('choosing a level writes note.dyn; the menu checks it; Track default clears it', () => {
        editor.menuBar.open('note');
        item('dynamic.mp').click();
        expect(editor.state.getNoteAtCursor().dyn).toBe('mp');
        editor.menuBar.open('note');
        expect(item('dynamic.mp').getAttribute('aria-checked')).toBe('true');
        expect(item('dynamic.pp').getAttribute('aria-checked')).toBe('false');
        item(DYNAMIC_DEFAULT_ACTION).click();
        expect(editor.state.getNoteAtCursor()).not.toHaveProperty('dyn');
    });

    it('is one undo step', () => {
        editor.state.setDynamic('ff');
        editor.state.facade.undo();
        expect(editor.state.getNoteAtCursor()).not.toHaveProperty('dyn');
    });

    it('over a selection it sets every note, in one step', () => {
        editor.state.cursor.tick = 480;
        editor.state.cursor.string = 2;
        editor.state.insertNote(7);
        editor.state.cursor.tick = 0;
        editor.state.cursor.string = 3;
        editor.state.setMode('visual');
        editor.state.cursor.tick = 480;
        editor.state.cursor.string = 2;
        editor.state.selection.end = editor.state.cursor.clone();
        expect(editor.state.setDynamic('pp')).toBe(true);
        const notes = editor.state.getMeasure(1).events.flatMap(e => e.notes);
        expect(notes.filter(n => n.dyn === 'pp')).toHaveLength(notes.length);
        editor.state.facade.undo();
        expect(editor.state.getMeasure(1).events.flatMap(e => e.notes).some(n => n.dyn)).toBe(false);
    });

    it('the status bar shows Dyn only when the note differs from its track', () => {
        expect(dynItem().hidden).toBe(true);
        editor.state.setDynamic('mf');
        editor.state.cursor.tick = 0;
        editor.statusBar && editor._updateStatusBar();
        expect(dynItem().hidden).toBe(false);
        expect(dynText()).toBe('mf');
        editor.state.setDynamic('f');             // the track's own level: stored as nothing
        editor._updateStatusBar();
        expect(dynItem().hidden).toBe(true);
    });
});
