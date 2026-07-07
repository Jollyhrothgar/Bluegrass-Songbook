// OTF Editor Keyboard Handler
// Handles keyboard input for all editor modes

import { EditorMode, DURATIONS } from './state.js';

/**
 * Keyboard event handler
 * Implements vim-style modal keyboard shortcuts
 */
export class KeyboardHandler {
    constructor(state, cursor, options = {}) {
        this.state = state;
        this.cursor = cursor;
        this.options = options;
        this.recorder = options.recorder || null;

        // For handling multi-key sequences (gg, dd, etc.)
        this.pendingKey = null;
        this.pendingTimeout = null;

        // For high fret entry (f12, f15, etc.)
        this.highFretMode = false;
        this.highFretBuffer = '';

        // Fret entry buffer for insert mode (legacy; digits now insert
        // immediately — kept so external checks read an empty string)
        this.fretBuffer = '';
        this.fretTimeout = null;

        // Two-digit refine window: after typing 1 or 2, a quick second
        // digit upgrades the just-inserted note in place (1,2 → 12)
        this.fretRefine = null;
        this.fretRefineTimeout = null;

        // Bound handler for easy removal
        this._boundHandler = this.handleKeyDown.bind(this);
    }

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
    }

    /**
     * Main key event handler
     */
    handleKeyDown(event) {
        // Check for global shortcuts first
        if (this._handleGlobalShortcut(event)) {
            event.preventDefault();
            return;
        }

        // Delegate to mode-specific handler
        const mode = this.state.mode;
        let handled = false;

        switch (mode) {
            case EditorMode.NORMAL:
                handled = this._handleNormalMode(event);
                break;
            case EditorMode.VISUAL:
                handled = this._handleVisualMode(event);
                break;
            case EditorMode.ANNOTATION:
                handled = this._handleAnnotationMode(event);
                break;
        }

        if (handled) {
            event.preventDefault();
        }
    }

    /**
     * Handle global shortcuts (available in all modes)
     */
    _handleGlobalShortcut(event) {
        const { key, ctrlKey, metaKey, shiftKey } = event;
        const mod = ctrlKey || metaKey;

        // Escape - exit to normal mode / cancel
        if (key === 'Escape') {
            if (this.state.mode !== EditorMode.NORMAL) {
                this._record('setMode', { mode: EditorMode.NORMAL });
                this.state.setMode(EditorMode.NORMAL);
                this._clearPending();
                return true;
            }
            this._clearPending();
            return true;
        }

        // Ctrl+S - save
        if (mod && key === 's') {
            this.options.onSave?.();
            return true;
        }

        // System clipboard idioms for mouse users (not in annotation mode,
        // which needs real text editing)
        if (mod && (key === 'c' || key === 'x' || key === 'v')
            && this.state.mode !== EditorMode.ANNOTATION) {
            if (key === 'c') {
                this.state.copy();
            } else if (key === 'x') {
                this.state.copy();
                if (this.state.selection) {
                    this._deleteSelection();
                    this.state.setMode(EditorMode.NORMAL);
                } else {
                    this.state.deleteTick();
                }
            } else {
                this.state.paste();
            }
            return true;
        }

        // Shift+Space / Ctrl+Space - play from cursor (toggles off while
        // playing). The verify loop for phrase entry.
        if (key === ' ' && (shiftKey || mod)) {
            this._commitFretBuffer();
            this.options.onPlayFromCursor?.();
            return true;
        }

        // L - loop the selection (VISUAL) or play from cursor (NORMAL)
        if (key === 'L' && !mod) {
            this._commitFretBuffer();
            this.options.onLoopSelection?.();
            return true;
        }

        // Ctrl+Z - undo
        if (mod && key === 'z' && !shiftKey) {
            this._record('undo');
            this.state.undo();
            return true;
        }

        // Ctrl+Shift+Z or Ctrl+Y - redo
        if ((mod && key === 'z' && shiftKey) || (mod && key === 'y')) {
            this._record('redo');
            this.state.redo();
            return true;
        }

        // ? - show help
        if (key === '?' && !mod) {
            this.options.onShowHelp?.();
            return true;
        }

        return false;
    }

    /**
     * Handle normal mode keys
     * NORMAL mode handles both navigation AND note entry (no separate INSERT mode)
     */
    _handleNormalMode(event) {
        const { key, ctrlKey, shiftKey } = event;

        // === NOTE ENTRY ===
        // Fret entry (0-9) - always available
        if (/^[0-9]$/.test(key) && !ctrlKey && !shiftKey) {
            if (this.highFretMode) {
                this.highFretBuffer += key;
                if (this.highFretBuffer.length >= 2) {
                    const fret = parseInt(this.highFretBuffer, 10);
                    this._insertFret(fret);
                    this.highFretMode = false;
                    this.highFretBuffer = '';
                }
                return true;
            }

            const digit = parseInt(key, 10);

            // Two-digit refine: "1","2" typed quickly still means fret 12
            // (as before), but the first digit was VISIBLE immediately —
            // the quick second digit upgrades that note in place.
            if (this.fretRefine) {
                const r = this.fretRefine;
                const combined = r.fret * 10 + digit;
                this._clearFretRefine();
                if (combined <= 24) {
                    this._record('insertNote', {
                        measure: r.measure, tick: r.tick, string: r.string,
                        fret: combined, duration: r.duration, tech: r.tech,
                    });
                    this.state.facade.insertNote({
                        measure: r.measure, tick: r.tick, string: r.string,
                        fret: combined, duration: r.duration, tech: r.tech,
                        trackId: this.state.trackId,
                    });
                    this.cursor.update();
                    return true;
                }
                // Can't combine — fall through to a fresh insert
            }

            // Insert immediately (no timeout latency); open a refine
            // window only when this digit can prefix a fret ≤ 24.
            const seed = {
                ...this._cursorParams(),
                fret: digit,
                duration: this.state.currentDuration,
                tech: this.state.pendingArticulation || null,
            };
            this._insertFret(digit);
            if (digit === 1 || digit === 2) {
                this._setFretRefine(seed);
            }
            return true;
        }

        // High fret mode (f then two digits for frets 10+)
        if (key === 'f' && !ctrlKey) {
            this._commitFretBuffer();
            this.highFretMode = true;
            this.highFretBuffer = '';
            return true;
        }

        // === NAVIGATION ===
        // Arrows step by the GRID — the same increment the ruler draws
        // and clicks snap to (one definitional layer). Note durations
        // only govern what you enter and the auto-advance after it.
        if ((key === 'h' && !ctrlKey) || key === 'ArrowLeft') {
            this._commitFretBuffer();
            this._record('moveCursorByGrid', { direction: -1 });
            this.cursor.moveByGrid(-1);
            return true;
        }
        if ((key === 'l' && !ctrlKey) || key === 'ArrowRight') {
            this._commitFretBuffer();
            this._record('moveCursorByGrid', { direction: 1 });
            this.cursor.moveByGrid(1);
            return true;
        }
        if (key === 'j' || key === 'ArrowDown') {
            this._commitFretBuffer();
            this._record('moveCursorString', { direction: 1 });
            this.cursor.moveString(1);
            return true;
        }
        if (key === 'k' || key === 'ArrowUp') {
            this._commitFretBuffer();
            this._record('moveCursorString', { direction: -1 });
            this.cursor.moveString(-1);
            return true;
        }

        // Beat navigation
        if (key === 'w') {
            this._commitFretBuffer();
            this._record('moveCursorByBeat', { direction: 1 });
            this.cursor.moveByBeat(1);
            return true;
        }
        if (key === 'b') {
            this._commitFretBuffer();
            this._record('moveCursorByBeat', { direction: -1 });
            this.cursor.moveByBeat(-1);
            return true;
        }

        // Space - advance cursor by duration (like a rest)
        if (key === ' ') {
            this._commitFretBuffer();
            this._record('moveCursorByDuration', { direction: 1 });
            this.cursor.moveByDuration(1);
            return true;
        }

        // Enter - move to next measure
        if (key === 'Enter') {
            this._commitFretBuffer();
            this._record('moveCursorToMeasure', { measure: this.state.cursor.measure + 1 });
            this.cursor.moveToMeasure(this.state.cursor.measure + 1);
            return true;
        }

        // Delete - remove the note under the cursor, stay put
        if (key === 'Delete') {
            this._commitFretBuffer();
            this._record('deleteNote', this._cursorParams());
            this.state.deleteNote();
            return true;
        }

        // Backspace (the Mac "delete" key): remove the note under the
        // cursor; on an empty slot, step back and delete there
        // (typewriter-style, so it erases the note you just entered)
        if (key === 'Backspace') {
            this._commitFretBuffer();
            if (!this.state.getNoteAtCursor()) {
                this._record('moveCursorByDuration', { direction: -1 });
                this.cursor.moveByDuration(-1);
            }
            this._record('deleteNote', this._cursorParams());
            this.state.deleteNote();
            return true;
        }

        // Measure start/end navigation
        if (key === '$') {
            this._commitFretBuffer();
            this._record('moveCursorToMeasureEnd');
            this.cursor.moveToMeasureEnd();
            return true;
        }

        // Multi-key sequences
        if (this.pendingKey === 'g' && key === 'g') {
            this._commitFretBuffer();
            this._record('moveCursorToStart');
            this.cursor.moveToStart();
            this._clearPending();
            return true;
        }
        if (key === 'g') {
            this._commitFretBuffer();
            this._setPending('g');
            return true;
        }

        // G - go to end
        if (key === 'G' && !this.pendingKey) {
            this._commitFretBuffer();
            this._record('moveCursorToEnd');
            this.cursor.moveToEnd();
            return true;
        }

        // === DURATION SHORTCUTS ===
        if (key === 'q' && !ctrlKey) {
            this._commitFretBuffer();
            this._record('setDuration', { duration: DURATIONS.quarter });
            this.state.setDuration(DURATIONS.quarter);
            return true;
        }
        if (key === 'e' && !ctrlKey) {
            this._commitFretBuffer();
            this._record('setDuration', { duration: DURATIONS.eighth });
            this.state.setDuration(DURATIONS.eighth);
            return true;
        }
        if (key === 's' && !ctrlKey) {
            this._commitFretBuffer();
            this._record('setDuration', { duration: DURATIONS.sixteenth });
            this.state.setDuration(DURATIONS.sixteenth);
            return true;
        }
        if (key === 't' && !ctrlKey) {
            this._commitFretBuffer();
            this._record('setDuration', { duration: DURATIONS.thirtySecond });
            this.state.setDuration(DURATIONS.thirtySecond);
            return true;
        }
        if (key === 'W') {
            this._commitFretBuffer();
            this._record('setDuration', { duration: DURATIONS.whole });
            this.state.setDuration(DURATIONS.whole);
            return true;
        }
        if (key === 'H') {
            this._commitFretBuffer();
            this._record('setDuration', { duration: DURATIONS.half });
            this.state.setDuration(DURATIONS.half);
            return true;
        }

        // === ARTICULATIONS (Ctrl + key) ===
        if (ctrlKey && key === 'h') {
            this._record('setPendingArticulation', { tech: 'h' });
            this.state.setPendingArticulation('h');
            return true;
        }
        if (ctrlKey && key === 'p') {
            this._record('setPendingArticulation', { tech: 'p' });
            this.state.setPendingArticulation('p');
            return true;
        }
        if (ctrlKey && key === '/') {
            this._record('setPendingArticulation', { tech: '/' });
            this.state.setPendingArticulation('/');
            return true;
        }
        if (ctrlKey && key === 't') {
            this._record('setPendingArticulation', { tech: '~' });
            this.state.setPendingArticulation('~');
            return true;
        }

        // === MODE SWITCHING ===
        if (key === 'v') {
            this._commitFretBuffer();
            this._record('setMode', { mode: EditorMode.VISUAL });
            this.state.setMode(EditorMode.VISUAL);
            return true;
        }
        if (key === 'A') {
            this._commitFretBuffer();
            this._record('setMode', { mode: EditorMode.ANNOTATION });
            this.state.setMode(EditorMode.ANNOTATION);
            return true;
        }

        // === EDITING OPERATIONS ===
        // Insert new measure
        if (key === 'o') {
            this._commitFretBuffer();
            this._record('insertMeasureAfter', { afterMeasure: this.state.cursor.measure });
            this._insertMeasureAfter();
            return true;
        }
        if (key === 'O') {
            this._commitFretBuffer();
            this._record('insertMeasureBefore', { beforeMeasure: this.state.cursor.measure });
            this._insertMeasureBefore();
            return true;
        }

        // Delete operations
        if (key === 'x') {
            this._commitFretBuffer();
            this._record('deleteNote', this._cursorParams());
            this.state.deleteNote();
            return true;
        }
        if (this.pendingKey === 'd' && key === 'd') {
            this._commitFretBuffer();
            this._record('deleteTick', this._cursorParams());
            this.state.deleteTick();
            this._clearPending();
            return true;
        }
        if (key === 'd' && !this.pendingKey) {
            this._commitFretBuffer();
            this._setPending('d');
            return true;
        }
        if (key === 'D') {
            this._commitFretBuffer();
            this._record('deleteTick', this._cursorParams()); // Close enough for replay
            this._deleteToMeasureEnd();
            return true;
        }

        // === CLIPBOARD ===
        if (key === 'y' && !this.pendingKey) {
            this._commitFretBuffer();
            this._record('copy');
            this.state.copy();
            return true;
        }
        if (this.pendingKey === 'y' && key === 'y') {
            this._commitFretBuffer();
            this._record('copy');
            this.state.copy();
            this._clearPending();
            return true;
        }
        if (key === 'p' && !ctrlKey) {
            this._commitFretBuffer();
            this._record('paste');
            this.state.paste();
            return true;
        }
        if (key === 'P') {
            this._commitFretBuffer();
            const duration = this.state.currentDuration;
            this.cursor.moveByTicks(-duration);
            this._record('paste');
            this.state.paste();
            return true;
        }

        // === UNDO/REDO ===
        if (key === 'u') {
            this._commitFretBuffer();
            this._record('undo');
            this.state.undo();
            return true;
        }
        if (key === 'R' && ctrlKey) {
            this._commitFretBuffer();
            this._record('redo');
            this.state.redo();
            return true;
        }

        // Repeat last action
        if (key === '.') {
            this._commitFretBuffer();
            this._record('repeatLastAction');
            this.state.repeatLastAction();
            return true;
        }

        // === GRID CONTROLS ===
        // Grid subdivision (Shift + duration keys)
        if (shiftKey && key === 'Q') {
            this.state.setGridSubdivision(DURATIONS.quarter);
            return true;
        }
        if (shiftKey && key === 'E') {
            this.state.setGridSubdivision(DURATIONS.eighth);
            return true;
        }
        if (shiftKey && key === 'S') {
            this.state.setGridSubdivision(DURATIONS.sixteenth);
            return true;
        }
        if (shiftKey && key === 'T') {
            this.state.setGridSubdivision(DURATIONS.thirtySecond);
            return true;
        }
        if (shiftKey && key === '#') {
            this.state.setGridSubdivision(DURATIONS.tripletEighth);
            return true;
        }

        // Toggle grid visibility
        if (key === '\\') {
            this.state.toggleGrid();
            return true;
        }

        return false;
    }

    /**
     * Handle visual mode keys
     */
    _handleVisualMode(event) {
        const { key } = event;

        // Navigation (extends selection)
        if (key === 'h' || key === 'ArrowLeft') {
            this.cursor.moveByTicks(-this.state.currentDuration);
            return true;
        }
        if (key === 'l' || key === 'ArrowRight') {
            this.cursor.moveByTicks(this.state.currentDuration);
            return true;
        }
        if (key === 'j' || key === 'ArrowDown') {
            this.cursor.moveString(1);
            return true;
        }
        if (key === 'k' || key === 'ArrowUp') {
            this.cursor.moveString(-1);
            return true;
        }

        // Yank selection
        if (key === 'y') {
            this.state.copy();
            this.state.setMode(EditorMode.NORMAL);
            return true;
        }

        // Delete selection (d, or Delete/Backspace for mouse users)
        if (key === 'd' || key === 'Delete' || key === 'Backspace') {
            this._deleteSelection();
            this.state.setMode(EditorMode.NORMAL);
            return true;
        }

        // Shift selection
        if (key === '>') {
            this._shiftSelection(1);
            return true;
        }
        if (key === '<') {
            this._shiftSelection(-1);
            return true;
        }

        return false;
    }

    /**
     * Handle annotation mode keys
     */
    _handleAnnotationMode(event) {
        const { key } = event;

        // Fingering annotations
        if (key === 't') {
            this._addFingering('T');
            return true;
        }
        if (key === 'i') {
            this._addFingering('I');
            return true;
        }
        if (key === 'm') {
            this._addFingering('M');
            return true;
        }

        // Technique annotations
        if (key === 'h') {
            this._record('addArticulation', { ...this._cursorParams(), tech: 'h' });
            this.state.addArticulation('h');
            return true;
        }
        if (key === 'p') {
            this._record('addArticulation', { ...this._cursorParams(), tech: 'p' });
            this.state.addArticulation('p');
            return true;
        }
        if (key === '/') {
            this._record('addArticulation', { ...this._cursorParams(), tech: '/' });
            this.state.addArticulation('/');
            return true;
        }
        if (key === '~') {
            this._record('addArticulation', { ...this._cursorParams(), tech: '~' });
            this.state.addArticulation('~');
            return true;
        }

        // Remove annotation
        if (key === 'x') {
            this._record('removeArticulation', this._cursorParams());
            this.state.removeArticulation();
            return true;
        }

        // Navigation in annotation mode
        if (key === 'h' || key === 'ArrowLeft') {
            this.cursor.moveToPrevEvent();
            return true;
        }
        if (key === 'l' || key === 'ArrowRight') {
            this.cursor.moveToNextEvent();
            return true;
        }

        return false;
    }

    /**
     * Set pending key for multi-key sequences
     */
    _setPending(key) {
        this._clearPending();
        this.pendingKey = key;
        this.pendingTimeout = setTimeout(() => {
            this._clearPending();
        }, 1000);
    }

    /**
     * Clear pending key
     */
    _clearPending() {
        this.pendingKey = null;
        if (this.pendingTimeout) {
            clearTimeout(this.pendingTimeout);
            this.pendingTimeout = null;
        }
        // Escape also settles a pending two-digit refine
        this._clearFretRefine();
    }

    /**
     * Schedule fret buffer commit
     */
    _setFretRefine(seed) {
        this._clearFretRefine();
        this.fretRefine = seed;
        this.fretRefineTimeout = setTimeout(() => {
            this.fretRefine = null;
            this.fretRefineTimeout = null;
        }, 300);
    }

    _clearFretRefine() {
        this.fretRefine = null;
        if (this.fretRefineTimeout) {
            clearTimeout(this.fretRefineTimeout);
            this.fretRefineTimeout = null;
        }
    }

    /**
     * Settle fret entry (legacy name). Digits insert immediately now;
     * this closes any pending two-digit refine window so navigation and
     * edit keys can never combine digits across a cursor move, and
     * flushes the legacy buffer if anything external put digits there.
     */
    _commitFretBuffer() {
        this._clearFretRefine();
        if (this.fretBuffer) {
            const fret = parseInt(this.fretBuffer, 10);
            this._insertFret(fret);
            this.fretBuffer = '';
        }
        if (this.fretTimeout) {
            clearTimeout(this.fretTimeout);
            this.fretTimeout = null;
        }
    }

    /**
     * Insert fret at cursor and auto-advance
     */
    _insertFret(fret) {
        // Clamp to valid range (0-24 typically)
        fret = Math.max(0, Math.min(24, fret));

        // Record BEFORE state mutation so cursor position is captured pre-advance
        this._record('insertNote', {
            ...this._cursorParams(),
            fret,
            duration: this.state.currentDuration,
            tech: this.state.pendingArticulation || null,
        });

        this.state.insertNote(fret);

        // Brief visual feedback
        this.cursor.showGhostNote(fret);
        setTimeout(() => {
            this.cursor.hideGhostNote();
        }, 100);

        // Auto-advance cursor after note entry
        this.cursor.moveByDuration(1);
    }

    /**
     * Insert new measure after current
     */
    _insertMeasureAfter() {
        const currentMeasure = this.state.cursor.measure;
        const notation = this.state.getNotation();

        // Shift all measures after current
        for (const measure of notation) {
            if (measure.measure > currentMeasure) {
                measure.measure++;
            }
        }

        // Move to new measure
        this.state.cursor.measure = currentMeasure + 1;
        this.state.cursor.tick = 0;
        this.cursor.update();
    }

    /**
     * Insert new measure before current
     */
    _insertMeasureBefore() {
        const currentMeasure = this.state.cursor.measure;
        const notation = this.state.getNotation();

        // Shift all measures at and after current
        for (const measure of notation) {
            if (measure.measure >= currentMeasure) {
                measure.measure++;
            }
        }

        // Stay at current measure number (which is now empty)
        this.state.cursor.tick = 0;
        this.cursor.update();
    }

    /**
     * Delete to end of measure
     */
    _deleteToMeasureEnd() {
        const measure = this.state.getMeasure(this.state.cursor.measure);
        if (!measure) return;

        const currentTick = this.state.cursor.tick;
        measure.events = measure.events.filter(e => e.tick < currentTick);
        this.state._emit('change', this.state.otf);
    }

    /**
     * Delete selection
     */
    _deleteSelection() {
        // Facade-backed (ts-aware and UNDOABLE — the old raw mutation
        // here silently bypassed history)
        this.state.deleteSelection();
    }

    /**
     * Shift selection by duration
     */
    _shiftSelection(direction) {
        // TODO: Implement shift selection
        // This would move all notes in selection by one duration
    }

    /**
     * Add fingering annotation to note at cursor
     */
    _addFingering(finger) {
        const note = this.state.getNoteAtCursor();
        if (note) {
            note.finger = finger;
            this.state._emit('change', this.state.otf);
        }
    }
}
