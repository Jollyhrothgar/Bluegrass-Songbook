// OTF Editing Facade
//
// A UI-free API over OTF documents that BOTH the mouse/touch UI and the
// vim-style keyboard drive. No cursor, no mode, no DOM — callers pass
// explicit positions ({measure, tick, string}) or absolute tick ranges.
//
// Instrument-agnostic by design: string counts come from track tuning
// data; measure math is ts-aware via measure-timing.js so documents with
// mid-tune time-signature changes (27493: 2/4 measures in a 2/2 tune)
// are never corrupted by edits.
//
// Undo never lies: every mutation is a whole-document snapshot pair, and
// transact() groups compound edits into one step with rollback on error.

import {
    MeasureTiming,
    TimelineTiming,
    identityTimeline,
    maxMeasureIn,
    measureTimingFromOtf,
} from '../renderers/measure-timing.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

export class EditingFacade {
    /**
     * @param {Object} otf - OTF document (deep-cloned; the facade owns its copy)
     * @param {Object} options
     * @param {string} [options.trackId] - initial track (defaults to first)
     */
    constructor(otf, options = {}) {
        this.otf = clone(otf);
        const tracks = this.otf.tracks || [];
        this.trackId = options.trackId && tracks.some(t => t.id === options.trackId)
            ? options.trackId
            : tracks[0]?.id;

        this.clipboard = null;

        this._history = [];
        this._historyIndex = -1;
        this._maxHistory = 200;
        this._txDepth = 0;
        this._listeners = new Map();
        this._timing = null;      // lazy TimelineTiming
        this._measureTiming = null;
    }

    // ------------------------------------------------------------------
    // Document / track access
    // ------------------------------------------------------------------

    /** Deep-cloned copy of the document. */
    export() {
        return clone(this.otf);
    }

    getTracks() {
        return this.otf.tracks || [];
    }

    getTrack(trackId = this.trackId) {
        return this.getTracks().find(t => t.id === trackId) || null;
    }

    setTrack(trackId) {
        if (!this.getTrack(trackId)) {
            throw new Error(`Unknown track: ${trackId}`);
        }
        this.trackId = trackId;
        this._emit('trackChange', trackId);
    }

    /** Strings on a track's instrument — data, not architecture. */
    stringCount(trackId = this.trackId) {
        return this.getTrack(trackId)?.tuning?.length || null;
    }

    getNotation(trackId = this.trackId) {
        if (!this.otf.notation[trackId]) this.otf.notation[trackId] = [];
        return this.otf.notation[trackId];
    }

    getMeasure(measureNum, trackId = this.trackId) {
        return this.getNotation(trackId).find(m => m.measure === measureNum) || null;
    }

    getOrCreateMeasure(measureNum, trackId = this.trackId) {
        let measure = this.getMeasure(measureNum, trackId);
        if (!measure) {
            measure = { measure: measureNum, events: [] };
            const notation = this.getNotation(trackId);
            notation.push(measure);
            notation.sort((a, b) => a.measure - b.measure);
            this._invalidateTiming();
        }
        return measure;
    }

    getMeasureCount(trackId = this.trackId) {
        const notation = this.getNotation(trackId);
        if (notation.length === 0) return 1;
        return Math.max(...notation.map(m => m.measure));
    }

    // ------------------------------------------------------------------
    // Timing (ts-aware measure math via measure-timing.js)
    // ------------------------------------------------------------------

    get measureTiming() {
        if (!this._measureTiming) {
            this._measureTiming = measureTimingFromOtf(this.otf);
        }
        return this._measureTiming;
    }

    get timing() {
        if (!this._timing) {
            const count = Math.max(1, maxMeasureIn(this.otf.notation || {}));
            this._timing = new TimelineTiming(
                this.measureTiming, identityTimeline(count));
        }
        return this._timing;
    }

    _invalidateTiming() {
        this._timing = null;
        this._measureTiming = null;
    }

    /** Effective time signature of a written measure. */
    signatureFor(measure) {
        return this.measureTiming.signatureFor(measure);
    }

    /** Tick length of a written measure (works past the document end). */
    ticksFor(measure) {
        return this.measureTiming.ticksFor(measure);
    }

    /** Absolute tick of (measure, tick). Extrapolates past the end. */
    toAbs(measure, tick = 0) {
        return this.timing.startTick(measure) + tick;
    }

    /** Inverse of toAbs: absolute tick → {measure, tick}. */
    locate(absTick) {
        const { display, tickInMeasure } = this.timing.locate(absTick);
        return { measure: display, tick: tickInMeasure };
    }

    // ------------------------------------------------------------------
    // Undo machinery
    // ------------------------------------------------------------------

    /**
     * Group several edits into ONE undo step. Rolls the document back and
     * rethrows if the callback throws — the doc is never left half-edited.
     */
    transact(description, fn) {
        const before = clone(this.otf);
        this._txDepth++;
        let result;
        try {
            result = fn();
        } catch (err) {
            this.otf = before;
            this._invalidateTiming();
            this._txDepth--;
            throw err;
        }
        this._txDepth--;
        if (this._txDepth === 0) {
            this._pushHistory(description, before);
            this._emit('change', this.otf);
        }
        return result;
    }

