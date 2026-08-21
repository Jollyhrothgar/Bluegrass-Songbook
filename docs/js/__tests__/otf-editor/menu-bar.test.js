// The menu bar and the state-reflecting palettes (plan §8.3).
//
// The property under test everywhere in this file is the same one:
// **nothing here writes a key down**. Menus, tooltips and the `?` overlay
// all render from `bindings.js`, so an advertised shortcut is a bound
// shortcut by construction and switching preset relabels the whole
// surface at once. Before this, the toolbar claimed `Ctrl+T`, `Shift+Q`,
// `G` and `3` — none of them bound to anything.
//
// The second property is TablEdit's purple border: the palettes outline
// what the note UNDER THE CURSOR is (`.reflects-note`), while `.active`
// stays what the NEXT note will be.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EditorMenuBar, MENUS } from '../../otf-editor/menu-bar.js';
import { EditorToolbar, durationReflects } from '../../otf-editor/toolbar.js';
import { EditorState, DURATIONS } from '../../otf-editor/state.js';
import { OTFEditor } from '../../otf-editor/editor.js';
import {
    ACTIONS, PRESETS, keyFor, menuKeyFor, prettyKeys,
    describe as describeBindings, getPreset, setPreset, resetPreset,
} from '../../otf-editor/bindings.js';

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/** Every key string a preset binds, hidden aliases included. */
function boundKeys(presetId) {
    const out = new Set();
    for (const list of Object.values(PRESETS[presetId].bindings)) {
        for (const entry of list) out.add(prettyKeys(entry.keys));
    }
    return out;
}

/** Every key the preset ADVERTISES (what the help overlay prints). */
function advertisedKeys(presetId) {
    const out = new Set();
    for (const group of describeBindings(presetId)) {
        for (const item of group.items) for (const k of item.keys) out.add(k);
    }
    return out;
}

/** A state stub with the small surface the menus' `when` predicates read. */
function stubState(over = {}) {
    return {
        selection: null,
        clipboard: null,
        trackId: 'banjo',
        history: { canUndo: () => true, canRedo: () => true },
        getNoteAtCursor: () => null,
        getAnnotationAtCursor: () => null,
        getMeasureCount: () => 4,
        getTracks: () => [{ id: 'banjo' }, { id: 'guitar' }],
        setTrack: () => {},
        ...over,
    };
}

function mountMenu(options = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bar = new EditorMenuBar({ state: stubState(), ...options });
    bar.render(container);
    return bar;
}

const itemsOf = (bar) => [...bar.popup.querySelectorAll('.menu-item')];
const labelOf = (el) => el.querySelector('.menu-item-label').textContent;
const keyOf = (el) => el.querySelector('.menu-item-key').textContent;
/** Match a menu item by label, with or without its ✓ check mark. */
const findItem = (bar, text) => itemsOf(bar)
    .find(el => labelOf(el) === text || labelOf(el) === `✓ ${text}`);

/** A one-measure banjo document with one note at the cursor slot. */
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
            banjo: [{
                measure: 1,
                events: note ? [{ tick: 0, notes: [note] }] : [],
            }],
        },
    };
}

// ======================================================================
// The menu bar
// ======================================================================

