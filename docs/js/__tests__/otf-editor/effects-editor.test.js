// TablEdit's note effects (`fx`) and grace notes, the EDITOR half:
// TablEdit's keys (B brush · C choke · G ghost · R roll · / staccato ·
// Alt+G grace · N clear · F3 repeat), the vim `a` operator, the menus,
// the palettes that reflect the note, the status bar, the popovers.
//
// The format half (vocabulary, refusal, canonical order) is in
// effects-facade.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { KeyboardHandler } from '../../otf-editor/keyboard.js';
import { EditorState, EditorMode } from '../../otf-editor/state.js';
import { EditorCursor } from '../../otf-editor/cursor.js';
import { EditorToolbar, ARTICULATION_BUTTONS, FX_BUTTONS } from '../../otf-editor/toolbar.js';
import {
    NoteEntryPopover, GracePopover, POPOVER_FX, POPOVER_TECHS,
} from '../../otf-editor/popover.js';
import { EditorMenuBar, MENUS } from '../../otf-editor/menu-bar.js';
import { OTFEditor } from '../../otf-editor/editor.js';
import { FX_ORDER } from '../../otf-editor/facade.js';
import {
    ACTIONS, PRESETS, FX_ACTIONS, keyFor, menuKeyFor, lookup, canonicalKeys,
    eventToKeyString, describe as describeBindings, resetPreset, setPreset,
} from '../../otf-editor/bindings.js';

function keyEvent(key, opts = {}) {
    return new KeyboardEvent('keydown', {
        key,
        code: opts.code || (/^[0-9]$/.test(key) ? `Digit${key}` : undefined),
        ctrlKey: !!opts.ctrl,
        altKey: !!opts.alt,
        metaKey: !!opts.meta,
        shiftKey: !!opts.shift,
        bubbles: true,
        cancelable: true,
    });
}

function makeRig(preset, hooks = {}) {
    const state = new EditorState();
    for (let m = 2; m <= 4; m++) state.getOrCreateMeasure(m);
    const cursor = new EditorCursor(state);
    const container = document.createElement('div');
    document.body.appendChild(container);
    cursor.init(container);
    cursor.setLayoutInfo({
        leftMargin: 40, topMargin: 30, stringSpacing: 16, measureWidth: 200,
        measuresPerRow: 2, ticksPerMeasure: 1920, rowHeight: 120,
        noteAreaStart: 10, noteAreaWidth: 180, trackInfoOffset: 0,
    });
    const keyboard = new KeyboardHandler(state, cursor, { preset, ...hooks });
    return {
        state, cursor, keyboard,
        press: (key, opts) => keyboard.handleKeyDown(keyEvent(key, opts)),
        /** Put a note at (m, tick, string) and park the cursor on it. */
        note(fret, { measure = 1, tick = 0, string = 3 } = {}) {
            state.cursor.measure = measure;
            state.cursor.tick = tick;
            state.cursor.string = string;
            state.insertNote(fret);
            state.cursor.measure = measure;
            state.cursor.tick = tick;
            state.cursor.string = string;
            return state.getNoteAtCursor();
        },
        at: (measure, tick, string) => {
            const m = state.getMeasure(measure);
            return m?.events.find(e => e.tick === tick)?.notes.find(n => n.s === string);
        },
        teardown: () => { keyboard.detach(); cursor.destroy(); container.remove(); },
    };
}

/** The action a chord runs in one mode of one preset. */
const bound = (preset, mode, keys) =>
    lookup(preset, mode).exact.get(canonicalKeys(keys))?.action;

// ======================================================================
// The binding table
// ======================================================================