    /**
     * Run one mutation with snapshot-undo. fn returns false for a no-op
     * (contract: a false return means the document was NOT modified).
     */
    _mutate(description, fn) {
        if (this._txDepth > 0) return fn(); // outer transact owns history
        const before = clone(this.otf);
        let result;
        try {
            result = fn();
        } catch (err) {
            this.otf = before;
            this._invalidateTiming();
            throw err;
        }
        if (result === false) return false;
        this._pushHistory(description, before);
        this._emit('change', this.otf);
        return result;
    }

    _pushHistory(description, beforeState) {
        if (this._historyIndex < this._history.length - 1) {
            this._history = this._history.slice(0, this._historyIndex + 1);
        }
        this._history.push({
            description,
            before: beforeState,
            after: clone(this.otf),
            timestamp: Date.now(),
        });
        this._historyIndex = this._history.length - 1;
        if (this._history.length > this._maxHistory) {
            this._history.shift();
            this._historyIndex--;
        }
    }

    canUndo() { return this._historyIndex >= 0; }
    canRedo() { return this._historyIndex < this._history.length - 1; }

    undo() {
        if (!this.canUndo()) return false;
        this.otf = clone(this._history[this._historyIndex].before);
        this._historyIndex--;
        this._invalidateTiming();
        this._emit('change', this.otf);
        this._emit('undo');
        return true;
    }

    redo() {
        if (!this.canRedo()) return false;
        this._historyIndex++;
        this.otf = clone(this._history[this._historyIndex].after);
        this._invalidateTiming();
        this._emit('change', this.otf);
        this._emit('redo');
        return true;
    }

    // ------------------------------------------------------------------
    // Note operations
    // ------------------------------------------------------------------

    _validateString(string, trackId = this.trackId) {
        const count = this.stringCount(trackId);
        if (!Number.isInteger(string) || string < 1 || (count && string > count)) {
            throw new RangeError(
                `String ${string} out of range for track '${trackId}' (1..${count})`);
        }
    }

    /**
     * Insert a note. When a duration crosses one or more barlines the
     * note is split into tie-continued notes, honoring each measure's own
     * tick length (ts-aware). Continuations carry `tie: true` — the
     * encoding the site renderer draws slurs from and the player skips.
     *
     * @param {Object} p - {measure, tick, string, fret, duration?, tech?, trackId?}
     */
    insertNote({ measure, tick, string, fret, duration = null, tech = null, trackId = this.trackId }) {
        this._validateString(string, trackId);
        return this._mutate('Insert note', () => {
            if (duration == null) {
                this._placeNote(trackId, measure, tick, { s: string, f: fret, ...(tech ? { tech } : {}) });
                return true;
            }
            let m = measure;
            let t = tick;
            let remaining = duration;
            let first = true;
            while (remaining > 0) {
                const cap = this.ticksFor(m);
                if (t >= cap) { m++; t = 0; continue; }
                const take = Math.min(remaining, cap - t);
                const note = { s: string, f: fret, dur: take };
                if (first && tech) note.tech = tech;
                if (!first) note.tie = true;
                this._placeNote(trackId, m, t, note);
                remaining -= take;
                first = false;
                m++;
                t = 0;
            }
            return true;
        });
    }

    _placeNote(trackId, measureNum, tick, note) {
        const measure = this.getOrCreateMeasure(measureNum, trackId);
        let event = measure.events.find(e => e.tick === tick);
        if (!event) {
            event = { tick, notes: [] };
            measure.events.push(event);
            measure.events.sort((a, b) => a.tick - b.tick);
        }
        event.notes = event.notes.filter(n => n.s !== note.s);
        event.notes.push(note);
        event.notes.sort((a, b) => a.s - b.s);
    }

    _findNote({ measure, tick, string }, trackId = this.trackId) {
        const m = this.getMeasure(measure, trackId);
        const event = m?.events.find(e => e.tick === tick) || null;
        const note = event?.notes.find(n => n.s === string) || null;
        return { measure: m, event, note };
    }

    deleteNote(pos, trackId = this.trackId) {
        return this._mutate('Delete note', () => {
            const { measure, event, note } = this._findNote(pos, trackId);
            if (!note) return false;
            event.notes = event.notes.filter(n => n !== note);
            if (event.notes.length === 0) {
                measure.events = measure.events.filter(e => e !== event);
            }
            return true;
        });
    }

    deleteTick({ measure, tick }, trackId = this.trackId) {
        return this._mutate('Delete tick', () => {
            const m = this.getMeasure(measure, trackId);
            if (!m) return false;
            const idx = m.events.findIndex(e => e.tick === tick);
            if (idx === -1) return false;
            m.events.splice(idx, 1);
            return true;
        });
    }

