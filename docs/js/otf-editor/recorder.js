// OTF Editor - Edit Event Recorder
// Records user actions for replay, regression testing, and session review

/**
 * Records editor events as a sequence of dispatchable actions.
 * Events are high-level (insertNote, moveCursor, setDuration) rather than
 * low-level (keydown), so replays work even if keyboard bindings change.
 *
 * Usage:
 *   const recorder = new EditEventRecorder();
 *   recorder.start();
 *   recorder.record('insertNote', { measure: 1, tick: 0, string: 3, fret: 0, duration: 240 });
 *   recorder.stop();
 *   const json = recorder.export();
 *
 *   // Replay later:
 *   const recorder2 = EditEventRecorder.fromJSON(json);
 *   await recorder2.replay(editor);
 */
export class EditEventRecorder {
    constructor() {
        this.events = [];
        this.recording = false;
        this.startTime = null;
        this.metadata = {};
    }

    /**
     * Start recording. Clears any existing events.
     * @param {Object} metadata - Optional metadata (tab name, instrument, etc.)
     */
    start(metadata = {}) {
        this.events = [];
        this.recording = true;
        this.startTime = Date.now();
        this.metadata = {
            startedAt: new Date().toISOString(),
            ...metadata,
        };
    }

    /**
     * Stop recording.
     */
    stop() {
        this.recording = false;
        if (this.metadata) {
            this.metadata.stoppedAt = new Date().toISOString();
            this.metadata.eventCount = this.events.length;
        }
    }

    /**
     * Record an event.
     * @param {string} type - Event type (e.g. 'insertNote', 'moveCursor', 'setDuration')
     * @param {Object} params - Event parameters
     */
    record(type, params = {}) {
        if (!this.recording) return;
        this.events.push({
            type,
            params,
            dt: Date.now() - this.startTime,
        });
    }

    /**
     * Export recording as JSON string.
     * @returns {string} JSON representation
     */
    export() {
        return JSON.stringify({
            version: 1,
            metadata: this.metadata,
            events: this.events,
        }, null, 2);
    }

    /**
     * Export as a plain object (for programmatic use).
     * @returns {Object}
     */
    toJSON() {
        return {
            version: 1,
            metadata: this.metadata,
            events: this.events,
        };
    }

    /**
     * Import recording from JSON string or object.
     * @param {string|Object} data - JSON string or parsed object
     * @returns {EditEventRecorder}
     */
    static fromJSON(data) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        const recorder = new EditEventRecorder();
        recorder.metadata = parsed.metadata || {};
        recorder.events = parsed.events || [];
        return recorder;
    }

    /**
     * Replay recording against an editor instance.
     * Dispatches each event to the editor's replay handler.
     *
     * @param {Object} editor - OTFEditor instance
     * @param {Object} options
     * @param {number} options.stepDelay - ms delay between events (0 = instant)
     * @param {function} options.onEvent - callback(event, index) called before each event
     * @param {AbortSignal} options.signal - abort signal to stop replay
     * @returns {Promise<{completed: number, total: number}>}
     */
    async replay(editor, { stepDelay = 0, onEvent = null, signal = null } = {}) {
        let completed = 0;
        const total = this.events.length;

        for (const event of this.events) {
            if (signal?.aborted) break;

            onEvent?.(event, completed);
            dispatchEditorEvent(editor, event);
            completed++;

            if (stepDelay > 0) {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(resolve, stepDelay);
                    if (signal) {
                        signal.addEventListener('abort', () => {
                            clearTimeout(timer);
                            resolve();
                        }, { once: true });
                    }
                });
            }
        }

        return { completed, total };
    }

    /**
     * Get recording duration in ms.
     * @returns {number}
     */
    get duration() {
        if (this.events.length === 0) return 0;
        return this.events[this.events.length - 1].dt;
    }

    /**
     * Get event count.
     * @returns {number}
     */
    get length() {
        return this.events.length;
    }
}

