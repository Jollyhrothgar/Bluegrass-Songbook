// OTF Editor — the binding table.
//
// ONE declarative source for (a) what the keyboard does, (b) what the `?`
// overlay says, (c) what the context menu and (soon) the menu bar print
// beside each item. `keyboard.js` is a matcher over this table and nothing
// else, so a key can no longer be bound without being advertised — the
// drift the input-parity plan (§1.3, §8.2) called out in four places.
//
// Three layers:
//
//   ACTIONS   verbs. `{ label, group, modes, run(ctx, {count, key, event}) }`
//             — the shared vocabulary. Presets differ only in the key column.
//   PRESETS   `tabledit` (default) and `vim`, each `mode → [{keys, action}]`.
//   matcher   `eventToKeyString` + `canonicalKeys` put both sides of the
//             lookup in ONE grammar, so `Ctrl+Z`, `W` and `Shift+3` mean the
//             same thing written in the table and pressed on a keyboard.
//
// Key-string grammar
// ------------------
//   modifiers   `Ctrl` `Alt` `Shift`, in that order, joined by `+`
//   letters     the CASE decides: lowercase = unshifted (`h`, `Ctrl+z`),
//               UPPERCASE = shifted (`W` ≡ `Shift+W`, `Ctrl+Z` ≡
//               `Ctrl+Shift+Z`). Write modified letters in lower case.
//   digits      the PHYSICAL digit (`3`, `Shift+3`) — shifted digits report
//               `!@#…` in `event.key`, so the matcher reads `event.code`
//   punctuation the character itself, shift already baked in (`<`, `?`, `*`)
//   named keys  `ArrowLeft` `Home` `End` `Insert` `Delete` `Backspace`
//               `Enter` `Escape` `Tab` `Space` `F2`…`F10`
//   sequences   space-separated chords: `g g`, `d m`, `a h`
//   ranges      `0-9`, `Shift+0-9` — expanded for matching, kept whole for
//               display
//
// Cmd (Meta) is NEVER in the table: on macOS it belongs to the OS, and on
// Chromium `Cmd+…` is unreachable anyway. The matcher mirrors Cmd onto Ctrl
// for the seven system idioms only (S C X V Z Y A); every other Cmd chord
// falls straight through to the browser.

import {
    DURATIONS, EditorMode, CursorPosition, SelectionRange,
} from './state.js';

// ----------------------------------------------------------------------
// Key strings
// ----------------------------------------------------------------------

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift'];

/** Aliases accepted in the table, so it reads like a help page. */
const KEY_ALIASES = {
    esc: 'Escape', del: 'Delete', ins: 'Insert', space: 'Space',
    left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
    arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
    arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
    enter: 'Enter', tab: 'Tab', home: 'Home', end: 'End',
    backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
    escape: 'Escape',
};

/** Cmd chords that mean the same as Ctrl (and nothing else does). */
const META_MIRRORS = new Set(['s', 'c', 'x', 'v', 'z', 'y', 'a']);

/** Chords the browser or OS eats — the table must never contain one. */
export const RESERVED_CHORDS = [
    'Ctrl+t', 'Ctrl+w', 'Ctrl+n', 'Ctrl+Shift+T', 'Ctrl+Shift+N',
    'F6', 'F11', 'F1', 'F12',
];

/** Canonicalise ONE chord written in the table (or read off an event). */
export function canonicalChord(spec) {
    const raw = String(spec).trim();
    if (!raw) return '';
    // Split on '+' but keep a trailing literal '+' (as in `Ctrl++`, `+`)
    let parts;
    if (raw === '+') {
        parts = ['+'];
    } else if (raw.endsWith('+')) {
        parts = raw.slice(0, -1).split('+').concat('+');
    } else {
        parts = raw.split('+');
    }
    let key = parts.pop();
    const mods = new Set(parts.map(p => {
        const l = p.toLowerCase();
        if (l === 'ctrl' || l === 'control' || l === 'cmd' || l === 'meta') return 'Ctrl';
        if (l === 'alt' || l === 'option') return 'Alt';
        if (l === 'shift') return 'Shift';
        return p;
    }));

    if (key.length > 1) key = KEY_ALIASES[key.toLowerCase()] || key;
    if (key === ' ') key = 'Space';
    if (/^[a-zA-Z]$/.test(key)) {
        if (mods.has('Shift') || key === key.toUpperCase()) {
            mods.add('Shift');
            key = key.toUpperCase();
        } else {
            key = key.toLowerCase();
        }
    }
    if (/^F\d{1,2}$/i.test(key)) key = key.toUpperCase();

    const out = MOD_ORDER.filter(m => mods.has(m));
    out.push(key);
    return out.join('+');
}

/** Canonicalise a whole `keys` spec (a chord, or a space-separated run). */
export function canonicalKeys(spec) {
    return String(spec).trim().split(/\s+/).map(canonicalChord).join(' ');
}

/**
 * The chord a keyboard event names, or `null` when the event belongs to
 * the browser (any Cmd chord outside the seven system idioms).
 */
export function eventToKeyString(event) {
    let key = event.key;
    if (key == null) return null;

    const digit = /^Digit([0-9])$/.exec(event.code || '');
    if (digit) key = digit[1];
    if (key === ' ' || key === 'Spacebar') key = 'Space';

    if (event.metaKey && !META_MIRRORS.has(String(key).toLowerCase())) return null;

    const mods = [];
    if (event.ctrlKey || event.metaKey) mods.push('Ctrl');
    if (event.altKey) mods.push('Alt');

    if (/^[a-zA-Z]$/.test(key)) {
        // The CASE is what matters, not the modifier: Caps Lock produces
        // an uppercase `key` with `shiftKey` false, and a synthetic event
        // (tests, the menu bar) often sets only one of the two.
        if (event.shiftKey || key !== key.toLowerCase()) {
            mods.push('Shift');
            key = key.toUpperCase();
        } else {
            key = key.toLowerCase();
        }
    } else if (event.shiftKey && (digit || key.length > 1)) {
        // Shift+3 (the physical digit) and Shift+ArrowLeft / Shift+Tab.
        // Printable punctuation already encodes its shift ('<', '?', '*').
        mods.push('Shift');
    }

    return mods.concat(key).join('+');
}

/** `Ctrl+ArrowLeft` → `Ctrl+←`, `g g` → `gg` — for help text and tooltips. */
export function prettyKeys(spec) {
    const chords = String(spec).trim().split(/\s+/).map(chord => {
        const parts = chord.split('+');
        const key = parts.pop();
        const pretty = {
            ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
            Escape: 'Esc', Space: 'Space', Delete: 'Del', Insert: 'Ins',
            Backspace: '⌫',
        }[key] || key;
        return parts.concat(pretty).join('+');
    });
    // A run of single LETTERS/DIGITS reads better closed up (`g g` → `gg`,
    // `a h` → `ah`); punctuation keeps the space so `a ~` stays legible.
    if (chords.length > 1 && chords.every(c => /^[a-zA-Z0-9]$/.test(c))) {
        return chords.join('');
    }
    return chords.join(' ');
}

/**
 * Expand a `keys` spec into the concrete chord-sequences that match it.
 * `0-9` → ten chords; `Shift+A-J` → ten chords; everything else → itself.
 */
export function expandKeys(spec) {
    const chords = String(spec).trim().split(/\s+/);
    const expanded = chords.map(chord => {
        const m = /^(.*?)([0-9A-Za-z])-([0-9A-Za-z])$/.exec(chord);
        if (!m) return [chord];
        const [, prefix, from, to] = m;
        const sameClass = (/[0-9]/.test(from) === /[0-9]/.test(to));
        if (!sameClass || from.charCodeAt(0) >= to.charCodeAt(0)) return [chord];
        const out = [];
        for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) {
            out.push(prefix + String.fromCharCode(c));
        }
        return out;
    });
    // Cartesian product across the sequence positions (ranges are only
    // ever used on single-chord bindings, but this keeps it honest).
    return expanded.reduce(
        (acc, options) => acc.flatMap(prefix =>
            options.map(o => (prefix ? `${prefix} ${o}` : o))),
        [''],
    ).map(canonicalKeys);
}

// ----------------------------------------------------------------------
// Fret entry — ONE algorithm (§9.2 "One fret-entry algorithm")
// ----------------------------------------------------------------------

/**
 * The digit → fret rule, shared by the canvas keyboard and the
 * double-click note popover (which used to accumulate and roll over on
 * its own, disagreeing with the canvas about what `1` `2` means).
 *
 * Rules, in order:
 *   `f` armed   the next TWO digits are one fret (`f` `1` `2` → 12)
 *   refine open the digit upgrades the note just placed, in place, when
 *               the combination is a real fret (`1` then `2` → 12); when
 *               it isn't (`1` then `9` → 19 ✓, `3` then `3` → 33 ✗) the
 *               digit starts a fresh note
 *   otherwise   the digit IS the fret, and opens a refine window when it
 *               could prefix a bigger one (1, 2 for a 24-fret neck)
 *
 * The keyboard closes the window after `refineMs`; the popover passes
 * `Infinity`, because a dialog has no hurry.
 */
