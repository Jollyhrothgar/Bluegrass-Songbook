// OTF Editor State Management
//
// UI-session state (cursor, mode, selection, entry duration, grid,
// pending articulation) layered over the UI-free EditingFacade, which
// owns the document, undo history, clipboard, and all mutations.
// Anything that edits the OTF goes through the facade — the mouse/touch
// UI can drive the same facade directly without this class.

import { measureTicksFor } from '../renderers/measure-timing.js';
import {
    EditingFacade,
    MAX_DURATION,
    MIN_DURATION,
    durationKey,
} from './facade.js';

/**
 * Duration constants (in ticks)
 * Based on 480 ticks per beat
 */
export const TICKS_PER_BEAT = 480;

export const DURATIONS = {
    whole: TICKS_PER_BEAT * 4,        // 1920
    half: TICKS_PER_BEAT * 2,         // 960
    quarter: TICKS_PER_BEAT,          // 480
    eighth: TICKS_PER_BEAT / 2,       // 240
    sixteenth: TICKS_PER_BEAT / 4,    // 120
    thirtySecond: TICKS_PER_BEAT / 8, // 60
    tripletEighth: Math.round(TICKS_PER_BEAT / 3), // 160
    // Dotted values need no flag — `dur` is ticks, and the renderer
    // already draws these (122 dotted quarters and 135 dotted eighths on
    // banjo tracks alone). Real for 3/4 and 6/8 waltzes.
    dottedHalf: 1440,
    dottedQuarter: 720,
    dottedEighth: 360,
    dottedSixteenth: 180,
};

export const DURATION_NAMES = {
    [DURATIONS.whole]: 'whole',
    [DURATIONS.half]: 'half',
    [DURATIONS.quarter]: 'quarter',
    [DURATIONS.eighth]: 'eighth',
    [DURATIONS.sixteenth]: 'sixteenth',
    [DURATIONS.thirtySecond]: 'thirty-second',
    [DURATIONS.tripletEighth]: 'triplet-eighth',
    [DURATIONS.dottedHalf]: 'dotted half',
    [DURATIONS.dottedQuarter]: 'dotted quarter',
    [DURATIONS.dottedEighth]: 'dotted eighth',
    [DURATIONS.dottedSixteenth]: 'dotted sixteenth',
};

/**
 * The dotted values `toggleDotted` recognises — including the dotted
 * 32nd (90), which has no DURATIONS entry because nobody picks it from a
 * palette, but is a legal place for the toggle to land and come back from.
 */
export const DOTTED_DURATIONS = new Set([
    90,
    DURATIONS.dottedSixteenth,
    DURATIONS.dottedEighth,
    DURATIONS.dottedQuarter,
    DURATIONS.dottedHalf,
]);

/**
 * Editor mode enum
 * Simplified: NORMAL handles both navigation and note entry
 * - NORMAL: navigate + enter notes + commands (default)
 * - VISUAL: select regions for copy/paste
 * - ANNOTATION: add text annotations (rare)
 */
export const EditorMode = {
    NORMAL: 'normal',
    VISUAL: 'visual',
    ANNOTATION: 'annotation',
};

/**
 * Cursor position in the document
 */
export class CursorPosition {
    constructor(measure = 1, tick = 0, string = 3, trackId = 'banjo') {
        this.measure = measure;
        this.tick = tick;
        this.string = string;
        this.trackId = trackId;
    }

    clone() {
        return new CursorPosition(this.measure, this.tick, this.string, this.trackId);
    }

    equals(other) {
        return this.measure === other.measure &&
               this.tick === other.tick &&
               this.string === other.string &&
               this.trackId === other.trackId;
    }

    /**
     * Get absolute tick position across all measures
     */
    getAbsoluteTick(ticksPerMeasure) {
        return (this.measure - 1) * ticksPerMeasure + this.tick;
    }

    /**
     * Set position from absolute tick
     */
    setFromAbsoluteTick(absTick, ticksPerMeasure) {
        this.measure = Math.floor(absTick / ticksPerMeasure) + 1;
        this.tick = absTick % ticksPerMeasure;
    }
}

/**
 * Selection range (for visual mode)
 */
export class SelectionRange {
    constructor(start, end) {
        this.start = start.clone();
        this.end = end.clone();
    }

    /**
     * Get normalized range (start before end).
     *
     * Accepts either a uniform ticks-per-measure number or a ts-aware
     * `(measure, tick) => absTick` function. Document ops must pass the
     * facade's toAbs: with mid-tune time-signature changes the uniform
     * ordering can disagree with the real timeline, mis-ordering the
     * endpoints and silently emptying a copy/delete.
     */
    getNormalized(ticksPerMeasure) {
        const toAbs = typeof ticksPerMeasure === 'function'
            ? ticksPerMeasure
            : (m, t) => (m - 1) * ticksPerMeasure + t;
        const startAbs = toAbs(this.start.measure, this.start.tick);
        const endAbs = toAbs(this.end.measure, this.end.tick);

        if (startAbs <= endAbs) {
            return { start: this.start.clone(), end: this.end.clone() };
        }
        return { start: this.end.clone(), end: this.start.clone() };
    }
}