describe('EditorMenuBar — the tree', () => {
    let bar;

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
    });

    afterEach(() => bar?.destroy());

    it('renders one trigger per menu, in the plan\'s order', () => {
        bar = mountMenu();
        const labels = [...bar.element.querySelectorAll('.menu-trigger')]
            .map(b => b.textContent);
        expect(labels).toEqual(['File', 'Edit', 'Note', 'Play', 'Score', 'View', 'Help']);
    });

    it('every action it names is a real action in the table', () => {
        for (const menu of MENUS) {
            for (const item of menu.items) {
                if (!item.action) continue;
                expect(ACTIONS[item.action], `${menu.id} → ${item.action}`).toBeTruthy();
            }
        }
    });

    it('prints each item\'s key from the ACTIVE preset, and only that', () => {
        bar = mountMenu();
        const bound = boundKeys('tabledit');
        for (const menu of MENUS) {
            bar.open(menu.id);
            for (const el of itemsOf(bar)) {
                const action = el.dataset.action;
                if (!action) continue;
                const expected = menuKeyFor(action, 'tabledit', 'normal');
                expect(keyOf(el)).toBe(expected ? prettyKeys(expected) : '');
                // Every CHORD printed is a bound chord — a qualified key
                // (`A, t`) is two of them, the way in and the key itself.
                for (const chord of keyOf(el).split(', ').filter(Boolean)) {
                    expect(bound.has(chord), `${action} → ${chord}`).toBe(true);
                }
            }
        }
    });

    // D3: the Note ▸ Fingering items printed a bare `t` / `i` / `m`,
    // which are ANNOTATION-mode keys. Read from NORMAL — where the user
    // is standing — `t` opens the placed-text popover and `m` writes a
    // dead note, so a bare letter there is an instruction to do the
    // wrong thing.
    describe('a key that belongs to another mode', () => {
        it('is qualified with the way into that mode, never printed bare', () => {
            bar = mountMenu();
            bar.open('note');
            for (const label of ['Thumb', 'Index', 'Middle']) {
                const printed = keyOf(findItem(bar, label));
                expect(printed, label).not.toBe('t');
                expect(printed, label).not.toBe('i');
                expect(printed, label).not.toBe('m');
            }
            expect(keyOf(findItem(bar, 'Thumb'))).toBe('A, t');
            expect(keyOf(findItem(bar, 'Middle'))).toBe('A, m');
        });

        it('prints bare once the menu IS read in that mode', () => {
            bar = mountMenu({ state: stubState({ mode: 'annotation' }) });
            bar.open('note');
            expect(keyOf(findItem(bar, 'Thumb'))).toBe('t');
        });

        it('leaves same-mode keys alone (`n` still clears the effect)', () => {
            bar = mountMenu();
            bar.open('note');
            expect(keyOf(findItem(bar, 'Clear'))).toBe('n');
            expect(keyOf(findItem(bar, 'Hammer-on'))).toBe('h');
        });

        it('vim binds fingering in NORMAL, so it needs no qualifier', () => {
            setPreset('vim');
            bar = mountMenu();
            bar.open('note');
            expect(keyOf(findItem(bar, 'Thumb'))).toBe(prettyKeys('a t'));
            setPreset('tabledit');
        });
    });

    it('shows the keys the §8.3 table calls out', () => {
        bar = mountMenu();
        bar.open('note');
        expect(keyOf(findItem(bar, 'Automatic duration'))).toBe('=');
        expect(keyOf(findItem(bar, 'Whole'))).toBe('F4');
        expect(keyOf(findItem(bar, 'Dotted'))).toBe('Ctrl+.');
        expect(keyOf(findItem(bar, 'Triplet'))).toBe('Ctrl+3');
        expect(keyOf(findItem(bar, 'Apply duration to selection'))).toBe('*');
        bar.open('edit');
        expect(keyOf(findItem(bar, 'Undo'))).toBe('Ctrl+z');
        expect(keyOf(findItem(bar, 'Select all'))).toBe('Ctrl+a');
        expect(keyOf(findItem(bar, 'Insert measure before'))).toBe('Ins');
        expect(keyOf(findItem(bar, 'Shift right'))).toBe('Alt+Ins');
        bar.open('play');
        expect(keyOf(findItem(bar, 'Play / stop'))).toBe('Space');
        expect(keyOf(findItem(bar, 'Play from the cursor'))).toBe('Shift+Space');
    });

    it('relabels every item when the preset changes', () => {
        bar = mountMenu();
        bar.open('note');
        expect(keyOf(findItem(bar, 'Whole'))).toBe('F4');
        setPreset('vim');
        expect(keyOf(findItem(bar, 'Whole'))).toBe('W');
        bar.open('edit');
        expect(keyOf(findItem(bar, 'Undo'))).toBe('u');
        setPreset('tabledit');
        expect(keyOf(findItem(bar, 'Undo'))).toBe('Ctrl+z');
    });

    it('dispatches through the keyboard layer, then hands focus back', () => {
        const dispatch = vi.fn();
        const onClose = vi.fn();
        bar = mountMenu({ dispatch, onClose });
        bar.open('edit');
        findItem(bar, 'Undo').click();
        expect(dispatch).toHaveBeenCalledWith('edit.undo');
        expect(onClose).toHaveBeenCalled();
        expect(bar.popup.hidden).toBe(true);
    });

    it('File offers Download OTF with Ctrl+S by default', () => {
        const run = vi.fn();
        bar = mountMenu({
            fileActions: [{ label: '⬇ Download OTF', action: 'edit.save', run }],
        });
        bar.open('file');
        const item = findItem(bar, '⬇ Download OTF');
        expect(keyOf(item)).toBe('Ctrl+s');
        item.click();
        expect(run).toHaveBeenCalled();
    });

    it('File carries whatever the session gave it (Submit / Cancel / Done)', () => {
        bar = mountMenu({
            fileActions: [
                { label: '🚀 Submit correction', run: () => {} },
                { label: '⬇ Download OTF', action: 'edit.save', run: () => {} },
                { label: 'Cancel', run: () => {} },
                { label: '✓ Done', run: () => {}, disabled: true },
            ],
        });
        bar.open('file');
        expect(itemsOf(bar).map(labelOf)).toEqual(
            ['🚀 Submit correction', '⬇ Download OTF', 'Cancel', '✓ Done']);
        expect(findItem(bar, '✓ Done').disabled).toBe(true);
    });

    it('disables what cannot happen right now', () => {
        bar = mountMenu({ state: stubState({ getMeasureCount: () => 1 }) });
        bar.open('edit');
        expect(findItem(bar, 'Delete measure').disabled).toBe(true);
        expect(findItem(bar, 'Paste').disabled).toBe(true);     // empty clipboard
        expect(findItem(bar, 'Undo').disabled).toBe(false);
        bar.open('note');
        expect(findItem(bar, 'Apply duration to selection').disabled).toBe(true);
        expect(findItem(bar, 'Tie').disabled).toBe(true);       // no note at cursor
    });

    it('enables the selection-only and note-only items when they apply', () => {
        bar = mountMenu({
            state: stubState({
                selection: {},
                clipboard: [{}],
                getNoteAtCursor: () => ({ s: 1, f: 5, dur: 240 }),
            }),
            hooks: { repeatSpan: () => {}, removeRepeat: () => {} },
        });
        bar.open('note');
        expect(findItem(bar, 'Apply duration to selection').disabled).toBe(false);
        expect(findItem(bar, 'Tie').disabled).toBe(false);
        expect(findItem(bar, 'Fret +1').disabled).toBe(false);
        bar.open('edit');
        expect(findItem(bar, 'Paste').disabled).toBe(false);
        expect(findItem(bar, 'Repeat measures ×2').disabled).toBe(false);
    });

    it('omits items whose hook the wrapper never supplied', () => {
        bar = mountMenu();       // no hooks at all
        bar.open('play');
        expect(findItem(bar, 'Tempo…')).toBeUndefined();
        expect(findItem(bar, 'Metronome')).toBeUndefined();
        expect(findItem(bar, 'Play / stop')).toBeTruthy();
    });

    it('draws hook items, latches and dynamic lists when they exist', () => {
        const setTrack = vi.fn();
        bar = mountMenu({
            state: stubState({ setTrack }),
            hooks: {
                metronome: () => {},
                metronomeOn: () => true,
                tracks: () => [
                    { label: 'banjo', checked: true, run: () => setTrack('banjo') },
                    { label: 'guitar', checked: false, run: () => setTrack('guitar') },
                ],
            },
        });
        bar.open('play');
        const metro = findItem(bar, 'Metronome');
        expect(metro.getAttribute('aria-checked')).toBe('true');
        bar.open('score');
        expect(itemsOf(bar).map(labelOf)).toContain('✓ banjo');
        findItem(bar, 'guitar').click();
        expect(setTrack).toHaveBeenCalledWith('guitar');
    });

    it('Help switches preset from radio items and keeps the menu open', () => {
        bar = mountMenu();
        bar.open('help');
        expect(keyOf(findItem(bar, 'Keyboard shortcuts'))).toBe('?');
        const vim = findItem(bar, 'vim');
        expect(vim.getAttribute('role')).toBe('menuitemradio');
        vim.click();
        expect(getPreset()).toBe('vim');
        expect(bar.popup.hidden).toBe(false);
        expect(findItem(bar, 'vim').getAttribute('aria-checked')).toBe('true');
        findItem(bar, 'TablEdit').click();
        expect(getPreset()).toBe('tabledit');
    });

    it('About OTF opens the design doc in a new tab', () => {
        const open = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
        bar = mountMenu();
        bar.open('help');
        findItem(bar, 'About OTF').click();
        expect(open).toHaveBeenCalledWith(
            'js/otf-editor/DESIGN.md', '_blank', 'noopener');
        open.mockRestore();
    });

    it('is a menu to a screen reader: role=menu, role=menuitem, aria-expanded', () => {
        bar = mountMenu();
        expect(bar.element.getAttribute('role')).toBe('menubar');
        expect(bar.popup.getAttribute('role')).toBe('menu');
        const trigger = bar.element.querySelector('.menu-trigger[data-menu="edit"]');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        bar.open('edit');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(itemsOf(bar)[0].getAttribute('role')).toBe('menuitem');
    });

    it('arrow keys walk the items and Escape closes back to the canvas', () => {
        const onClose = vi.fn();
        bar = mountMenu({ onClose });
        bar.open('edit');
        const items = itemsOf(bar).filter(b => !b.disabled);
        expect(document.activeElement).toBe(items[0]);
        items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(items[1]);
        items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(bar.popup.hidden).toBe(true);
        expect(onClose).toHaveBeenCalled();
    });

    it('a click outside closes the open menu', () => {
        bar = mountMenu();
        bar.open('note');
        document.body.click();
        expect(bar.popup.hidden).toBe(true);
    });
});

