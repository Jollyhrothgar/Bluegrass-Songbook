// The note-entry popover's TECHNIQUE row (QA D4).
//
// The popover is the TOUCH path into a note: on a phone it is the only
// way to say "dead note" or "choke". It had drifted into being a second
// opinion about what a technique is — a hand-written `h · p · / · ~ ·
// none` that still offered the retired `~`-as-technique and offered
// neither of the two techs P1-3 added. It now renders from the SAME
// config the toolbar's articulation group does.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    NoteEntryPopover, POPOVER_TECHS, POPOVER_FINGERS, POPOVER_LH,
} from '../../otf-editor/popover.js';
import { ARTICULATION_BUTTONS } from '../../otf-editor/toolbar.js';
import { EditorState, DURATIONS } from '../../otf-editor/state.js';

function mount(state) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const popover = new NoteEntryPopover(state, {});
    popover.init(container);
    return { popover, container };
}

const techButtons = (popover) => [...popover.element.querySelectorAll('.tech-button')]
    .map(b => ({
        tech: b.dataset.tech,
        symbol: b.textContent,
        disabled: b.disabled,
        title: b.getAttribute('title'),
    }));

describe('NoteEntryPopover — the technique row', () => {
    let state;
    let popover;
    let container;

    beforeEach(() => {
        document.body.innerHTML = '';
        state = new EditorState();
        state.setDuration(DURATIONS.eighth);
        state.cursor.string = 3;
        ({ popover, container } = mount(state));
    });

    afterEach(() => {
        popover?.destroy();
        container?.remove();
    });

    it('is the toolbar’s articulation group, minus the clear latch', () => {
        expect(POPOVER_TECHS.map(t => t.tech))
            .toEqual(['h', 'p', '/', 'x', 'b', '~']);
        // Same source, same wording — not a parallel list to keep in step
        expect(POPOVER_TECHS.map(t => t.label))
            .toEqual(ARTICULATION_BUTTONS.filter(c => !c.clear).map(c => c.label));
    });

    it('offers h · p · / · x · b · ⌒, then none — and no bare `~`', () => {
        popover.open(0, 0, {});
        const buttons = techButtons(popover);
        expect(buttons.map(b => b.tech))
            .toEqual(['h', 'p', '/', 'x', 'b', '~', '']);
        expect(buttons.map(b => b.symbol))
            .toEqual(['h', 'p', '/', 'x', 'b', '⌒', 'none']);
        // The tie's own button says tie; nothing advertises `~` as a tech
        expect(buttons.find(b => b.tech === '~').symbol).toBe('⌒');
    });

    it('dead and choke reach the document as `tech`', () => {
        // Insert exactly as the editor does: the popover hands the
        // choice to `onInsert`, which calls `state.insertNote`.
        popover.options.onInsert = (note) => {
            state.cursor.string = note.string;
            state.insertNote(note.fret, { tech: note.tech });
        };
        for (const [tech, tick] of [['x', 0], ['b', 240]]) {
            state.cursor.tick = tick;
            popover.open(0, 0, {});
            popover.element.querySelector(`.tech-button[data-tech="${tech}"]`).click();
            popover.element.querySelector('.fret-button[data-fret="5"]').click();
            popover.element.querySelector('.insert-btn').click();
            expect(state.getNoteAtCursor().tech, tech).toBe(tech);
            expect(state.getNoteAtCursor().tie, tech).toBeUndefined();
        }
    });

    it('the tie is disabled, with a reason, when there is no predecessor', () => {
        state.cursor.tick = 0;                 // nothing before it
        popover.open(0, 0, {});
        const tie = popover.element.querySelector('.tech-button[data-tech="~"]');
        expect(tie.disabled).toBe(true);
        expect(tie.getAttribute('title')).toMatch(/same string/i);
        tie.click();
        expect(popover.selectedTech).toBe(null);
    });

    it('the tie is live once a same-string predecessor exists', () => {
        state.cursor.tick = 0;
        state.insertNote(5);
        state.cursor.tick = 240;
        popover.open(0, 0, {});
        const tie = popover.element.querySelector('.tech-button[data-tech="~"]');
        expect(tie.disabled).toBe(false);
        tie.click();
        expect(popover.selectedTech).toBe('~');

        // …and inserting with it writes `tie: true`, never `tech: '~'`
        state.insertNote(7, { tech: popover.selectedTech });
        expect(state.getNoteAtCursor().tie).toBe(true);
        expect(state.getNoteAtCursor().tech).toBeUndefined();
    });

    it('a tie selected then made impossible is dropped, not carried', () => {
        state.cursor.tick = 0;
        state.insertNote(5);            // string 3 has a predecessor
        state.cursor.tick = 240;
        popover.open(0, 0, {});
        popover.element.querySelector('.tech-button[data-tech="~"]').click();
        expect(popover.selectedTech).toBe('~');

        // String 1 has nothing before it — the tie goes away with it
        popover.element.querySelector('.string-button[data-string="1"]').click();
        expect(popover.selectedTech).toBe(null);
        expect(popover.element.querySelector('.tech-button[data-tech="~"]').disabled)
            .toBe(true);
    });

    it('x and b are typeable, like they are on the canvas', () => {
        state.cursor.tick = 0;
        popover.open(0, 0, {});
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
        expect(popover.selectedTech).toBe('x');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
        expect(popover.selectedTech).toBe('b');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
        expect(popover.selectedTech).toBe(null);   // pressing it again unsets
    });
});