export class FretEntry {
    constructor({ maxFret = 24, refineMs = 300 } = {}) {
        this.maxFret = maxFret;
        this.refineMs = refineMs;
        this._seed = null;
        this._timer = null;
        this._high = false;
        this._highBuf = '';
    }

    /** Is `f` armed (waiting for two digits)? */
    get isHighFret() { return this._high; }

    /** Is a two-digit refine window open? */
    get isRefining() { return this._seed != null; }

    /** The note the refine window would upgrade (null when closed). */
    get seed() { return this._seed; }

    /** `f`: the next two digits are one fret. */
    armHighFret() {
        this.cancelRefine();
        this._high = true;
        this._highBuf = '';
    }

    /** Close the refine window (any navigation or edit key does this). */
    cancelRefine() {
        this._seed = null;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    }

    /** Forget everything (Escape, detach). */
    reset() {
        this.cancelRefine();
        this._high = false;
        this._highBuf = '';
    }

    /**
     * Feed one digit.
     * @returns {{kind: 'insert'|'refine'|'pending', fret: number,
     *            seed?: Object, refinable?: boolean}}
     */
    digit(d) {
        if (this._high) {
            this._highBuf += String(d);
            if (this._highBuf.length < 2) {
                return { kind: 'pending', fret: parseInt(this._highBuf, 10) };
            }
            const fret = Math.min(this.maxFret, parseInt(this._highBuf, 10));
            this._high = false;
            this._highBuf = '';
            return { kind: 'insert', fret, refinable: false };
        }
        if (this._seed) {
            const seed = this._seed;
            const combined = seed.fret * 10 + d;
            this.cancelRefine();
            if (combined <= this.maxFret) return { kind: 'refine', fret: combined, seed };
        }
        return { kind: 'insert', fret: d, refinable: d > 0 && d * 10 <= this.maxFret };
    }

    /** Open the refine window over the note just placed. */
    remember(seed) {
        this.cancelRefine();
        this._seed = seed;
        if (this.refineMs !== Infinity) {
            this._timer = setTimeout(() => {
                this._seed = null;
                this._timer = null;
            }, this.refineMs);
        }
    }
}

// ----------------------------------------------------------------------
// Shared helpers the actions are built from
// ----------------------------------------------------------------------

const posOf = (state) => ({
    measure: state.cursor.measure,
    tick: state.cursor.tick,
    string: state.cursor.string,
});

const absOf = (state) => state.facade.toAbs(state.cursor.measure, state.cursor.tick);

/** One tick past the last slot of the last measure. */
const docEndAbs = (state) => {
    const n = state.getMeasureCount();
    return state.facade.toAbs(n, 0) + state.facade.ticksFor(n);
};

/** How far entering a note moves you on: the grid under auto, else the duration. */
export function entryAdvanceTicks(state) {
    return state.isAutoDuration ? state.gridSubdivision : state.effectiveDuration();
}

/**
 * Step the cursor, APPENDING a measure when the step would walk off the
 * end ("making new measures", plan §7). Every forward step the user can
 * make — `→`, `Tab`, `.`, `Enter`, an auto-advance — comes through here.
 */
export function stepTicks(ctx, ticks) {
    const { state, cursor } = ctx;
    if (ticks > 0 && state.facade && absOf(state) + ticks >= docEndAbs(state)) {
        const next = state.getMeasureCount() + 1;
        if (state.ensureMeasure(next)) ctx.record('ensureMeasure', { measure: next });
    }
    cursor.moveByTicks(ticks);
}

/** Move to a measure, appending it first when it is past the end. */
function goToMeasure(ctx, n) {
    const { state, cursor } = ctx;
    if (n > state.getMeasureCount()) {
        if (state.ensureMeasure(n)) ctx.record('ensureMeasure', { measure: n });
    }
    ctx.record('moveCursorToMeasure', { measure: n });
    cursor.moveToMeasure(n);
}

/** Is this written measure empty on EVERY track? */
function measureIsEmpty(state, n) {
    const notation = state.otf?.notation || {};
    for (const measures of Object.values(notation)) {
        const m = measures.find(x => x.measure === n);
        if (m && m.events.some(e => (e.notes || []).length > 0)) return false;
    }
    return true;
}

/** Enter VISUAL (if needed), run a move, drag the selection end with it. */
function extend(ctx, move) {
    const { state } = ctx;
    if (state.mode !== EditorMode.VISUAL) {
        ctx.record('setMode', { mode: EditorMode.VISUAL });
        state.setMode(EditorMode.VISUAL);
    }
    move();
    if (state.selection) state.selection.end = state.cursor.clone();
    ctx.cursor.update();
    ctx.cursor.renderSelection?.();
}

/** Select an explicit span and show it. */
function selectSpan(ctx, start, end) {
    const { state } = ctx;
    state.setMode(EditorMode.VISUAL);
    state.selection = new SelectionRange(
        new CursorPosition(start.measure, start.tick, start.string ?? state.cursor.string, state.trackId),
        new CursorPosition(end.measure, end.tick, end.string ?? state.cursor.string, state.trackId));
    ctx.cursor.update();
    ctx.cursor.renderSelection?.();
}

/**
 * Apply a technique to the note at the cursor, or to every note in the
 * selection, as ONE undo step. `'~'` means TIE — the facade routes it.
 */
function applyTech(ctx, tech) {
    const { state } = ctx;
    const range = state.selection ? state.selectionRange() : null;
    if (range) {
        const hits = state.facade.notesInRange(range.startAbs, range.endAbs,
            { trackId: state.trackId });
        if (!hits.length) return false;
        state.facade.transact(tech ? 'Set technique' : 'Clear technique', () => {
            for (const hit of hits) {
                state.facade.setArticulation(
                    { measure: hit.measure, tick: hit.tick, string: hit.string },
                    tech, state.trackId);
            }
            return true;
        });
        if (tech) state.lastTech = tech;
        return true;
    }
    ctx.record(tech ? 'addArticulation' : 'removeArticulation',
        { ...posOf(state), tech });
    if (tech === '~') {
        state.lastTech = '~';
        return state.toggleTieAtCursor();
    }
    return tech ? state.addArticulation(tech) !== false
                : state.removeArticulation() !== false;
}

/**
 * TablEdit marks the FIRST note of a hammer pair; OTF marks the target
 * ("`2h4`: the 4 is hammered"). So `h` on a note that has a same-string
 * successor and no predecessor to hang off marks the successor instead —
 * either note of the pair does the right thing.
 */
function techTarget(ctx, tech) {
    const { state } = ctx;
    if (state.selection) return null;
    if (!['h', 'p', '/', '\\'].includes(tech)) return null;
    if (!state.getNoteAtCursor()) return null;
    if (state.facade.tiePredecessor(posOf(state), state.trackId)) return null;
    // Look for the next onset on this string inside the measure
    const measure = state.getMeasure(state.cursor.measure);
    if (!measure) return null;
    const later = measure.events
        .filter(e => e.tick > state.cursor.tick
            && (e.notes || []).some(n => n.s === state.cursor.string))
        .sort((a, b) => a.tick - b.tick)[0];
    return later ? { measure: state.cursor.measure, tick: later.tick } : null;
}

function techAction(tech, label) {
    return {
        label,
        group: 'Effects',
        modes: ['normal', 'visual'],
        run(ctx) {
            const move = techTarget(ctx, tech);
            if (move) {
                ctx.state.cursor.tick = move.tick;
                ctx.cursor.update();
            }
            applyTech(ctx, tech);
            return true;
        },
    };
}

/** Duration ladder for the coarser/finer grid keys. */
const GRID_LADDER = [
    DURATIONS.thirtySecond, DURATIONS.sixteenth,
    DURATIONS.eighth, DURATIONS.quarter, DURATIONS.half,
];

function durationAction(ticks, label) {
    return {
        label,
        group: 'Durations',
        modes: ['normal', 'visual'],
        run(ctx) {
            if (ctx.state.selection) {
                ctx.record('applyDurationToSelection', { duration: ticks });
                ctx.state.applyDurationToSelection(ticks);
                return true;
            }
            ctx.record('setDuration', { duration: ticks });
            ctx.state.setDuration(ticks);
            return true;
        },
    };
}

function gridAction(ticks, label) {
    return {
        label,
        group: 'Grid',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('setGridSubdivision', { subdivision: ticks });
            ctx.state.setGridSubdivision(ticks);
            return true;
        },
    };
}

function fingeringAction(finger, label) {
    return {
        label,
        group: 'Fingering',
        // Reachable from NORMAL too — vim puts it behind the `a` operator
        modes: ['normal', 'annotation'],
        run(ctx) {
            ctx.state.setFingering(finger);
            return true;
        },
    };
}

// ----------------------------------------------------------------------
// ACTIONS — the verbs. Keys live in PRESETS, never here.
// ----------------------------------------------------------------------