/**
 * Main editor state management
 */
export class EditorState {
    constructor(options = {}) {
        // Event listeners (created first: facade forwarding needs them)
        this._listeners = new Map();
        this._suppressForward = false;

        // Editing facade — owns the OTF document, undo history, clipboard
        const otf = options.otf || this._createEmptyOTF(options.instrument || '5-string-banjo');
        this.facade = new EditingFacade(otf, { trackId: options.trackId });

        // Current track ID
        this.trackId = this.facade.trackId || 'banjo';

        // Cursor position
        this.cursor = new CursorPosition(1, 0, 3, this.trackId);

        // Editor mode
        this.mode = EditorMode.NORMAL;

        // Selection range (for visual mode)
        this.selection = null;

        // Current duration for note entry. `null` means AUTOMATIC — the
        // column rule computes each note's dur from where it lands (see
        // setAutoDuration / effectiveDuration). Anything that needs a
        // number must read effectiveDuration(), never this field raw.
        this.currentDuration = DURATIONS.eighth;

        // What `setAutoDuration(false)` goes back to.
        this._lastExplicitDuration = DURATIONS.eighth;

        // Duration bookkeeping for automatic duration. SESSION STATE —
        // neither set is ever written to the document (OTF has no
        // "manual duration" flag and must not grow one):
        //   pinned      durations the user set by hand; auto never touches them
        //   autoEntered notes typed under auto THIS session; auto touches
        //               only these, so a reopened document is never re-timed
        // Keys are facade `durationKey(measure, tick, string)` strings.
        this.pinnedDurations = new Set();
        this.autoEnteredDurations = new Set();

        // Auto-advance: does typing a fret move the cursor on? TablEdit
        // makes this a toggle (chord entry wants it off); we default it
        // on, which is what this editor has always done.
        this.autoAdvance = true;

        // Pending articulation (applied to next note)
        this.pendingArticulation = null;

        // Last technique applied — TablEdit's F3 "repeat last effect".
        // '~' is stored as the string '~' meaning TIE, which is not a
        // tech at all (see toggleTieAtCursor).
        this.lastTech = null;

        // Triplet entry state
        this.tripletMode = false;
        this.tripletCount = 0;

        // Grid subdivision (for cursor snap/movement)
        this.gridSubdivision = DURATIONS.eighth;

        // Grid visibility
        this.showGrid = true;

        // Undo history view (facade owns the real history)
        this.history = {
            canUndo: () => this.facade.canUndo(),
            canRedo: () => this.facade.canRedo(),
            clear: () => this.facade.clearHistory(),
        };

        // Last action (for repeat with .)
        this.lastAction = null;

        // Forward facade events to this emitter
        this.facade.on('change', (doc) => {
            if (this._suppressForward) return;
            this._updateTicksPerMeasure();
            this._emit('change', doc);
        });
        // The facade can change the current track on its own — renaming
        // it, or undoing a rename back onto a name this object still
        // holds a stale copy of. Follow it, cursor included, or the next
        // edit lands in a notation bucket nobody renders.
        this.facade.on('trackChange', (id) => {
            if (this._suppressForward || !id || id === this.trackId) return;
            this.trackId = id;
            this.cursor.trackId = id;
            this._emit('trackChange', id);
        });
        this.facade.on('undo', () => { if (!this._suppressForward) this._emit('undo'); });
        this.facade.on('redo', () => { if (!this._suppressForward) this._emit('redo'); });
        this.facade.on('clipboardChange', (c) => {
            if (!this._suppressForward) this._emit('clipboardChange', c);
        });

        // Calculate ticks per measure from time signature
        this._updateTicksPerMeasure();
    }

    /** The OTF document lives in the facade. */
    get otf() {
        return this.facade.otf;
    }

    set otf(value) {
        this.facade.otf = value;
        this.facade._invalidateTiming();
    }

    /** Clipboard lives in the facade (shared with any other UI). */
    get clipboard() {
        return this.facade.clipboard;
    }

    set clipboard(value) {
        this.facade.clipboard = value;
    }

    /**
     * Create empty OTF document
     */
    _createEmptyOTF(instrument) {
        const instrumentConfigs = {
            '5-string-banjo': {
                strings: 5,
                tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
            },
            '6-string-guitar': {
                strings: 6,
                tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
            },
            'mandolin': {
                strings: 4,
                tuning: ['E5', 'A4', 'D4', 'G3'],
            },
            'upright-bass': {
                strings: 4,
                tuning: ['G2', 'D2', 'A1', 'E1'],
            },
        };

        const config = instrumentConfigs[instrument] || instrumentConfigs['5-string-banjo'];
        const trackId = instrument.replace(/-/g, '_').replace(/\d+_string_/, '');

        return {
            otf_version: '1.0',
            metadata: {
                title: 'Untitled',
                time_signature: '4/4',
                tempo: 120,
            },
            timing: {
                ticks_per_beat: TICKS_PER_BEAT,
            },
            tracks: [{
                id: trackId,
                instrument: instrument,
                tuning: config.tuning,
                capo: 0,
                role: 'lead',
            }],
            notation: {
                [trackId]: [{
                    measure: 1,
                    events: [],
                }],
            },
        };
    }

