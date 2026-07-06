// OTF Editor State Management
//
// UI-session state (cursor, mode, selection, entry duration, grid,
// pending articulation) layered over the UI-free EditingFacade, which
// owns the document, undo history, clipboard, and all mutations.
// Anything that edits the OTF goes through the facade — the mouse/touch
// UI can drive the same facade directly without this class.

import { measureTicksFor } from '../renderers/measure-timing.js';
import { EditingFacade } from './facade.js';

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
};

export const DURATION_NAMES = {
    [DURATIONS.whole]: 'whole',
    [DURATIONS.half]: 'half',
    [DURATIONS.quarter]: 'quarter',
    [DURATIONS.eighth]: 'eighth',
    [DURATIONS.sixteenth]: 'sixteenth',
    [DURATIONS.thirtySecond]: 'thirty-second',
    [DURATIONS.tripletEighth]: 'triplet-eighth',
};

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
     * Get normalized range (start before end)
     */
    getNormalized(ticksPerMeasure) {
        const startAbs = this.start.getAbsoluteTick(ticksPerMeasure);
        const endAbs = this.end.getAbsoluteTick(ticksPerMeasure);

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

        // Current duration for note entry
        this.currentDuration = DURATIONS.eighth;

        // Pending articulation (applied to next note)
        this.pendingArticulation = null;

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
        this._updateTicksPerMeasure();
        this._emit('load', this.otf);
        this._emit('change', this.otf);
    }

    /**
     * Get current track
     */
    getCurrentTrack() {
        return this.otf.tracks.find(t => t.id === this.trackId);
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
        const duration = options.duration || this.currentDuration;

        this.facade.insertNote({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string,
            fret,
            duration,
            tech,
            trackId: this.trackId,
        });

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
        this.lastAction = { type: 'insertNote', fret, options: { string, tech, duration } };

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
        }, this.trackId);
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
        }, this.trackId);
        if (ok) this.lastAction = { type: 'deleteTick' };
        return ok;
    }

    /**
     * Add articulation to note at cursor
     */
    addArticulation(tech) {
        return this.facade.setArticulation({
            measure: this.cursor.measure,
            tick: this.cursor.tick,
            string: this.cursor.string,
        }, tech, this.trackId);
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
     * Set current duration
     */
    setDuration(duration) {
        this.currentDuration = duration;
        this._emit('durationChange', duration);
    }

    /**
     * Toggle triplet mode
     */
    toggleTripletMode() {
        this.tripletMode = !this.tripletMode;
        this.tripletCount = 0;
        if (this.tripletMode) {
            this.currentDuration = DURATIONS.tripletEighth;
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
        this._emit('pendingArticulationChange', tech);
    }

    /**
     * Copy selection (visual mode) or the event at cursor to clipboard.
     * Selection ranges are inclusive of the end tick.
     */
    copy() {
        if (this.selection) {
            const { start, end } = this.selection.getNormalized(this.ticksPerMeasure);
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
        return this.facade.paste(atAbs, undefined, { trackId: this.trackId });
    }

    /**
     * Delete every note in the current selection (undoable, ts-aware —
     * goes through the facade, unlike the old raw-mutation path).
     * The selection range is inclusive of its end slot.
     */
    deleteSelection() {
        if (!this.selection) return false;
        const { start, end } = this.selection.getNormalized(this.ticksPerMeasure);
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
