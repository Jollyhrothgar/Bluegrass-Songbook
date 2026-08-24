// OTF Editor Keyboard Handler
//
// A MATCHER over `bindings.js`, and nothing else. Every behaviour lives in
// `ACTIONS`; every key lives in `PRESETS`. There is no `if (key === …)`
// here, which is the point: the `?` overlay, the context menu and the menu
// bar all render from the same table, so an advertised key is a bound key
// by construction (plan `tab-editor-input-parity.md` §3 "The binding
// table").
//
// What the matcher adds on top of the table:
//
//   sequences  `g g`, `d m`, `a h` — a 1 s pending window, as before
//   counts     only after a key the preset marks `countPrefix` (vim's `g`),
//              because in NORMAL every digit is a fret. `g12G` → measure 12,
//              `g3w` → three beats on, `g4.` → repeat four times. A count
//              that lands on a sequence with no binding falls back to the
//              last chord alone, which is what makes `g3w` work without a
//              `g w` entry.
//   fret entry the shared `FretEntry` (two-digit refine, `f` prefix) — the
//              same object the note popover uses.

import {
    ACTIONS, FretEntry, eventToKeyString, lookup, isCountPrefix,
    getPreset, onPresetChange, stepTicks, entryAdvanceTicks,
} from './bindings.js';

const PENDING_MS = 1000;
const REFINE_MS = 300;
const GHOST_MS = 100;

/**
 * Keyboard event handler — modal, table-driven.
 */
export class KeyboardHandler {
    constructor(state, cursor, options = {}) {
        this.state = state;
        this.cursor = cursor;
        this.options = options;
        this.recorder = options.recorder || null;

        // Multi-key sequences: the chords typed so far
        this.pending = [];
        this.pendingTimeout = null;

        // Count prefix (vim's `g`), collected as text so `g012G` behaves
        this.countBuffer = '';
        this.counting = false;

        // The one fret-entry algorithm (shared with NoteEntryPopover)
        this.fret = new FretEntry({ maxFret: 24, refineMs: REFINE_MS });

        // Legacy field: digits insert immediately now, but external code
        // (and tests) still read an empty buffer here.
        this.fretBuffer = '';

        this._ghostTimeout = null;
        this._preset = options.preset || getPreset();
        this._unsubscribePreset = onPresetChange((id) => { this._preset = id; });

        this.ctx = {
            state: this.state,
            cursor: this.cursor,
            fret: this.fret,
            hooks: this.options,
            record: (type, params) => this._record(type, params),
            insertFret: (fret, opts) => this._insertFret(fret, opts),
            reset: () => this._resetAll(),
        };

        this._boundHandler = this.handleKeyDown.bind(this);
    }

    /** The active preset id (`tabledit` by default). */
    get preset() { return this._preset || getPreset(); }

    set preset(id) { this._preset = id; }

    // --- Compatibility shims over the old ad-hoc fields ----------------

    /** The last chord of a pending sequence (`'g'`, `'d'`, …), or null. */
    get pendingKey() {
        return this.pending.length ? this.pending[this.pending.length - 1] : null;
    }

    /** Is `f` armed for a two-digit fret? */
    get highFretMode() { return this.fret.isHighFret; }

    /** The note a quick second digit would upgrade, or null. */
    get fretRefine() { return this.fret.seed; }

    /**
     * Record an event (no-op if no recorder or not recording)
     */
    _record(type, params = {}) {
        this.recorder?.record(type, params);
    }

    /**
     * Record a cursor position snapshot
     */
    _cursorParams() {
        const c = this.state.cursor;
        return { measure: c.measure, tick: c.tick, string: c.string };
    }

    /**
     * Attach to element
     */
    attach(element) {
        this.element = element;
        element.addEventListener('keydown', this._boundHandler);
    }

    /**
     * Detach from element
     */
    detach() {
        if (this.element) {
            this.element.removeEventListener('keydown', this._boundHandler);
            this.element = null;
        }
        this._resetAll();
        this._unsubscribePreset?.();
        this._unsubscribePreset = null;
        if (this._ghostTimeout) {
            clearTimeout(this._ghostTimeout);
            this._ghostTimeout = null;
        }
    }

    /**
     * Main key event handler
     */
    handleKeyDown(event) {
        const chord = eventToKeyString(event);
        // `null` means a Cmd chord we don't mirror: it belongs to the OS
        // or the browser (Cmd+F find, Cmd+L address bar, Cmd+digit …).
        if (chord == null) return;
        if (this.dispatch(chord, event)) event.preventDefault();
    }

