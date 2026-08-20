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
import { notePitch, fretForPitch } from './pitch.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

/**
 * The technique vocabulary the corpus and the renderer actually share:
 * hammer-on, pull-off, slide up, slide down, dead/muted note, choke/bend.
 * `~` is NOT here — a tie is `tie: true` on the continuation note, a
 * separate field the renderer draws an arc from (see setTie).
 */
export const TECHS = ['h', 'p', '/', '\\', 'x', 'b'];

/** Duration clamp for the scale ops: 32nd .. whole (at 480 tpb). */
export const MIN_DURATION = 60;
export const MAX_DURATION = 1920;

/**
 * Session identity of a note for duration bookkeeping: measure, tick and
 * string. NOT written to the document — see "Automatic duration" below.
 * @returns {string} "m:t:s"
 */
export function durationKey(measure, tick, string) {
    return `${measure}:${tick}:${string}`;
}

/**
 * Validate a technique value on its way into the document.
 * `~` is translated by the callers (it means "tie", not a tech); every
 * other unknown value throws rather than landing a symbol the renderer
 * and the player have never seen.
 */
function assertTech(tech) {
    if (tech == null) return null;
    if (!TECHS.includes(tech)) {
        throw new RangeError(
            `Unknown technique '${tech}' (expected one of ${TECHS.join(' ')})`);
    }
    return tech;
}

/**
 * Clean a typed track name into something safe to be a track id.
 *
 * A track id is not an internal handle — it IS the name the site shows
 * (`renderers/tablature.js` draws `<strong>${track.id}</strong>` into the
 * stave's track-info row, work-view's mixer prints it, the percussion
 * placeholder prints it), and it is a `data-track-id` attribute value and
 * a JSON object key. Two of those consumers interpolate it without
 * escaping, so the characters that could break out of markup are stripped
 * here, at the only place a human ever types one. Everything else —
 * spaces, mixed case, digits, hyphens — is kept, because the point of the
 * feature is that the user gets to choose the words.
 *
 * @param {*} name
 * @returns {string} the cleaned name ('' when nothing usable is left)
 */