describe('TablEdit’s effect keys are bound', () => {
    beforeEach(() => resetPreset());

    const TABLEDIT_KEYS = {
        b: 'effect.brush',
        g: 'effect.ghost',
        '/': 'effect.staccato',
        r: 'effect.roll',
        c: 'effect.choke',
        m: 'effect.dead',
        n: 'effect.clear',
        F3: 'effect.repeatLast',
    };

    for (const [keys, action] of Object.entries(TABLEDIT_KEYS)) {
        it(`${keys} → ${action} in NORMAL and VISUAL`, () => {
            expect(bound('tabledit', 'normal', keys)).toBe(action);
            if (keys !== 'F3') expect(bound('tabledit', 'visual', keys)).toBe(action);
        });
    }

    it('Alt+G opens the grace note dialog (NORMAL)', () => {
        expect(bound('tabledit', 'normal', 'Alt+g')).toBe('effect.grace');
    });

    it('Shift+R (TablEdit’s anticipated roll) is the same roll, unadvertised', () => {
        expect(bound('tabledit', 'normal', 'R')).toBe('effect.roll');
        const entry = PRESETS.tabledit.bindings.normal.find(e => e.keys === 'R');
        expect(entry.hidden).toBe(true);
    });

    it('repeat-previous-measure moved off `r` to Alt+R, and says why', () => {
        expect(bound('tabledit', 'normal', 'Alt+r')).toBe('measure.repeatPrevious');
        expect(keyFor('measure.repeatPrevious', 'tabledit')).toBe('Alt+r');
        expect(PRESETS.tabledit.exceptions.join(' ')).toMatch(/repeat.*Alt\+R/i);
    });

    it('the exceptions say why m is the dead note, not TablEdit’s muted note', () => {
        expect(PRESETS.tabledit.exceptions.join(' ')).toMatch(/M is .*muted/i);
    });

    it('the bend TARGET (tech b) has no TablEdit key — TablEdit has none', () => {
        expect(keyFor('effect.bend', 'tabledit')).toBeNull();
    });

    it('the help overlay lists the new keys from the table', () => {
        const effects = describeBindings('tabledit').find(g => g.group === 'Effects');
        const keysOf = (action) => effects.items.find(i => i.action === action)?.keys;
        expect(keysOf('effect.brush')).toEqual(['b']);
        expect(keysOf('effect.roll')).toEqual(['r']);
        expect(keysOf('effect.grace')).toEqual(['Alt+g']);
    });
});

describe('vim puts the same effects behind the `a` operator', () => {
    const VIM_KEYS = {
        'a B': 'effect.brush',
        'a R': 'effect.roll',
        'a C': 'effect.choke',
        'a G': 'effect.ghost',
        'a S': 'effect.staccato',
        'a b': 'effect.bend',
        'a n': 'effect.clear',
    };

    for (const [keys, action] of Object.entries(VIM_KEYS)) {
        it(`${keys} → ${action} in NORMAL and VISUAL`, () => {
            expect(bound('vim', 'normal', keys)).toBe(action);
            expect(bound('vim', 'visual', keys)).toBe(action);
        });
    }

    it('a g opens the grace note dialog', () => {
        expect(bound('vim', 'normal', 'a g')).toBe('effect.grace');
    });

    it('keeps the fingering letters it already had', () => {
        expect(bound('vim', 'normal', 'a r')).toBe('finger.ring');
        expect(bound('vim', 'normal', 'a c')).toBe('finger.clear');
    });
});

describe('the rest of the effects are menu-only, as in TablEdit', () => {
    const MENU_ONLY = FX_ORDER.filter(
        fx => !['brush', 'roll', 'choke', 'ghost', 'staccato'].includes(fx));

    it('every fx has an action', () => {
        for (const fx of FX_ORDER) expect(ACTIONS[FX_ACTIONS[fx]], fx).toBeTruthy();
    });

    it('the unkeyed ones are flagged menuOnly and bound in NO preset', () => {
        for (const fx of MENU_ONLY) {
            const id = FX_ACTIONS[fx];
            expect(ACTIONS[id].menuOnly, id).toBe(true);
            for (const preset of Object.keys(PRESETS)) {
                expect(keyFor(id, preset), `${preset} ${id}`).toBeNull();
            }
        }
    });

    it('every menuOnly action is in a menu (or it is reachable nowhere)', () => {
        const inMenus = new Set(MENUS.flatMap(m => m.items).map(i => i.action).filter(Boolean));
        for (const [id, action] of Object.entries(ACTIONS)) {
            if (action.menuOnly) expect(inMenus.has(id), id).toBe(true);
        }
    });
});