export const ACTIONS = {
    // === Note entry ===============================================
    'note.fret': {
        label: 'Fret at cursor (two-digit refine)',
        group: 'Notes',
        modes: ['normal'],
        run(ctx, { key }) {
            const d = parseInt(key.slice(-1), 10);
            if (Number.isNaN(d)) return false;
            const result = ctx.fret.digit(d);
            if (result.kind === 'pending') return true;
            if (result.kind === 'refine') {
                const r = result.seed;
                ctx.record('insertNote', { ...r, fret: result.fret });
                ctx.state.facade.insertNote({
                    measure: r.measure, tick: r.tick, string: r.string,
                    fret: result.fret, duration: r.duration, tech: r.tech,
                    trackId: ctx.state.trackId,
                    autoDuration: r.duration == null,
                    pins: ctx.state.pinnedDurations,
                    autoEntered: ctx.state.autoEnteredDurations,
                });
                ctx.cursor.update();
                return true;
            }
            ctx.insertFret(result.fret, { refinable: result.refinable });
            return true;
        },
    },
    'note.fret.stack': {
        label: 'Fret WITHOUT advancing (stack a chord)',
        group: 'Notes',
        modes: ['normal'],
        run(ctx, { key }) {
            const d = parseInt(key.slice(-1), 10);
            if (Number.isNaN(d)) return false;
            ctx.fret.cancelRefine();
            ctx.insertFret(d, { advance: false, refinable: false });
            return true;
        },
    },
    'note.fret.high': {
        label: 'Next two digits are one fret (10–24)',
        group: 'Notes',
        modes: ['normal'],
        run(ctx) { ctx.fret.armHighFret(); return true; },
    },

    // === Deleting =================================================
    'note.delete': {
        label: 'Delete the note at the cursor',
        group: 'Notes',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            ctx.record('deleteNote', posOf(ctx.state));
            ctx.state.deleteNote();
            return true;
        },
    },
    'note.deleteOrMeasure': {
        label: 'Delete the note — or an empty measure',
        group: 'Notes',
        modes: ['normal'],
        run(ctx) {
            const { state } = ctx;
            if (!state.getNoteAtCursor() && measureIsEmpty(state, state.cursor.measure)
                && state.getMeasureCount() > 1) {
                ctx.record('deleteMeasure', { measure: state.cursor.measure });
                if (state.deleteMeasureAtCursor()) { ctx.cursor.update(); return true; }
            }
            ctx.record('deleteNote', posOf(state));
            state.deleteNote();
            return true;
        },
    },
    'note.backspace': {
        label: 'Delete backwards (typewriter)',
        group: 'Notes',
        modes: ['normal'],
        run(ctx) {
            const { state } = ctx;
            if (!state.getNoteAtCursor()) {
                ctx.record('moveCursorByDuration', { direction: -1 });
                ctx.cursor.moveByDuration(-1);
            }
            ctx.record('deleteNote', posOf(state));
            state.deleteNote();
            return true;
        },
    },
    'note.deleteTick': {
        label: 'Delete every note at this tick',
        group: 'Notes',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            ctx.record('deleteTick', posOf(ctx.state));
            ctx.state.deleteTick();
            return true;
        },
    },
    'note.deleteToMeasureEnd': {
        label: 'Delete to the end of the measure',
        group: 'Notes',
        modes: ['normal'],
        run(ctx) {
            ctx.record('deleteTick', posOf(ctx.state));
            ctx.state.deleteToMeasureEnd();
            return true;
        },
    },

    // === Note fixes ===============================================
    'note.fretUp': {
        label: 'Fret +1',
        group: 'Notes',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            ctx.record('transposeFret', { ...posOf(ctx.state), delta: 1 });
            ctx.state.transposeFretAtCursor(1);
            return true;
        },
    },
    'note.fretDown': {
        label: 'Fret −1',
        group: 'Notes',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            ctx.record('transposeFret', { ...posOf(ctx.state), delta: -1 });
            ctx.state.transposeFretAtCursor(-1);
            return true;
        },
    },
    'note.restringUp': {
        label: 'Move to the string above, same pitch',
        group: 'Notes',
        modes: ['normal'],
        run(ctx) {
            ctx.record('moveNoteToString', { ...posOf(ctx.state), direction: -1 });
            ctx.state.moveNoteAcrossStrings(-1);
            ctx.cursor.update();
            return true;
        },
    },
    'note.restringDown': {
        label: 'Move to the string below, same pitch',
        group: 'Notes',
        modes: ['normal'],
        run(ctx) {
            ctx.record('moveNoteToString', { ...posOf(ctx.state), direction: 1 });
            ctx.state.moveNoteAcrossStrings(1);
            ctx.cursor.update();
            return true;
        },
    },

    // === Navigation ===============================================
    'nav.left': {
        label: 'Left one grid slot',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            ctx.record('moveCursorByGrid', { direction: -1 });
            ctx.cursor.moveByGrid(-1);
            return true;
        },
    },
    'nav.right': {
        label: 'Right one grid slot (past the end adds a measure)',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            ctx.record('moveCursorByGrid', { direction: 1 });
            stepTicks(ctx, ctx.state.gridSubdivision);
            return true;
        },
    },
    'nav.stringUp': {
        label: 'Up one string',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            ctx.record('moveCursorString', { direction: -1 });
            ctx.cursor.moveString(-1);
            return true;
        },
    },
    'nav.stringDown': {
        label: 'Down one string',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            ctx.record('moveCursorString', { direction: 1 });
            ctx.cursor.moveString(1);
            return true;
        },
    },
    'nav.beatForward': {
        label: 'Next beat',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            ctx.record('moveCursorByBeat', { direction: 1 });
            ctx.cursor.moveByBeat(1);
            return true;
        },
    },
    'nav.beatBack': {
        label: 'Previous beat',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            ctx.record('moveCursorByBeat', { direction: -1 });
            ctx.cursor.moveByBeat(-1);
            return true;
        },
    },
    'nav.advance': {
        label: 'Advance by the current duration (TablEdit’s rest)',
        group: 'Navigate',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            ctx.record('moveCursorByDuration', { direction: 1 });
            stepTicks(ctx, ctx.state.effectiveDuration());
            return true;
        },
    },
    'nav.retreat': {
        label: 'Back by the current duration',
        group: 'Navigate',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            ctx.record('moveCursorByDuration', { direction: -1 });
            ctx.cursor.moveByDuration(-1);
            return true;
        },
    },
    'nav.nextMeasure': {
        label: 'Next measure (past the end adds one)',
        group: 'Navigate',
        modes: ['normal'],
        run(ctx) {
            goToMeasure(ctx, ctx.state.cursor.measure + 1);
            return true;
        },
    },
    'nav.measureStart': {
        label: 'Start of the measure',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('moveCursor', { ...posOf(ctx.state), tick: 0 });
            ctx.cursor.moveToMeasureStart();
            return true;
        },
    },
    'nav.measureEnd': {
        label: 'End of the measure',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('moveCursorToMeasureEnd');
            ctx.cursor.moveToMeasureEnd();
            return true;
        },
    },
    'nav.measureEdgeLeft': {
        label: 'Measure start, then the previous measure',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        run(ctx) {
            const { state } = ctx;
            if (state.cursor.tick !== 0) {
                ctx.record('moveCursor', { ...posOf(state), tick: 0 });
                ctx.cursor.moveToMeasureStart();
            } else if (state.cursor.measure > 1) {
                ctx.record('moveCursorToMeasure', { measure: state.cursor.measure - 1 });
                ctx.cursor.moveToMeasure(state.cursor.measure - 1);
            }
            return true;
        },
    },
    'nav.measureEdgeRight': {
        label: 'Measure end, then the next measure',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        run(ctx) {
            const { state } = ctx;
            const ticks = state.facade.ticksFor(state.cursor.measure);
            const last = Math.max(0, ticks - state.effectiveDuration());
            if (state.cursor.tick < last) {
                ctx.record('moveCursorToMeasureEnd');
                ctx.cursor.moveToMeasureEnd();
            } else {
                goToMeasure(ctx, state.cursor.measure + 1);
            }
            return true;
        },
    },
    'nav.firstString': {
        label: 'First string',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('moveCursor', { ...posOf(ctx.state), string: 1 });
            ctx.cursor.moveToString(1);
            return true;
        },
    },
    'nav.lastString': {
        label: 'Last string',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        run(ctx) {
            const n = ctx.state.getStringCount();
            ctx.record('moveCursor', { ...posOf(ctx.state), string: n });
            ctx.cursor.moveToString(n);
            return true;
        },
    },
    'nav.docStart': {
        label: 'Start of the tab',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('moveCursorToStart');
            ctx.cursor.moveToStart();
            return true;
        },
    },
    'nav.docEnd': {
        label: 'End of the tab (with a count: go to that measure)',
        group: 'Navigate',
        modes: ['normal', 'visual'],
        run(ctx, { count } = {}) {
            if (count) { goToMeasure(ctx, count); return true; }
            ctx.record('moveCursorToEnd');
            ctx.cursor.moveToEnd();
            return true;
        },
    },
    'nav.prevNote': {
        label: 'Previous note',
        group: 'Navigate',
        modes: ['normal', 'visual', 'annotation'],
        repeatable: true,
        run(ctx) { ctx.cursor.moveToPrevEvent(); return true; },
    },
    'nav.nextNote': {
        label: 'Next note',
        group: 'Navigate',
        modes: ['normal', 'visual', 'annotation'],
        repeatable: true,
        run(ctx) { ctx.cursor.moveToNextEvent(); return true; },
    },
    'nav.goToMeasure': {
        label: 'Go to measure…',
        group: 'Navigate',
        modes: ['normal'],
        run(ctx, { count } = {}) {
            if (count) { goToMeasure(ctx, count); return true; }
            const n = ctx.hooks.onGoToMeasure?.();
            if (n > 0) goToMeasure(ctx, Math.floor(n));
            return true;
        },
    },

    // === Selection ================================================
    'select.visual': {
        label: 'Visual select',
        group: 'Select',
        modes: ['normal'],
        run(ctx) {
            ctx.record('setMode', { mode: EditorMode.VISUAL });
            ctx.state.setMode(EditorMode.VISUAL);
            return true;
        },
    },
    'select.extendLeft': {
        label: 'Extend the selection left',
        group: 'Select',
        modes: ['normal', 'visual'],
        run(ctx) { extend(ctx, () => ctx.cursor.moveByGrid(-1)); return true; },
    },
    'select.extendRight': {
        label: 'Extend the selection right',
        group: 'Select',
        modes: ['normal', 'visual'],
        run(ctx) { extend(ctx, () => stepTicks(ctx, ctx.state.gridSubdivision)); return true; },
    },
    'select.extendUp': {
        label: 'Extend the selection up a string',
        group: 'Select',
        modes: ['normal', 'visual'],
        run(ctx) { extend(ctx, () => ctx.cursor.moveString(-1)); return true; },
    },
    'select.extendDown': {
        label: 'Extend the selection down a string',
        group: 'Select',
        modes: ['normal', 'visual'],
        run(ctx) { extend(ctx, () => ctx.cursor.moveString(1)); return true; },
    },
    'select.measureOrAll': {
        label: 'Select the measure — again, the whole tab',
        group: 'Select',
        modes: ['normal', 'visual'],
        run(ctx) {
            const { state } = ctx;
            const m = state.cursor.measure;
            const lastTick = Math.max(0,
                state.facade.ticksFor(m) - state.gridSubdivision);
            const measureSelected = state.selection
                && state.selection.start.measure === m
                && state.selection.start.tick === 0
                && state.selection.end.measure === m
                && state.selection.end.tick === lastTick;
            if (measureSelected) {
                const n = state.getMeasureCount();
                selectSpan(ctx, { measure: 1, tick: 0, string: 1 },
                    {
                        measure: n,
                        tick: Math.max(0, state.facade.ticksFor(n) - state.gridSubdivision),
                        string: state.getStringCount(),
                    });
            } else {
                selectSpan(ctx, { measure: m, tick: 0, string: 1 },
                    { measure: m, tick: lastTick, string: state.getStringCount() });
            }
            return true;
        },
    },
    'select.delete': {
        label: 'Delete the selection',
        group: 'Select',
        modes: ['visual'],
        run(ctx) {
            ctx.state.deleteSelection();
            ctx.state.setMode(EditorMode.NORMAL);
            return true;
        },
    },

    // === Clipboard ================================================
    'clip.copy': {
        label: 'Copy',
        group: 'Clipboard',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('copy');
            ctx.state.copy();
            return true;
        },
    },
    'clip.copyExit': {
        label: 'Copy the selection and leave visual',
        group: 'Clipboard',
        modes: ['visual'],
        run(ctx) {
            ctx.record('copy');
            ctx.state.copy();
            ctx.state.setMode(EditorMode.NORMAL);
            return true;
        },
    },
    'clip.cut': {
        label: 'Cut',
        group: 'Clipboard',
        modes: ['normal', 'visual'],
        run(ctx) {
            const { state } = ctx;
            ctx.record('copy');
            state.copy();
            if (state.selection) {
                state.deleteSelection();
                state.setMode(EditorMode.NORMAL);
            } else {
                ctx.record('deleteTick', posOf(state));
                state.deleteTick();
            }
            return true;
        },
    },
    'clip.paste': {
        label: 'Paste at the cursor',
        group: 'Clipboard',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('paste');
            ctx.state.paste();
            return true;
        },
    },
    'clip.pasteBefore': {
        label: 'Paste one duration back',
        group: 'Clipboard',
        modes: ['normal'],
        run(ctx) {
            ctx.cursor.moveByTicks(-ctx.state.effectiveDuration());
            ctx.record('paste');
            ctx.state.paste();
            return true;
        },
    },

    // === Durations ================================================
    'duration.whole': durationAction(DURATIONS.whole, 'Whole note'),
    'duration.half': durationAction(DURATIONS.half, 'Half note'),
    'duration.quarter': durationAction(DURATIONS.quarter, 'Quarter note'),
    'duration.eighth': durationAction(DURATIONS.eighth, 'Eighth note'),
    'duration.sixteenth': durationAction(DURATIONS.sixteenth, 'Sixteenth note'),
    'duration.thirtySecond': durationAction(DURATIONS.thirtySecond, 'Thirty-second note'),
    'duration.auto': {
        label: 'Automatic duration (the gap decides)',
        group: 'Durations',
        modes: ['normal', 'visual'],
        run(ctx) {
            const next = !ctx.state.isAutoDuration;
            ctx.record('setAutoDuration', { auto: next });
            ctx.state.setAutoDuration(next);
            return true;
        },
    },
    'duration.dotted': {
        label: 'Dotted',
        group: 'Durations',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('toggleDotted');
            ctx.state.toggleDotted();
            return true;
        },
    },
    'duration.triplet': {
        label: 'Triplet',
        group: 'Durations',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('toggleTripletMode');
            ctx.state.toggleTripletMode();
            return true;
        },
    },
    'duration.shorter': {
        label: 'Halve the note’s duration',
        group: 'Durations',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            if (ctx.state.selection) {
                ctx.record('scaleSelectionDuration', { factor: 0.5 });
                ctx.state.scaleSelectionDuration(0.5);
            } else {
                ctx.record('scaleDuration', { ...posOf(ctx.state), factor: 0.5 });
                ctx.state.scaleDurationAtCursor(0.5);
            }
            return true;
        },
    },
    'duration.longer': {
        label: 'Double the note’s duration',
        group: 'Durations',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            if (ctx.state.selection) {
                ctx.record('scaleSelectionDuration', { factor: 2 });
                ctx.state.scaleSelectionDuration(2);
            } else {
                ctx.record('scaleDuration', { ...posOf(ctx.state), factor: 2 });
                ctx.state.scaleDurationAtCursor(2);
            }
            return true;
        },
    },
    'duration.applyToSelection': {
        label: 'Apply the current duration to the selection',
        group: 'Durations',
        modes: ['normal', 'visual'],
        run(ctx) {
            const d = ctx.state.effectiveDuration();
            ctx.record('applyDurationToSelection', { duration: d });
            ctx.state.applyDurationToSelection(d);
            return true;
        },
    },
    'duration.fix': {
        label: 'Fix durations from spacing (measure or selection)',
        group: 'Durations',
        modes: ['normal', 'visual'],
        run(ctx) {
            if (ctx.state.selection) {
                ctx.record('fixDurations', { measure: ctx.state.cursor.measure });
                ctx.state.fixDurationsInSelection();
            } else {
                ctx.record('fixDurations', { measure: ctx.state.cursor.measure });
                ctx.state.fixDurationsAtCursor();
            }
            return true;
        },
    },

    // === Effects ==================================================
    'effect.hammer': techAction('h', 'Hammer-on'),
    'effect.pull': techAction('p', 'Pull-off'),
    'effect.slide': techAction('/', 'Slide'),
    'effect.dead': techAction('x', 'Dead / muted note'),
    'effect.choke': techAction('b', 'Choke / bend'),
    'effect.tie': {
        label: 'Tie to the previous note',
        group: 'Effects',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('toggleTie', posOf(ctx.state));
            ctx.state.toggleTieAtCursor();
            return true;
        },
    },
    'effect.clear': {
        label: 'Clear the effect',
        group: 'Effects',
        modes: ['normal', 'visual'],
        run(ctx) { applyTech(ctx, null); return true; },
    },
    'effect.repeatLast': {
        label: 'Repeat the last effect',
        group: 'Effects',
        modes: ['normal', 'visual'],
        run(ctx) {
            const { state } = ctx;
            if (!state.lastTech) return true;
            if (state.lastTech === '~') {
                ctx.record('toggleTie', posOf(state));
                state.toggleTieAtCursor();
            } else {
                applyTech(ctx, state.lastTech);
            }
            return true;
        },
    },
    'effect.pendingHammer': {
        label: 'Arm hammer-on for the next note',
        group: 'Effects',
        modes: ['normal'],
        run(ctx) {
            ctx.record('setPendingArticulation', { tech: 'h' });
            ctx.state.setPendingArticulation('h');
            return true;
        },
    },
    'effect.pendingPull': {
        label: 'Arm pull-off for the next note',
        group: 'Effects',
        modes: ['normal'],
        run(ctx) {
            ctx.record('setPendingArticulation', { tech: 'p' });
            ctx.state.setPendingArticulation('p');
            return true;
        },
    },
    'effect.pendingSlide': {
        label: 'Arm slide for the next note',
        group: 'Effects',
        modes: ['normal'],
        run(ctx) {
            ctx.record('setPendingArticulation', { tech: '/' });
            ctx.state.setPendingArticulation('/');
            return true;
        },
    },

    // === Annotation-mode effects (kept: `A` is still the note-mark mode)
    'annotate.hammer': {
        label: 'Hammer-on on this note',
        group: 'Annotation mode',
        modes: ['annotation'],
        run(ctx) { applyTech(ctx, 'h'); return true; },
    },
    'annotate.pull': {
        label: 'Pull-off on this note',
        group: 'Annotation mode',
        modes: ['annotation'],
        run(ctx) { applyTech(ctx, 'p'); return true; },
    },
    'annotate.slide': {
        label: 'Slide on this note',
        group: 'Annotation mode',
        modes: ['annotation'],
        run(ctx) { applyTech(ctx, '/'); return true; },
    },
    'annotate.tie': {
        label: 'Tie this note',
        group: 'Annotation mode',
        modes: ['annotation'],
        run(ctx) { applyTech(ctx, '~'); return true; },
    },
    'annotate.clear': {
        label: 'Clear this note’s effect',
        group: 'Annotation mode',
        modes: ['annotation'],
        run(ctx) {
            ctx.record('removeArticulation', posOf(ctx.state));
            ctx.state.removeArticulation();
            return true;
        },
    },
    'finger.thumb': fingeringAction('T', 'Thumb'),
    'finger.index': fingeringAction('I', 'Index'),
    'finger.middle': fingeringAction('M', 'Middle'),

    // === Measures =================================================
    'measure.insertBefore': {
        label: 'Insert a measure before this one',
        group: 'Measures',
        modes: ['normal'],
        run(ctx) {
            const { state } = ctx;
            ctx.record('insertMeasureBefore', { beforeMeasure: state.cursor.measure });
            state.insertMeasure(state.cursor.measure);
            state.cursor.tick = 0;
            ctx.cursor.update();
            return true;
        },
    },
    'measure.insertAfter': {
        label: 'Insert a measure after this one',
        group: 'Measures',
        modes: ['normal'],
        run(ctx) {
            const { state } = ctx;
            const at = state.cursor.measure;
            ctx.record('insertMeasureAfter', { afterMeasure: at });
            state.insertMeasure(at + 1);
            state.cursor.measure = at + 1;
            state.cursor.tick = 0;
            ctx.cursor.update();
            return true;
        },
    },
    'measure.delete': {
        label: 'Delete this measure',
        group: 'Measures',
        modes: ['normal'],
        run(ctx) {
            ctx.record('deleteMeasure', { measure: ctx.state.cursor.measure });
            ctx.state.deleteMeasureAtCursor();
            ctx.cursor.update();
            return true;
        },
    },
    'measure.repeatPrevious': {
        label: 'Repeat the previous measure here',
        group: 'Measures',
        modes: ['normal'],
        run(ctx) {
            ctx.record('repeatMeasure', { measure: ctx.state.cursor.measure });
            ctx.state.repeatPreviousMeasure();
            ctx.cursor.update();
            return true;
        },
    },
    'measure.rippleRight': {
        label: 'Ripple right (open a slot)',
        group: 'Measures',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            const ticks = ctx.state.rippleTicks();
            ctx.record('shiftRight', { ...posOf(ctx.state), ticks });
            ctx.state.shiftRightAtCursor(ticks);
            return true;
        },
    },
    'measure.rippleLeft': {
        label: 'Ripple left (close the gap)',
        group: 'Measures',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            const ticks = ctx.state.rippleTicks();
            ctx.record('shiftLeft', { ...posOf(ctx.state), ticks });
            ctx.state.shiftLeftAtCursor(ticks);
            return true;
        },
    },

    // === Placed text ==============================================
    'text.edit': {
        label: 'Add/edit placed text (section label, chord)',
        group: 'Text',
        modes: ['normal'],
        run(ctx) { ctx.hooks.onEditAnnotation?.(); return true; },
    },
    'text.delete': {
        label: 'Delete the placed text here',
        group: 'Text',
        modes: ['normal'],
        run(ctx) {
            ctx.record('deleteAnnotation', posOf(ctx.state));
            ctx.state.deleteAnnotationAtCursor();
            return true;
        },
    },

    // === Grid =====================================================
    'grid.quarter': gridAction(DURATIONS.quarter, 'Quarter grid'),
    'grid.eighth': gridAction(DURATIONS.eighth, 'Eighth grid'),
    'grid.sixteenth': gridAction(DURATIONS.sixteenth, 'Sixteenth grid'),
    'grid.thirtySecond': gridAction(DURATIONS.thirtySecond, '32nd grid'),
    'grid.triplet': gridAction(DURATIONS.tripletEighth, 'Triplet grid'),
    'grid.coarser': {
        label: 'Coarser grid',
        group: 'Grid',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            const i = GRID_LADDER.indexOf(ctx.state.gridSubdivision);
            const next = i < 0 ? DURATIONS.eighth
                : GRID_LADDER[Math.min(GRID_LADDER.length - 1, i + 1)];
            ctx.record('setGridSubdivision', { subdivision: next });
            ctx.state.setGridSubdivision(next);
            return true;
        },
    },
    'grid.finer': {
        label: 'Finer grid',
        group: 'Grid',
        modes: ['normal', 'visual'],
        repeatable: true,
        run(ctx) {
            const i = GRID_LADDER.indexOf(ctx.state.gridSubdivision);
            const next = i < 0 ? DURATIONS.sixteenth
                : GRID_LADDER[Math.max(0, i - 1)];
            ctx.record('setGridSubdivision', { subdivision: next });
            ctx.state.setGridSubdivision(next);
            return true;
        },
    },
    'grid.toggle': {
        label: 'Show/hide the grid',
        group: 'Grid',
        modes: ['normal', 'visual'],
        run(ctx) {
            ctx.record('toggleGrid');
            ctx.state.toggleGrid();
            return true;
        },
    },

    // === Entry state ==============================================
    'entry.autoAdvance': {
        label: 'Auto-advance after a note on/off',
        group: 'Entry',
        modes: ['normal'],
        run(ctx) {
            ctx.record('toggleAutoAdvance');
            ctx.state.toggleAutoAdvance();
            return true;
        },
    },

    // === Undo / repeat / save =====================================
    'edit.undo': {
        label: 'Undo',
        group: 'Edit',
        modes: ['*'],
        repeatable: true,
        run(ctx) { ctx.record('undo'); ctx.state.undo(); return true; },
    },
    'edit.redo': {
        label: 'Redo',
        group: 'Edit',
        modes: ['*'],
        repeatable: true,
        run(ctx) { ctx.record('redo'); ctx.state.redo(); return true; },
    },
    'edit.repeatLast': {
        label: 'Repeat the last edit',
        group: 'Edit',
        modes: ['normal'],
        repeatable: true,
        run(ctx) {
            ctx.record('repeatLastAction');
            ctx.state.repeatLastAction();
            return true;
        },
    },
    'edit.save': {
        label: 'Download / save',
        group: 'Edit',
        modes: ['*'],
        run(ctx) { ctx.hooks.onSave?.(); return true; },
    },

    // === Playback =================================================
    'play.toggle': {
        label: 'Play / stop',
        group: 'Play',
        modes: ['*'],
        run(ctx) {
            if (ctx.hooks.onTogglePlay) ctx.hooks.onTogglePlay();
            else ctx.hooks.onPlayFromCursor?.();
            return true;
        },
    },
    'play.fromCursor': {
        label: 'Play from the cursor',
        group: 'Play',
        modes: ['*'],
        run(ctx) { ctx.hooks.onPlayFromCursor?.(); return true; },
    },
    'play.measure': {
        label: 'Play this measure',
        group: 'Play',
        modes: ['*'],
        run(ctx) {
            if (ctx.hooks.onPlayMeasure) ctx.hooks.onPlayMeasure();
            else ctx.hooks.onPlayFromCursor?.();
            return true;
        },
    },
    'play.loop': {
        label: 'Loop the selection',
        group: 'Play',
        modes: ['*'],
        run(ctx) { ctx.hooks.onLoopSelection?.(); return true; },
    },

    // === Modes ====================================================
    'mode.annotation': {
        label: 'Note-mark mode (fingering, effects)',
        group: 'Modes',
        modes: ['normal'],
        run(ctx) {
            ctx.record('setMode', { mode: EditorMode.ANNOTATION });
            ctx.state.setMode(EditorMode.ANNOTATION);
            return true;
        },
    },
    'mode.normal': {
        label: 'Back to normal / cancel',
        group: 'Modes',
        modes: ['*'],
        run(ctx) {
            if (ctx.state.mode !== EditorMode.NORMAL) {
                ctx.record('setMode', { mode: EditorMode.NORMAL });
                ctx.state.setMode(EditorMode.NORMAL);
            }
            ctx.reset?.();
            ctx.cursor.update();
            return true;
        },
    },

    // === Help =====================================================
    'help.toggle': {
        label: 'Keyboard shortcuts',
        group: 'Help',
        modes: ['*'],
        run(ctx) { ctx.hooks.onShowHelp?.(); return true; },
    },
};