export function sanitizeTrackId(name) {
    return String(name ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[<>&"'\\\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * The note a tie at (measure, tick, string) would hang from: the nearest
 * earlier note on the SAME string, in this measure or — when this note is
 * the measure's first on that string — the last one in the measure before.
 * That is exactly the pairing `tablature.js renderSlurs` draws its arc
 * from, so a tie with no predecessor is an arc from nowhere.
 *
 * @param {Map<number, Object>} byNumber - measure number → measure
 * @returns {{measure: number, tick: number, note: Object}|null}
 */
function tiePredecessorIn(byNumber, measureNum, tick, string) {
    const lastOn = (measure, before) => {
        let best = null;
        for (const event of measure?.events || []) {
            if (before != null && event.tick >= before) continue;
            const note = event.notes?.find(n => n.s === string);
            if (note && (!best || event.tick > best.tick)) {
                best = { measure: measure.measure, tick: event.tick, note };
            }
        }
        return best;
    };
    return lastOn(byNumber.get(measureNum), tick)
        || lastOn(byNumber.get(measureNum - 1), null);
}

export class EditingFacade {
    /**
     * @param {Object} otf - OTF document (deep-cloned; the facade owns its copy)
     * @param {Object} options
     * @param {string} [options.trackId] - initial track (defaults to first)
     */
    constructor(otf, options = {}) {
        this.otf = this._adopt(clone(otf));
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

    /**
     * Take ownership of a document, repairing the one encoding the
     * editor itself used to emit and nothing else ever read: `tech: '~'`.
     * A tie is `tie: true` on the CONTINUATION note (1,785 of them in a
     * 400-file corpus sample; the facade writes it itself when a long
     * note crosses a barline), and `renderers/tablature.js` draws the arc
     * from the same-string predecessor. A `~` got no arc and no sustain,
     * and carried a value the corpus has never contained.
     *
     * Conversion is per note: `~` becomes `tie: true` when a same-string
     * predecessor exists to draw the arc from, and is otherwise dropped.
     * No corpus document contains `~`, so for every real file this walk
     * changes nothing and the byte-identical round trip is untouched.
     *
     * @param {Object} doc - an already-cloned document (mutated in place)
     * @returns {Object} the same document
     */
    _adopt(doc) {
        const notation = doc?.notation;
        if (!notation) return doc;
        for (const measures of Object.values(notation)) {
            if (!Array.isArray(measures)) continue;
            const byNumber = new Map(measures.map(m => [m.measure, m]));
            for (const measure of measures) {
                for (const event of measure.events || []) {
                    for (const note of event.notes || []) {
                        if (note.tech !== '~') continue;
                        delete note.tech;
                        if (tiePredecessorIn(byNumber, measure.measure, event.tick, note.s)) {
                            note.tie = true;
                        }
                    }
                }
            }
        }
        return doc;
    }

    /**
     * Replace the document (deep-cloned). Resets the current track,
     * clears history and clipboard, and emits 'load' + 'change'.
     */
    load(otf, { trackId } = {}) {
        this.otf = this._adopt(clone(otf));
        const tracks = this.otf.tracks || [];
        this.trackId = trackId && tracks.some(t => t.id === trackId)
            ? trackId
            : tracks[0]?.id;
        this.clipboard = null;
        this.clearHistory();
        this._invalidateTiming();
        this._emit('load', this.otf);
        this._emit('change', this.otf);
    }

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

    // ------------------------------------------------------------------
    // Track identity and order
    //
    // Two facts shape both ops:
    //
    // 1. `notation` is keyed BY TRACK ID. A rename is therefore a
    //    two-part edit — the track's `id` and its notation key move
    //    together, or the track's music silently disappears. There is no
    //    display-name field to rename instead: the id IS the name every
    //    surface prints (the renderer's track-info row, work-view's
    //    mixer, the percussion placeholder, the editor's own switcher).
    //
    // 2. `tracks[]` order is MEANINGFUL, and `notation` is not ordered at
    //    all. work-view picks its lead as the first pitched track
    //    (`pitched[0]?.id`) unless a track's instrument matches the part,
    //    and `resolveEditTrackId`/`load()` fall back to `tracks[0]`. So
    //    "make this the lead" is literally "move it first" — and a move
    //    must leave `notation` alone, because reordering a keyed map
    //    would be churn with no meaning.
    // ------------------------------------------------------------------

    /** Position of a track in `tracks[]` (-1 when unknown). */
    trackIndex(trackId = this.trackId) {
        return this.getTracks().findIndex(t => t.id === trackId);
    }

    /**
     * Rename a track: its `id` and its notation key, which are the same
     * name. The notation object is rebuilt in key order so the renamed
     * key stays exactly where it was — the diff is one key, nothing
     * reshuffles, and a document that is only read still round-trips.
     *
     * @param {string} trackId - the track to rename
     * @param {string} newId - the typed name (sanitized, see sanitizeTrackId)
     * @returns {boolean} false when nothing changed (blank, or same name)
     * @throws {Error} unknown track, or a name another track already has
     *   (duplicate ids would collide in `notation` and make `getTrack`
     *   ambiguous — no document in the corpus has one)
     */
    renameTrack(trackId, newId) {
        const track = this.getTrack(trackId);
        if (!track) throw new Error(`Unknown track: ${trackId}`);
        const clean = sanitizeTrackId(newId);
        if (!clean || clean === track.id) return false;
        if (this.getTracks().some(t => t !== track && t.id === clean)) {
            throw new Error(`Track id already in use: ${clean}`);
        }
        const oldId = track.id;
        const wasCurrent = this.trackId === oldId;
        const result = this._mutate('Rename track', () => {
            const index = this.trackIndex(oldId);
            this.otf.tracks[index].id = clean;
            const notation = this.otf.notation;
            if (notation && Object.prototype.hasOwnProperty.call(notation, oldId)) {
                const rebuilt = {};
                for (const key of Object.keys(notation)) {
                    rebuilt[key === oldId ? clean : key] = notation[key];
                }
                this.otf.notation = rebuilt;
            }
            return true;
        });
        if (result !== false && wasCurrent) {
            this.trackId = clean;
            this._emit('trackChange', clean);
        }
        return result;
    }

    /**
     * Move a track to `toIndex` in `tracks[]`, clamped to the ends.
     * `notation` is NOT touched — it is keyed, not positional.
     *
     * @returns {boolean} false when the track is already there
     * @throws {Error} unknown track
     */
    moveTrack(trackId, toIndex) {
        const from = this.trackIndex(trackId);
        if (from === -1) throw new Error(`Unknown track: ${trackId}`);
        if (!Number.isFinite(Number(toIndex))) return false;
        const last = this.getTracks().length - 1;
        const to = Math.max(0, Math.min(last, Math.trunc(Number(toIndex))));
        if (to === from) return false;
        return this._mutate('Reorder tracks', () => {
            const [moved] = this.otf.tracks.splice(from, 1);
            this.otf.tracks.splice(to, 0, moved);
            return true;
        });
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

    clearHistory() {
        this._history = [];
        this._historyIndex = -1;
    }

    canUndo() { return this._historyIndex >= 0; }
    canRedo() { return this._historyIndex < this._history.length - 1; }

    undo() {
        if (!this.canUndo()) return false;
        const index = this.trackIndex();
        this.otf = clone(this._history[this._historyIndex].before);
        this._historyIndex--;
        this._invalidateTiming();
        this._reconcileTrack(index);
        this._emit('change', this.otf);
        this._emit('undo');
        return true;
    }

    redo() {
        if (!this.canRedo()) return false;
        const index = this.trackIndex();
        this._historyIndex++;
        this.otf = clone(this._history[this._historyIndex].after);
        this._invalidateTiming();
        this._reconcileTrack(index);
        this._emit('change', this.otf);
        this._emit('redo');
        return true;
    }

    /**
     * A history swap can strand `this.trackId`: undoing a rename puts the
     * old id back in the document while the facade still points at the
     * new one, and the next `getNotation()` would happily MINT an empty
     * array under the dead name. A rename never moves a track, so the
     * track now sitting at the same index is the same track; only if even
     * that is gone do we fall back to the first one.
     *
     * @param {number} index - the current track's position before the swap
     */
    _reconcileTrack(index) {
        if (this.getTrack(this.trackId)) return;
        const tracks = this.getTracks();
        const next = (index >= 0 ? tracks[index]?.id : undefined) ?? tracks[0]?.id;
        this.trackId = next;
        this._emit('trackChange', next);
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
     * `tech: '~'` is NOT a technique (nothing renders or plays it): it
     * means "tie this to the note before it on the same string", and is
     * routed to `tie: true` when such a note exists, dropped when it does
     * not. Every other tech value must be in TECHS or this throws.
     *
     * With `autoDuration: true` the note's `dur` — and every unpinned
     * auto-entered note in the same measure — is computed by the column
     * rule instead (see "Automatic duration" below), in this same
     * transaction, so one undo takes back the note AND its neighbour's
     * re-timing.
     *
     * @param {Object} p - {measure, tick, string, fret, duration?, tech?,
     *   trackId?, autoDuration?, pins?, autoEntered?}
     */
    insertNote({ measure, tick, string, fret, duration = null, tech = null,
        trackId = this.trackId, autoDuration = false,
        pins = null, autoEntered = null }) {
        this._validateString(string, trackId);
        const tie = tech === '~';
        if (tie) tech = null;
        else assertTech(tech);
        if (autoDuration) {
            return this._mutate('Insert note', () => {
                const note = { s: string, f: fret, ...(tech ? { tech } : {}) };
                this._placeNote(trackId, measure, tick, note);
                if (tie && this.tiePredecessor({ measure, tick, string }, trackId)) {
                    note.tie = true;
                }
                const key = durationKey(measure, tick, string);
                if (pins) pins.delete(key);
                if (autoEntered) autoEntered.add(key);
                this._recomputeAuto(measure, trackId, { pins, only: autoEntered });
                return true;
            });
        }
        return this._mutate('Insert note', () => {
            if (duration == null) {
                const note = { s: string, f: fret, ...(tech ? { tech } : {}) };
                this._placeNote(trackId, measure, tick, note);
                if (tie && this.tiePredecessor({ measure, tick, string }, trackId)) {
                    note.tie = true;
                }
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
                if (first && tie
                    && this.tiePredecessor({ measure: m, tick: t, string }, trackId)) {
                    note.tie = true;
                }
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

    /**
     * @param {Object} pos - {measure, tick, string}
     * @param {string} [trackId]
     * @param {Object} [opts] - {autoDuration, pins, autoEntered}: re-time
     *   the measure's auto-entered notes in the same transaction, so
     *   deleting a note re-extends the one before it.
     */
    deleteNote(pos, trackId = this.trackId, opts = {}) {
        return this._mutate('Delete note', () => {
            const { measure, event, note } = this._findNote(pos, trackId);
            if (!note) return false;
            event.notes = event.notes.filter(n => n !== note);
            if (event.notes.length === 0) {
                measure.events = measure.events.filter(e => e !== event);
            }
            this._afterAutoEdit(pos.measure, trackId, opts,
                [durationKey(pos.measure, pos.tick, pos.string)]);
            return true;
        });
    }

    deleteTick({ measure, tick }, trackId = this.trackId, opts = {}) {
        return this._mutate('Delete tick', () => {
            const m = this.getMeasure(measure, trackId);
            if (!m) return false;
            const idx = m.events.findIndex(e => e.tick === tick);
            if (idx === -1) return false;
            const gone = m.events[idx].notes.map(
                n => durationKey(measure, tick, n.s));
            m.events.splice(idx, 1);
            this._afterAutoEdit(measure, trackId, opts, gone);
            return true;
        });
    }

    /** Forget deleted keys, then re-time the measure (auto mode only). */
    _afterAutoEdit(measureNum, trackId, { autoDuration = false, pins = null,
        autoEntered = null } = {}, removedKeys = []) {
        for (const key of removedKeys) {
            if (pins) pins.delete(key);
            if (autoEntered) autoEntered.delete(key);
        }
        if (!autoDuration) return false;
        return this._recomputeAuto(measureNum, trackId, { pins, only: autoEntered });
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

    /**
     * Set (or clear, with null) a note's articulation.
     *
     * `tech` must be one of TECHS. `'~'` is not a technique — it is
     * delegated to `setTie(pos, true)`, because that is what the user
     * meant and what the renderer can draw. `tie` and `tech` are
     * independent: 21 notes in a corpus sample carry both `tie: true`
     * and `tech: '/'`, so neither op ever clears the other's field.
     *
     * @throws {RangeError} on a tech value outside the vocabulary
     */
    setArticulation(pos, tech, trackId = this.trackId) {
        if (tech === '~') return this.setTie(pos, true, { trackId });
        assertTech(tech);
        return this._mutate(tech ? 'Add articulation' : 'Remove articulation', () => {
            const { note } = this._findNote(pos, trackId);
            if (!note) return false;
            if (tech) note.tech = tech;
            else if (note.tech !== undefined) delete note.tech;
            else return false;
            return true;
        });
    }

    /**
     * The note a tie at `pos` would hang from (null when there is none).
     * @param {Object} pos - {measure, tick, string}
     */
    tiePredecessor({ measure, tick, string }, trackId = this.trackId) {
        const byNumber = new Map(
            this.getNotation(trackId).map(m => [m.measure, m]));
        return tiePredecessorIn(byNumber, measure, tick, string);
    }

    /**
     * Tie the note at `pos` to its same-string predecessor (`tie: true`),
     * or clear the tie with `on: false`.
     *
     * Refuses — no mutation — when there is nothing to tie FROM: the arc
     * `renderers/tablature.js` draws runs from the previous note on the
     * same string (in this measure, or the last one in the measure
     * before), so a tie without one is an arc from nowhere and a sustain
     * the player cannot attach. Clearing a tie that isn't set is also a
     * no-op. `tech` is never touched either way.
     *
     * @returns {boolean} false when nothing changed
     */
    setTie(pos, on = true, { trackId = this.trackId } = {}) {
        const { note } = this._findNote(pos, trackId);
        if (!note) return false;
        if (on && note.tie === true) return false;
        if (!on && note.tie !== true) return false;
        if (on && !this.tiePredecessor(pos, trackId)) return false;
        return this._mutate(on ? 'Add tie' : 'Remove tie', () => {
            const found = this._findNote(pos, trackId);
            if (on) found.note.tie = true;
            else delete found.note.tie;
            return true;
        });
    }

    setNoteDuration(pos, duration, trackId = this.trackId) {
        return this._mutate('Set duration', () => {
            const { note } = this._findNote(pos, trackId);
            if (!note) return false;
            if (note.dur === duration) return false;
            note.dur = duration;
            return true;
        });
    }

    // ------------------------------------------------------------------
    // Duration editing: a range, and halve/double.
    //
    // `dur` is plain ticks, so a dotted or triplet value needs no flag —
    // 720 IS a dotted quarter and 160 IS a triplet eighth, and today's
    // renderer already draws both (751 triplet eighths and 122 dotted
    // quarters on banjo tracks alone).
    // ------------------------------------------------------------------

    /**
     * Every note whose onset falls in [startAbs, endAbs), with its
     * position — the shared scan behind the range ops and the state's
     * duration pinning.
     * @returns {Array<{measure: number, tick: number, string: number, note: Object}>}
     */
    notesInRange(startAbs, endAbs, { strings = null, trackId = this.trackId } = {}) {
        const out = [];
        for (const measure of this.getNotation(trackId)) {
            const base = this.toAbs(measure.measure, 0);
            for (const event of measure.events) {
                const abs = base + event.tick;
                if (abs < startAbs || abs >= endAbs) continue;
                for (const note of event.notes) {
                    if (strings && !strings.includes(note.s)) continue;
                    out.push({
                        measure: measure.measure, tick: event.tick,
                        string: note.s, note,
                    });
                }
            }
        }
        return out;
    }

    /**
     * Apply one duration to every note in a tick range (TablEdit's `*`).
     * @returns {boolean} false when nothing changed
     */
    setRangeDuration(startAbs, endAbs, duration, { strings = null, trackId = this.trackId } = {}) {
        if (!(duration > 0)) return false;
        return this._mutate('Set duration', () => {
            let changed = false;
            for (const { note } of this.notesInRange(startAbs, endAbs, { strings, trackId })) {
                if (note.dur === duration) continue;
                note.dur = duration;
                changed = true;
            }
            return changed;
        });
    }

    /**
     * Halve (`factor` 0.5) or double (2) the duration of the note at
     * `pos`, clamped to [MIN_DURATION, MAX_DURATION]. A note with no
     * explicit `dur` is scaled from what the column rule says it sounds
     * like, so `<`/`>` work on imported and auto-timed notes alike.
     * @returns {boolean} false when there is no note, or it can't move
     */
    scaleDuration(pos, factor, trackId = this.trackId) {
        const { note } = this._findNote(pos, trackId);
        if (!note || !(factor > 0)) return false;
        const next = this._scaled(note.dur ?? this.autoDurationAt(pos, trackId), factor);
        if (next == null || next === note.dur) return false;
        return this.setNoteDuration(pos, next, trackId);
    }

    /** scaleDuration over a tick range. @returns {boolean} */
    scaleRangeDuration(startAbs, endAbs, factor, { strings = null, trackId = this.trackId } = {}) {
        if (!(factor > 0)) return false;
        return this._mutate('Scale duration', () => {
            let changed = false;
            for (const hit of this.notesInRange(startAbs, endAbs, { strings, trackId })) {
                const base = hit.note.dur ?? this.autoDurationAt(hit, trackId);
                const next = this._scaled(base, factor);
                if (next == null || next === hit.note.dur) continue;
                hit.note.dur = next;
                changed = true;
            }
            return changed;
        });
    }

    _scaled(base, factor) {
        if (!(base > 0)) return null;
        const raw = Math.round(base * factor);
        const next = Math.max(MIN_DURATION, Math.min(MAX_DURATION, raw));
        return next;
    }

    /**
     * Move a note's fret by `delta`, clamped to 0..24 — the typo fixer
     * (`+`/`-`), not a transposition of anything else.
     * @returns {boolean} false when there is no note or it can't move
     */
    transposeFret(pos, delta, trackId = this.trackId) {
        const { note } = this._findNote(pos, trackId);
        if (!note || !Number.isFinite(delta)) return false;
        const next = Math.max(0, Math.min(24, note.f + delta));
        if (next === note.f) return false;
        return this._mutate('Transpose note', () => {
            this._findNote(pos, trackId).note.f = next;
            return true;
        });
    }

    /**
     * Re-string a note onto its neighbour, KEEPING ITS PITCH — the most
     * consistent cross-product expectation there is (Guitar Pro,
     * MuseScore and Soundslice all do it; TuxGuitar keeps the fret
     * instead). The new fret is the old sounding pitch minus the target
     * string's open pitch (`pitch.js`, ported from the player's own
     * `tuning[s-1] + f`).
     *
     * Refuses — no mutation — when the target string doesn't exist, is
     * already occupied at that tick, the track has no usable tuning
     * (percussion), or the fret would land outside 0..24.
     *
     * @param {Object} pos - {measure, tick, string}
     * @param {number} direction - +1 (toward string 5) or -1
     * @returns {boolean}
     */
    moveNoteToString(pos, direction, trackId = this.trackId) {
        if (direction !== 1 && direction !== -1) return false;
        const { event, note } = this._findNote(pos, trackId);
        if (!note) return false;
        const target = pos.string + direction;
        const count = this.stringCount(trackId);
        if (!(target >= 1) || (count && target > count)) return false;
        if (event.notes.some(n => n.s === target)) return false;
        const track = this.getTrack(trackId);
        const pitch = notePitch(track, note);
        if (pitch == null) return false;
        const fret = fretForPitch(track, target, pitch);
        if (fret == null || fret < 0 || fret > 24) return false;
        return this._mutate('Move note to string', () => {
            const found = this._findNote(pos, trackId);
            const moved = clone(found.note);
            moved.s = target;
            moved.f = fret;
            found.event.notes = found.event.notes.filter(n => n !== found.note);
            found.event.notes.push(moved);
            found.event.notes.sort((a, b) => a.s - b.s);
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

    /**
     * Insert an empty written measure AS `measureNum`, shifting measures
     * >= measureNum up by one on EVERY track — written measures are
     * shared score structure, so a single-track shift would desync an
     * ensemble doc. reading_list ranges and time_signature_changes are
     * renumbered with it (a range straddling the split grows, keeping
     * play order intact) — and so are placed annotations, which anchor to
     * written measures exactly like a reading-list range does. One undo
     * step.
     */
    insertMeasure(measureNum) {
        if (!(measureNum >= 1)) return false;
        return this._mutate('Insert measure', () => {
            for (const notation of Object.values(this.otf.notation || {})) {
                for (const m of notation) {
                    if (m.measure >= measureNum) m.measure++;
                }
            }
            if (this.otf.reading_list?.length) {
                for (const r of this.otf.reading_list) {
                    if (r.from_measure >= measureNum) r.from_measure++;
                    if (r.to_measure >= measureNum) r.to_measure++;
                }
            }
            const tsc = this.otf.metadata?.time_signature_changes;
            if (Array.isArray(tsc)) {
                for (const c of tsc) {
                    if (c.measure >= measureNum) c.measure++;
                }
            }
            if (Array.isArray(this.otf.annotations)) {
                for (const a of this.otf.annotations) {
                    if (a.measure >= measureNum) a.measure++;
                }
            }
            this._invalidateTiming();
            return true;
        });
    }

    /**
     * Delete written measure `measureNum` — the exact inverse of
     * `insertMeasure`, and the same all-tracks edit for the same reason:
     * written measures are shared score structure, so removing one from a
     * single track would desync an ensemble document.
     *
     * Everything anchored to a written measure moves with it:
     * - `notation`: the measure is dropped on every track, later ones -1
     * - `reading_list`: ranges shrink; a range that WAS only this measure
     *   is dropped (it would otherwise name a measure that isn't there)
     * - `time_signature_changes`: a change at `measureNum` survives at
     *   `measureNum` (it governs what is now that measure) UNLESS the
     *   next measure had its own change, which takes the slot instead —
     *   either way every surviving measure keeps the signature it had
     * - `annotations`: text placed in the measure goes with it
     *
     * Refuses when the number is out of range or it is the last measure
     * the document has (a document with no measures has nowhere to put a
     * cursor). One undo step.
     *
     * @returns {boolean} false when nothing was deleted
     */
    deleteMeasure(measureNum) {
        if (!(measureNum >= 1)) return false;
        const max = Math.max(1, maxMeasureIn(this.otf.notation || {}));
        if (measureNum > max || max <= 1) return false;
        return this._mutate('Delete measure', () => {
            for (const [trackId, notation] of Object.entries(this.otf.notation || {})) {
                this.otf.notation[trackId] = notation.filter(m => m.measure !== measureNum);
                for (const m of this.otf.notation[trackId]) {
                    if (m.measure > measureNum) m.measure--;
                }
            }
            if (this.otf.reading_list?.length) {
                const kept = [];
                for (const r of this.otf.reading_list) {
                    if (r.from_measure === measureNum && r.to_measure === measureNum) continue;
                    if (r.from_measure > measureNum) r.from_measure--;
                    if (r.to_measure >= measureNum) r.to_measure--;
                    kept.push(r);
                }
                if (kept.length) this.otf.reading_list = kept;
                else delete this.otf.reading_list;
            }
            const tsc = this.otf.metadata?.time_signature_changes;
            if (Array.isArray(tsc)) {
                const successorHasOwn = tsc.some(c => c.measure === measureNum + 1);
                const kept = [];
                for (const c of tsc) {
                    if (c.measure === measureNum && successorHasOwn) continue;
                    if (c.measure > measureNum) c.measure--;
                    kept.push(c);
                }
                this.otf.metadata.time_signature_changes = kept;
            }
            if (Array.isArray(this.otf.annotations)) {
                const kept = [];
                for (const a of this.otf.annotations) {
                    if (a.measure === measureNum) continue;
                    if (a.measure > measureNum) a.measure--;
                    kept.push(a);
                }
                if (kept.length) this.otf.annotations = kept;
                else delete this.otf.annotations;
            }
            this._invalidateTiming();
            return true;
        });
    }

    /**
     * Ripple the tail of a measure (TablEdit's Alt+Insert / Alt+Delete):
     * every note at or after `tick` in that measure, on that track, moves
     * by `ticks` (positive = later). "I left out a note" is the most
     * common correction in transcription, and `dd` only ever left a hole.
     *
     * Refuses — no mutation at all — when a note would leave the measure
     * (this never ties across a barline; the note count is preserved) or
     * would land on a tick that is already occupied by a note staying put.
     *
     * @returns {boolean} false when refused, or nothing was there to move
     */
    shiftRight(measureNum, tick, ticks, { trackId = this.trackId } = {}) {
        if (!Number.isFinite(ticks) || ticks === 0) return false;
        const measure = this.getMeasure(measureNum, trackId);
        if (!measure) return false;
        const cap = this.ticksFor(measureNum);
        const moving = measure.events.filter(e => e.tick >= tick);
        if (moving.length === 0) return false;
        const staying = measure.events.filter(e => e.tick < tick);
        const stayingTicks = new Set(staying.map(e => e.tick));
        for (const event of moving) {
            const next = event.tick + ticks;
            if (next < 0 || next >= cap) return false;
            if (stayingTicks.has(next)) return false;
        }
        return this._mutate(ticks > 0 ? 'Shift right' : 'Shift left', () => {
            const m = this.getMeasure(measureNum, trackId);
            for (const event of m.events) {
                if (event.tick >= tick) event.tick += ticks;
            }
            m.events.sort((a, b) => a.tick - b.tick);
            return true;
        });
    }

    /** shiftRight with the sign flipped. @see shiftRight */
    shiftLeft(measureNum, tick, ticks, options = {}) {
        return this.shiftRight(measureNum, tick, -Math.abs(ticks), options);
    }

    /**
     * Copy measure N−1's notes into measure N — the bluegrass backup and
     * vamp accelerator ("this bar again"). The measure is created when it
     * doesn't exist yet, so it also appends at the end of the tune.
     *
     * Refuses when N−1 doesn't exist, when N already has notes (this
     * never overwrites music), or when the source measure is longer than
     * the destination (a 4/4 bar does not fit in a 2/4 one).
     *
     * @returns {boolean}
     */
    repeatMeasure(measureNum, { trackId = this.trackId } = {}) {
        if (!(measureNum >= 2)) return false;
        const source = this.getMeasure(measureNum - 1, trackId);
        if (!source) return false;
        const existing = this.getMeasure(measureNum, trackId);
        if (existing && existing.events.some(e => e.notes.length > 0)) return false;
        const events = source.events.filter(e => e.notes.length > 0);
        if (events.length === 0) return false;
        const cap = this.ticksFor(measureNum);
        if (events.some(e => e.tick >= cap)) return false;
        return this._mutate('Repeat measure', () => {
            const target = this.getOrCreateMeasure(measureNum, trackId);
            target.events = clone(events);
            target.events.sort((a, b) => a.tick - b.tick);
            return true;
        });
    }

    // ------------------------------------------------------------------
    // Automatic duration (TablEdit's "no explicit current duration")
    //
    // THE COLUMN RULE: a note's `dur` is the gap to the next onset on ANY
    // string of the same track, within the same measure, and to the
    // measure end when there is none. Not the same-string gap TablEdit's
    // manual describes — that would make every 5th-string note of a
    // Scruggs roll a dotted quarter, and what TablEdit users actually
    // WRITE (95,702 notes across every 5-string banjo track in
    // docs/data/tabs/) is eighths 63.6%, dotted quarters 0.1%. Rolls are
    // eighths, so the column rule is the TablEdit-faithful one.
    //
    // Measure-bounded on purpose: auto never ties across a barline, so
    // the last note of a measure fills to the barline. OTF has no rests,
    // which makes trailing silence the one thing auto cannot express —
    // the escape hatch is setting that note's duration explicitly, which
    // pins it.
    //
    // PINNING IS SESSION STATE, NEVER FORMAT. The document has no
    // "manual duration" flag and must not grow one, so the caller (the
    // editor state) keeps two Sets of `durationKey` strings and hands
    // them in: `pins` (durations the user set by hand — auto never
    // touches these) and `autoEntered` (notes typed under auto this
    // session — auto touches ONLY these). A reopened document therefore
    // starts with both empty, i.e. fully pinned: you didn't type those
    // notes, so nothing re-times them behind your back. `fixDurations`
    // is the deliberate one-shot that ignores both.
    // ------------------------------------------------------------------

    /**
     * What the column rule says a note at `pos` should sound for — the
     * prediction the status bar and the ghost note show before you type.
     * @param {Object} pos - {measure, tick}
     * @returns {number} ticks (the rest of the measure when nothing follows)
     */
    autoDurationAt({ measure, tick }, trackId = this.trackId) {
        const cap = this.ticksFor(measure);
        const m = this.getMeasure(measure, trackId);
        let next = cap;
        for (const event of m?.events || []) {
            if (event.tick > tick && event.notes.length > 0 && event.tick < next) {
                next = event.tick;
            }
        }
        return Math.max(0, next - tick);
    }

    /**
     * Re-time a measure's notes by the column rule.
     * @param {number} measureNum
     * @param {string} trackId
     * @param {Object} opts
     * @param {Set<string>} [opts.pins] - keys auto must not touch
     * @param {Set<string>} [opts.only] - when given, the ONLY keys auto may touch
     * @param {{startAbs: number, endAbs: number}} [opts.absRange] - limit to
     *   notes whose onset falls in this half-open range
     * @returns {boolean} whether anything changed
     */
    _recomputeAuto(measureNum, trackId, { pins = null, only = null, absRange = null } = {}) {
        const measure = this.getMeasure(measureNum, trackId);
        if (!measure) return false;
        const cap = this.ticksFor(measureNum);
        const base = this.toAbs(measureNum, 0);
        const sounding = measure.events
            .filter(e => e.notes.length > 0)
            .sort((a, b) => a.tick - b.tick);
        let changed = false;
        for (let i = 0; i < sounding.length; i++) {
            const event = sounding[i];
            const dur = (sounding[i + 1]?.tick ?? cap) - event.tick;
            if (dur <= 0) continue;
            if (absRange) {
                const abs = base + event.tick;
                if (abs < absRange.startAbs || abs >= absRange.endAbs) continue;
            }
            for (const note of event.notes) {
                // A tie continuation's length belongs to the note it
                // continues, not to this column — leave it alone.
                if (note.tie === true) continue;
                const key = durationKey(measureNum, event.tick, note.s);
                if (pins && pins.has(key)) continue;
                if (only && !only.has(key)) continue;
                if (note.dur === dur) continue;
                note.dur = dur;
                changed = true;
            }
        }
        return changed;
    }

    /**
     * One-shot "fix durations from spacing" (TablEdit's `J`): re-time by
     * the column rule, ignoring pins entirely. This is the repair for a
     * hand-entered tab where someone forgot to change duration — the only
     * op that re-times notes the user typed by hand, and it only ever
     * runs because they asked.
     *
     * @param {number|{startAbs: number, endAbs: number}} target - a written
     *   measure, or a tick range (whose measures' rule is still computed
     *   from the whole measure — the rule is measure-scoped)
     * @returns {boolean} false when nothing changed
     */
    fixDurations(target, { trackId = this.trackId } = {}) {
        return this._mutate('Fix durations', () => {
            let changed = false;
            if (typeof target === 'number') {
                changed = this._recomputeAuto(target, trackId) || changed;
                return changed;
            }
            const { startAbs, endAbs } = target || {};
            if (!Number.isFinite(startAbs) || !Number.isFinite(endAbs)) return false;
            for (const measure of this.getNotation(trackId)) {
                const base = this.toAbs(measure.measure, 0);
                if (base >= endAbs || base + this.ticksFor(measure.measure) <= startAbs) continue;
                changed = this._recomputeAuto(measure.measure, trackId,
                    { absRange: { startAbs, endAbs } }) || changed;
            }
            return changed;
        });
    }

    /** Set the document tempo (quarter-note BPM). Undoable. */
    setTempo(bpm) {
        const v = Number(bpm);
        if (!Number.isFinite(v) || v < 1) return false;
        return this._mutate('Set tempo', () => {
            if (!this.otf.metadata) this.otf.metadata = {};
            if (this.otf.metadata.tempo === v) return false;
            this.otf.metadata.tempo = v;
            return true;
        });
    }

    /** Set (or clear with null) a fingering annotation. Undoable. */
    setFingering(pos, finger, trackId = this.trackId) {
        return this._mutate(finger ? 'Add fingering' : 'Remove fingering', () => {
            const { note } = this._findNote(pos, trackId);
            if (!note || note.finger === finger) return false;
            if (finger) note.finger = finger;
            else delete note.finger;
            return true;
        });
    }

    // ------------------------------------------------------------------
    // Placed free-text annotations
    //
    // `otf.annotations` is a TOP-LEVEL array of {measure, tick, text}
    // anchored to a spot in the score, not to a track or a note: section
    // banners ("PART A"), playing notes ("Long Choke") and chord names
    // ("Bb6+9") all live here, and the renderer x-positions each one by
    // its tick within its written measure.
    //
    // Two annotations may legitimately share one (measure, tick) —
    // Welcome to New York m14 carries both "PART B" and "F" at tick 0 —
    // so they are addressed by INDEX, never by position. Every op keeps
    // the existing entries' relative order untouched, so a document that
    // is only read through the editor round-trips byte-for-byte.
    // ------------------------------------------------------------------

    /** The document's annotations (live array; `[]` when it has none). */
    annotations() {
        return this.otf.annotations || [];
    }

    /**
     * Index of the annotation at (or nearest to) a position, searching
     * WITHIN the given measure only.
     * @param {Object} pos - {measure, tick}
     * @param {Object} [opts] - {maxTicks} how far from `tick` still counts
     * @returns {number} index, or -1 when nothing qualifies
     */
    findAnnotationIndex({ measure, tick = 0 }, { maxTicks = null } = {}) {
        const anns = this.annotations();
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < anns.length; i++) {
            if (anns[i].measure !== measure) continue;
            const dist = Math.abs((anns[i].tick || 0) - tick);
            if (dist < bestDist) { bestDist = dist; best = i; }
        }
        if (best === -1) return -1;
        return bestDist <= (maxTicks == null ? Infinity : maxTicks) ? best : -1;
    }

    /**
     * Add an annotation. Text is trimmed; empty text is a no-op (an empty
     * annotation is a blank label nobody can see or select again).
     * The entry is spliced in at its score-order position — before the
     * first entry that sorts after it — which never reorders what is
     * already there.
     * @returns {boolean} false when nothing was added
     */
    addAnnotation({ measure, tick = 0, text }) {
        const clean = String(text ?? '').trim();
        if (!clean) return false;
        if (!Number.isInteger(measure) || measure < 1) return false;
        if (!Number.isInteger(tick) || tick < 0) return false;
        return this._mutate('Add text', () => {
            if (!Array.isArray(this.otf.annotations)) this.otf.annotations = [];
            const anns = this.otf.annotations;
            let at = anns.length;
            for (let i = 0; i < anns.length; i++) {
                const a = anns[i];
                if (a.measure > measure
                    || (a.measure === measure && (a.tick || 0) > tick)) {
                    at = i;
                    break;
                }
            }
            anns.splice(at, 0, { measure, tick, text: clean });
            return true;
        });
    }

    /**
     * Retext an annotation. Empty (or whitespace-only) text DELETES it
     * rather than persisting a blank — clearing the box is how you get
     * rid of one.
     * @returns {boolean} false when nothing changed
     */
    setAnnotationText(index, text) {
        const anns = this.annotations();
        if (!(index >= 0 && index < anns.length)) return false;
        const clean = String(text ?? '').trim();
        if (!clean) return this.deleteAnnotation(index);
        return this._mutate('Edit text', () => {
            if (this.otf.annotations[index].text === clean) return false;
            this.otf.annotations[index].text = clean;
            return true;
        });
    }

    /** Delete an annotation by index. Undoable. */
    deleteAnnotation(index) {
        const anns = this.annotations();
        if (!(index >= 0 && index < anns.length)) return false;
        return this._mutate('Delete text', () => {
            this.otf.annotations.splice(index, 1);
            // Keep plain documents plain (same rule as reading_list)
            if (this.otf.annotations.length === 0) delete this.otf.annotations;
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
    copyRange(startAbs, endAbs, { strings = null, trackId = this.trackId, updateClipboard = true } = {}) {
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
        if (updateClipboard) {
            this.clipboard = payload;
            this._emit('clipboardChange', payload);
        }
        return payload;
    }

    /**
     * Move a tick range wholesale (drag a phrase somewhere else): one
     * undo step, ts-aware re-bucketing at the destination, clipboard
     * untouched. Overlapping source/destination is fine — the source is
     * cleared before the paste.
     *
     * @param {number} startAbs - source range start (inclusive)
     * @param {number} endAbs - source range end (exclusive)
     * @param {number} destAbs - destination start tick
     * @returns {boolean} false if the source range was empty
     */
    moveRange(startAbs, endAbs, destAbs, { strings = null, trackId = this.trackId } = {}) {
        const payload = this.copyRange(startAbs, endAbs,
            { strings, trackId, updateClipboard: false });
        if (payload.data.length === 0 || destAbs === startAbs) return false;
        return this.transact('Move phrase', () => {
            this.deleteRange(startAbs, endAbs, { strings, trackId });
            this.paste(destAbs, payload, { trackId });
            return true;
        });
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
    paste(atAbs, payload = this.clipboard, { trackId = this.trackId,
        autoDuration = false, pins = null, autoEntered = null } = {}) {
        if (!payload || !payload.data || payload.data.length === 0) return false;
        const count = this.stringCount(trackId);
        return this._mutate('Paste', () => {
            let pasted = false;
            const touched = new Set();
            for (const item of payload.data) {
                const { measure, tick } = this.locate(atAbs + item.relativeTick);
                for (const note of item.notes) {
                    if (count && note.s > count) continue;
                    this._placeNote(trackId, measure, tick, clone(note));
                    // A pasted note keeps the rhythm it was copied with:
                    // it is not "entered under auto", so it is neither
                    // pinned nor re-timed. Its NEIGHBOURS still adapt.
                    if (pins) pins.delete(durationKey(measure, tick, note.s));
                    if (autoEntered) autoEntered.delete(durationKey(measure, tick, note.s));
                    touched.add(measure);
                    pasted = true;
                }
            }
            if (pasted && autoDuration) {
                for (const measure of touched) {
                    this._recomputeAuto(measure, trackId, { pins, only: autoEntered });
                }
            }
            return pasted;
        });
    }

    // ------------------------------------------------------------------
    // Repeats & endings — reading_list ops.
    // Repeat signs and ending brackets are DERIVED from reading_list
    // (play-order measure ranges); editing repeats = editing the
    // ranges. Ops expand to the flat play sequence, splice, recompress.
    // ------------------------------------------------------------------

    /** Flat play-order sequence of written measures. */
    readingSequence() {
        const rl = this.otf.reading_list;
        const max = Math.max(1, maxMeasureIn(this.otf.notation || {}));
        if (!rl || rl.length === 0) {
            return Array.from({ length: max }, (_, i) => i + 1);
        }
        const seq = [];
        for (const r of rl) {
            for (let m = r.from_measure; m <= r.to_measure; m++) seq.push(m);
        }
        return seq;
    }

    _setSequence(seq) {
        // Recompress into contiguous ranges; an identity sequence means
        // no reading list at all (keeps plain docs plain).
        const ranges = [];
        for (const m of seq) {
            const last = ranges[ranges.length - 1];
            if (last && m === last.to_measure + 1) last.to_measure = m;
            else ranges.push({ from_measure: m, to_measure: m });
        }
        const max = Math.max(1, maxMeasureIn(this.otf.notation || {}));
        const identity = ranges.length === 1
            && ranges[0].from_measure === 1 && ranges[0].to_measure === max;
        if (identity) delete this.otf.reading_list;
        else this.otf.reading_list = ranges;
    }

    _findContiguous(seq, from, to) {
        const len = to - from + 1;
        outer:
        for (let i = 0; i <= seq.length - len; i++) {
            for (let k = 0; k < len; k++) {
                if (seq[i + k] !== from + k) continue outer;
            }
            return i;
        }
        return -1;
    }

    /** |: from .. to :| — play the span twice. One undo step. */
    repeatSpan(from, to) {
        if (!(from >= 1 && to >= from)) return false;
        const seq = this.readingSequence();
        const idx = this._findContiguous(seq, from, to);
        if (idx === -1) return false;
        return this._mutate('Add repeat', () => {
            const span = [];
            for (let m = from; m <= to; m++) span.push(m);
            seq.splice(idx + span.length, 0, ...span);
            this._setSequence(seq);
            return true;
        });
    }

    /**
     * Repeat with 1st/2nd endings. Written layout: body = from ..
     * firstEndingStart-1, 1st ending = firstEndingStart .. firstEndingTo,
     * 2nd ending = firstEndingTo+1 .. secondEndingTo. Play order:
     * body+1st, body, 2nd — the range shape TablEdit reading lists use
     * (and analyzeReadingList reconstructs brackets from).
     */
    repeatSpanWithEndings(from, firstEndingStart, firstEndingTo, secondEndingTo) {
        if (!(from >= 1
            && firstEndingStart > from
            && firstEndingTo >= firstEndingStart
            && secondEndingTo > firstEndingTo)) return false;
        const seq = this.readingSequence();
        const idx = this._findContiguous(seq, from, secondEndingTo);
        if (idx === -1) return false;
        return this._mutate('Add repeat with endings', () => {
            const out = [];
            for (let m = from; m <= firstEndingTo; m++) out.push(m);           // body + 1st
            for (let m = from; m < firstEndingStart; m++) out.push(m);         // body again
            for (let m = firstEndingTo + 1; m <= secondEndingTo; m++) out.push(m); // 2nd
            seq.splice(idx, secondEndingTo - from + 1, ...out);
            this._setSequence(seq);
            return true;
        });
    }

    /** Remove a repeat: delete the SECOND contiguous occurrence of the span. */
    removeRepeat(from, to) {
        const seq = this.readingSequence();
        const first = this._findContiguous(seq, from, to);
        if (first === -1) return false;
        const len = to - from + 1;
        const second = this._findContiguous(seq.slice(first + 1), from, to);
        if (second === -1) return false;
        return this._mutate('Remove repeat', () => {
            seq.splice(first + 1 + second, len);
            this._setSequence(seq);
            return true;
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