describe('Alt+letter is read off the physical key', () => {
    // macOS Option+G types "©" into event.key; the chord is still Alt+G.
    it('Alt+G and Alt+R survive the macOS character', () => {
        expect(eventToKeyString(keyEvent('©', { alt: true, code: 'KeyG' }))).toBe('Alt+g');
        expect(eventToKeyString(keyEvent('®', { alt: true, code: 'KeyR' }))).toBe('Alt+r');
        expect(eventToKeyString(keyEvent('Í', { alt: true, shift: true, code: 'KeyS' })))
            .toBe('Alt+Shift+S');
    });

    it('an unmodified letter still follows the layout, not the key position', () => {
        // AZERTY: the key in QWERTY's Q position types "a"
        expect(eventToKeyString(keyEvent('a', { code: 'KeyQ' }))).toBe('a');
    });
});

// ======================================================================
// The keyboard, end to end
// ======================================================================

describe('TablEdit preset — effect keys on a note', () => {
    let rig;
    beforeEach(() => { resetPreset(); rig = makeRig('tabledit'); });
    afterEach(() => rig.teardown());

    it('b toggles brush on the note at the cursor, and n clears it', () => {
        rig.note(2);
        rig.press('b');
        expect(rig.state.getNoteAtCursor().fx).toEqual(['brush']);
        rig.press('n');
        expect(rig.state.getNoteAtCursor().fx).toBeUndefined();
    });

    it('a second b takes the brush off again', () => {
        rig.note(2);
        rig.press('b');
        rig.press('b');
        expect(rig.state.getNoteAtCursor().fx).toBeUndefined();
    });

    it('g, / and r add ghost, staccato and roll — stored in canonical order', () => {
        rig.note(2);
        rig.press('/');
        rig.press('g');
        rig.press('r');
        expect(rig.state.getNoteAtCursor().fx).toEqual(['roll', 'ghost', 'staccato']);
    });

    it('r no longer repeats the previous measure; Alt+R does', () => {
        rig.note(2);                         // m1 has a note
        rig.state.cursor.measure = 2;
        rig.state.cursor.tick = 0;
        rig.press('r');                      // empty slot: nothing to roll
        expect(rig.state.getMeasure(2).events).toHaveLength(0);
        rig.press('®', { alt: true, code: 'KeyR' });
        expect(rig.at(2, 0, 3)).toMatchObject({ f: 2 });
    });

    it('c is TablEdit’s choke — an fx, not the bend-target tech', () => {
        rig.note(5);
        rig.press('c');
        const n = rig.state.getNoteAtCursor();
        expect(n.fx).toEqual(['choke']);
        expect(n.tech).toBeUndefined();
    });

    it('m is still the dead note (tech x), not fx muted', () => {
        rig.note(0);
        rig.press('m');
        const n = rig.state.getNoteAtCursor();
        expect(n.tech).toBe('x');
        expect(n.fx).toBeUndefined();
    });

    it('n clears tech, tie, fx AND grace in one undo step — but not fingering', () => {
        rig.note(2);
        rig.note(4, { tick: 480 });
        rig.state.setFingering('I');
        rig.press('h');
        rig.state.toggleTieAtCursor();
        rig.press('b');
        rig.state.setGraceAtCursor({ f: 2, kind: 'hp' });
        const before = { ...rig.state.getNoteAtCursor() };
        const depth = rig.state.facade._history.length;

        rig.press('n');
        const n = rig.state.getNoteAtCursor();
        expect(n.tech).toBeUndefined();
        expect(n.tie).toBeUndefined();
        expect(n.fx).toBeUndefined();
        expect(n.grace).toBeUndefined();
        expect(n.finger).toBe('I');
        expect(rig.state.facade._history.length).toBe(depth + 1);

        rig.state.undo();
        expect(rig.state.getNoteAtCursor()).toEqual(before);
    });

    it('n on a note with nothing to clear adds no history', () => {
        rig.note(2);
        const depth = rig.state.facade._history.length;
        rig.press('n');
        expect(rig.state.facade._history.length).toBe(depth);
    });

    it('F3 re-applies the last effect TURNED ON to the next note', () => {
        rig.note(2);
        rig.note(3, { tick: 480 });
        rig.state.cursor.tick = 0;
        rig.press('g');
        rig.state.cursor.tick = 480;
        rig.press('F3');
        expect(rig.state.getNoteAtCursor().fx).toEqual(['ghost']);
        // a re-apply, not a toggle: F3 again leaves it on
        rig.press('F3');
        expect(rig.state.getNoteAtCursor().fx).toEqual(['ghost']);
    });

    it('turning an effect OFF is not what F3 remembers', () => {
        rig.note(2);
        rig.press('h');                      // last applied: hammer
        rig.press('b');
        rig.press('b');                      // brush on, then off
        rig.note(3, { tick: 480 });
        rig.press('F3');
        expect(rig.state.getNoteAtCursor().fx).toEqual(['brush']);
    });

    it('a selection takes the effect as ONE undo step (VISUAL b)', () => {
        rig.note(2, { tick: 0, string: 3 });
        rig.note(0, { tick: 480, string: 2 });
        rig.state.cursor.tick = 0;
        rig.state.cursor.string = 3;
        rig.press('ArrowRight', { shift: true });
        rig.press('ArrowRight', { shift: true });
        rig.press('ArrowUp', { shift: true });
        expect(rig.state.mode).toBe(EditorMode.VISUAL);
        const depth = rig.state.facade._history.length;
        rig.press('b');
        expect(rig.at(1, 0, 3).fx).toEqual(['brush']);
        expect(rig.at(1, 480, 2).fx).toEqual(['brush']);
        expect(rig.state.facade._history.length).toBe(depth + 1);
        // all of them have it → the same key takes it off them all
        rig.press('b');
        expect(rig.at(1, 0, 3).fx).toBeUndefined();
        expect(rig.at(1, 480, 2).fx).toBeUndefined();
    });

    it('VISUAL n clears fx and grace across the selection, in one step', () => {
        rig.note(2, { tick: 0, string: 3 });
        rig.state.setEffect('ghost', true);
        rig.state.setGraceAtCursor({ f: 0 });
        rig.note(0, { tick: 480, string: 3 });
        rig.state.setEffect('slap', true);
        rig.state.cursor.tick = 0;
        rig.press('ArrowRight', { shift: true });
        rig.press('ArrowRight', { shift: true });
        const depth = rig.state.facade._history.length;
        rig.press('n');
        expect(rig.at(1, 0, 3).fx).toBeUndefined();
        expect(rig.at(1, 0, 3).grace).toBeUndefined();
        expect(rig.at(1, 480, 3).fx).toBeUndefined();
        expect(rig.state.facade._history.length).toBe(depth + 1);
        rig.press('n');                      // nothing left: no history
        expect(rig.state.facade._history.length).toBe(depth + 1);
    });

    it('Alt+G asks the host for the grace dialog', () => {
        const onEditGrace = vi.fn();
        rig.teardown();
        rig = makeRig('tabledit', { onEditGrace });
        rig.note(2);
        rig.press('©', { alt: true, code: 'KeyG' });
        expect(onEditGrace).toHaveBeenCalledTimes(1);
    });
});