// ----------------------------------------------------------------------
// PRESETS
// ----------------------------------------------------------------------

/**
 * TablEdit — the default. Every key here is a TablEdit key except where
 * the browser, the OS or an internal collision forced a change; those are
 * listed in `exceptions` and printed at the foot of the `?` overlay.
 */
const TABLEDIT = {
    id: 'tabledit',
    label: 'TablEdit',
    // No count prefix: TablEdit has a go-to-measure dialog (Ctrl+G here),
    // and every digit in NORMAL is a fret.
    countPrefix: [],
    bindings: {
        normal: [
            { keys: '0-9', action: 'note.fret' },
            { keys: 'Shift+0-9', action: 'note.fret.stack' },
            { keys: 'f', action: 'note.fret.high' },

            { keys: 'ArrowLeft', action: 'nav.left' },
            { keys: 'ArrowRight', action: 'nav.right' },
            { keys: 'ArrowUp', action: 'nav.stringUp' },
            { keys: 'ArrowDown', action: 'nav.stringDown' },
            // vim muscle memory, deliberately unadvertised in this preset
            { keys: 'k', action: 'nav.stringUp', hidden: true },
            { keys: 'j', action: 'nav.stringDown', hidden: true },
            { keys: 'Shift+ArrowLeft', action: 'select.extendLeft' },
            { keys: 'Shift+ArrowRight', action: 'select.extendRight' },
            { keys: 'Shift+ArrowUp', action: 'select.extendUp' },
            { keys: 'Shift+ArrowDown', action: 'select.extendDown' },
            { keys: 'Ctrl+ArrowLeft', action: 'nav.measureEdgeLeft' },
            { keys: 'Ctrl+ArrowRight', action: 'nav.measureEdgeRight' },
            { keys: 'Ctrl+ArrowUp', action: 'nav.firstString' },
            { keys: 'Ctrl+ArrowDown', action: 'nav.lastString' },
            { keys: 'Home', action: 'nav.measureStart' },
            { keys: 'End', action: 'nav.measureEnd' },
            { keys: 'Ctrl+Home', action: 'nav.docStart' },
            { keys: 'Ctrl+End', action: 'nav.docEnd' },
            { keys: 'Tab', action: 'nav.advance' },
            { keys: 'Shift+Tab', action: 'nav.retreat' },
            { keys: '.', action: 'nav.advance' },
            { keys: 'Enter', action: 'nav.nextMeasure' },
            { keys: ',', action: 'nav.prevNote' },
            { keys: ';', action: 'nav.nextNote' },
            { keys: 'Ctrl+g', action: 'nav.goToMeasure' },
            { keys: 'Ctrl+Space', action: 'entry.autoAdvance' },

            { keys: 'F4', action: 'duration.whole' },
            { keys: 'F5', action: 'duration.half' },
            { keys: 'q', action: 'duration.quarter' },
            { keys: 'F7', action: 'duration.eighth' },
            { keys: 'F8', action: 'duration.sixteenth' },
            { keys: 'F9', action: 'duration.thirtySecond' },
            { keys: 'W', action: 'duration.whole', hidden: true },
            { keys: 'H', action: 'duration.half', hidden: true },
            { keys: 'e', action: 'duration.eighth', hidden: true },
            { keys: '=', action: 'duration.auto' },
            { keys: 'Ctrl+.', action: 'duration.dotted' },
            { keys: 'Ctrl+3', action: 'duration.triplet' },
            { keys: '<', action: 'duration.shorter' },
            { keys: '>', action: 'duration.longer' },
            { keys: '*', action: 'duration.applyToSelection' },
            { keys: 'J', action: 'duration.fix' },
            { keys: 'Ctrl+j', action: 'duration.fix', hidden: true },

            { keys: 'h', action: 'effect.hammer' },
            { keys: 'p', action: 'effect.pull' },
            { keys: 's', action: 'effect.slide' },
            { keys: 'm', action: 'effect.dead' },
            { keys: 'c', action: 'effect.choke' },
            { keys: 'l', action: 'effect.tie' },
            { keys: 'n', action: 'effect.clear' },
            { keys: 'F3', action: 'effect.repeatLast' },
            { keys: 'Ctrl+h', action: 'effect.pendingHammer' },
            { keys: 'Ctrl+p', action: 'effect.pendingPull' },
            { keys: 'Ctrl+/', action: 'effect.pendingSlide' },

            { keys: 't', action: 'text.edit' },
            { keys: 'T', action: 'text.delete' },

            { keys: '+', action: 'note.fretUp' },
            { keys: '-', action: 'note.fretDown' },
            { keys: 'Alt+ArrowUp', action: 'note.restringUp' },
            { keys: 'Alt+ArrowDown', action: 'note.restringDown' },
            { keys: 'Ctrl+=', action: 'note.restringUp' },
            { keys: 'Ctrl+-', action: 'note.restringDown' },

            { keys: 'Insert', action: 'measure.insertBefore' },
            { keys: 'Ctrl+Shift+M', action: 'measure.insertBefore', hidden: true },
            { keys: 'Ctrl+m', action: 'measure.insertAfter' },
            { keys: 'Delete', action: 'note.deleteOrMeasure' },
            { keys: 'Backspace', action: 'note.backspace' },
            { keys: 'Alt+Insert', action: 'measure.rippleRight' },
            { keys: 'Alt+Delete', action: 'measure.rippleLeft' },
            { keys: 'Ctrl+Shift+ArrowRight', action: 'measure.rippleRight', hidden: true },
            { keys: 'Ctrl+Shift+ArrowLeft', action: 'measure.rippleLeft', hidden: true },
            { keys: 'r', action: 'measure.repeatPrevious' },

            { keys: 'Ctrl+a', action: 'select.measureOrAll' },
            { keys: 'v', action: 'select.visual' },
            { keys: 'Ctrl+c', action: 'clip.copy' },
            { keys: 'Ctrl+x', action: 'clip.cut' },
            { keys: 'Ctrl+v', action: 'clip.paste' },

            { keys: 'u', action: 'edit.undo', hidden: true },

            { keys: '[', action: 'grid.coarser' },
            { keys: ']', action: 'grid.finer' },
            { keys: '#', action: 'grid.triplet' },
            { keys: '\\', action: 'grid.toggle' },

            { keys: 'A', action: 'mode.annotation' },
        ],
        visual: [
            { keys: 'ArrowLeft', action: 'nav.left' },
            { keys: 'ArrowRight', action: 'nav.right' },
            { keys: 'ArrowUp', action: 'nav.stringUp' },
            { keys: 'ArrowDown', action: 'nav.stringDown' },
            { keys: 'Shift+ArrowLeft', action: 'select.extendLeft' },
            { keys: 'Shift+ArrowRight', action: 'select.extendRight' },
            { keys: 'Shift+ArrowUp', action: 'select.extendUp' },
            { keys: 'Shift+ArrowDown', action: 'select.extendDown' },
            { keys: 'Ctrl+a', action: 'select.measureOrAll' },
            { keys: 'Delete', action: 'select.delete' },
            { keys: 'Backspace', action: 'select.delete' },
            { keys: 'Ctrl+c', action: 'clip.copyExit', hidden: true },
            { keys: 'Ctrl+x', action: 'clip.cut' },
            { keys: 'Ctrl+v', action: 'clip.paste' },
            { keys: '<', action: 'duration.shorter' },
            { keys: '>', action: 'duration.longer' },
            { keys: '*', action: 'duration.applyToSelection' },
            { keys: 'J', action: 'duration.fix' },
            { keys: 'Ctrl+j', action: 'duration.fix', hidden: true },
            { keys: 'h', action: 'effect.hammer' },
            { keys: 'p', action: 'effect.pull' },
            { keys: 's', action: 'effect.slide' },
            { keys: 'm', action: 'effect.dead' },
            { keys: 'c', action: 'effect.choke' },
            { keys: 'n', action: 'effect.clear' },
        ],
        annotation: [
            { keys: 't', action: 'finger.thumb' },
            { keys: 'i', action: 'finger.index' },
            { keys: 'm', action: 'finger.middle' },
            { keys: 'h', action: 'annotate.hammer' },
            { keys: 'p', action: 'annotate.pull' },
            { keys: '/', action: 'annotate.slide' },
            { keys: '~', action: 'annotate.tie' },
            { keys: 'x', action: 'annotate.clear' },
            { keys: ',', action: 'nav.prevNote' },
            { keys: ';', action: 'nav.nextNote' },
            { keys: 'ArrowLeft', action: 'nav.prevNote', hidden: true },
            { keys: 'ArrowRight', action: 'nav.nextNote', hidden: true },
        ],
        // Mode-independent: available in NORMAL, VISUAL and ANNOTATION
        // alike, so Ctrl+Z still undoes while you are marking fingering.
        global: [
            { keys: 'Ctrl+s', action: 'edit.save' },
            { keys: 'Ctrl+z', action: 'edit.undo' },
            { keys: 'Ctrl+y', action: 'edit.redo' },
            { keys: 'Ctrl+Shift+Z', action: 'edit.redo', hidden: true },
            { keys: 'Space', action: 'play.toggle' },
            { keys: 'Shift+Space', action: 'play.fromCursor' },
            { keys: 'F10', action: 'play.measure' },
            { keys: 'Ctrl+l', action: 'play.loop' },
            { keys: 'L', action: 'play.loop', hidden: true },
            { keys: '?', action: 'help.toggle' },
            { keys: 'Escape', action: 'mode.normal' },
        ],
    },
    exceptions: [
        'F6 (quarter note) is the browser’s address bar — quarter is q here.',
        'F11 (play selection) is fullscreen — loop is Ctrl+L, or L.',
        'Ctrl+T is a new browser tab and is never bound; the tie is l.',
        'Ctrl+↑/↓ (first/last string) is Mission Control on macOS — Home/End reach the measure edges, and Alt+↑/↓ re-strings a note.',
        'Ctrl+Alt+F4 (automatic duration) is =.',
        'TablEdit’s Shift+A…J (frets 10–19) is not bound: A, H, J and T are needed elsewhere. Type the two digits instead — 1 then 2 gives fret 12 — or f then two digits.',
    ],
};