describe('EditorMenuBar — narrow screens', () => {
    let bar;
    const setWidth = (w) => Object.defineProperty(globalThis, 'innerWidth',
        { value: w, configurable: true, writable: true });

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
    });

    afterEach(() => {
        bar?.destroy();
        setWidth(1024);
    });

    it('collapses to one ☰ below 720px', () => {
        setWidth(500);
        bar = mountMenu();
        expect(bar.element.querySelector('.menu-hamburger')?.textContent).toBe('☰');
        expect(bar.element.classList.contains('is-narrow')).toBe(true);
    });

    it('the ☰ opens the SAME menus as a sheet — touch reaches every command', () => {
        setWidth(500);
        bar = mountMenu();
        bar.element.querySelector('.menu-hamburger').click();
        const labels = itemsOf(bar).map(labelOf);
        expect(labels).toContain('Insert measure before');
        expect(labels).toContain('Repeat the previous measure');
        expect(labels).toContain('Keyboard shortcuts');
        const heads = [...bar.popup.querySelectorAll('.menu-sheet-head')]
            .map(h => h.textContent);
        expect(heads).toEqual(MENUS.map(m => m.label));
    });

    it('grows back into a bar when the window widens', () => {
        setWidth(500);
        bar = mountMenu();
        setWidth(1200);
        bar.updateLayout();
        expect(bar.element.querySelector('.menu-hamburger')).toBeNull();
        expect(bar.element.classList.contains('is-narrow')).toBe(false);
    });

    // D2: `updateLayout` used to open with `if (narrow === this._narrow)
    // return`, so one missed transition left a ☰ sitting beside the full
    // trigger row until something else re-rendered the bar. It now
    // RECONCILES: it asks what this width should look like and makes it
    // so, however many times it is called.
    it('survives a round trip: wide → narrow → wide leaves one surface', () => {
        setWidth(1200);
        bar = mountMenu();
        expect(bar.element.querySelector('.menu-hamburger')).toBeNull();

        setWidth(500);
        bar.updateLayout();
        expect(bar.element.querySelector('.menu-hamburger')).not.toBeNull();
        expect(bar.element.classList.contains('is-narrow')).toBe(true);

        setWidth(1200);
        bar.updateLayout();
        expect(bar.element.querySelector('.menu-hamburger')).toBeNull();
        expect(bar.element.classList.contains('is-narrow')).toBe(false);
        expect(bar.hamburger).toBeNull();
        // …and the triggers are back, all seven of them
        expect([...bar.element.querySelectorAll('.menu-trigger')].map(b => b.textContent))
            .toEqual(MENUS.map(m => m.label));
    });

    it('is idempotent — repeat calls at one width change nothing', () => {
        setWidth(500);
        bar = mountMenu();
        bar.updateLayout();
        bar.updateLayout();
        expect(bar.element.querySelectorAll('.menu-hamburger')).toHaveLength(1);

        setWidth(1200);
        bar.updateLayout();
        bar.updateLayout();
        expect(bar.element.querySelectorAll('.menu-hamburger')).toHaveLength(0);
    });

    it('a stale hamburger from a missed transition is swept up', () => {
        setWidth(1200);
        bar = mountMenu();
        // Exactly the state QA found: `is-narrow` off, ☰ still in the DOM
        bar._narrow = false;
        bar.hamburger = bar._makeHamburger();
        bar.element.insertBefore(bar.hamburger, bar.triggerRow);

        bar.updateLayout();
        expect(bar.element.querySelector('.menu-hamburger')).toBeNull();
    });
});