describe('vim preset — the a operator', () => {
    let rig;
    beforeEach(() => { rig = makeRig('vim'); });
    afterEach(() => rig.teardown());

    it('a B brushes, a C chokes, a b marks the bend target', () => {
        rig.note(2);
        rig.press('a');
        rig.press('B', { shift: true });
        rig.press('a');
        rig.press('C', { shift: true });
        rig.press('a');
        rig.press('b');
        const n = rig.state.getNoteAtCursor();
        expect(n.fx).toEqual(['brush', 'choke']);
        expect(n.tech).toBe('b');
    });

    it('a n clears them', () => {
        rig.note(2);
        rig.press('a');
        rig.press('G', { shift: true });
        rig.press('a');
        rig.press('n');
        expect(rig.state.getNoteAtCursor().fx).toBeUndefined();
    });
});

// ======================================================================
// EditorState wrappers
// ======================================================================

describe('EditorState — effects and grace', () => {
    let state;
    beforeEach(() => {
        state = new EditorState();
        state.cursor.string = 3;
        state.insertNote(2);
        state.cursor.tick = 0;
    });

    it('setEffect defaults to a toggle and reports whether anything changed', () => {
        expect(state.setEffect('tap')).toBe(true);
        expect(state.getNoteAtCursor().fx).toEqual(['tap']);
        expect(state.setEffect('tap', true)).toBe(false);
        expect(state.setEffect('tap')).toBe(true);
        expect(state.getNoteAtCursor().fx).toBeUndefined();
    });

    it('remembers an effect turned on for F3 as fx:<name>', () => {
        state.setEffect('vibrato');
        expect(state.lastTech).toBe('fx:vibrato');
    });

    it('setGraceAtCursor sets, replaces and clears', () => {
        expect(state.setGraceAtCursor({ f: 0, kind: 'hp' })).toBe(true);
        expect(state.getNoteAtCursor().grace).toEqual({ f: 0, kind: 'hp' });
        expect(state.setGraceAtCursor(null)).toBe(true);
        expect(state.getNoteAtCursor().grace).toBeUndefined();
        expect(state.setGraceAtCursor(null)).toBe(false);
    });

    it('vim’s `.` repeat (repeatLastAction) re-applies an fx too', () => {
        state.setEffect('harmonic');
        state.cursor.tick = 480;
        state.insertNote(4);
        state.cursor.tick = 480;
        state.lastAction = { type: 'addArticulation', tech: state.lastTech };
        expect(state.repeatLastAction()).toBe(true);
        expect(state.getNoteAtCursor().fx).toEqual(['harmonic']);
    });
});