/** vim — today’s bindings, plus the `a` operator for effects. Opt-in. */
const VIM = {
    id: 'vim',
    label: 'vim',
    // `g` starts a count: g12G, g3w, g4.
    countPrefix: ['g'],
    bindings: {
        normal: [
            { keys: '0-9', action: 'note.fret' },
            { keys: 'Shift+0-9', action: 'note.fret.stack' },
            { keys: 'f', action: 'note.fret.high' },

            { keys: 'h', action: 'nav.left' },
            { keys: 'l', action: 'nav.right' },
            { keys: 'k', action: 'nav.stringUp' },
            { keys: 'j', action: 'nav.stringDown' },
            { keys: 'ArrowLeft', action: 'nav.left' },
            { keys: 'ArrowRight', action: 'nav.right' },
            { keys: 'ArrowUp', action: 'nav.stringUp' },
            { keys: 'ArrowDown', action: 'nav.stringDown' },
            { keys: 'Shift+ArrowLeft', action: 'select.extendLeft' },
            { keys: 'Shift+ArrowRight', action: 'select.extendRight' },
            { keys: 'Shift+ArrowUp', action: 'select.extendUp' },
            { keys: 'Shift+ArrowDown', action: 'select.extendDown' },
            { keys: 'w', action: 'nav.beatForward' },
            { keys: 'b', action: 'nav.beatBack' },
            { keys: 'Space', action: 'nav.advance' },
            { keys: 'Tab', action: 'nav.advance', hidden: true },
            { keys: 'Shift+Tab', action: 'nav.retreat', hidden: true },
            { keys: 'Enter', action: 'nav.nextMeasure' },
            { keys: '^', action: 'nav.measureStart' },
            { keys: '$', action: 'nav.measureEnd' },
            { keys: 'Ctrl+ArrowLeft', action: 'nav.measureEdgeLeft', hidden: true },
            { keys: 'Ctrl+ArrowRight', action: 'nav.measureEdgeRight', hidden: true },
            { keys: 'K', action: 'nav.firstString' },
            { keys: 'Ctrl+ArrowUp', action: 'nav.firstString', hidden: true },
            { keys: 'Ctrl+ArrowDown', action: 'nav.lastString', hidden: true },
            { keys: 'g g', action: 'nav.docStart' },
            { keys: 'G', action: 'nav.docEnd' },
            { keys: ',', action: 'nav.prevNote' },
            { keys: ';', action: 'nav.nextNote' },
            { keys: 'Ctrl+g', action: 'nav.goToMeasure' },
            { keys: 'Ctrl+Space', action: 'entry.autoAdvance' },

            { keys: 'q', action: 'duration.quarter' },
            { keys: 'e', action: 'duration.eighth' },
            { keys: 's', action: 'duration.sixteenth' },
            { keys: 't', action: 'duration.thirtySecond' },
            { keys: 'W', action: 'duration.whole' },
            { keys: 'H', action: 'duration.half' },
            { keys: '=', action: 'duration.auto' },
            { keys: 'Ctrl+.', action: 'duration.dotted' },
            { keys: 'Ctrl+3', action: 'duration.triplet' },
            { keys: '<', action: 'duration.shorter' },
            { keys: '>', action: 'duration.longer' },
            { keys: '*', action: 'duration.applyToSelection' },
            { keys: 'J', action: 'duration.fix' },

            { keys: 'a h', action: 'effect.hammer' },
            { keys: 'a p', action: 'effect.pull' },
            { keys: 'a /', action: 'effect.slide' },
            { keys: 'a ~', action: 'effect.tie' },
            { keys: 'a x', action: 'effect.dead' },
            { keys: 'a b', action: 'effect.choke' },
            { keys: 'a n', action: 'effect.clear' },
            { keys: 'a .', action: 'effect.repeatLast' },
            { keys: 'F3', action: 'effect.repeatLast', hidden: true },
            { keys: 'a t', action: 'finger.thumb' },
            { keys: 'a i', action: 'finger.index' },
            { keys: 'a m', action: 'finger.middle' },
            { keys: 'Ctrl+h', action: 'effect.pendingHammer' },
            { keys: 'Ctrl+p', action: 'effect.pendingPull' },
            { keys: 'Ctrl+/', action: 'effect.pendingSlide' },

            { keys: 'c', action: 'text.edit' },
            { keys: 'C', action: 'text.delete' },

            { keys: '+', action: 'note.fretUp' },
            { keys: '-', action: 'note.fretDown' },
            { keys: 'Alt+ArrowUp', action: 'note.restringUp' },
            { keys: 'Alt+ArrowDown', action: 'note.restringDown' },

            { keys: 'x', action: 'note.delete' },
            { keys: 'd d', action: 'note.deleteTick' },
            { keys: 'd m', action: 'measure.delete' },
            { keys: 'D', action: 'note.deleteToMeasureEnd' },
            { keys: 'Delete', action: 'note.deleteOrMeasure' },
            { keys: 'Backspace', action: 'note.backspace' },
            { keys: 'o', action: 'measure.insertAfter' },
            { keys: 'O', action: 'measure.insertBefore' },
            { keys: 'R', action: 'measure.repeatPrevious' },
            { keys: 'Alt+Insert', action: 'measure.rippleRight' },
            { keys: 'Alt+Delete', action: 'measure.rippleLeft' },

            { keys: 'v', action: 'select.visual' },
            { keys: 'Ctrl+a', action: 'select.measureOrAll' },
            { keys: 'y', action: 'clip.copy' },
            { keys: 'p', action: 'clip.paste' },
            { keys: 'P', action: 'clip.pasteBefore' },
            { keys: 'Ctrl+c', action: 'clip.copy', hidden: true },
            { keys: 'Ctrl+x', action: 'clip.cut', hidden: true },
            { keys: 'Ctrl+v', action: 'clip.paste', hidden: true },

            { keys: 'u', action: 'edit.undo' },
            { keys: 'Ctrl+r', action: 'edit.redo' },
            { keys: '.', action: 'edit.repeatLast' },

            { keys: '\\', action: 'grid.toggle' },
            { keys: 'Shift+Q', action: 'grid.quarter' },
            { keys: 'Shift+E', action: 'grid.eighth' },
            { keys: 'Shift+S', action: 'grid.sixteenth' },
            { keys: 'Shift+T', action: 'grid.thirtySecond' },
            { keys: '#', action: 'grid.triplet' },
            { keys: '[', action: 'grid.coarser' },
            { keys: ']', action: 'grid.finer' },

            { keys: 'A', action: 'mode.annotation' },
        ],
        visual: [
            { keys: 'h', action: 'nav.left' },
            { keys: 'l', action: 'nav.right' },
            { keys: 'k', action: 'nav.stringUp' },
            { keys: 'j', action: 'nav.stringDown' },
            { keys: 'ArrowLeft', action: 'nav.left' },
            { keys: 'ArrowRight', action: 'nav.right' },
            { keys: 'ArrowUp', action: 'nav.stringUp' },
            { keys: 'ArrowDown', action: 'nav.stringDown' },
            { keys: 'Shift+ArrowLeft', action: 'select.extendLeft' },
            { keys: 'Shift+ArrowRight', action: 'select.extendRight' },
            { keys: 'Shift+ArrowUp', action: 'select.extendUp' },
            { keys: 'Shift+ArrowDown', action: 'select.extendDown' },
            { keys: 'Ctrl+a', action: 'select.measureOrAll' },
            { keys: 'y', action: 'clip.copyExit', hidden: true },
            { keys: 'd', action: 'select.delete' },
            { keys: 'Delete', action: 'select.delete' },
            { keys: 'Backspace', action: 'select.delete' },
            { keys: 'Ctrl+c', action: 'clip.copyExit', hidden: true },
            { keys: 'Ctrl+x', action: 'clip.cut', hidden: true },
            { keys: 'Ctrl+v', action: 'clip.paste', hidden: true },
            { keys: '<', action: 'duration.shorter' },
            { keys: '>', action: 'duration.longer' },
            { keys: '*', action: 'duration.applyToSelection' },
            { keys: 'J', action: 'duration.fix' },
            { keys: 'a h', action: 'effect.hammer' },
            { keys: 'a p', action: 'effect.pull' },
            { keys: 'a /', action: 'effect.slide' },
            { keys: 'a x', action: 'effect.dead' },
            { keys: 'a b', action: 'effect.choke' },
            { keys: 'a n', action: 'effect.clear' },
        ],
        annotation: [
            // No fret entry here, so the effect letters are plain — this
            // is exactly what ANNOTATION mode has always done.
            { keys: 't', action: 'finger.thumb' },
            { keys: 'i', action: 'finger.index' },
            { keys: 'm', action: 'finger.middle' },
            { keys: 'h', action: 'annotate.hammer' },
            { keys: 'p', action: 'annotate.pull' },
            { keys: '/', action: 'annotate.slide' },
            { keys: '~', action: 'annotate.tie' },
            { keys: 'x', action: 'annotate.clear' },
            { keys: ',', action: 'nav.prevNote' },
            { keys: ';', action: 'nav.nextNote' },
            { keys: 'ArrowLeft', action: 'nav.prevNote', hidden: true },
            { keys: 'ArrowRight', action: 'nav.nextNote', hidden: true },
        ],
        // Mode-independent (see the TablEdit preset's note)
        global: [
            { keys: 'Ctrl+s', action: 'edit.save' },
            { keys: 'Ctrl+z', action: 'edit.undo', hidden: true },
            { keys: 'Ctrl+y', action: 'edit.redo', hidden: true },
            { keys: 'Ctrl+Shift+Z', action: 'edit.redo', hidden: true },
            // Shift only changes the CASE of the key, so Ctrl+Shift+R is
            // the same intent (the browser usually eats it — hence hidden)
            { keys: 'Ctrl+Shift+R', action: 'edit.redo', hidden: true },
            { keys: 'Shift+Space', action: 'play.fromCursor' },
            { keys: 'F10', action: 'play.measure' },
            { keys: 'L', action: 'play.loop' },
            { keys: 'Ctrl+l', action: 'play.loop', hidden: true },
            { keys: '?', action: 'help.toggle' },
            { keys: 'Escape', action: 'mode.normal' },
        ],
    },
    exceptions: [
        'A count is introduced by g: g12G goes to measure 12, g3w moves three beats, g4. repeats four times.',
        'Ctrl+T, Ctrl+W, Ctrl+N, F6 and F11 belong to the browser and are never bound.',
    ],
};

