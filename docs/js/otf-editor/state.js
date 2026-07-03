// OTF Editor State Management
// Manages editor state, undo/redo history, and clipboard

import { measureTicksFor } from '../renderers/measure-timing.js';

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
 * Undo history entry
 */
class HistoryEntry {
    constructor(description, beforeState, afterState) {
        this.timestamp = Date.now();
        this.description = description;
        this.beforeState = JSON.parse(JSON.stringify(beforeState));
        this.afterState = JSON.parse(JSON.stringify(afterState));
    }
}

/**
 * Undo/Redo history manager
 */
class UndoHistory {
    constructor(maxSize = 100) {
        this.entries = [];
        this.currentIndex = -1;
        this.maxSize = maxSize;
    }

    /**
     * Record a state change
     */
    push(description, beforeState, afterState) {
        // Remove any redo entries after current position
        if (this.currentIndex < this.entries.length - 1) {
            this.entries = this.entries.slice(0, this.currentIndex + 1);
        }

        // Add new entry
        const entry = new HistoryEntry(description, beforeState, afterState);
        this.entries.push(entry);
        this.currentIndex = this.entries.length - 1;

        // Trim if exceeds max size
        if (this.entries.length > this.maxSize) {
            this.entries.shift();
            this.currentIndex--;
        }
    }

    /**
     * Undo - returns the before state if available
     */
    undo() {
        if (this.currentIndex >= 0) {
            const entry = this.entries[this.currentIndex];
            this.currentIndex--;
            return entry.beforeState;
        }
        return null;
    }

    /**
     * Redo - returns the after state if available
     */
    redo() {
        if (this.currentIndex < this.entries.length - 1) {
            this.currentIndex++;
            const entry = this.entries[this.currentIndex];
            return entry.afterState;
        }
        return null;
    }

    /**
     * Check if undo is available
     */
    canUndo() {
        return this.currentIndex >= 0;
    }

    /**
     * Check if redo is available
     */
    canRedo() {
        return this.currentIndex < this.entries.length - 1;
    }

    /**
     * Clear all history
     */
    clear() {
        this.entries = [];
        this.currentIndex = -1;
    }
}

/**
 * Main editor state management
 */