// ======================================================================
// Palettes, popovers, menus, status bar
// ======================================================================

function doc(note = null) {
    return {
        otf_version: '1.0',
        metadata: { title: 'T', time_signature: '4/4', tempo: 120 },
        timing: { ticks_per_beat: 480 },
        tracks: [{
            id: 'banjo', instrument: '5-string-banjo',
            tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead',
        }],
        notation: {
            banjo: [{ measure: 1, events: note ? [{ tick: 0, notes: [note] }] : [] }],
        },
    };
}

describe('toolbar — the keyed effects reflect the note', () => {
    let toolbar;
    let state;
    let actions;

    function mount(note) {
        state = new EditorState({ otf: doc(note), trackId: 'banjo' });
        state.cursor.measure = 1;
        state.cursor.tick = 0;
        state.cursor.string = note ? note.s : 1;
        actions = [];
        toolbar = new EditorToolbar(state, { onAction: (id) => actions.push(id) });
        const container = document.createElement('div');
        document.body.appendChild(container);
        toolbar.render(container);
    }

    beforeEach(() => { document.body.innerHTML = ''; resetPreset(); });
    afterEach(() => toolbar?.destroy());

    it('has a button for each keyed effect, in the shared articulation config', () => {
        const fx = ARTICULATION_BUTTONS.filter(c => c.fx).map(c => c.fx);
        expect(fx).toEqual(['brush', 'roll', 'choke', 'ghost', 'staccato']);
        mount(null);
        for (const f of fx) {
            expect(toolbar.articulationButtons.get(FX_ACTIONS[f]), f).toBeTruthy();
        }
    });

    it('outlines brush and ghost on a note that carries them', () => {
        mount({ s: 2, f: 0, dur: 480, fx: ['brush', 'ghost'] });
        const lit = (id) => toolbar.articulationButtons.get(id).classList.contains('reflects-note');
        expect(lit('effect.brush')).toBe(true);
        expect(lit('effect.ghost')).toBe(true);
        expect(lit('effect.roll')).toBe(false);
        expect(lit('effect.clear')).toBe(false);
    });

    it('Clear only reads "nothing set" when there is no fx and no grace either', () => {
        mount({ s: 2, f: 0, dur: 480, grace: { f: 0 } });
        expect(toolbar.articulationButtons.get('effect.clear')
            .classList.contains('reflects-note')).toBe(false);
    });

    it('an effect button runs its binding action, even on an empty slot', () => {
        mount(null);
        toolbar.articulationButtons.get('effect.roll').click();
        expect(actions).toEqual(['effect.roll']);
        expect(state.pendingArticulation).toBe(null);
    });

    it('its tooltip prints the preset’s key', () => {
        mount(null);
        expect(toolbar.articulationButtons.get('effect.brush').title).toMatch(/\(b\)/);
        setPreset('vim');
        expect(toolbar.articulationButtons.get('effect.brush').title).toMatch(/aB/);
    });
});

