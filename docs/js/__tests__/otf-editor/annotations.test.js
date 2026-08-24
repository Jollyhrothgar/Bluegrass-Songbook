// Placed free-text annotations: add / edit / delete from the editor.
//
// These are the document's top-level `annotations` — section banners
// ("PART A"), playing notes ("Long Choke") and chord names ("Bb6+9") —
// NOT the per-note fingering the ANNOTATION *mode* deals in.
//
// The load-bearing promise is the round trip: a document opened in the
// editor and saved again must carry every imported annotation, in the
// same order, byte-identical. That is checked against the real
// works/welcome-to-new-york/banjo.otf.json, which is the file that
// prompted the feature (34 annotations, two of them sharing one tick).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EditingFacade } from '../../otf-editor/facade.js';
import { EditorState } from '../../otf-editor/state.js';
import { KeyboardHandler } from '../../otf-editor/keyboard.js';
import { EditorCursor } from '../../otf-editor/cursor.js';
import { AnnotationPopover } from '../../otf-editor/popover.js';
import { dispatchEditorEvent } from '../../otf-editor/recorder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WNY_PATH = path.join(here, '../../../../works/welcome-to-new-york/banjo.otf.json');
const wnyRaw = fs.readFileSync(WNY_PATH, 'utf8');
const wny = JSON.parse(wnyRaw);