    /**
     * Update ticks per measure from time signature (den-aware: a 2/2
     * measure is 1920 ticks, not 960 — see measure-timing.js)
     *
     * NB: this is the UNIFORM measure length used by cursor/grid math.
     * Document mutations are ts-aware via the facade; cursor ts-awareness
     * lands with the UI passes.
     */
    _updateTicksPerMeasure() {
        const timeSig = this.otf.metadata?.time_signature || '4/4';
        const ticksPerBeat = this.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;
        this.ticksPerMeasure = measureTicksFor(timeSig, ticksPerBeat);
    }

    /**
     * Load an OTF document
     */
    load(otf) {
        this._suppressForward = true;
        this.facade.load(otf);
        this._suppressForward = false;

        this.trackId = this.facade.trackId || 'banjo';
        this.cursor = new CursorPosition(1, 0, 3, this.trackId);
        this.selection = null;
        this.mode = EditorMode.NORMAL;
        // A loaded document starts with NO auto bookkeeping: you didn't
        // type those notes, so automatic duration leaves every one of
        // them exactly as written until you ask for `fixDurations`.
        this.pinnedDurations.clear();
        this.autoEnteredDurations.clear();
        this._updateTicksPerMeasure();
        this._emit('load', this.otf);
        this._emit('change', this.otf);
    }

    /**
     * Switch which track is being edited (multi-track OTFs). Resets the
     * cursor to the track's start and clears any selection.
     * @returns {boolean} false for unknown track ids
     */
    setTrack(trackId) {
        if (!this.otf.tracks.some(t => t.id === trackId)) return false;
        if (trackId === this.trackId) return true;
        // Claim the id BEFORE the facade emits, so the trackChange
        // forwarder above sees it as already-synced and this method stays
        // the single source of the event.
        this.trackId = trackId;
        this.facade.setTrack(trackId);
        this.selection = null;
        this.mode = EditorMode.NORMAL;
        this.cursor = new CursorPosition(1, 0,
            Math.min(3, this.getStringCount()), trackId);
        this._emit('trackChange', trackId);
        this._emit('change', this.otf);
        return true;
    }

    /**
     * Get current track
     */
    getCurrentTrack() {
        return this.otf.tracks.find(t => t.id === this.trackId);
    }

    // ------------------------------------------------------------------
    // Track identity and order (facade ops; see facade.js for WHY a
    // rename moves the notation and a reorder does not)
    // ------------------------------------------------------------------

    /** The document's tracks, in document order. First = the site's lead. */
    getTracks() {
        return this.otf.tracks || [];
    }

    /** Position of a track in `tracks[]` (-1 when unknown). */
    getTrackIndex(trackId = this.trackId) {
        return this.facade.trackIndex(trackId);
    }

    /**
     * Rename a track (the current one by default). The track stays
     * selected under its new name — the facade re-points itself and this
     * object follows via the trackChange forwarder. Undoable.
     *
     * @returns {boolean} false when nothing changed
     * @throws {Error} when another track already has that name
     */
    renameTrack(newId, trackId = this.trackId) {
        const changed = this.facade.renameTrack(trackId, newId) !== false;
        if (changed) this._emit('tracksChange', this.getTracks());
        return changed;
    }

    /**
     * Move a track `delta` places through `tracks[]` (-1 earlier, +1
     * later). Order is what makes a track the lead, so moving one to the
     * front is how you say "this is the lead". Undoable.
     *
     * @returns {boolean} false at the ends (nothing moved)
     */
    moveTrack(delta, trackId = this.trackId) {
        const from = this.facade.trackIndex(trackId);
        if (from === -1) return false;
        const changed = this.facade.moveTrack(trackId, from + delta) !== false;
        if (changed) this._emit('tracksChange', this.getTracks());
        return changed;
    }

    /**
     * Get notation for current track
     */
    getNotation() {
        return this.otf.notation[this.trackId] || [];
    }

    /**
     * Get number of strings for current instrument
     */
    getStringCount() {
        return this.facade.stringCount(this.trackId) || 5;
    }

    /**
     * Get measure by number
     */
    getMeasure(measureNum) {
        const notation = this.getNotation();
        return notation.find(m => m.measure === measureNum);
    }

    /**
     * Get or create measure
     */
    getOrCreateMeasure(measureNum) {
        return this.facade.getOrCreateMeasure(measureNum, this.trackId);
    }

    /**
     * Get total measure count
     */
    getMeasureCount() {
        const notation = this.getNotation();
        if (notation.length === 0) return 1;
        return Math.max(...notation.map(m => m.measure));
    }

    /**
     * Get note at cursor position
     */
    getNoteAtCursor() {
        const measure = this.getMeasure(this.cursor.measure);
        if (!measure) return null;

        const event = measure.events.find(e => e.tick === this.cursor.tick);
        if (!event) return null;

        return event.notes.find(n => n.s === this.cursor.string);
    }

    /**
     * Get event at cursor tick
     */
    getEventAtCursor() {
        const measure = this.getMeasure(this.cursor.measure);
        if (!measure) return null;
        return measure.events.find(e => e.tick === this.cursor.tick);
    }