export const PRESETS = { tabledit: TABLEDIT, vim: VIM };
export const DEFAULT_PRESET = 'tabledit';

// Freeze a compiled lookup per preset/mode: chord-sequence → binding.
const COMPILED = new Map();

function compile(presetId) {
    if (COMPILED.has(presetId)) return COMPILED.get(presetId);
    const preset = PRESETS[presetId] || PRESETS[DEFAULT_PRESET];
    const modes = {};
    const globals = preset.bindings.global || [];
    for (const [mode, list] of Object.entries(preset.bindings)) {
        // Mode-specific bindings are listed FIRST, so they shadow a
        // global one on the same chord (first writer wins below).
        const merged = mode === 'global' ? list : list.concat(globals);
        const exact = new Map();
        const prefixes = new Set();
        for (const entry of merged) {
            for (const chords of expandKeys(entry.keys)) {
                if (!exact.has(chords)) exact.set(chords, entry);
                const parts = chords.split(' ');
                for (let i = 1; i < parts.length; i++) {
                    prefixes.add(parts.slice(0, i).join(' '));
                }
            }
        }
        modes[mode] = { exact, prefixes, list: merged };
    }
    const compiled = { preset, modes };
    COMPILED.set(presetId, compiled);
    return compiled;
}

/** Lookup table for one mode of one preset. */
export function lookup(presetId, mode) {
    const c = compile(presetId);
    return c.modes[mode] || c.modes.normal;
}