    /**
     * Resolve one chord against the active preset. Public so tests and
     * the menu bar can drive an action the same way a key does.
     * @returns {boolean} handled (caller preventDefaults)
     */
    dispatch(chord, event = null) {
        const table = lookup(this.preset, this.state.mode);

        // A digit while a count-collecting sequence is open is a COUNT,
        // not a fret — that is the only place digits stop being frets.
        if (this.counting && /^[0-9]$/.test(chord)) {
            this.countBuffer += chord;
            this._armPendingTimeout();
            return true;
        }

        const seq = this.pending.concat(chord);
        const key = seq.join(' ');
        const count = this.countBuffer ? parseInt(this.countBuffer, 10) : 0;

        const entry = table.exact.get(key);
        if (entry) {
            this._clearPending();
            return this._run(entry, { count, key: chord, event });
        }

        if (table.prefixes.has(key)) {
            this.pending = seq;
            if (isCountPrefix(this.preset, chord)) this.counting = true;
            this._armPendingTimeout();
            return true;
        }

        // The sequence went nowhere — retry the chord on its own, keeping
        // any count. This is what makes `g3w` work with no `g w` entry.
        if (this.pending.length) {
            this._clearPending();
            const solo = table.exact.get(chord);
            if (solo) return this._run(solo, { count, key: chord, event });
            if (table.prefixes.has(chord)) {
                this.pending = [chord];
                if (isCountPrefix(this.preset, chord)) this.counting = true;
                this._armPendingTimeout();
                return true;
            }
        }
        return false;
    }

    /**
     * Run an action by id, with no key involved — the path menus, the
     * toolbar and the context menu use, so a mouse click and a keystroke
     * go through exactly the same code.
     * @returns {boolean} handled
     */
    dispatchAction(actionId, info = {}) {
        const action = ACTIONS[actionId];
        if (!action) return false;
        this.fret.reset();
        return action.run(this.ctx, { count: 0, key: null, event: null, ...info }) !== false;
    }

    /** Run one binding's action. */
    _run(entry, info) {
        const action = ACTIONS[entry.action];
        if (!action) return false;

        // Anything that isn't fret entry settles the two-digit refine
        // window, so digits can never combine across a cursor move.
        if (entry.action !== 'note.fret') {
            if (entry.action === 'note.fret.high') this.fret.cancelRefine();
            else this.fret.reset();
        }

        const times = (action.repeatable && info.count > 1) ? info.count : 1;
        let handled = false;
        for (let i = 0; i < times; i++) {
            handled = action.run(this.ctx, info) !== false;
        }
        return handled;
    }

    /**
     * Arm/clear the 1 s window a multi-key sequence waits in.
     */
    _armPendingTimeout() {
        if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
        this.pendingTimeout = setTimeout(() => this._clearPending(), PENDING_MS);
    }

    /**
     * Forget a half-typed sequence and its count.
     *
     * NOT the fret refine window: this runs on the way IN to every
     * action, and the second digit of `1` `2` has to still see the note
     * the first one placed. `_run` settles the window instead, for every
     * action except fret entry itself.
     */
    _clearPending() {
        this.pending = [];
        this.counting = false;
        this.countBuffer = '';
        if (this.pendingTimeout) {
            clearTimeout(this.pendingTimeout);
            this.pendingTimeout = null;
        }
    }

    /** Escape / detach: forget the sequence AND the fret state. */
    _resetAll() {
        this._clearPending();
        this.fret.reset();
    }

    /**
     * Place a fret at the cursor, flash the ghost note, and auto-advance
     * when `state.autoAdvance` says so.
     *
     * The advance is ONE GRID SLOT under automatic duration (there the
     * grid IS the rhythm input) and the entry duration otherwise; walking
     * past the last bar appends a measure (`stepTicks`).
     */
    _insertFret(fret, { advance = true, refinable = false } = {}) {
        const state = this.state;
        fret = Math.max(0, Math.min(24, fret));

        // Record BEFORE the mutation so the cursor is captured pre-advance
        const seed = {
            ...this._cursorParams(),
            fret,
            duration: state.isAutoDuration ? null : state.currentDuration,
            tech: state.pendingArticulation || null,
        };
        this._record('insertNote', seed);
        state.insertNote(fret);

        // Brief visual feedback
        this.cursor.showGhostNote(fret);
        if (this._ghostTimeout) clearTimeout(this._ghostTimeout);
        this._ghostTimeout = setTimeout(() => {
            this.cursor.hideGhostNote();
            this._ghostTimeout = null;
        }, GHOST_MS);

        if (refinable) this.fret.remember(seed);
        if (advance && state.autoAdvance) {
            stepTicks(this.ctx, entryAdvanceTicks(state));
        }
        return seed;
    }
}