    /**
     * Insert a note at cursor position
     * If the note duration exceeds the measure boundary, the facade
     * splits it into tie-continued notes (ts-aware).
     */
    insertNote(fret, options = {}) {
        const string = options.string || this.cursor.string;
        const tech = options.tech || this.pendingArticulation;
        // `duration: null` (or nothing) under auto means "let the column
        // rule decide"; an explicit duration is an explicit duration even
        // while auto is on, and pins the note it lands on.
        const explicit = options.duration != null
            ? options.duration
            : (this.isAutoDuration ? null : this.currentDuration);
        const auto = explicit == null;
        const key = durationKey(this.cursor.measure, this.cursor.tick, string);

        this.facade.insertNote({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string,
            fret,
            duration: explicit,
            tech,
            trackId: this.trackId,
            autoDuration: auto,
            pins: this.pinnedDurations,
            autoEntered: this.autoEnteredDurations,
        });
        if (!auto && this.isAutoDuration) {
            this.autoEnteredDurations.delete(key);
            this.pinnedDurations.add(key);
        }

        // Clear pending articulation
        this.pendingArticulation = null;

        // Handle triplet mode
        if (this.tripletMode) {
            this.tripletCount++;
            if (this.tripletCount >= 3) {
                this.tripletMode = false;
                this.tripletCount = 0;
            }
        }

        // Record action for repeat
        this.lastAction = {
            type: 'insertNote', fret,
            options: { string, tech, duration: explicit },
        };

        this._emit('noteInserted', { measure: this.cursor.measure, tick: this.cursor.tick, fret, string });
    }

    /**
     * Delete note at cursor position
     */
    deleteNote() {
        const ok = this.facade.deleteNote({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        }, this.trackId, this._autoOptions());
        if (ok) this.lastAction = { type: 'deleteNote' };
        return ok;
    }

    /**
     * Delete all notes at current tick
     */
    deleteTick() {
        const ok = this.facade.deleteTick({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
        }, this.trackId, this._autoOptions());
        if (ok) this.lastAction = { type: 'deleteTick' };
        return ok;
    }

    /** The auto-duration bookkeeping every editing op hands the facade. */
    _autoOptions() {
        return {
            autoDuration: this.isAutoDuration,
            pins: this.pinnedDurations,
            autoEntered: this.autoEnteredDurations,
        };
    }

    /**
     * Insert an empty measure AS measureNum (shifts everything at and
     * after it, incl. reading_list and ts changes). Undoable.
     */
    insertMeasure(measureNum) {
        const ok = this.facade.insertMeasure(measureNum);
        if (ok) this.lastAction = { type: 'insertMeasure', measureNum };
        return ok;
    }

    /**
     * Delete every event from the cursor tick to the end of the
     * cursor's measure (current track). Undoable.
     */
    deleteToMeasureEnd() {
        const m = this.cursor.measure;
        const start = this.facade.toAbs(m, this.cursor.tick);
        const end = this.facade.toAbs(m, 0) + this.facade.ticksFor(m);
        const ok = this.facade.deleteRange(start, end, { trackId: this.trackId });
        if (ok) this.lastAction = { type: 'deleteToMeasureEnd' };
        return ok;
    }

    /**
     * Set the document tempo (quarter-note BPM). Undoable.
     */
    setTempo(bpm) {
        return this.facade.setTempo(bpm);
    }

    /**
     * Set a fingering annotation on the note at the cursor. Undoable.
     */
    setFingering(finger) {
        return this.facade.setFingering({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        }, finger, this.trackId);
    }

    // ------------------------------------------------------------------
    // Placed free-text annotations, anchored to the CURSOR.
    //
    // These are the document's `annotations` ("PART A", "Long Choke",
    // chord names) — score-level text, not the per-note fingering the
    // ANNOTATION *mode* deals in. They live in one place only, the
    // facade's document, so undo/redo covers them like every other edit.
    // ------------------------------------------------------------------

    /**
     * How far from the cursor a placed text still counts as "here" when
     * you ask to edit one: a beat. Coarse enough to catch the label you
     * are looking at, tight enough that a bar's other labels are safe.
     */
    get annotationReach() {
        return this.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;
    }

    /**
     * The annotation at (or within a beat of) the cursor.
     * @returns {{index: number, annotation: Object}|null}
     */
    getAnnotationAtCursor() {
        const index = this.facade.findAnnotationIndex(
            { measure: this.cursor.measure, tick: this.cursor.tick },
            { maxTicks: this.annotationReach });
        if (index === -1) return null;
        return { index, annotation: this.facade.annotations()[index] };
    }

    /**
     * Write text at the cursor: retext the annotation already there, or
     * place a new one. Empty text deletes the existing one (and adds
     * nothing when there is none). Undoable.
     * @returns {boolean} false when nothing changed
     */
    setAnnotationAtCursor(text) {
        const found = this.getAnnotationAtCursor();
        if (found) return this.facade.setAnnotationText(found.index, text) !== false;
        return this.facade.addAnnotation({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            text,
        }) !== false;
    }