/** Does this preset collect a count after `chord`? */
export function isCountPrefix(presetId, chord) {
    const preset = PRESETS[presetId] || PRESETS[DEFAULT_PRESET];
    return (preset.countPrefix || []).map(canonicalChord).includes(chord);
}

// ----------------------------------------------------------------------
// Introspection: the help overlay, tooltips and the menu bar
// ----------------------------------------------------------------------

/** Order the help columns read in. */
export const GROUP_ORDER = [
    'Notes', 'Navigate', 'Durations', 'Effects', 'Measures', 'Select',
    'Clipboard', 'Text', 'Grid', 'Entry', 'Play', 'Edit', 'Modes',
    'Annotation mode', 'Fingering', 'Help',
];

/**
 * Everything a preset binds, grouped for display.
 * @returns {Array<{group: string, items: Array<{action, label, keys: string[], modes: string[]}>}>}
 */
export function describe(presetId = DEFAULT_PRESET) {
    const preset = PRESETS[presetId] || PRESETS[DEFAULT_PRESET];
    const byAction = new Map();
    for (const [mode, list] of Object.entries(preset.bindings)) {
        for (const entry of list) {
            if (entry.hidden) continue;
            const action = ACTIONS[entry.action];
            if (!action) continue;
            if (!byAction.has(entry.action)) {
                byAction.set(entry.action, {
                    action: entry.action,
                    label: action.label,
                    group: action.group,
                    keys: [],
                    modes: [],
                });
            }
            const item = byAction.get(entry.action);
            const pretty = prettyKeys(entry.keys);
            if (!item.keys.includes(pretty)) item.keys.push(pretty);
            if (!item.modes.includes(mode)) item.modes.push(mode);
        }
    }
    const groups = new Map();
    for (const item of byAction.values()) {
        if (!groups.has(item.group)) groups.set(item.group, []);
        groups.get(item.group).push(item);
    }
    return [...groups.entries()]
        .sort((a, b) => {
            const ia = GROUP_ORDER.indexOf(a[0]);
            const ib = GROUP_ORDER.indexOf(b[0]);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        })
        .map(([group, items]) => ({ group, items }));
}