// ----------------------------------------------------------------------
// The FINGERING row — the touch path to the two marks ANNOTATION mode
// types. Same vocabulary as the facade and the TEF importer, and every
// button is a toggle because a phone has no other way to un-mark a hand.
// ----------------------------------------------------------------------

describe('NoteEntryPopover — the fingering row', () => {
    let state;
    let popover;
    let container;

    const fingerBtn = (f) => popover.element
        .querySelector(`.finger-button[data-finger="${f}"]`);
    const lhBtn = (d) => popover.element.querySelector(`.lh-button[data-lh="${d}"]`);

    beforeEach(() => {
        document.body.innerHTML = '';
        state = new EditorState();
        state.setDuration(DURATIONS.eighth);
        state.cursor.string = 3;
        ({ popover, container } = mount(state));
    });

    afterEach(() => {
        popover?.destroy();
        container?.remove();
    });

    it('speaks the OTF vocabulary and nothing else', () => {
        expect(POPOVER_FINGERS).toEqual(['T', 'I', 'M', 'R', 'P']);
        expect(POPOVER_LH).toEqual([0, 1, 2, 3, 4]);
    });

    it('draws both hands', () => {
        popover.open(0, 0, {});
        expect([...popover.element.querySelectorAll('.finger-button')]
            .map(b => b.textContent)).toEqual(['T', 'I', 'M', 'R', 'P']);
        expect([...popover.element.querySelectorAll('.lh-button')]
            .map(b => b.textContent)).toEqual(['0', '1', '2', '3', '4']);
    });

    it('toggles: a second tap on the lit button clears that hand', () => {
        popover.open(0, 0, {});
        fingerBtn('R').click();
        expect(popover.selectedFinger).toBe('R');
        expect(fingerBtn('R').classList.contains('selected')).toBe(true);
        fingerBtn('R').click();
        expect(popover.selectedFinger).toBeNull();
        expect(fingerBtn('R').classList.contains('selected')).toBe(false);

        lhBtn(0).click();
        expect(popover.selectedLh).toBe(0);   // 0 is a value, not "cleared"
        lhBtn(2).click();
        expect(popover.selectedLh).toBe(2);
        lhBtn(2).click();
        expect(popover.selectedLh).toBeNull();
    });

    it('the two hands are independent', () => {
        popover.open(0, 0, {});
        fingerBtn('T').click();
        lhBtn(3).click();
        expect(popover.selectedFinger).toBe('T');
        expect(popover.selectedLh).toBe(3);
        fingerBtn('T').click();
        expect(popover.selectedLh).toBe(3);
    });

    it('hands both marks to onInsert', () => {
        let got = null;
        popover.options.onInsert = (note) => { got = note; };
        popover.open(0, 0, {});
        fingerBtn('P').click();
        lhBtn(4).click();
        popover.element.querySelector('.fret-button[data-fret="5"]').click();
        popover.element.querySelector('.insert-btn').click();
        expect(got).toMatchObject({ fret: 5, finger: 'P', lh: 4 });
    });

    it('pre-selects an existing note’s fingering, and says it is an EDIT', () => {
        popover.open(0, 0, {
            string: 3, fret: 7, tech: 'h', finger: 'M', lh: 1, editing: true,
        });
        expect(popover.element.querySelector('.popover-title').textContent)
            .toBe('Edit Note');
        expect(popover.selectedFret).toBe(7);
        expect(fingerBtn('M').classList.contains('selected')).toBe(true);
        expect(lhBtn(1).classList.contains('selected')).toBe(true);
        expect(popover.element.querySelector('.tech-button[data-tech="h"]')
            .classList.contains('selected')).toBe(true);

        // …and the fingering can be changed without retyping the fret
        fingerBtn('T').click();
        let got = null;
        popover.options.onInsert = (note) => { got = note; };
        popover.element.querySelector('.insert-btn').click();
        expect(got).toMatchObject({ fret: 7, finger: 'T', lh: 1, editing: true });
    });

    it('opens clean for a new note', () => {
        popover.open(0, 0, { string: 3, fret: 0 });
        expect(popover.element.querySelector('.popover-title').textContent)
            .toBe('Enter Note');
        expect(popover.selectedFinger).toBeNull();
        expect(popover.selectedLh).toBeNull();
        expect(popover.editing).toBe(false);
    });
});