    /**
     * Delete the annotation at/nearest the cursor. Undoable.
     * @returns {boolean} false when there was none
     */
    deleteAnnotationAtCursor() {
        const found = this.getAnnotationAtCursor();
        if (!found) return false;
        return this.facade.deleteAnnotation(found.index) !== false;
    }

    /**
     * Add articulation to the note at the cursor. `'~'` is not a
     * technique — the facade routes it to the tie. Remembered as
     * `lastTech` for TablEdit's "repeat last effect".
     */
    addArticulation(tech) {
        const ok = this.facade.setArticulation({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        }, tech, this.trackId);
        if (tech) {
            this.lastTech = tech;
            this.lastAction = { type: 'addArticulation', tech };
        }
        return ok;
    }

    /**
     * Remove articulation from note at cursor
     */
    removeArticulation() {
        return this.facade.setArticulation({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        }, null, this.trackId);
    }

    /**
     * Clear EVERY effect on the note at the cursor — technique and tie
     * alike, which is what TablEdit's `N` does. `tech` and `tie` are
     * independent fields (neither op clears the other's, deliberately),
     * so the clear has to name both; `facade.transact` makes the pair one
     * undo step. Refused — no history entry — when there is nothing set.
     * @returns {boolean} true when something was cleared
     */
    clearEffectsAtCursor() {
        const note = this.getNoteAtCursor();
        if (!note) return false;
        if (note.tech === undefined && note.tie !== true) return false;
        const pos = {
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        };
        return this.facade.transact('Clear effects', () => {
            const tech = this.facade.setArticulation(pos, null, this.trackId) !== false;
            const tie = this.facade.setTie(pos, false, { trackId: this.trackId }) !== false;
            return tech || tie;
        }) !== false;
    }

    /**
     * Set mode
     */
    setMode(mode) {
        const oldMode = this.mode;
        this.mode = mode;

        // Clear selection when leaving visual mode
        if (oldMode === EditorMode.VISUAL && mode !== EditorMode.VISUAL) {
            this.selection = null;
        }

        // Start selection when entering visual mode
        if (mode === EditorMode.VISUAL && oldMode !== EditorMode.VISUAL) {
            this.selection = new SelectionRange(this.cursor, this.cursor);
        }

        this._emit('modeChange', { oldMode, newMode: mode });
    }

    /**
     * Set current duration (the length of notes you ENTER; the grid is
     * the movement/ruler increment). Minimal coupling — REFINE ONLY:
     * the grid changes only when it cannot express the selected
     * duration's positions (divisibility check, so triplet and straight
     * grids trade correctly). Coarser durations never touch your grid —
     * quarters place fine on a 1/16 ruler — and explicit grid buttons
     * are absolute. This keeps the one hard invariant (what you
     * selected is always placeable via click/arrows) without churning
     * the ruler on every duration change during mixed-value entry.
     */
    setDuration(duration) {
        // null = AUTOMATIC. Nothing to place, nothing to refine: under
        // auto the GRID is the rhythm input, so the grid is left exactly
        // where the user put it.
        if (duration == null) {
            this.currentDuration = null;
            this._emit('durationChange', null);
            return;
        }
        this.currentDuration = duration;
        this._lastExplicitDuration = duration;
        // TablEdit's `*` folded in: with a note under the cursor, a
        // duration key re-times THAT note as well as arming the next one,
        // and pins it so automatic duration will not take it back.
        const pos = {
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        };
        if (this.getNoteAtCursor()) {
            this.facade.setNoteDuration(pos, duration, this.trackId);
            this.pinDuration(pos);
        }
        this._emit('durationChange', duration);
        const needed = Math.min(duration, DURATIONS.quarter);
        if (needed % this.gridSubdivision !== 0) {
            this.setGridSubdivision(needed);
        }
    }

    // ------------------------------------------------------------------
    // Automatic duration (§6 of the input-parity plan)
    //
    // `currentDuration === null` IS auto — TablEdit's semantics exactly
    // ("auto is the absence of a chosen duration"). The column rule and
    // the pin/autoEntered sets live in the facade; this class owns the
    // sets, the toggle and the prediction the status bar shows.
    // ------------------------------------------------------------------

    /** True when note entry is letting the column rule pick durations. */
    get isAutoDuration() {
        return this.currentDuration == null;
    }

    /**
     * Turn automatic duration on or off. Off restores the last duration
     * you actually chose (an eighth, until you choose one).
     * @returns {boolean} the new auto state
     */
    setAutoDuration(on) {
        if (on) this.setDuration(null);
        else this.setDuration(this._lastExplicitDuration || DURATIONS.eighth);
        return this.isAutoDuration;
    }

    /** Flip automatic duration. @returns {boolean} the new auto state */
    toggleAutoDuration() {
        return this.setAutoDuration(!this.isAutoDuration);
    }

    /**
     * The duration a note entered right now would get: the chosen one, or
     * — under auto — what the column rule predicts for the cursor slot.
     * EVERY consumer of `currentDuration` that needs a number (cursor
     * steps, ghost note, status bar) must call this instead.
     * @returns {number} ticks (never null, never 0)
     */
    effectiveDuration() {
        if (!this.isAutoDuration) return this.currentDuration;
        const predicted = this.facade.autoDurationAt({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
        }, this.trackId);
        return predicted > 0 ? predicted : this.gridSubdivision;
    }