// ======================================================================
// The toolbar: tooltips from the table, palettes that reflect the note
// ======================================================================

describe('EditorToolbar — tooltips come from the binding table', () => {
    let state;
    let toolbar;
    let container;

    function mount(document_ = doc()) {
        state = new EditorState({ otf: document_, trackId: 'banjo' });
        toolbar = new EditorToolbar(state, {});
        container = document.createElement('div');
        document.body.appendChild(container);
        toolbar.render(container);
        return toolbar;
    }

    /** Every `(key)` a toolbar tooltip claims. */
    function claimedKeys() {
        return [...toolbar.element.querySelectorAll('.toolbar-button')]
            .map(b => /\(([^)]*)\)\s*$/.exec(b.title || '')?.[1])
            .filter(Boolean);
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
    });

    afterEach(() => toolbar?.destroy());

    it('claims no key the preset does not bind', () => {
        mount();
        const bound = boundKeys('tabledit');
        for (const key of claimedKeys()) expect(bound.has(key)).toBe(true);
    });

    it('claims no key the help overlay does not advertise', () => {
        mount();
        const advertised = advertisedKeys('tabledit');
        for (const key of claimedKeys()) expect(advertised.has(key)).toBe(true);
    });

    it('the four lies are gone (Ctrl+T, Shift+Q, G, 3)', () => {
        mount();
        const titles = [...toolbar.element.querySelectorAll('.toolbar-button')]
            .map(b => b.title).join(' | ');
        expect(titles).not.toContain('Ctrl+T');
        expect(titles).not.toContain('Shift+Q');
        expect(titles).not.toContain('(G)');
        expect(titles).not.toContain('(3)');
        // …and the grid buttons say what IS bound, or nothing at all
        const gridQuarter = toolbar.element
            .querySelector(`.grid-btn[data-subdivision="${DURATIONS.quarter}"]`);
        expect(gridQuarter.title).toBe('Grid: 1/4');
    });

    it('names each button from the table, keys included', () => {
        mount();
        const byDur = (d) => toolbar.durationButtons.get(d).title;
        expect(byDur(DURATIONS.whole)).toBe('Whole (F4)');
        expect(byDur(DURATIONS.quarter)).toBe('Quarter (q)');
        expect(toolbar.autoDurationButton.title)
            .toBe('Automatic duration — the gap decides (=)');
        expect(toolbar.dottedButton.title).toBe('Dotted (Ctrl+.)');
        expect(toolbar.tripletButton.title).toBe('Triplet (Ctrl+3)');
        expect(toolbar.autoAdvanceButton.title)
            .toBe('Auto-advance after entry (Ctrl+Space)');
        expect(toolbar.restButton.title)
            .toBe('Rest — advance one duration without a note (Tab)');
    });

    it('relabels every tooltip when the preset changes', () => {
        mount();
        expect(toolbar.durationButtons.get(DURATIONS.whole).title).toBe('Whole (F4)');
        setPreset('vim');
        expect(toolbar.durationButtons.get(DURATIONS.whole).title).toBe('Whole (W)');
        expect(toolbar.undoButton.title).toBe('Undo (u)');
        const bound = boundKeys('vim');
        for (const key of claimedKeys()) expect(bound.has(key)).toBe(true);
        setPreset('tabledit');
        expect(toolbar.undoButton.title).toBe('Undo (Ctrl+z)');
    });

    it('the duration buttons print their key inline too', () => {
        mount();
        const keyText = (d) => toolbar.durationButtons.get(d)
            .querySelector('.button-key').textContent;
        expect(keyText(DURATIONS.eighth)).toBe('F7');
        setPreset('vim');
        expect(keyText(DURATIONS.eighth)).toBe('e');
    });
});