/** A small doc with a couple of placed texts. */
function docWithAnnotations() {
    return {
        otf_version: '1.0',
        metadata: { title: 'T', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [{ id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
        notation: { banjo: [{ measure: 1, events: [] }, { measure: 2, events: [] }, { measure: 3, events: [] }] },
        annotations: [
            { measure: 1, tick: 0, text: 'Intro' },
            { measure: 2, tick: 960, text: 'PART A' },
            { measure: 2, tick: 1200, text: 'Long Choke' },
        ],
    };
}

function keyEvent(key, options = {}) {
    return new KeyboardEvent('keydown', {
        key,
        ctrlKey: options.ctrl || false,
        metaKey: options.meta || false,
        shiftKey: options.shift || false,
        bubbles: true,
        cancelable: true,
    });
}

describe('EditingFacade — annotation CRUD', () => {
    let facade;

    beforeEach(() => {
        facade = new EditingFacade(docWithAnnotations());
    });

    describe('add', () => {
        it('places a new annotation at a position', () => {
            expect(facade.addAnnotation({ measure: 3, tick: 240, text: 'Outro' })).toBe(true);
            expect(facade.annotations()).toContainEqual({ measure: 3, tick: 240, text: 'Outro' });
        });

        it('trims the text before storing', () => {
            facade.addAnnotation({ measure: 3, tick: 0, text: '  Bb6+9 \n' });
            expect(facade.annotations().at(-1).text).toBe('Bb6+9');
        });

        it('refuses empty and whitespace-only text (no blank annotations)', () => {
            expect(facade.addAnnotation({ measure: 3, tick: 0, text: '' })).toBe(false);
            expect(facade.addAnnotation({ measure: 3, tick: 0, text: '   ' })).toBe(false);
            expect(facade.addAnnotation({ measure: 3, tick: 0, text: null })).toBe(false);
            expect(facade.annotations()).toHaveLength(3);
            expect(facade.canUndo()).toBe(false);
        });

        it('refuses nonsense positions', () => {
            expect(facade.addAnnotation({ measure: 0, tick: 0, text: 'x' })).toBe(false);
            expect(facade.addAnnotation({ measure: 1, tick: -1, text: 'x' })).toBe(false);
            expect(facade.addAnnotation({ measure: 1.5, tick: 0, text: 'x' })).toBe(false);
        });

        it('splices in score order without reordering what is there', () => {
            facade.addAnnotation({ measure: 2, tick: 0, text: 'New' });
            expect(facade.annotations().map(a => a.text))
                .toEqual(['Intro', 'New', 'PART A', 'Long Choke']);
        });

        it('creates the array on a document that has none', () => {
            const plain = new EditingFacade({
                ...docWithAnnotations(), annotations: undefined,
            });
            delete plain.otf.annotations;
            expect(plain.annotations()).toEqual([]);
            expect(plain.addAnnotation({ measure: 1, tick: 0, text: 'C' })).toBe(true);
            expect(plain.otf.annotations).toEqual([{ measure: 1, tick: 0, text: 'C' }]);
        });
    });

    describe('edit', () => {
        it('retexts by index and leaves its neighbours alone', () => {
            expect(facade.setAnnotationText(1, 'PART B')).toBe(true);
            expect(facade.annotations().map(a => a.text))
                .toEqual(['Intro', 'PART B', 'Long Choke']);
            expect(facade.annotations()[1]).toEqual({ measure: 2, tick: 960, text: 'PART B' });
        });

        it('trims on edit', () => {
            facade.setAnnotationText(0, '  Verse  ');
            expect(facade.annotations()[0].text).toBe('Verse');
        });

        it('is a no-op when the text is unchanged', () => {
            expect(facade.setAnnotationText(0, 'Intro')).toBe(false);
            expect(facade.canUndo()).toBe(false);
        });

        it('rejects an out-of-range index', () => {
            expect(facade.setAnnotationText(-1, 'x')).toBe(false);
            expect(facade.setAnnotationText(99, 'x')).toBe(false);
        });

        it('EMPTY TEXT DELETES rather than persisting a blank', () => {
            expect(facade.setAnnotationText(1, '')).toBe(true);
            expect(facade.annotations().map(a => a.text)).toEqual(['Intro', 'Long Choke']);
        });

        it('whitespace-only text deletes too', () => {
            expect(facade.setAnnotationText(1, '   \t ')).toBe(true);
            expect(facade.annotations().map(a => a.text)).toEqual(['Intro', 'Long Choke']);
        });
    });

    describe('delete', () => {
        it('removes by index', () => {
            expect(facade.deleteAnnotation(0)).toBe(true);
            expect(facade.annotations().map(a => a.text)).toEqual(['PART A', 'Long Choke']);
        });

        it('rejects an out-of-range index', () => {
            expect(facade.deleteAnnotation(3)).toBe(false);
            expect(facade.deleteAnnotation(-1)).toBe(false);
            expect(facade.annotations()).toHaveLength(3);
        });

        it('drops the key entirely once the last one goes (keeps plain docs plain)', () => {
            facade.deleteAnnotation(0);
            facade.deleteAnnotation(0);
            facade.deleteAnnotation(0);
            expect('annotations' in facade.otf).toBe(false);
            expect(facade.annotations()).toEqual([]);
        });
    });

    describe('find', () => {
        it('finds an exact hit', () => {
            expect(facade.findAnnotationIndex({ measure: 2, tick: 960 })).toBe(1);
        });

        it('finds the nearest one in the same measure', () => {
            expect(facade.findAnnotationIndex({ measure: 2, tick: 1100 })).toBe(2);
            expect(facade.findAnnotationIndex({ measure: 2, tick: 1000 })).toBe(1);
        });

        it('never crosses a barline', () => {
            expect(facade.findAnnotationIndex({ measure: 3, tick: 0 })).toBe(-1);
        });

        it('honours maxTicks', () => {
            expect(facade.findAnnotationIndex({ measure: 2, tick: 0 }, { maxTicks: 480 })).toBe(-1);
            expect(facade.findAnnotationIndex({ measure: 2, tick: 600 }, { maxTicks: 480 })).toBe(1);
        });

        it('returns the FIRST of two sharing a tick (they are addressed by index)', () => {
            facade.addAnnotation({ measure: 1, tick: 0, text: 'C' });
            // Intro and C now share measure 1 / tick 0
            expect(facade.annotations().filter(a => a.measure === 1 && a.tick === 0))
                .toHaveLength(2);
            expect(facade.findAnnotationIndex({ measure: 1, tick: 0 })).toBe(0);
        });

        it('is -1 on a document with no annotations', () => {
            const plain = new EditingFacade(docWithAnnotations());
            delete plain.otf.annotations;
            expect(plain.findAnnotationIndex({ measure: 1, tick: 0 })).toBe(-1);
        });
    });

    describe('undo / redo', () => {
        it('covers an add', () => {
            facade.addAnnotation({ measure: 3, tick: 0, text: 'Outro' });
            expect(facade.annotations()).toHaveLength(4);
            expect(facade.undo()).toBe(true);
            expect(facade.annotations().map(a => a.text))
                .toEqual(['Intro', 'PART A', 'Long Choke']);
            expect(facade.redo()).toBe(true);
            expect(facade.annotations().map(a => a.text))
                .toEqual(['Intro', 'PART A', 'Long Choke', 'Outro']);
        });

        it('covers an edit', () => {
            facade.setAnnotationText(0, 'Kickoff');
            facade.undo();
            expect(facade.annotations()[0].text).toBe('Intro');
            facade.redo();
            expect(facade.annotations()[0].text).toBe('Kickoff');
        });

        it('covers a delete, key removal and all', () => {
            facade.deleteAnnotation(0);
            facade.deleteAnnotation(0);
            facade.deleteAnnotation(0);
            expect('annotations' in facade.otf).toBe(false);
            facade.undo();
            facade.undo();
            facade.undo();
            expect(facade.annotations().map(a => a.text))
                .toEqual(['Intro', 'PART A', 'Long Choke']);
        });

        it('an empty-text edit undoes as one step (it is a delete)', () => {
            facade.setAnnotationText(1, '   ');
            expect(facade.annotations()).toHaveLength(2);
            expect(facade.undo()).toBe(true);
            expect(facade.annotations().map(a => a.text))
                .toEqual(['Intro', 'PART A', 'Long Choke']);
            expect(facade.canUndo()).toBe(false);
        });

        it('groups into one step inside a transact', () => {
            facade.transact('Two texts', () => {
                facade.addAnnotation({ measure: 3, tick: 0, text: 'A' });
                facade.addAnnotation({ measure: 3, tick: 480, text: 'B' });
            });
            expect(facade.annotations()).toHaveLength(5);
            facade.undo();
            expect(facade.annotations()).toHaveLength(3);
        });
    });

    it('insertMeasure renumbers annotations with the score', () => {
        facade.insertMeasure(2);
        expect(facade.annotations()).toEqual([
            { measure: 1, tick: 0, text: 'Intro' },
            { measure: 3, tick: 960, text: 'PART A' },
            { measure: 3, tick: 1200, text: 'Long Choke' },
        ]);
        facade.undo();
        expect(facade.annotations()).toEqual(docWithAnnotations().annotations);
    });
});

describe('EditorState — annotations anchored to the cursor', () => {
    let state;

    beforeEach(() => {
        state = new EditorState({ otf: docWithAnnotations(), trackId: 'banjo' });
    });

    it('reports the annotation at the cursor', () => {
        state.cursor.measure = 2;
        state.cursor.tick = 960;
        expect(state.getAnnotationAtCursor()).toMatchObject({
            index: 1,
            annotation: { text: 'PART A' },
        });
    });

    it('reaches one beat, no further', () => {
        state.cursor.measure = 2;
        state.cursor.tick = 480;   // one beat before PART A
        expect(state.getAnnotationAtCursor().annotation.text).toBe('PART A');
        state.cursor.tick = 0;     // two beats — out of reach
        expect(state.getAnnotationAtCursor()).toBe(null);
    });

    it('adds at the cursor when nothing is there', () => {
        state.cursor.measure = 3;
        state.cursor.tick = 240;
        expect(state.setAnnotationAtCursor('G7')).toBe(true);
        expect(state.otf.annotations).toContainEqual({ measure: 3, tick: 240, text: 'G7' });
    });

    it('edits the one that IS there instead of stacking a second', () => {
        state.cursor.measure = 2;
        state.cursor.tick = 1000;
        expect(state.setAnnotationAtCursor('PART B')).toBe(true);
        expect(state.otf.annotations).toHaveLength(3);
        expect(state.otf.annotations.map(a => a.text))
            .toEqual(['Intro', 'PART B', 'Long Choke']);
    });

    it('empty text at an annotation deletes it', () => {
        state.cursor.measure = 1;
        state.cursor.tick = 0;
        expect(state.setAnnotationAtCursor('  ')).toBe(true);
        expect(state.otf.annotations.map(a => a.text)).toEqual(['PART A', 'Long Choke']);
    });

    it('empty text on empty space adds nothing', () => {
        state.cursor.measure = 3;
        state.cursor.tick = 0;
        expect(state.setAnnotationAtCursor('')).toBe(false);
        expect(state.otf.annotations).toHaveLength(3);
    });

    it('deletes at the cursor, and says so when there is nothing to delete', () => {
        state.cursor.measure = 2;
        state.cursor.tick = 960;
        expect(state.deleteAnnotationAtCursor()).toBe(true);
        expect(state.otf.annotations.map(a => a.text)).toEqual(['Intro', 'Long Choke']);
        state.cursor.measure = 3;
        expect(state.deleteAnnotationAtCursor()).toBe(false);
    });

    it('emits change so the view re-renders', () => {
        const onChange = vi.fn();
        state.on('change', onChange);
        state.cursor.measure = 3;
        state.cursor.tick = 0;
        state.setAnnotationAtCursor('Outro');
        expect(onChange).toHaveBeenCalled();
    });

    it('undo/redo through the state covers text edits', () => {
        state.cursor.measure = 3;
        state.cursor.tick = 0;
        state.setAnnotationAtCursor('Outro');
        expect(state.history.canUndo()).toBe(true);
        state.undo();
        expect(state.otf.annotations.map(a => a.text))
            .toEqual(['Intro', 'PART A', 'Long Choke']);
        state.redo();
        expect(state.otf.annotations.map(a => a.text))
            .toEqual(['Intro', 'PART A', 'Long Choke', 'Outro']);
    });

    it('interleaves with note edits in ONE history stack', () => {
        state.cursor.measure = 1;
        state.cursor.tick = 0;
        state.insertNote(5);
        state.cursor.measure = 3;
        state.setAnnotationAtCursor('Outro');
        state.undo();                                     // undoes the text
        expect(state.otf.annotations).toHaveLength(3);
        expect(state.getMeasure(1).events).toHaveLength(1);
        state.undo();                                     // undoes the note
        expect(state.getMeasure(1).events).toHaveLength(0);
        expect(state.otf.annotations).toHaveLength(3);
    });

    it('annotation reach follows the document ticks_per_beat', () => {
        expect(state.annotationReach).toBe(480);
    });
});

// Placed text through the KEYS the vim preset uses (c / C). The
// TablEdit preset puts the same actions on t / T — see keyboard.test.js.
describe('KeyboardHandler — c / Shift+C (vim preset)', () => {
    let state;
    let cursor;
    let keyboard;
    let container;
    let onEditAnnotation;

    beforeEach(() => {
        state = new EditorState({ otf: docWithAnnotations(), trackId: 'banjo' });
        cursor = new EditorCursor(state);
        container = document.createElement('div');
        document.body.appendChild(container);
        cursor.init(container);
        onEditAnnotation = vi.fn();
        keyboard = new KeyboardHandler(state, cursor, { onEditAnnotation, preset: 'vim' });
    });

    it('c opens the text prompt', () => {
        keyboard.handleKeyDown(keyEvent('c'));
        expect(onEditAnnotation).toHaveBeenCalled();
    });

    it('c does not enter a note or change mode', () => {
        keyboard.handleKeyDown(keyEvent('c'));
        expect(state.getMeasure(1).events).toHaveLength(0);
        expect(state.mode).toBe('normal');
    });

    it('Shift+C deletes the text at the cursor', () => {
        state.cursor.measure = 2;
        state.cursor.tick = 960;
        keyboard.handleKeyDown(keyEvent('C', { shift: true }));
        expect(state.otf.annotations.map(a => a.text)).toEqual(['Intro', 'Long Choke']);
    });

    it('Shift+C is undoable', () => {
        state.cursor.measure = 2;
        state.cursor.tick = 960;
        keyboard.handleKeyDown(keyEvent('C', { shift: true }));
        state.undo();
        expect(state.otf.annotations).toHaveLength(3);
    });

    it('u undoes a text edit, and Ctrl+R redoes it', () => {
        state.cursor.measure = 3;
        state.cursor.tick = 0;
        state.setAnnotationAtCursor('Outro');
        keyboard.handleKeyDown(keyEvent('u'));
        expect(state.otf.annotations.map(a => a.text)).not.toContain('Outro');
        // `key` is only 'R' when Shift is down, so the advertised Ctrl+R
        // must match case-insensitively (it did not, before)
        keyboard.handleKeyDown(keyEvent('r', { ctrl: true }));
        expect(state.otf.annotations.map(a => a.text)).toContain('Outro');
    });

    it('Ctrl+Shift+R redoes too (Shift is what made key uppercase)', () => {
        state.cursor.measure = 3;
        state.cursor.tick = 0;
        state.setAnnotationAtCursor('Outro');
        state.undo();
        keyboard.handleKeyDown(keyEvent('R', { ctrl: true, shift: true }));
        expect(state.otf.annotations.map(a => a.text)).toContain('Outro');
    });

    it('Cmd+C still copies — the clipboard binding is untouched', () => {
        keyboard.handleKeyDown(keyEvent('c', { meta: true }));
        expect(onEditAnnotation).not.toHaveBeenCalled();
        expect(state.clipboard).not.toBe(null);
    });

    it('replays recorded text events', () => {
        const editor = { state, cursor };
        dispatchEditorEvent(editor, {
            type: 'setAnnotation', params: { measure: 3, tick: 0, text: 'Outro' },
        });
        expect(state.otf.annotations.map(a => a.text)).toContain('Outro');
        dispatchEditorEvent(editor, {
            type: 'deleteAnnotation', params: { measure: 3, tick: 0 },
        });
        expect(state.otf.annotations.map(a => a.text)).not.toContain('Outro');
    });
});

describe('AnnotationPopover', () => {
    let popover;
    let host;
    let onCommit;
    let onDelete;
    let onCancel;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        onCommit = vi.fn();
        onDelete = vi.fn();
        onCancel = vi.fn();
        popover = new AnnotationPopover({ onCommit, onDelete, onCancel });
        popover.init(host);
    });

    it('opens empty for a fresh spot and says "Add text"', () => {
        popover.open({ measure: 3, tick: 0, beatLabel: '1' });
        expect(popover.opened).toBe(true);
        expect(host.querySelector('.popover-title').textContent).toBe('Add text');
        expect(host.querySelector('.annotation-input').value).toBe('');
        expect(host.querySelector('.delete-btn')).toBe(null);
    });

    it('opens pre-filled for an existing one, with a Delete button', () => {
        popover.open({ measure: 4, tick: 960, existing: 'PART A', beatLabel: '3' });
        expect(host.querySelector('.popover-title').textContent).toBe('Edit text');
        expect(host.querySelector('.annotation-input').value).toBe('PART A');
        expect(host.querySelector('.delete-btn')).not.toBe(null);
    });

    it('commits trimmed text and closes', () => {
        popover.open({ measure: 1, tick: 0 });
        host.querySelector('.annotation-input').value = '  Bb6+9  ';
        host.querySelector('.save-btn').click();
        expect(onCommit).toHaveBeenCalledWith('Bb6+9');
        expect(popover.opened).toBe(false);
    });

    it('commits an EMPTY string when the box is cleared (the delete path)', () => {
        popover.open({ measure: 1, tick: 0, existing: 'PART A' });
        host.querySelector('.annotation-input').value = '   ';
        host.querySelector('.save-btn').click();
        expect(onCommit).toHaveBeenCalledWith('');
    });

    it('Enter commits', () => {
        popover.open({ measure: 1, tick: 0 });
        host.querySelector('.annotation-input').value = 'Solo';
        host.querySelector('.otf-annotation-popover')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onCommit).toHaveBeenCalledWith('Solo');
    });

    it('Escape cancels without committing', () => {
        popover.open({ measure: 1, tick: 0, existing: 'PART A' });
        host.querySelector('.otf-annotation-popover')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onCommit).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalled();
        expect(popover.opened).toBe(false);
    });

    it('the Delete button deletes without going through the text box', () => {
        popover.open({ measure: 1, tick: 0, existing: 'PART A' });
        host.querySelector('.delete-btn').click();
        expect(onDelete).toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('a suggestion chip fills the box', () => {
        popover.open({ measure: 1, tick: 0 });
        host.querySelector('.annotation-suggestion').click();
        expect(host.querySelector('.annotation-input').value)
            .toBe(AnnotationPopover.SUGGESTIONS[0]);
    });

    it('never lets stray keys reach the editor behind it', () => {
        popover.open({ measure: 1, tick: 0 });
        const seen = vi.fn();
        host.addEventListener('keydown', seen);
        host.querySelector('.annotation-input')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
        expect(seen).not.toHaveBeenCalled();
    });

    it('escapes markup in existing text', () => {
        popover.open({ measure: 1, tick: 0, existing: '"><img src=x>' });
        expect(host.querySelector('.annotation-input').value).toBe('"><img src=x>');
        expect(host.querySelector('img')).toBe(null);
    });
});

describe('Round trip × works/welcome-to-new-york/banjo.otf.json', () => {
    it('the fixture is the shape this feature edits', () => {
        expect(wny.annotations).toHaveLength(34);
        // Two annotations share m14 tick 0 — position is NOT a key
        const at14 = wny.annotations.filter(a => a.measure === 14 && a.tick === 0);
        expect(at14.map(a => a.text)).toEqual(['PART B', 'F']);
    });

    it('load → export preserves every annotation, in order, untouched', () => {
        const facade = new EditingFacade(wny);
        expect(facade.export().annotations).toEqual(wny.annotations);
    });

    it('a full editor state round trip is byte-identical for annotations', () => {
        const state = new EditorState({ otf: JSON.parse(wnyRaw) });
        const out = state.export();
        expect(JSON.stringify(out.annotations)).toBe(JSON.stringify(wny.annotations));
    });

    it('editing NOTES never disturbs the text', () => {
        const state = new EditorState({ otf: JSON.parse(wnyRaw) });
        state.cursor.measure = 5;
        state.cursor.tick = 0;
        state.insertNote(7);
        state.deleteNote();
        expect(state.export().annotations).toEqual(wny.annotations);
    });

    it('adding one text leaves the imported 34 in their original order', () => {
        const state = new EditorState({ otf: JSON.parse(wnyRaw) });
        state.cursor.measure = 3;
        state.cursor.tick = 0;
        expect(state.setAnnotationAtCursor('New note here')).toBe(true);
        const out = state.export().annotations;
        expect(out).toHaveLength(35);
        expect(out.filter(a => a.text !== 'New note here')).toEqual(wny.annotations);
    });

    it('editing one text leaves the other 33 exactly as imported', () => {
        const state = new EditorState({ otf: JSON.parse(wnyRaw) });
        // "PART A" at m4 tick 960
        state.cursor.measure = 4;
        state.cursor.tick = 960;
        expect(state.getAnnotationAtCursor().annotation.text).toBe('PART A');
        state.setAnnotationAtCursor('PART A (kickoff)');
        const out = state.export().annotations;
        expect(out).toHaveLength(34);
        expect(out[3]).toEqual({ measure: 4, tick: 960, text: 'PART A (kickoff)' });
        expect(out.filter((_, i) => i !== 3))
            .toEqual(wny.annotations.filter((_, i) => i !== 3));
    });

    it('deleting one text, then undoing, restores the file exactly', () => {
        const state = new EditorState({ otf: JSON.parse(wnyRaw) });
        state.cursor.measure = 4;
        state.cursor.tick = 1200;
        expect(state.getAnnotationAtCursor().annotation.text).toBe('Long Choke');
        expect(state.deleteAnnotationAtCursor()).toBe(true);
        expect(state.export().annotations).toHaveLength(33);
        state.undo();
        expect(JSON.stringify(state.export().annotations))
            .toBe(JSON.stringify(wny.annotations));
    });

    it('the two texts sharing m14 tick 0 are individually reachable', () => {
        const state = new EditorState({ otf: JSON.parse(wnyRaw) });
        state.cursor.measure = 14;
        state.cursor.tick = 0;
        expect(state.getAnnotationAtCursor().annotation.text).toBe('PART B');
        state.deleteAnnotationAtCursor();
        expect(state.getAnnotationAtCursor().annotation.text).toBe('F');
        state.deleteAnnotationAtCursor();
        expect(state.getAnnotationAtCursor()).toBe(null);
        expect(state.export().annotations).toHaveLength(32);
    });

    it('the exported document still validates as OTF', () => {
        const state = new EditorState({ otf: JSON.parse(wnyRaw) });
        state.cursor.measure = 1;
        state.cursor.tick = 0;
        state.setAnnotationAtCursor('Capo 2');
        const out = state.export();
        // The gate submissions pass (scripts/lib/process_pending.validate_otf)
        // walks tracks/tuning/notation — annotations must not disturb any
        // of it, and must survive as a plain array of plain objects.
        expect(out.tracks.length).toBeGreaterThan(0);
        for (const t of out.tracks) {
            expect(Array.isArray(t.tuning)).toBe(true);
            expect(Array.isArray(out.notation[t.id])).toBe(true);
        }
        for (const a of out.annotations) {
            expect(Number.isInteger(a.measure)).toBe(true);
            expect(Number.isInteger(a.tick)).toBe(true);
            expect(typeof a.text).toBe('string');
            expect(a.text.trim()).toBe(a.text);
            expect(Object.keys(a).sort()).toEqual(['measure', 'text', 'tick']);
        }
        expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    });
});