    /** Mark a note's duration as hand-set: automatic duration won't touch it. */
    pinDuration({ measure, tick, string }) {
        const key = durationKey(measure, tick, string);
        this.autoEnteredDurations.delete(key);
        this.pinnedDurations.add(key);
    }

    /** Is this note's duration pinned (hand-set) rather than automatic? */
    isDurationPinned({ measure, tick, string }) {
        return this.pinnedDurations.has(durationKey(measure, tick, string));
    }

    /**
     * Toggle a dot on the current duration (×1.5 / ÷1.5). A no-op when
     * the result isn't a whole number of ticks or leaves the editable
     * range — which is what keeps it off triplets (160 × 1.5 = 240 is a
     * straight eighth, not a dotted anything).
     * @returns {boolean} whether the duration changed
     */
    toggleDotted() {
        const current = this.currentDuration;
        if (current == null) return false;
        const dotted = DOTTED_DURATIONS.has(current);
        const next = dotted ? current / 1.5 : current * 1.5;
        if (!Number.isInteger(next)) return false;
        if (next < MIN_DURATION || next > MAX_DURATION) return false;
        if (!dotted && !DOTTED_DURATIONS.has(next)) return false;
        this.setDuration(next);
        return true;
    }

    /**
     * Absolute [start, end) of the current selection, end-inclusive of
     * the selected slot (the same convention copy/delete use).
     * @returns {{startAbs: number, endAbs: number}|null}
     */
    selectionRange() {
        if (!this.selection) return null;
        const { start, end } = this.selection.getNormalized(
            (m, t) => this.facade.toAbs(m, t));
        return {
            startAbs: this.facade.toAbs(start.measure, start.tick),
            endAbs: this.facade.toAbs(end.measure, end.tick) + 1,
        };
    }

    /**
     * Apply one duration to every note in the selection (TablEdit's `*`),
     * pinning them all. Undoable in one step.
     * @returns {boolean} false with no selection, or when nothing changed
     */
    applyDurationToSelection(duration) {
        const range = this.selectionRange();
        if (!range) return false;
        const hits = this.facade.notesInRange(range.startAbs, range.endAbs,
            { trackId: this.trackId });
        const ok = this.facade.setRangeDuration(range.startAbs, range.endAbs,
            duration, { trackId: this.trackId }) !== false;
        if (ok) for (const hit of hits) this.pinDuration(hit);
        return ok;
    }

    /**
     * Halve (0.5) or double (2) the duration of the note at the cursor,
     * pinning it. Undoable.
     * @returns {boolean}
     */
    scaleDurationAtCursor(factor) {
        const pos = {
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        };
        const ok = this.facade.scaleDuration(pos, factor, this.trackId) !== false;
        if (ok) this.pinDuration(pos);
        return ok;
    }

    /** scaleDurationAtCursor over the selection. @returns {boolean} */
    scaleSelectionDuration(factor) {
        const range = this.selectionRange();
        if (!range) return false;
        const hits = this.facade.notesInRange(range.startAbs, range.endAbs,
            { trackId: this.trackId });
        const ok = this.facade.scaleRangeDuration(range.startAbs, range.endAbs,
            factor, { trackId: this.trackId }) !== false;
        if (ok) for (const hit of hits) this.pinDuration(hit);
        return ok;
    }

    /**
     * One-shot "fix durations from spacing" for the cursor's measure
     * (TablEdit's `J`), ignoring pins. The measure's notes become
     * auto-managed afterwards, so continued entry keeps them consistent
     * — the user just said this is what they want the rule to decide.
     * @returns {boolean} false when nothing changed
     */
    fixDurationsAtCursor() {
        const measureNum = this.cursor.measure;
        const ok = this.facade.fixDurations(measureNum, { trackId: this.trackId }) !== false;
        this._adoptForAuto(this.facade.toAbs(measureNum, 0),
            this.facade.toAbs(measureNum, 0) + this.facade.ticksFor(measureNum));
        return ok;
    }

    /** fixDurationsAtCursor over the selection. @returns {boolean} */
    fixDurationsInSelection() {
        const range = this.selectionRange();
        if (!range) return false;
        const ok = this.facade.fixDurations(range, { trackId: this.trackId }) !== false;
        this._adoptForAuto(range.startAbs, range.endAbs);
        return ok;
    }

    /** Hand a tick range's notes over to automatic duration. */
    _adoptForAuto(startAbs, endAbs) {
        for (const hit of this.facade.notesInRange(startAbs, endAbs, { trackId: this.trackId })) {
            const key = durationKey(hit.measure, hit.tick, hit.string);
            this.pinnedDurations.delete(key);
            this.autoEnteredDurations.add(key);
        }
    }

    // ------------------------------------------------------------------
    // Note fixes at the cursor
    // ------------------------------------------------------------------