/**
 * The key to print beside a menu item / tooltip for an action, in the
 * active preset. `null` when the preset doesn’t bind it.
 */
export function keyFor(actionId, presetId = DEFAULT_PRESET, mode = 'normal') {
    const preset = PRESETS[presetId] || PRESETS[DEFAULT_PRESET];
    const order = mode === 'normal'
        ? ['normal', 'global', 'visual', 'annotation']
        : [mode, 'global', 'normal'];
    for (const m of order) {
        for (const entry of preset.bindings[m] || []) {
            if (entry.action === actionId && !entry.hidden) return prettyKeys(entry.keys);
        }
    }
    // Fall back to a hidden alias rather than printing nothing
    for (const list of Object.values(preset.bindings)) {
        for (const entry of list) {
            if (entry.action === actionId) return prettyKeys(entry.keys);
        }
    }
    return null;
}

/** Every chord (expanded) a preset binds, across all modes. */
export function allChords(presetId = DEFAULT_PRESET) {
    const preset = PRESETS[presetId] || PRESETS[DEFAULT_PRESET];
    const out = [];
    for (const list of Object.values(preset.bindings)) {
        for (const entry of list) out.push(...expandKeys(entry.keys));
    }
    return out;
}

// ----------------------------------------------------------------------
// Which preset is active
//
// Lives here rather than on EditorState because the table is what
// consumes it — the toolbar, the menu bar and the help overlay all read
// the preset through `getPreset()` and re-render on `onPresetChange`.
// ----------------------------------------------------------------------

const STORAGE_KEY = 'otf-editor.preset';
const presetListeners = new Set();
let activePreset = null;

function readStoredPreset() {
    try {
        const v = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (v && PRESETS[v]) return v;
    } catch { /* private mode / no storage */ }
    return DEFAULT_PRESET;
}

/** The active preset id (`'tabledit'` by default). */
export function getPreset() {
    if (activePreset == null) activePreset = readStoredPreset();
    return activePreset;
}

/** Switch presets; persists, and notifies every listener. */
export function setPreset(id) {
    if (!PRESETS[id]) return getPreset();
    const changed = id !== getPreset();
    activePreset = id;
    try { globalThis.localStorage?.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
    if (changed) for (const fn of [...presetListeners]) fn(id);
    return id;
}

/** Subscribe to preset changes. @returns {Function} unsubscribe */
export function onPresetChange(fn) {
    presetListeners.add(fn);
    return () => presetListeners.delete(fn);
}

/** Test seam: forget the cached/stored choice. */
export function resetPreset() {
    activePreset = null;
    try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