/**
 * Dispatch a recorded event to an editor instance.
 * This is the inverse of recording — it translates recorded events
 * back into editor actions.
 *
 * @param {Object} editor - OTFEditor instance
 * @param {Object} event - { type, params }
 */
export function dispatchEditorEvent(editor, event) {
    const { type, params } = event;
    const state = editor.state;
    const cursor = editor.cursor;

    switch (type) {
        // === Note entry ===
        case 'insertNote':
            state.cursor.measure = params.measure;
            state.cursor.tick = params.tick;
            state.cursor.string = params.string;
            state.insertNote(params.fret, {
                duration: params.duration,
                tech: params.tech || null,
            });
            break;

        case 'deleteNote':
            state.cursor.measure = params.measure;
            state.cursor.tick = params.tick;
            state.cursor.string = params.string;
            state.deleteNote();
            break;

        case 'deleteTick':
            state.cursor.measure = params.measure;
            state.cursor.tick = params.tick;
            state.deleteTick();
            break;

        // === Cursor movement ===
        case 'moveCursor':
            state.cursor.measure = params.measure;
            state.cursor.tick = params.tick;
            state.cursor.string = params.string;
            cursor.update();
            break;

        case 'moveCursorByDuration':
            cursor.moveByDuration(params.direction);
            break;

        case 'moveCursorByBeat':
            cursor.moveByBeat(params.direction);
            break;

        case 'moveCursorString':
            cursor.moveString(params.direction);
            break;

        case 'moveCursorToMeasure':
            cursor.moveToMeasure(params.measure);
            break;

        case 'moveCursorToStart':
            cursor.moveToStart();
            break;

        case 'moveCursorToEnd':
            cursor.moveToEnd();
            break;

        case 'moveCursorToMeasureEnd':
            cursor.moveToMeasureEnd();
            break;

        // === Duration ===
        case 'setDuration':
            state.setDuration(params.duration);
            break;

        // === Articulation ===
        case 'addArticulation':
            state.cursor.measure = params.measure;
            state.cursor.tick = params.tick;
            state.cursor.string = params.string;
            state.addArticulation(params.tech);
            break;

        case 'removeArticulation':
            state.cursor.measure = params.measure;
            state.cursor.tick = params.tick;
            state.cursor.string = params.string;
            state.removeArticulation();
            break;

        case 'setPendingArticulation':
            state.setPendingArticulation(params.tech);
            break;

        // === Mode ===
        case 'setMode':
            state.setMode(params.mode);
            break;

        // === Clipboard ===
        case 'copy':
            state.copy();
            break;

        case 'paste':
            state.paste();
            break;

        // === Undo/Redo ===
        case 'undo':
            state.undo();
            break;

        case 'redo':
            state.redo();
            break;

        // === Measure operations ===
        case 'insertMeasureAfter':
            // Inline the logic from keyboard handler
            {
                const notation = state.getNotation();
                for (const m of notation) {
                    if (m.measure > params.afterMeasure) {
                        m.measure++;
                    }
                }
                state.cursor.measure = params.afterMeasure + 1;
                state.cursor.tick = 0;
                state._emit('change', state.otf);
            }
            break;

        case 'insertMeasureBefore':
            {
                const notation = state.getNotation();
                for (const m of notation) {
                    if (m.measure >= params.beforeMeasure) {
                        m.measure++;
                    }
                }
                state.cursor.tick = 0;
                state._emit('change', state.otf);
            }
            break;

        // === Repeat ===
        case 'repeatLastAction':
            state.repeatLastAction();
            break;

        // === Grid ===
        case 'setGridSubdivision':
            state.setGridSubdivision(params.subdivision);
            break;

        case 'toggleGrid':
            state.toggleGrid();
            break;

        // === Triplet ===
        case 'toggleTripletMode':
            state.toggleTripletMode();
            break;

        default:
            console.warn(`Unknown replay event type: ${type}`);
    }
}
