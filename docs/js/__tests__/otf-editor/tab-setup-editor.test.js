// G20b: Score ▸ Tab setup… in the running editor — the menu entry, Apply as one
// undo step through the keyboard's own `u`, a refusal on screen, and the title
// the page above the editor shows (the new-tab title box).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OTFEditor } from '../../otf-editor/editor.js';
import { MENUS } from '../../otf-editor/menu-bar.js';
import { resetPreset } from '../../otf-editor/bindings.js';

const note = (s, f, dur = 480) => ({ s, f, dur });

function otfWithNotes() {
    return {
        otf_version: '1.0',
        metadata: { title: 'Old title', time_signature: '4/4', tempo: 120, composer: '', key: '' },
        timing: { ticks_per_beat: 480 },
        tracks: [
            { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead' },
            { id: 'mandolin', instrument: 'mandolin', tuning: ['E5', 'A4', 'D4', 'G3'], capo: 0, role: 'rhythm' },
        ],
        notation: {
            banjo: [
                { measure: 1, events: [{ tick: 0, notes: [note(5, 0), note(2, 3)] }] },
                { measure: 2, events: [{ tick: 1440, notes: [note(1, 2)] }] },
            ],
            mandolin: [{ measure: 1, events: [] }],
        },
    };
}

const ctrl = (key) => new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });

describe('Score ▸ Tab setup…', () => {
    let container, editor;
    const panel = () => editor.tabSetupPopover;
    const $ = (sel) => panel().element.querySelector(sel);
    const type = (sel, value) => { $(sel).value = value; $(sel).dispatchEvent(new Event('input', { bubbles: true })); };
    const pick = (sel, value) => { $(sel).value = value; $(sel).dispatchEvent(new Event('change', { bubbles: true })); };

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
        container = document.createElement('div');
        document.body.appendChild(container);
        editor = new OTFEditor({ container, otf: otfWithNotes() });
    });
    afterEach(() => { editor?.destroy(); container.remove(); });

    it('is one entry in the Score menu, in place of the two that never showed', () => {
        const score = MENUS.find(m => m.id === 'score').items;
        expect(score.filter(i => i.hook === 'tabSetup').map(i => i.label)).toEqual(['Tab setup…']);
        expect(score.some(i => i.hook === 'timeSignature' || i.hook === 'tuning')).toBe(false);

        editor.menuBar.open('score');
        const labels = [...editor.menuBar.popup.querySelectorAll('.menu-item-label')].map(e => e.textContent);
        expect(labels).toContain('Tab setup…');
        expect(labels).not.toContain('Tuning…');
        const item = [...editor.menuBar.popup.querySelectorAll('.menu-item')]
            .find(el => el.querySelector('.menu-item-label').textContent === 'Tab setup…');
        item.click();
        expect(panel().opened).toBe(true);
    });

    it('opens on the document and the current track', () => {
        editor.openTabSetup();
        expect($('.tab-setup-title').value).toBe('Old title');
        expect($('.tab-setup-track legend').textContent).toBe('Track: banjo');
        expect($('.tab-setup-tuning').value).toBe('Open G');
        expect($('.tab-setup-keeps')).not.toBeNull();       // the banjo has notes
        editor.state.setTrack('mandolin');
        editor.openTabSetup();
        expect($('.tab-setup-track legend').textContent).toBe('Track: mandolin');
        expect($('.tab-setup-keeps')).toBeNull();           // the mandolin has none
    });

    it('Apply changes the capo, tuning and time signature as ONE undo step, and Ctrl+Z takes it back', () => {
        editor.openTabSetup();
        pick('.tab-setup-time', '6/8');                     // 3 beats of 8ths... m2's note at 1440 is past 6/8's 1440
        type('.tab-setup-capo', '2');
        pick('.tab-setup-tuning', 'Double C');
        $('.apply-btn').click();
        // the m2 note at tick 1440 starts at the end of a 6/8 bar: refused as a whole
        expect($('.tab-setup-error').textContent).toBe(
            '1 measure has notes that do not fit 6/8; the first is measure 2.');
        expect(panel().opened).toBe(true);
        expect(editor.state.otf.metadata.time_signature).toBe('4/4');
        expect(editor.state.otf.tracks[0].capo).toBe(0);
        expect(editor.state.facade.canUndo()).toBe(false);

        pick('.tab-setup-time', '4/4');
        $('.apply-btn').click();
        expect(panel().opened).toBe(false);
        const banjo = editor.state.otf.tracks[0];
        expect(banjo.capo).toBe(2);
        expect(banjo.tuning).toEqual(['D4', 'C4', 'G3', 'C3', 'G4']);
        // every note kept its string and fret
        expect(editor.state.otf.notation.banjo[0].events[0].notes).toEqual([note(5, 0), note(2, 3)]);

        editor.keyboard.handleKeyDown(ctrl('z'));
        expect(editor.state.otf.tracks[0].capo).toBe(0);
        expect(editor.state.otf.tracks[0].tuning[1]).toBe('B3');
        expect(editor.state.facade.canUndo()).toBe(false);  // it was the only step
        editor.state.facade.redo();
        expect(editor.state.otf.tracks[0].capo).toBe(2);
    });

    it('shows the time signature on the stave as the bar length', () => {
        const d = otfWithNotes();
        d.notation.banjo[1].events = [];
        editor.destroy();
        container.innerHTML = '';
        editor = new OTFEditor({ container, otf: d });
        editor.openTabSetup();
        pick('.tab-setup-time', '3/4');
        $('.apply-btn').click();
        expect(editor.state.otf.metadata.time_signature).toBe('3/4');
        expect(editor.state.facade.ticksFor(1)).toBe(1440);
    });

    it('a tuning that would drop string 5 is refused in the panel, and nothing changes', () => {
        editor.state.setTrack('banjo');
        editor.openTabSetup();
        pick('.tab-setup-instrument', 'mandolin');
        $('.apply-btn').click();
        expect($('.tab-setup-error').textContent).toBe(
            'This tuning has 4 strings, but 1 note is on string 5; the first is in measure 1. Move or delete them first.');
        expect(panel().opened).toBe(true);
        expect(editor.state.otf.tracks[0].instrument).toBe('5-string-banjo');
        expect(editor.state.otf.tracks[0].tuning).toHaveLength(5);
        expect(editor.state.facade.canUndo()).toBe(false);
    });

    it('whole-tab fields: title, composer, key and tempo, and the tempo box follows', () => {
        editor.openTabSetup();
        type('.tab-setup-title', 'Cripple Creek');
        type('.tab-setup-composer', 'Trad.');
        type('.tab-setup-key', 'A');
        type('.tab-setup-tempo', '96');
        $('.apply-btn').click();
        expect(editor.state.otf.metadata).toMatchObject({
            title: 'Cripple Creek', composer: 'Trad.', key: 'A', tempo: 96,
        });
        expect(editor.statusBar.querySelector('.tempo-input').value).toBe('96');
    });

    it('a new string count keeps the cursor on the stave', () => {
        const d = otfWithNotes();
        d.notation.banjo = [{ measure: 1, events: [] }];
        editor.destroy();
        container.innerHTML = '';
        editor = new OTFEditor({ container, otf: d });
        editor.state.cursor.string = 5;
        editor.openTabSetup();
        pick('.tab-setup-instrument', 'mandolin');
        $('.apply-btn').click();
        expect(editor.state.otf.tracks[0].tuning).toHaveLength(4);
        expect(editor.state.cursor.string).toBe(4);
    });

    describe('the title on the page above the editor', () => {
        it('says when the title changes (Tab setup, undo, redo) so the new-tab box can follow', () => {
            const heard = [];
            container.addEventListener('otf-editor:title', (e) => heard.push(e.detail.title));
            editor.openTabSetup();
            type('.tab-setup-title', 'New name');
            $('.apply-btn').click();
            expect(heard).toEqual(['New name']);
            editor.state.facade.undo();
            editor.state.facade.redo();
            expect(heard).toEqual(['New name', 'Old title', 'New name']);
        });

        it('setTitle (the box typing) writes metadata.title as one undo step and is not echoed back', () => {
            const heard = vi.fn();
            container.addEventListener('otf-editor:title', heard);
            expect(editor.setTitle('  Typed in the box ')).toBe(true);
            expect(editor.state.otf.metadata.title).toBe('Typed in the box');
            expect(heard).not.toHaveBeenCalled();
            editor.state.facade.undo();
            expect(editor.state.otf.metadata.title).toBe('Old title');
            expect(editor.state.facade.canUndo()).toBe(false);
        });

        it('stays quiet for edits that are not the title', () => {
            const heard = vi.fn();
            container.addEventListener('otf-editor:title', heard);
            editor.state.setTempo(100);
            editor.state.facade.undo();
            expect(heard).not.toHaveBeenCalled();
        });
    });
});