    /**
     * Move the note under the cursor by `delta` frets (clamped 0..24).
     * @returns {boolean}
     */
    transposeFretAtCursor(delta) {
        return this.facade.transposeFret({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        }, delta, this.trackId) !== false;
    }

    /**
     * Re-string the note under the cursor, preserving its pitch, and
     * follow it with the cursor. Refused (false, nothing moved) when the
     * target slot is taken or the fret would leave 0..24.
     * @param {number} direction - +1 / -1
     * @returns {boolean}
     */
    moveNoteAcrossStrings(direction) {
        const pos = {
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        };
        const ok = this.facade.moveNoteToString(pos, direction, this.trackId) !== false;
        if (!ok) return false;
        const to = { ...pos, string: pos.string + direction };
        const from = durationKey(pos.measure, pos.tick, pos.string);
        const onto = durationKey(to.measure, to.tick, to.string);
        for (const set of [this.pinnedDurations, this.autoEnteredDurations]) {
            if (set.delete(from)) set.add(onto);
        }
        this.cursor.string = to.string;
        // The cursor MOVED, so say so on the same channel every ordinary
        // move uses — the status bar's `String:` field, the toolbar's
        // `.reflects-note` outlines and the cursor overlay all subscribe
        // to `cursorMove` and would otherwise show the old string until
        // the next arrow key.
        this._emit('cursorMove', this.cursor);
        return true;
    }

    /**
     * Tie the note at the cursor to its same-string predecessor, or untie
     * it. A tie is `tie: true` on the CONTINUATION note — never
     * `tech: '~'`, which nothing has ever rendered or played.
     * @returns {boolean} the tie state after the call
     */
    toggleTieAtCursor() {
        const note = this.getNoteAtCursor();
        if (!note) return false;
        const pos = {
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        };
        const want = note.tie !== true;
        const ok = this.facade.setTie(pos, want, { trackId: this.trackId }) !== false;
        if (ok) this.lastTech = '~';
        return this.getNoteAtCursor()?.tie === true;
    }

    // ------------------------------------------------------------------
    // Measures
    // ------------------------------------------------------------------

    /**
     * Delete the cursor's written measure on EVERY track (the inverse of
     * insertMeasure) and pull the cursor back if it fell off the end.
     * @returns {boolean}
     */
    deleteMeasureAtCursor() {
        const measureNum = this.cursor.measure;
        const ok = this.facade.deleteMeasure(measureNum) !== false;
        if (!ok) return false;
        this.lastAction = { type: 'deleteMeasure', measureNum };
        const max = this.getMeasureCount();
        if (this.cursor.measure > max) this.cursor.measure = max;
        this.cursor.tick = 0;
        return true;
    }

    /**
     * Remove the last measure — but only when it is empty on EVERY
     * track, because a trailing measure is shared score structure and
     * deleting it would take another track's music with it. This is the
     * "walked past the end, changed my mind" undo for ensureMeasure.
     * @returns {boolean} false when the last measure has any note
     */
    deleteEmptyTrailingMeasure() {
        const notation = this.otf.notation || {};
        const last = Math.max(1, ...Object.values(notation)
            .flatMap(ms => ms.map(m => m.measure)));
        if (last <= 1) return false;
        for (const measures of Object.values(notation)) {
            const m = measures.find(x => x.measure === last);
            if (m && m.events.some(e => e.notes.length > 0)) return false;
        }
        const ok = this.facade.deleteMeasure(last) !== false;
        if (ok && this.cursor.measure > last - 1) {
            this.cursor.measure = last - 1;
            this.cursor.tick = 0;
        }
        return ok;
    }

    /**
     * Make measure `n` exist, appending through the facade — how the
     * keyboard layer lets you walk past the end to add a bar.
     * @returns {boolean} false when it was already there
     */
    ensureMeasure(n) {
        if (!(n >= 1) || this.getMeasure(n)) return false;
        const count = this.getMeasureCount();
        if (n > count) {
            return this.facade.addMeasures(n - count, this.trackId) !== false;
        }
        return this.facade.transact('Add measure', () => {
            this.facade.getOrCreateMeasure(n, this.trackId);
            return true;
        }) !== false;
    }

    /**
     * Ripple the cursor's measure right (insert a slot) or left (close
     * one) by `ticks`, defaulting to the entry duration — the grid when
     * automatic duration is on, since then the grid IS the rhythm.
     * @returns {boolean} false when refused (barline or occupied slot)
     */
    shiftRightAtCursor(ticks = this.rippleTicks()) {
        return this.facade.shiftRight(this.cursor.measure, this.cursor.tick,
            ticks, { trackId: this.trackId }) !== false;
    }

    /** @see shiftRightAtCursor */
    shiftLeftAtCursor(ticks = this.rippleTicks()) {
        return this.facade.shiftLeft(this.cursor.measure, this.cursor.tick,
            ticks, { trackId: this.trackId }) !== false;
    }

    /** How far a ripple moves things by default. */
    rippleTicks() {
        return this.isAutoDuration ? this.gridSubdivision : this.currentDuration;
    }