describe('note popover — the effects row', () => {
    let popover;
    let inserted;

    function open(defaults = {}) {
        const state = new EditorState();
        inserted = [];
        popover = new NoteEntryPopover(state, { onInsert: (n) => inserted.push(n) });
        popover.init(document.body);
        popover.open(0, 0, defaults);
    }

    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => popover?.destroy());

    it('offers a toggle for every fx, in canonical order', () => {
        expect(POPOVER_FX.map(c => c.fx)).toEqual(FX_ORDER);
        open();
        const row = [...popover.element.querySelectorAll('.fx-button')].map(b => b.dataset.fx);
        expect(row).toEqual(FX_ORDER);
    });

    it('the technique row is unchanged — fx are not single-choice techs', () => {
        expect(POPOVER_TECHS.map(c => c.tech)).toEqual(['h', 'p', '/', 'x', 'b', '~']);
    });

    it('pre-selects what the note carries and hands back the set, canonical', () => {
        open({ string: 3, fret: 2, fx: ['let-ring'], editing: true, grace: { f: 0 } });
        const btn = (fx) => popover.element.querySelector(`.fx-button[data-fx="${fx}"]`);
        expect(btn('let-ring').classList.contains('selected')).toBe(true);
        btn('slap').click();
        btn('brush').click();
        btn('let-ring').click();             // toggled off
        popover.element.querySelector('.insert-btn').click();
        expect(inserted[0].fx).toEqual(['brush', 'slap']);
        expect(inserted[0].grace).toEqual({ f: 0 });   // carried, not dropped
    });
});

describe('GracePopover', () => {
    let popover;
    let committed;

    function open(context = {}) {
        committed = [];
        popover = new GracePopover({ onCommit: (g) => committed.push(g) });
        popover.init(document.body);
        popover.open(context);
    }
    const key = (k) => popover.element.dispatchEvent(keyEvent(k));

    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => popover?.destroy());

    it('types the fret with the shared FretEntry rule (1 then 2 is 12)', () => {
        open();
        key('1');
        key('2');
        expect(popover.element.querySelector('.grace-fret-value').textContent).toBe('12');
        key('Enter');
        expect(committed).toEqual([{ f: 12 }]);
    });

    it('a kind button sets how it connects; "plain" means no kind', () => {
        open();
        key('2');
        popover.element.querySelector('.grace-kind[data-kind="hp"]').click();
        popover.element.querySelector('.save-btn').click();
        expect(committed).toEqual([{ f: 2, kind: 'hp' }]);
    });

    it('opens on the existing grace and can remove it', () => {
        open({ existing: { f: 3, kind: 'slide' } });
        expect(popover.element.querySelector('.grace-fret-value').textContent).toBe('3');
        expect(popover.element.querySelector('.grace-kind[data-kind="slide"]')
            .classList.contains('selected')).toBe(true);
        popover.element.querySelector('.grace-remove').click();
        expect(committed).toEqual([null]);
    });

    it('offers every TablEdit grace kind plus plain', () => {
        open();
        const kinds = [...popover.element.querySelectorAll('.grace-kind')]
            .map(b => b.dataset.kind);
        expect(kinds).toEqual(['', 'hp', 'slide', 'bend', 'mordent', 'double', 'gruppetto', 'trill']);
    });

    it('swallows keys so the editor never sees them, and Escape cancels', () => {
        const onCancel = vi.fn();
        committed = [];
        popover = new GracePopover({ onCommit: (g) => committed.push(g), onCancel });
        popover.init(document.body);
        popover.open({});
        const spy = vi.fn();
        document.body.addEventListener('keydown', spy);
        key('b');
        expect(spy).not.toHaveBeenCalled();
        key('Escape');
        expect(onCancel).toHaveBeenCalled();
        expect(committed).toEqual([]);
        document.body.removeEventListener('keydown', spy);
    });
});