describe('EditorToolbar — entry latches', () => {
    let state;
    let toolbar;

    function mount() {
        state = new EditorState({ otf: doc(), trackId: 'banjo' });
        toolbar = new EditorToolbar(state, {});
        const container = document.createElement('div');
        document.body.appendChild(container);
        toolbar.render(container);
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
        mount();
    });

    afterEach(() => toolbar.destroy());

    it('Auto latches with state.isAutoDuration', () => {
        expect(toolbar.autoDurationButton.classList.contains('active')).toBe(false);
        toolbar.autoDurationButton.click();
        expect(state.isAutoDuration).toBe(true);
        expect(toolbar.autoDurationButton.classList.contains('active')).toBe(true);
        toolbar.autoDurationButton.click();
        expect(state.isAutoDuration).toBe(false);
        expect(toolbar.autoDurationButton.classList.contains('active')).toBe(false);
    });

    it('Dot toggles the dotted value and latches', () => {
        state.setDuration(DURATIONS.eighth);
        toolbar.dottedButton.click();
        expect(state.currentDuration).toBe(360);
        expect(toolbar.dottedButton.classList.contains('active')).toBe(true);
        toolbar.dottedButton.click();
        expect(state.currentDuration).toBe(DURATIONS.eighth);
        expect(toolbar.dottedButton.classList.contains('active')).toBe(false);
    });

    it('the triplet button calls toggleTripletMode', () => {
        toolbar.tripletButton.click();
        expect(state.tripletMode).toBe(true);
        expect(toolbar.tripletButton.classList.contains('active')).toBe(true);
    });

    it('auto-advance is a latch, on by default', () => {
        expect(toolbar.autoAdvanceButton.classList.contains('active')).toBe(true);
        toolbar.autoAdvanceButton.click();
        expect(state.autoAdvance).toBe(false);
        expect(toolbar.autoAdvanceButton.classList.contains('active')).toBe(false);
    });

    it('the track group comes LAST — once-per-document edits do not lead', () => {
        const sections = [...toolbar.element.querySelectorAll('.toolbar-section')]
            .map(s => s.className.replace('toolbar-section ', ''));
        expect(sections[0]).toBe('mode-section');
        expect(sections[1]).toBe('duration-section');
        expect(sections[sections.length - 1]).toBe('track-section');
    });
});