export class EditorState {
    constructor(options = {}) {
        // OTF document (source of truth)
        this.otf = options.otf || this._createEmptyOTF(options.instrument || '5-string-banjo');

        // Current track ID
        this.trackId = this.otf.tracks[0]?.id || 'banjo';

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

        // Clipboard
        this.clipboard = null;

        // Grid subdivision (for cursor snap/movement)
        this.gridSubdivision = DURATIONS.eighth;

        // Grid visibility
        this.showGrid = true;

        // Undo history
        this.history = new UndoHistory();

        // Last action (for repeat with .)
        this.lastAction = null;

        // Event listeners
        this._listeners = new Map();

        // Calculate ticks per measure from time signature
        this._updateTicksPerMeasure();
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
        this.otf = JSON.parse(JSON.stringify(otf)); // Deep clone
        this.trackId = this.otf.tracks[0]?.id || 'banjo';
        this.cursor = new CursorPosition(1, 0, 3, this.trackId);
        this.selection = null;
        this.mode = EditorMode.NORMAL;
        this.history.clear();
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
        const track = this.getCurrentTrack();
        return track?.tuning?.length || 5;
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
        let measure = this.getMeasure(measureNum);
        if (!measure) {
            measure = { measure: measureNum, events: [] };
            const notation = this.getNotation();
            notation.push(measure);
            notation.sort((a, b) => a.measure - b.measure);
        }
        return measure;
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
     * Record current state for undo
     */
    _recordUndo(description) {
        return JSON.parse(JSON.stringify(this.otf));
    }

    /**
     * Complete undo entry
     */
    _completeUndo(description, beforeState) {
        this.history.push(description, beforeState, this.otf);
        this._emit('change', this.otf);
    }

    /**
     * Insert a note at cursor position
     * If the note duration exceeds the measure boundary, creates tied notes
     */
    insertNote(fret, options = {}) {
        const beforeState = this._recordUndo('Insert note');
        const string = options.string || this.cursor.string;
        const tech = options.tech || this.pendingArticulation;
        const duration = options.duration || this.currentDuration;

        // Calculate remaining ticks in current measure
        const remainingTicks = this.ticksPerMeasure - this.cursor.tick;

        // Check if we need tied notes (duration extends past measure)
        if (duration > remainingTicks && remainingTicks > 0) {
            // Insert first note (fills remainder of measure)
            this._insertNoteAtPosition(
                this.cursor.measure,
                this.cursor.tick,
                string,
                fret,
                remainingTicks,
                tech,
                '~'  // Tie to next note
            );

            // Insert tied note at start of next measure
            const overflowDuration = duration - remainingTicks;
            this._insertNoteAtPosition(
                this.cursor.measure + 1,
                0,
                string,
                fret,
                overflowDuration,
                '~',  // Tied from previous
                null
            );
        } else {
            // Normal note insertion
            this._insertNoteAtPosition(
                this.cursor.measure,
                this.cursor.tick,
                string,
                fret,
                duration,
                tech,
                null
            );
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
        this.lastAction = { type: 'insertNote', fret, options: { string, tech, duration } };

        this._completeUndo('Insert note', beforeState);
        this._emit('noteInserted', { measure: this.cursor.measure, tick: this.cursor.tick, fret, string });
    }

    /**
     * Insert note at specific position (internal helper)
     */
    _insertNoteAtPosition(measureNum, tick, string, fret, duration, tech, tie) {
        const measure = this.getOrCreateMeasure(measureNum);

        // Find or create event at this tick
        let event = measure.events.find(e => e.tick === tick);
        if (!event) {
            event = { tick, notes: [] };
            measure.events.push(event);
            measure.events.sort((a, b) => a.tick - b.tick);
        }

        // Remove existing note on this string
        event.notes = event.notes.filter(n => n.s !== string);

        // Add new note with duration
        const note = { s: string, f: fret, dur: duration };
        if (tech) note.tech = tech;
        if (tie) note.tie = tie;
        event.notes.push(note);
        event.notes.sort((a, b) => a.s - b.s);
    }

    /**
     * Delete note at cursor position
     */
    deleteNote() {
        const measure = this.getMeasure(this.cursor.measure);
        if (!measure) return false;

        const event = measure.events.find(e => e.tick === this.cursor.tick);
        if (!event) return false;

        const noteIndex = event.notes.findIndex(n => n.s === this.cursor.string);
        if (noteIndex === -1) return false;

        const beforeState = this._recordUndo('Delete note');
        event.notes.splice(noteIndex, 1);

        // Remove empty events
        if (event.notes.length === 0) {
            const eventIndex = measure.events.indexOf(event);
            measure.events.splice(eventIndex, 1);
        }

        this.lastAction = { type: 'deleteNote' };
        this._completeUndo('Delete note', beforeState);
        return true;
    }

    /**
     * Delete all notes at current tick
     */
    deleteTick() {
        const measure = this.getMeasure(this.cursor.measure);
        if (!measure) return false;

        const eventIndex = measure.events.findIndex(e => e.tick === this.cursor.tick);
        if (eventIndex === -1) return false;

        const beforeState = this._recordUndo('Delete tick');
        measure.events.splice(eventIndex, 1);

        this.lastAction = { type: 'deleteTick' };
        this._completeUndo('Delete tick', beforeState);
        return true;
    }

    /**
     * Add articulation to note at cursor
     */
    addArticulation(tech) {
        const note = this.getNoteAtCursor();
        if (!note) return false;

        const beforeState = this._recordUndo('Add articulation');
        note.tech = tech;

        this._completeUndo('Add articulation', beforeState);
        return true;
    }

    /**
     * Remove articulation from note at cursor
     */
    removeArticulation() {
        const note = this.getNoteAtCursor();
        if (!note || !note.tech) return false;

        const beforeState = this._recordUndo('Remove articulation');
        delete note.tech;

        this._completeUndo('Remove articulation', beforeState);
        return true;
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
     * Copy selection to clipboard
     */
    copy() {
        if (this.selection) {
            const { start, end } = this.selection.getNormalized(this.ticksPerMeasure);
            // Copy notes in selection range
            const notes = [];
            const notation = this.getNotation();

            for (const measure of notation) {
                if (measure.measure >= start.measure && measure.measure <= end.measure) {
                    for (const event of measure.events) {
                        const absTick = (measure.measure - 1) * this.ticksPerMeasure + event.tick;
                        const startAbs = start.getAbsoluteTick(this.ticksPerMeasure);
                        const endAbs = end.getAbsoluteTick(this.ticksPerMeasure);

                        if (absTick >= startAbs && absTick <= endAbs) {
                            notes.push({
                                relativeTick: absTick - startAbs,
                                notes: JSON.parse(JSON.stringify(event.notes)),
                            });
                        }
                    }
                }
            }

            this.clipboard = { type: 'notes', data: notes };
        } else {
            // Copy note at cursor
            const event = this.getEventAtCursor();
            if (event) {
                this.clipboard = {
                    type: 'notes',
                    data: [{ relativeTick: 0, notes: JSON.parse(JSON.stringify(event.notes)) }],
                };
            }
        }

        this._emit('clipboardChange', this.clipboard);
    }

    /**
     * Paste from clipboard
     */
    paste() {
        if (!this.clipboard || this.clipboard.data.length === 0) return false;

        const beforeState = this._recordUndo('Paste');
        const baseAbsTick = this.cursor.getAbsoluteTick(this.ticksPerMeasure);

        for (const item of this.clipboard.data) {
            const absTick = baseAbsTick + item.relativeTick;
            const measureNum = Math.floor(absTick / this.ticksPerMeasure) + 1;
            const tick = absTick % this.ticksPerMeasure;

            const measure = this.getOrCreateMeasure(measureNum);

            let event = measure.events.find(e => e.tick === tick);
            if (!event) {
                event = { tick, notes: [] };
                measure.events.push(event);
                measure.events.sort((a, b) => a.tick - b.tick);
            }

            // Merge notes
            for (const note of item.notes) {
                const existingIndex = event.notes.findIndex(n => n.s === note.s);
                if (existingIndex >= 0) {
                    event.notes[existingIndex] = JSON.parse(JSON.stringify(note));
                } else {
                    event.notes.push(JSON.parse(JSON.stringify(note)));
                }
            }
            event.notes.sort((a, b) => a.s - b.s);
        }

        this._completeUndo('Paste', beforeState);
        return true;
    }

    /**
     * Undo last action
     */
    undo() {
        const state = this.history.undo();
        if (state) {
            this.otf = JSON.parse(JSON.stringify(state));
            this._updateTicksPerMeasure();
            this._emit('change', this.otf);
            this._emit('undo');
            return true;
        }
        return false;
    }

    /**
     * Redo last undone action
     */
    redo() {
        const state = this.history.redo();
        if (state) {
            this.otf = JSON.parse(JSON.stringify(state));
            this._updateTicksPerMeasure();
            this._emit('change', this.otf);
            this._emit('redo');
            return true;
        }
        return false;
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
        return JSON.parse(JSON.stringify(this.otf));
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