describe('OTFEditor — effects end to end', () => {
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

    const status = () => editor.statusBar.querySelector('[data-field="effects"]').textContent;

    it('the status bar shows the note’s fx and grace', () => {
        expect(status()).toBe('—');
        editor.state.setEffect('brush');
        editor.state.setEffect('let-ring');
        expect(status()).toBe('brush · let-ring');
        editor.state.setGraceAtCursor({ f: 3, kind: 'hp' });
        expect(status()).toBe('brush · let-ring · grace 3 hp');
    });

    it('Alt+G opens the grace dialog over the note, and Save writes it', () => {
        editor.keyboard.handleKeyDown(keyEvent('©', { alt: true, code: 'KeyG' }));
        expect(editor.gracePopover.opened).toBe(true);
        const el = editor.gracePopover.element;
        el.dispatchEvent(keyEvent('2'));
        el.querySelector('.grace-kind[data-kind="slide"]').click();
        el.querySelector('.save-btn').click();
        expect(editor.state.getNoteAtCursor().grace).toEqual({ f: 2, kind: 'slide' });
    });

    it('Alt+G on an empty slot says so instead of opening', () => {
        editor.state.cursor.tick = 960;
        editor.keyboard.dispatchAction('effect.grace');
        expect(editor.gracePopover.opened).toBe(false);
        expect(editor.statusBar.querySelector('[data-field="flash"]').textContent)
            .toMatch(/grace/i);
    });

    it('Note ▸ Effects lists every fx with its key and a check for what is set', () => {
        editor.state.setEffect('harmonic');
        editor.menuBar.open('note');
        const item = (id) => editor.menuBar.popup.querySelector(`.menu-item[data-action="${id}"]`);
        for (const fx of FX_ORDER) expect(item(FX_ACTIONS[fx]), fx).toBeTruthy();
        expect(item('effect.brush').querySelector('.menu-item-key').textContent).toBe('b');
        expect(item('effect.harmonic').querySelector('.menu-item-key').textContent).toBe('');
        expect(item('effect.harmonic').getAttribute('aria-checked')).toBe('true');
        expect(item('effect.brush').getAttribute('aria-checked')).toBe('false');
        expect(item('effect.bend')).toBeTruthy();
        expect(item('effect.grace')).toBeTruthy();
    });

    it('a menu-only effect really toggles from the menu', () => {
        editor.menuBar.open('note');
        editor.menuBar.popup.querySelector('.menu-item[data-action="effect.tremolo"]').click();
        expect(editor.state.getNoteAtCursor().fx).toEqual(['tremolo']);
    });

    it('editing a note in the popover keeps its grace and rewrites its fx, one undo', () => {
        editor.state.setEffect('roll');
        editor.state.setGraceAtCursor({ f: 0, kind: 'hp' });
        const depth = editor.state.facade._history.length;
        editor._handlePopoverInsert({
            string: 3, fret: 7, tech: null, finger: null, lh: null,
            fx: ['ghost'], grace: { f: 0, kind: 'hp' }, editing: true,
        });
        editor.state.cursor.tick = 0;
        expect(editor.state.getNoteAtCursor()).toMatchObject({
            f: 7, fx: ['ghost'], grace: { f: 0, kind: 'hp' },
        });
        expect(editor.state.facade._history.length).toBe(depth + 1);
    });

    it('a double-click hands the popover the note’s fx and grace', () => {
        editor.state.setEffect('choke');
        editor.state.setGraceAtCursor({ f: 4 });
        const opened = [];
        editor.popover.open = (x, y, defaults) => opened.push(defaults);
        editor._handleCanvasDblClick({ target: editor.canvasContainer, clientX: 0, clientY: 0 });
        expect(opened[0]).toMatchObject({ fx: ['choke'], grace: { f: 4 } });
    });
});

describe('the menu bar stub path', () => {
    it('renders the Effects items without an editor (state stub)', () => {
        document.body.innerHTML = '';
        resetPreset();
        const bar = new EditorMenuBar({
            state: { getNoteAtCursor: () => ({ s: 1, f: 0, fx: ['slap'] }), selection: null },
        });
        bar.render(document.body);
        bar.open('note');
        const slap = bar.popup.querySelector('.menu-item[data-action="effect.slap"]');
        expect(slap.getAttribute('aria-checked')).toBe('true');
        expect(menuKeyFor('effect.slap', 'tabledit', 'normal')).toBeNull();
        bar.destroy();
    });
});