describe('EditorToolbar — the palettes reflect the note under the cursor', () => {
    let state;
    let toolbar;
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

    const reflected = () => [...toolbar.element.querySelectorAll('.reflects-note')];

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
    });

    afterEach(() => toolbar?.destroy());

    it('durationReflects maps dotted values onto their base button', () => {
        expect(durationReflects(360, DURATIONS.eighth)).toBe(true);
        expect(durationReflects(720, DURATIONS.quarter)).toBe(true);
        expect(durationReflects(240, DURATIONS.eighth)).toBe(true);
        expect(durationReflects(240, DURATIONS.quarter)).toBe(false);
        expect(durationReflects(null, DURATIONS.eighth)).toBe(false);
    });

    it('a dotted eighth (dur 360) outlines 1/8 AND Dot', () => {
        mount({ s: 1, f: 5, dur: 360 });
        expect(toolbar.durationButtons.get(DURATIONS.eighth)
            .classList.contains('reflects-note')).toBe(true);
        expect(toolbar.dottedButton.classList.contains('reflects-note')).toBe(true);
        expect(toolbar.durationButtons.get(DURATIONS.quarter)
            .classList.contains('reflects-note')).toBe(false);
    });

    it('a triplet eighth outlines the triplet button', () => {
        mount({ s: 1, f: 5, dur: DURATIONS.tripletEighth });
        expect(toolbar.tripletButton.classList.contains('reflects-note')).toBe(true);
    });

    it('a tie outlines the tie button', () => {
        mount({ s: 1, f: 5, dur: 240, tie: true });
        const tie = toolbar.articulationButtons.get('effect.tie');
        expect(tie.classList.contains('reflects-note')).toBe(true);
        expect(toolbar.articulationButtons.get('h')
            .classList.contains('reflects-note')).toBe(false);
    });

    it('tech "x" outlines the dead button', () => {
        mount({ s: 1, f: 5, dur: 240, tech: 'x' });
        expect(toolbar.articulationButtons.get('x')
            .classList.contains('reflects-note')).toBe(true);
        expect(toolbar.articulationButtons.get('effect.clear')
            .classList.contains('reflects-note')).toBe(false);
    });

    it('an empty slot reflects nothing at all', () => {
        mount(null);
        expect(reflected()).toHaveLength(0);
    });

    it('follows the cursor off the note and back', () => {
        mount({ s: 1, f: 5, dur: 360 });
        expect(toolbar.dottedButton.classList.contains('reflects-note')).toBe(true);
        state.cursor.string = 3;
        state._emit('cursorMove', state.cursor);
        expect(toolbar.dottedButton.classList.contains('reflects-note')).toBe(false);
        state.cursor.string = 1;
        state._emit('cursorMove', state.cursor);
        expect(toolbar.dottedButton.classList.contains('reflects-note')).toBe(true);
    });

    it('the ENTRY state stays filled, and the two never fight', () => {
        mount({ s: 1, f: 5, dur: 360 });
        state.setDuration(DURATIONS.sixteenth);   // pins the note to 1/16
        const sixteenth = toolbar.durationButtons.get(DURATIONS.sixteenth);
        expect(sixteenth.classList.contains('active')).toBe(true);
    });

    it('an articulation button applies to the note under the cursor', () => {
        mount({ s: 1, f: 5, dur: 240 });
        toolbar.articulationButtons.get('h').click();
        expect(actions).toEqual(['effect.hammer']);
        expect(state.pendingArticulation).toBe(null);
    });

    it('…and ARMS the effect when the slot is empty (the mouse path)', () => {
        mount(null);
        toolbar.articulationButtons.get('p').click();
        expect(actions).toEqual([]);
        expect(state.pendingArticulation).toBe('p');
        expect(toolbar.articulationButtons.get('p')
            .classList.contains('pending')).toBe(true);
        toolbar.articulationButtons.get('effect.clear').click();
        expect(state.pendingArticulation).toBe(null);
    });

    it('tie always goes to the action — it needs a real predecessor', () => {
        mount(null);
        toolbar.articulationButtons.get('effect.tie').click();
        expect(actions).toEqual(['effect.tie']);
    });

    it('has no ~-as-technique button any more', () => {
        mount(null);
        expect(toolbar.articulationButtons.has('~')).toBe(false);
        const symbols = [...toolbar.element.querySelectorAll('.articulation-button')]
            .map(b => b.textContent);
        expect(symbols).toEqual(['h', 'p', '/', 'x', 'b', '⌒', '∅']);
    });
});