    /** Relocate a note, preserving every field except its string. */
    moveNote(from, to, trackId = this.trackId) {
        this._validateString(to.string, trackId);
        const found = this._findNote(from, trackId);
        if (!found.note) return false;
        return this.transact('Move note', () => {
            const moved = clone(found.note);
            moved.s = to.string;
            this.deleteNote(from, trackId);
            const target = this.getOrCreateMeasure(to.measure, trackId);
            let event = target.events.find(e => e.tick === to.tick);
            if (!event) {
                event = { tick: to.tick, notes: [] };
                target.events.push(event);
                target.events.sort((a, b) => a.tick - b.tick);
            }
            event.notes = event.notes.filter(n => n.s !== moved.s);
            event.notes.push(moved);
            event.notes.sort((a, b) => a.s - b.s);
            return true;
        });
    }

    /** Set (or clear, with null) a note's articulation. */
    setArticulation(pos, tech, trackId = this.trackId) {
        return this._mutate(tech ? 'Add articulation' : 'Remove articulation', () => {
            const { note } = this._findNote(pos, trackId);
            if (!note) return false;
            if (tech) note.tech = tech;
            else if (note.tech !== undefined) delete note.tech;
            else return false;
            return true;
        });
    }

    setNoteDuration(pos, duration, trackId = this.trackId) {
        return this._mutate('Set duration', () => {
            const { note } = this._findNote(pos, trackId);
            if (!note) return false;
            note.dur = duration;
            return true;
        });
    }

    addMeasures(count = 1, trackId = this.trackId) {
        return this._mutate('Add measures', () => {
            const max = this.getMeasureCount(trackId);
            for (let i = 1; i <= count; i++) {
                this.getOrCreateMeasure(max + i, trackId);
            }
            return true;
        });
    }

    // ------------------------------------------------------------------
    // Tick-range selection ops (phrases): copy / cut / delete / paste
    // Ranges are half-open [startAbs, endAbs) in absolute ticks.
    // ------------------------------------------------------------------

    /**
     * Copy a range into the clipboard (and return the payload).
     * @param {number} startAbs
     * @param {number} endAbs
     * @param {Object} options - {strings?: number[]} filter
     */
    copyRange(startAbs, endAbs, { strings = null, trackId = this.trackId } = {}) {
        const data = [];
        for (const measure of this.getNotation(trackId)) {
            const base = this.toAbs(measure.measure, 0);
            for (const event of measure.events) {
                const abs = base + event.tick;
                if (abs < startAbs || abs >= endAbs) continue;
                const notes = event.notes.filter(
                    n => !strings || strings.includes(n.s));
                if (notes.length === 0) continue;
                data.push({ relativeTick: abs - startAbs, notes: clone(notes) });
            }
        }
        data.sort((a, b) => a.relativeTick - b.relativeTick);
        const payload = { type: 'notes', span: endAbs - startAbs, data };
        this.clipboard = payload;
        this._emit('clipboardChange', payload);
        return payload;
    }

    deleteRange(startAbs, endAbs, { strings = null, trackId = this.trackId } = {}) {
        return this._mutate('Delete range', () => {
            let changed = false;
            for (const measure of this.getNotation(trackId)) {
                const base = this.toAbs(measure.measure, 0);
                measure.events = measure.events.filter(event => {
                    const abs = base + event.tick;
                    if (abs < startAbs || abs >= endAbs) return true;
                    const kept = event.notes.filter(
                        n => strings && !strings.includes(n.s));
                    if (kept.length !== event.notes.length) changed = true;
                    event.notes = kept;
                    return kept.length > 0;
                });
            }
            return changed;
        });
    }

    cutRange(startAbs, endAbs, options = {}) {
        const payload = this.copyRange(startAbs, endAbs, options);
        this.deleteRange(startAbs, endAbs, options);
        return payload;
    }

    /**
     * Paste a payload with its start at an absolute tick. Events are
     * re-bucketed into measures through the ts-aware timeline, so a
     * phrase copied from 4/4 territory lands correctly around short
     * measures. Notes whose string doesn't exist on the target track are
     * skipped (transpose-on-paste comes later).
     */
    paste(atAbs, payload = this.clipboard, { trackId = this.trackId } = {}) {
        if (!payload || !payload.data || payload.data.length === 0) return false;
        const count = this.stringCount(trackId);
        return this._mutate('Paste', () => {
            let pasted = false;
            for (const item of payload.data) {
                const { measure, tick } = this.locate(atAbs + item.relativeTick);
                for (const note of item.notes) {
                    if (count && note.s > count) continue;
                    this._placeNote(trackId, measure, tick, clone(note));
                    pasted = true;
                }
            }
            return pasted;
        });
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    on(event, callback) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(callback);
    }

    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (!listeners) return;
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
    }

    _emit(event, data) {
        const listeners = this._listeners.get(event);
        if (!listeners) return;
        for (const cb of listeners) cb(data);
    }
}