    /**
     * Copy the previous measure into the cursor's measure (creating it if
     * the cursor is past the end) and land at its start. Refused when the
     * cursor's measure already has notes.
     * @returns {boolean}
     */
    repeatPreviousMeasure() {
        const measureNum = this.cursor.measure;
        const ok = this.facade.repeatMeasure(measureNum, { trackId: this.trackId }) !== false;
        if (!ok) return false;
        this.lastAction = { type: 'repeatMeasure', measureNum };
        this.cursor.tick = 0;
        return true;
    }

    /**
     * Toggle auto-advance (does typing a fret move the cursor on?).
     * @returns {boolean} the new state
     */
    toggleAutoAdvance() {
        this.autoAdvance = !this.autoAdvance;
        this._emit('autoAdvanceChange', this.autoAdvance);
        return this.autoAdvance;
    }

    /** Set auto-advance explicitly. @returns {boolean} the new state */
    setAutoAdvance(on) {
        const next = !!on;
        if (next === this.autoAdvance) return next;
        return this.toggleAutoAdvance();
    }

    /**
     * Toggle triplet mode
     */
    toggleTripletMode() {
        this.tripletMode = !this.tripletMode;
        this.tripletCount = 0;
        if (this.tripletMode) {
            // An explicit duration, so it leaves automatic duration (and
            // is what auto-off goes back to). Under auto a triplet needs
            // no mode at all — a 160-tick gap IS a triplet eighth.
            this.currentDuration = DURATIONS.tripletEighth;
            this._lastExplicitDuration = DURATIONS.tripletEighth;
            // Straight grids can't express triplet positions (and vice
            // versa) — same refine-only divisibility rule as setDuration
            if (DURATIONS.tripletEighth % this.gridSubdivision !== 0) {
                this.setGridSubdivision(DURATIONS.tripletEighth);
            }
        }
        this._emit('tripletModeChange', this.tripletMode);
    }

    /**
     * Set grid subdivision (controls cursor snap/movement)
     */
    setGridSubdivision(subdivision) {
        this.gridSubdivision = subdivision;
        this._emit('gridSubdivisionChange', subdivision);
    }

    /**
     * Toggle grid visibility
     */
    toggleGrid() {
        this.showGrid = !this.showGrid;
        this._emit('gridToggle', this.showGrid);
    }

    /**
     * Set pending articulation for next note
     */
    setPendingArticulation(tech) {
        this.pendingArticulation = tech;
        if (tech) this.lastTech = tech;
        this._emit('pendingArticulationChange', tech);
    }

    /**
     * Copy selection (visual mode) or the event at cursor to clipboard.
     * Selection ranges are inclusive of the end tick.
     */
    copy() {
        if (this.selection) {
            const { start, end } = this.selection.getNormalized(
                (m, t) => this.facade.toAbs(m, t));
            const startAbs = this.facade.toAbs(start.measure, start.tick);
            const endAbs = this.facade.toAbs(end.measure, end.tick) + 1;
            this.facade.copyRange(startAbs, endAbs, { trackId: this.trackId });
        } else {
            const abs = this.facade.toAbs(this.cursor.measure, this.cursor.tick);
            this.facade.copyRange(abs, abs + 1, { trackId: this.trackId });
        }
    }

    /**
     * Paste from clipboard at cursor position
     */
    paste() {
        const atAbs = this.facade.toAbs(this.cursor.measure, this.cursor.tick);
        return this.facade.paste(atAbs, undefined,
            { trackId: this.trackId, ...this._autoOptions() });
    }

    /**
     * Delete every note in the current selection (undoable, ts-aware —
     * goes through the facade, unlike the old raw-mutation path).
     * The selection range is inclusive of its end slot.
     */
    deleteSelection() {
        if (!this.selection) return false;
        const { start, end } = this.selection.getNormalized(
            (m, t) => this.facade.toAbs(m, t));
        const startAbs = this.facade.toAbs(start.measure, start.tick);
        const endAbs = this.facade.toAbs(end.measure, end.tick) + 1;
        return this.facade.deleteRange(startAbs, endAbs, { trackId: this.trackId });
    }

    /**
     * Undo last action
     */
    undo() {
        return this.facade.undo();
    }

    /**
     * Redo last undone action
     */
    redo() {
        return this.facade.redo();
    }

    /**
     * Repeat last action
     */
    repeatLastAction() {
        if (!this.lastAction) return false;

        switch (this.lastAction.type) {
            case 'insertNote':
                this.insertNote(this.lastAction.fret, this.lastAction.options);
                return true;
            case 'deleteNote':
                return this.deleteNote();
            case 'deleteTick':
                return this.deleteTick();
            case 'addArticulation':
                // TablEdit's F3: re-apply the last effect to the note
                // you are parked on now. '~' means tie, not a tech.
                if (!this.lastTech) return false;
                if (this.lastTech === '~') return this.toggleTieAtCursor();
                return this.addArticulation(this.lastTech) !== false;
            default:
                return false;
        }
    }

    /**
     * Export OTF document
     */
    export() {
        return this.facade.export();
    }

    /**
     * Subscribe to events
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(callback);
    }

    /**
     * Unsubscribe from events
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index >= 0) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * Emit event
     */
    _emit(event, data) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const callback of listeners) {
                callback(data);
            }
        }
    }
}