// ======================================================================
// The editor: where the menu bar mounts, and whose transport it is
// ======================================================================

describe('OTFEditor — menu bar and status bar', () => {
    let container;
    let editor;

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        editor?.destroy();
        container.remove();
    });

    it('mounts the menu bar ABOVE the toolbar', () => {
        editor = new OTFEditor({ container });
        const classes = [...editor.editorRoot.children].map(el => el.className);
        expect(classes[0]).toBe('editor-menu-container');
        expect(classes[1]).toBe('editor-toolbar-container');
        expect(editor.menuBar.element.querySelectorAll('.menu-trigger')).toHaveLength(7);
    });

    it('keeps its own transport when nothing else has one', () => {
        editor = new OTFEditor({ container });
        expect(editor.statusBar.querySelector('.play-button')).toBeTruthy();
        expect(editor.statusBar.querySelector('.tempo-input')).toBeTruthy();
    });

    it('drops ▶ ⏹ BPM when the host band provides the transport', () => {
        editor = new OTFEditor({ container, hostTransport: true });
        expect(editor.statusBar.querySelector('.playback-controls')).toBeNull();
        expect(editor.statusBar.querySelector('.play-button')).toBeNull();
        expect(editor.statusBar.querySelector('.stop-button')).toBeNull();
        expect(editor.statusBar.querySelector('.tempo-input')).toBeNull();
        // …and keeps everything else
        for (const field of ['mode', 'measure', 'beat', 'string', 'duration',
            'fingering', 'annotation']) {
            expect(editor.statusBar.querySelector(`[data-field="${field}"]`)).toBeTruthy();
        }
        expect(editor.statusBar.querySelector('.status-help-btn')).toBeTruthy();
    });

    // The toolbar has no fingering palette (eleven buttons for a mark
    // most tabs never carry), so the status bar is where what is SET on
    // the note at the cursor becomes visible without reading the stave.
    it('shows the fingering of the note at the cursor', () => {
        editor = new OTFEditor({ container });
        const read = () => editor.statusBar
            .querySelector('[data-field="fingering"]').textContent;
        expect(read()).toBe('—');            // empty slot

        editor.state.cursor.string = 3;
        editor.state.insertNote(5);
        expect(read()).toBe('—');            // a note with no marks

        editor.state.setFingering('T');
        expect(read()).toBe('T');
        editor.state.setLeftHand(2);
        expect(read()).toBe('T · lh 2');
        editor.state.setFingering(null);
        expect(read()).toBe('lh 2');
        editor.state.clearFingerings();
        expect(read()).toBe('—');
    });

    it('lh 0 shows as a mark, not as nothing', () => {
        editor = new OTFEditor({ container });
        editor.state.cursor.string = 3;
        editor.state.insertNote(0);
        editor.state.setLeftHand(0);
        expect(editor.statusBar.querySelector('[data-field="fingering"]')
            .textContent).toBe('lh 0');
    });

    it('the note popover EDITS a note in place, in one undo step', () => {
        editor = new OTFEditor({ container });
        editor.state.cursor.string = 3;
        editor.state.cursor.tick = 0;
        editor.state.insertNote(5);
        editor.state.setFingering('T');
        const depth = editor.state.facade._history.length;

        // What a double-click over that note hands the popover…
        editor._handlePopoverInsert({
            string: 3, fret: 5, tech: null, finger: 'R', lh: 3, editing: true,
        });
        editor.state.cursor.tick = 0;
        const note = editor.state.getNoteAtCursor();
        expect(note).toMatchObject({ f: 5, finger: 'R', lh: 3 });
        expect(editor.state.facade._history.length).toBe(depth + 1);

        editor.state.facade.undo();
        expect(editor.state.getNoteAtCursor()).toMatchObject({ f: 5, finger: 'T' });
        expect(editor.state.getNoteAtCursor().lh).toBeUndefined();
    });

    it('a double-click over a note opens the panel as an edit of it', () => {
        editor = new OTFEditor({ container });
        editor.state.cursor.string = 3;
        editor.state.cursor.tick = 0;
        editor.state.insertNote(7);
        editor.state.setFingering('I');
        editor.state.setLeftHand(4);

        const opened = [];
        editor.popover.open = (x, y, defaults) => opened.push(defaults);
        editor._handleCanvasDblClick({ target: editor.canvasContainer, clientX: 0, clientY: 0 });
        expect(opened).toHaveLength(1);
        expect(opened[0]).toMatchObject({ fret: 7, finger: 'I', lh: 4, editing: true });
    });

    it('playing with no transport in the status bar does not throw', async () => {
        editor = new OTFEditor({ container, hostTransport: true });
        expect(() => editor._updatePlayButton()).not.toThrow();
        editor.stop();
    });

    it('menu items really drive the editor (Select all, Insert measure)', () => {
        editor = new OTFEditor({ container });
        editor.menuBar.open('edit');
        findItem(editor.menuBar, 'Select all').click();
        expect(editor.state.selection).toBeTruthy();

        editor.state.setMode('normal');
        editor.state.cursor.measure = 1;
        editor.menuBar.open('edit');
        findItem(editor.menuBar, 'Insert measure after').click();
        expect(editor.state.cursor.measure).toBe(2);
    });

    it('View ▸ Measures per row re-pins the row count', () => {
        editor = new OTFEditor({ container });
        editor.menuBar.open('view');
        findItem(editor.menuBar, '6').click();
        expect(editor.renderer.options.measuresPerRow).toBe(6);
    });

    it('Score lists the document\'s tracks and switches between them', () => {
        editor = new OTFEditor({ container });
        editor.menuBar.open('score');
        const labels = itemsOf(editor.menuBar).map(labelOf);
        expect(labels.some(l => l.includes(editor.state.trackId))).toBe(true);
        expect(findItem(editor.menuBar, 'Rename track…')).toBeTruthy();
    });

    // ── The two prompts that used to be window.prompt ─────────────────
    // They are ValuePromptPopover now: in the DOM, themed, validated, and
    // drivable by a test (which a native dialog never was).

    /** The open value prompt, or null. */
    const valuePrompt = () => container.querySelector(
        '.otf-value-prompt-overlay[style*="flex"] .otf-value-prompt-popover');

    /** Type into the open value prompt (fires `input`, as a human would). */
    const typeValue = (panel, text) => {
        const input = panel.querySelector('.value-prompt-input');
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input;
    };

    it('Play ▸ Tempo… writes the document tempo through an in-app popover', () => {
        editor = new OTFEditor({ container });
        const nativePrompt = vi.spyOn(globalThis, 'prompt');
        editor.menuBar.open('play');
        findItem(editor.menuBar, 'Tempo…').click();

        const panel = valuePrompt();
        expect(panel).toBeTruthy();
        expect(panel.querySelector('.value-prompt-input').value).toBe('120');

        typeValue(panel, '96');
        panel.querySelector('.save-btn').click();

        expect(editor.state.otf.metadata.tempo).toBe(96);
        expect(nativePrompt).not.toHaveBeenCalled();
        nativePrompt.mockRestore();
    });

    it('the tempo prompt refuses an out-of-range value inline', () => {
        editor = new OTFEditor({ container });
        editor.menuBar.open('play');
        findItem(editor.menuBar, 'Tempo…').click();

        const panel = valuePrompt();
        typeValue(panel, '900');
        expect(panel.querySelector('.save-btn').disabled).toBe(true);
        expect(panel.querySelector('.value-prompt-error').textContent)
            .toContain('40');

        panel.querySelector('.save-btn').click();
        expect(editor.state.otf.metadata.tempo).toBe(120);
    });

    it('Escape cancels the tempo prompt without writing', () => {
        editor = new OTFEditor({ container });
        editor.menuBar.open('play');
        findItem(editor.menuBar, 'Tempo…').click();

        const panel = valuePrompt();
        typeValue(panel, '96');
        panel.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true,
        }));

        expect(valuePrompt()).toBeNull();
        expect(editor.state.otf.metadata.tempo).toBe(120);
    });

    it('Score ▸ Go to measure… moves the cursor from the popover', () => {
        editor = new OTFEditor({ container });
        editor.state.ensureMeasure(4);
        editor.menuBar.open('score');
        findItem(editor.menuBar, 'Go to measure…').click();

        const panel = valuePrompt();
        expect(panel).toBeTruthy();
        typeValue(panel, '3');
        // Enter commits, exactly like the note and track-name panels
        panel.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true,
        }));

        expect(editor.state.cursor.measure).toBe(3);
        expect(valuePrompt()).toBeNull();
    });

    it('destroy takes the menu bar with it', () => {
        editor = new OTFEditor({ container });
        editor.destroy();
        editor = null;
        expect(document.querySelector('.otf-menu-bar')).toBeNull();
    });
});
