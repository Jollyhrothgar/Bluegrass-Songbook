// Unit tests for OTF Editor State Management
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    EditorState,
    EditorMode,
    CursorPosition,
    SelectionRange,
    DURATIONS,
    DURATION_NAMES,
    TICKS_PER_BEAT,
} from '../../otf-editor/state.js';

describe('Constants', () => {
    describe('TICKS_PER_BEAT', () => {
        it('equals 480', () => {
            expect(TICKS_PER_BEAT).toBe(480);
        });
    });

    describe('DURATIONS', () => {
        it('has correct tick values', () => {
            expect(DURATIONS.whole).toBe(1920);
            expect(DURATIONS.half).toBe(960);
            expect(DURATIONS.quarter).toBe(480);
            expect(DURATIONS.eighth).toBe(240);
            expect(DURATIONS.sixteenth).toBe(120);
            expect(DURATIONS.thirtySecond).toBe(60);
            expect(DURATIONS.tripletEighth).toBe(160);
        });
    });

    describe('DURATION_NAMES', () => {
        it('maps tick values to names', () => {
            expect(DURATION_NAMES[DURATIONS.quarter]).toBe('quarter');
            expect(DURATION_NAMES[DURATIONS.eighth]).toBe('eighth');
            expect(DURATION_NAMES[DURATIONS.tripletEighth]).toBe('triplet-eighth');
        });
    });

    describe('EditorMode', () => {
        it('has all modes (simplified: NORMAL, VISUAL, ANNOTATION)', () => {
            expect(EditorMode.NORMAL).toBe('normal');
            expect(EditorMode.VISUAL).toBe('visual');
            expect(EditorMode.ANNOTATION).toBe('annotation');
        });
    });
});

describe('CursorPosition', () => {
    describe('constructor', () => {
        it('creates with default values', () => {
            const cursor = new CursorPosition();
            expect(cursor.measure).toBe(1);
            expect(cursor.tick).toBe(0);
            expect(cursor.string).toBe(3);
            expect(cursor.trackId).toBe('banjo');
        });

        it('creates with custom values', () => {
            const cursor = new CursorPosition(2, 240, 1, 'guitar');
            expect(cursor.measure).toBe(2);
            expect(cursor.tick).toBe(240);
            expect(cursor.string).toBe(1);
            expect(cursor.trackId).toBe('guitar');
        });
    });

    describe('clone', () => {
        it('creates independent copy', () => {
            const original = new CursorPosition(2, 120, 4, 'banjo');
            const clone = original.clone();

            expect(clone.measure).toBe(2);
            expect(clone.tick).toBe(120);
            expect(clone.string).toBe(4);

            // Modify clone doesn't affect original
            clone.measure = 5;
            expect(original.measure).toBe(2);
        });
    });

    describe('equals', () => {
        it('returns true for equal positions', () => {
            const a = new CursorPosition(2, 240, 1, 'banjo');
            const b = new CursorPosition(2, 240, 1, 'banjo');
            expect(a.equals(b)).toBe(true);
        });

        it('returns false for different positions', () => {
            const a = new CursorPosition(2, 240, 1, 'banjo');
            const b = new CursorPosition(2, 240, 2, 'banjo');
            expect(a.equals(b)).toBe(false);
        });
    });

    describe('getAbsoluteTick', () => {
        it('calculates absolute tick for measure 1', () => {
            const cursor = new CursorPosition(1, 120, 1);
            expect(cursor.getAbsoluteTick(1920)).toBe(120);
        });

        it('calculates absolute tick for measure 2', () => {
            const cursor = new CursorPosition(2, 120, 1);
            expect(cursor.getAbsoluteTick(1920)).toBe(1920 + 120);
        });

        it('calculates absolute tick for measure 4', () => {
            const cursor = new CursorPosition(4, 480, 1);
            expect(cursor.getAbsoluteTick(1920)).toBe(3 * 1920 + 480);
        });
    });

    describe('setFromAbsoluteTick', () => {
        it('sets position from absolute tick in first measure', () => {
            const cursor = new CursorPosition();
            cursor.setFromAbsoluteTick(120, 1920);
            expect(cursor.measure).toBe(1);
            expect(cursor.tick).toBe(120);
        });

        it('sets position from absolute tick spanning measures', () => {
            const cursor = new CursorPosition();
            cursor.setFromAbsoluteTick(2040, 1920); // 1920 + 120
            expect(cursor.measure).toBe(2);
            expect(cursor.tick).toBe(120);
        });

        it('handles exact measure boundaries', () => {
            const cursor = new CursorPosition();
            cursor.setFromAbsoluteTick(3840, 1920); // exactly 2 measures
            expect(cursor.measure).toBe(3);
            expect(cursor.tick).toBe(0);
        });
    });
});

describe('SelectionRange', () => {
    describe('constructor', () => {
        it('creates from start and end positions', () => {
            const start = new CursorPosition(1, 0, 1);
            const end = new CursorPosition(2, 240, 5);
            const range = new SelectionRange(start, end);

            expect(range.start.measure).toBe(1);
            expect(range.end.measure).toBe(2);
        });

        it('clones positions so originals are independent', () => {
            const start = new CursorPosition(1, 0, 1);
            const end = new CursorPosition(2, 240, 5);
            const range = new SelectionRange(start, end);

            start.measure = 10;
            expect(range.start.measure).toBe(1);
        });
    });

    describe('getNormalized', () => {
        it('returns in order when start < end', () => {
            const start = new CursorPosition(1, 0, 1);
            const end = new CursorPosition(2, 240, 5);
            const range = new SelectionRange(start, end);

            const { start: normStart, end: normEnd } = range.getNormalized(1920);
            expect(normStart.measure).toBe(1);
            expect(normEnd.measure).toBe(2);
        });

        it('swaps when start > end', () => {
            const start = new CursorPosition(2, 240, 5);
            const end = new CursorPosition(1, 0, 1);
            const range = new SelectionRange(start, end);

            const { start: normStart, end: normEnd } = range.getNormalized(1920);
            expect(normStart.measure).toBe(1);
            expect(normEnd.measure).toBe(2);
        });

        it('accepts a ts-aware toAbs function and orders by the real timeline', () => {
            // Doc metadata says 2/4 (960/measure) but measure 1 is really
            // 2/2 (1920 ticks). Uniform math mis-orders (m1,t1500) vs
            // (m2,t100): 1500 > 960+100. The real timeline does not:
            // 1500 < 1920+100.
            const realToAbs = (m, t) => (m === 1 ? 0 : 1920 + (m - 2) * 960) + t;
            const range = new SelectionRange(
                new CursorPosition(1, 1500, 3),
                new CursorPosition(2, 100, 3));

            const uniform = range.getNormalized(960);
            expect(uniform.start.measure).toBe(2); // the documented mis-order

            const real = range.getNormalized(realToAbs);
            expect(real.start.measure).toBe(1);
            expect(real.end.measure).toBe(2);
        });
    });
});

describe('EditorState', () => {
    let state;

    beforeEach(() => {
        state = new EditorState();
    });

    describe('constructor', () => {
        it('creates with default 5-string banjo', () => {
            expect(state.otf.tracks[0].instrument).toBe('5-string-banjo');
            expect(state.otf.tracks[0].tuning).toHaveLength(5);
        });

        it('starts in NORMAL mode', () => {
            expect(state.mode).toBe(EditorMode.NORMAL);
        });

        it('cursor starts at measure 1, tick 0, string 3', () => {
            expect(state.cursor.measure).toBe(1);
            expect(state.cursor.tick).toBe(0);
            expect(state.cursor.string).toBe(3);
        });

        it('current duration is eighth note', () => {
            expect(state.currentDuration).toBe(DURATIONS.eighth);
        });

        it('calculates ticks per measure for 4/4 time', () => {
            expect(state.ticksPerMeasure).toBe(1920);
        });
    });

    describe('constructor with options', () => {
        it('creates with custom instrument', () => {
            const guitarState = new EditorState({ instrument: '6-string-guitar' });
            expect(guitarState.otf.tracks[0].instrument).toBe('6-string-guitar');
            expect(guitarState.otf.tracks[0].tuning).toHaveLength(6);
        });

        it('loads provided OTF document', () => {
            const otf = {
                otf_version: '1.0',
                metadata: { title: 'Test Song', time_signature: '3/4' },
                timing: { ticks_per_beat: 480 },
                tracks: [{ id: 'test', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
                notation: { test: [{ measure: 1, events: [] }] }
            };
            const loadedState = new EditorState({ otf });
            expect(loadedState.otf.metadata.title).toBe('Test Song');
            expect(loadedState.ticksPerMeasure).toBe(1440); // 3/4 time
        });
    });

    describe('getStringCount', () => {
        it('returns 5 for banjo', () => {
            expect(state.getStringCount()).toBe(5);
        });

        it('returns 6 for guitar', () => {
            const guitarState = new EditorState({ instrument: '6-string-guitar' });
            expect(guitarState.getStringCount()).toBe(6);
        });

        it('returns 4 for mandolin', () => {
            const mandolinState = new EditorState({ instrument: 'mandolin' });
            expect(mandolinState.getStringCount()).toBe(4);
        });
    });

    describe('getMeasure', () => {
        it('returns undefined for non-existent measure', () => {
            expect(state.getMeasure(5)).toBeUndefined();
        });

        it('returns measure when it exists', () => {
            const measure = state.getMeasure(1);
            expect(measure).not.toBeNull();
            expect(measure.measure).toBe(1);
        });
    });

    describe('getOrCreateMeasure', () => {
        it('returns existing measure', () => {
            const measure = state.getOrCreateMeasure(1);
            expect(measure.measure).toBe(1);
        });

        it('creates new measure when not exists', () => {
            expect(state.getMeasure(3)).toBeUndefined();
            const measure = state.getOrCreateMeasure(3);
            expect(measure).not.toBeNull();
            expect(measure.measure).toBe(3);
            expect(state.getMeasure(3)).toBe(measure);
        });

        it('maintains sorted order when creating', () => {
            state.getOrCreateMeasure(3);
            state.getOrCreateMeasure(2);
            const notation = state.getNotation();
            expect(notation[0].measure).toBe(1);
            expect(notation[1].measure).toBe(2);
            expect(notation[2].measure).toBe(3);
        });
    });

    describe('getMeasureCount', () => {
        it('returns 1 for empty document', () => {
            expect(state.getMeasureCount()).toBe(1);
        });

        it('returns highest measure number', () => {
            state.getOrCreateMeasure(5);
            expect(state.getMeasureCount()).toBe(5);
        });
    });

    describe('insertNote', () => {
        it('inserts note at cursor position', () => {
            state.cursor.tick = 0;
            state.cursor.string = 3;
            state.insertNote(5);

            const measure = state.getMeasure(1);
            expect(measure.events).toHaveLength(1);
            expect(measure.events[0].tick).toBe(0);
            expect(measure.events[0].notes[0]).toEqual({ s: 3, f: 5, dur: DURATIONS.eighth });
        });

        it('replaces existing note on same string', () => {
            state.cursor.string = 3;
            state.insertNote(5);
            state.insertNote(7);

            const measure = state.getMeasure(1);
            expect(measure.events[0].notes).toHaveLength(1);
            expect(measure.events[0].notes[0].f).toBe(7);
        });

        it('adds notes to existing event at same tick', () => {
            state.cursor.string = 3;
            state.insertNote(5);
            state.cursor.string = 1;
            state.insertNote(0);

            const measure = state.getMeasure(1);
            expect(measure.events[0].notes).toHaveLength(2);
        });

        it('applies pending articulation', () => {
            state.setPendingArticulation('h');
            state.insertNote(5);

            const measure = state.getMeasure(1);
            expect(measure.events[0].notes[0].tech).toBe('h');
        });

        it('clears pending articulation after use', () => {
            state.setPendingArticulation('h');
            state.insertNote(5);
            expect(state.pendingArticulation).toBeNull();
        });

        it('emits noteInserted event', () => {
            const callback = vi.fn();
            state.on('noteInserted', callback);
            state.insertNote(5);
            expect(callback).toHaveBeenCalled();
        });

        it('records action for repeat', () => {
            state.insertNote(5, { string: 2 });
            expect(state.lastAction).toEqual({
                type: 'insertNote',
                fret: 5,
                options: { string: 2, tech: null, duration: DURATIONS.eighth }
            });
        });
    });

    describe('deleteNote', () => {
        beforeEach(() => {
            state.cursor.string = 3;
            state.insertNote(5);
        });

        it('deletes note at cursor position', () => {
            expect(state.deleteNote()).toBe(true);
            const measure = state.getMeasure(1);
            expect(measure.events).toHaveLength(0);
        });

        it('returns false when no note exists', () => {
            state.cursor.string = 1; // Different string
            expect(state.deleteNote()).toBe(false);
        });

        it('removes event when last note deleted', () => {
            state.deleteNote();
            const measure = state.getMeasure(1);
            expect(measure.events).toHaveLength(0);
        });

        it('keeps event when other notes remain', () => {
            state.cursor.string = 1;
            state.insertNote(0);
            state.cursor.string = 3;
            state.deleteNote();

            const measure = state.getMeasure(1);
            expect(measure.events).toHaveLength(1);
            expect(measure.events[0].notes).toHaveLength(1);
            expect(measure.events[0].notes[0].s).toBe(1);
        });
    });

    describe('deleteTick', () => {
        beforeEach(() => {
            state.cursor.string = 3;
            state.insertNote(5);
            state.cursor.string = 1;
            state.insertNote(0);
        });

        it('deletes all notes at cursor tick', () => {
            expect(state.deleteTick()).toBe(true);
            const measure = state.getMeasure(1);
            expect(measure.events).toHaveLength(0);
        });

        it('returns false when no event exists', () => {
            state.cursor.tick = 240;
            expect(state.deleteTick()).toBe(false);
        });
    });

    describe('addArticulation', () => {
        beforeEach(() => {
            state.insertNote(5);
        });

        it('adds articulation to note at cursor', () => {
            expect(state.addArticulation('h')).toBe(true);
            const note = state.getNoteAtCursor();
            expect(note.tech).toBe('h');
        });

        it('returns false when no note exists', () => {
            state.cursor.tick = 240;
            expect(state.addArticulation('h')).toBe(false);
        });
    });

    describe('removeArticulation', () => {
        beforeEach(() => {
            state.insertNote(5);
            state.addArticulation('h');
        });

        it('removes articulation from note', () => {
            expect(state.removeArticulation()).toBe(true);
            const note = state.getNoteAtCursor();
            expect(note.tech).toBeUndefined();
        });

        it('returns false when no articulation exists', () => {
            state.removeArticulation();
            expect(state.removeArticulation()).toBe(false);
        });
    });

    describe('setMode', () => {
        it('changes mode', () => {
            state.setMode(EditorMode.VISUAL);
            expect(state.mode).toBe(EditorMode.VISUAL);
        });

        it('starts selection when entering visual mode', () => {
            state.setMode(EditorMode.VISUAL);
            expect(state.selection).not.toBeNull();
        });

        it('clears selection when leaving visual mode', () => {
            state.setMode(EditorMode.VISUAL);
            state.setMode(EditorMode.NORMAL);
            expect(state.selection).toBeNull();
        });

        it('emits modeChange event', () => {
            const callback = vi.fn();
            state.on('modeChange', callback);
            state.setMode(EditorMode.ANNOTATION);
            expect(callback).toHaveBeenCalledWith({
                oldMode: EditorMode.NORMAL,
                newMode: EditorMode.ANNOTATION
            });
        });
    });

    describe('setDuration', () => {
        it('changes current duration', () => {
            state.setDuration(DURATIONS.quarter);
            expect(state.currentDuration).toBe(DURATIONS.quarter);
        });

        it('emits durationChange event', () => {
            const callback = vi.fn();
            state.on('durationChange', callback);
            state.setDuration(DURATIONS.sixteenth);
            expect(callback).toHaveBeenCalledWith(DURATIONS.sixteenth);
        });
    });

    describe('toggleTripletMode', () => {
        it('enables triplet mode', () => {
            state.toggleTripletMode();
            expect(state.tripletMode).toBe(true);
            expect(state.currentDuration).toBe(DURATIONS.tripletEighth);
        });

        it('disables triplet mode on second toggle', () => {
            state.toggleTripletMode();
            state.toggleTripletMode();
            expect(state.tripletMode).toBe(false);
        });

        it('resets triplet count', () => {
            state.tripletMode = true;
            state.tripletCount = 2;
            state.toggleTripletMode();
            expect(state.tripletCount).toBe(0);
        });
    });

    describe('undo/redo', () => {
        it('undoes insertNote', () => {
            state.insertNote(5);
            expect(state.getMeasure(1).events).toHaveLength(1);

            state.undo();
            expect(state.getMeasure(1).events).toHaveLength(0);
        });

        it('redoes after undo', () => {
            state.insertNote(5);
            state.undo();
            state.redo();

            expect(state.getMeasure(1).events).toHaveLength(1);
        });

        it('returns false when nothing to undo', () => {
            expect(state.undo()).toBe(false);
        });

        it('returns false when nothing to redo', () => {
            expect(state.redo()).toBe(false);
        });

        it('clears redo stack on new action', () => {
            state.insertNote(5);
            state.undo();
            state.insertNote(7);

            expect(state.redo()).toBe(false);
        });
    });

    describe('copy/paste', () => {
        beforeEach(() => {
            state.insertNote(5);
        });

        it('copies note at cursor when no selection', () => {
            state.copy();
            expect(state.clipboard).not.toBeNull();
            expect(state.clipboard.type).toBe('notes');
            expect(state.clipboard.data).toHaveLength(1);
        });

        it('pastes at cursor position', () => {
            state.copy();
            state.cursor.tick = 240;
            state.paste();

            const measure = state.getMeasure(1);
            expect(measure.events).toHaveLength(2);
            expect(measure.events[1].tick).toBe(240);
        });

        it('returns false when clipboard empty', () => {
            expect(state.paste()).toBe(false);
        });

        it('copies selection range in visual mode', () => {
            // Add another note
            state.cursor.tick = 240;
            state.insertNote(7);

            // Select range
            state.cursor.tick = 0;
            state.setMode(EditorMode.VISUAL);
            state.selection.end.tick = 240;

            state.copy();
            expect(state.clipboard.data).toHaveLength(2);
        });
    });

    describe('repeatLastAction', () => {
        it('repeats insertNote', () => {
            state.insertNote(5);
            state.cursor.tick = 240;
            state.repeatLastAction();

            const measure = state.getMeasure(1);
            expect(measure.events).toHaveLength(2);
            expect(measure.events[1].notes[0].f).toBe(5);
        });

        it('returns false when no last action', () => {
            expect(state.repeatLastAction()).toBe(false);
        });
    });

    describe('load', () => {
        it('loads new OTF document', () => {
            const otf = {
                otf_version: '1.0',
                metadata: { title: 'Loaded Song', time_signature: '4/4' },
                timing: { ticks_per_beat: 480 },
                tracks: [{ id: 'test', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
                notation: { test: [{ measure: 1, events: [{ tick: 0, notes: [{ s: 3, f: 5 }] }] }] }
            };

            state.load(otf);
            expect(state.otf.metadata.title).toBe('Loaded Song');
            expect(state.getMeasure(1).events).toHaveLength(1);
        });

        it('resets cursor to beginning', () => {
            state.cursor.measure = 5;
            state.cursor.tick = 240;

            state.load(state._createEmptyOTF('5-string-banjo'));
            expect(state.cursor.measure).toBe(1);
            expect(state.cursor.tick).toBe(0);
        });

        it('clears history', () => {
            state.insertNote(5);
            state.load(state._createEmptyOTF('5-string-banjo'));
            expect(state.undo()).toBe(false);
        });

        it('emits load and change events', () => {
            const loadCallback = vi.fn();
            const changeCallback = vi.fn();
            state.on('load', loadCallback);
            state.on('change', changeCallback);

            state.load(state._createEmptyOTF('5-string-banjo'));
            expect(loadCallback).toHaveBeenCalled();
            expect(changeCallback).toHaveBeenCalled();
        });
    });

    describe('export', () => {
        it('returns deep copy of OTF', () => {
            state.insertNote(5);
            const exported = state.export();

            // Modify exported, shouldn't affect state
            exported.metadata.title = 'Modified';
            expect(state.otf.metadata.title).toBe('Untitled');
        });
    });

    describe('event system', () => {
        it('on/off adds and removes listeners', () => {
            const callback = vi.fn();
            state.on('change', callback);
            state.insertNote(5);
            expect(callback).toHaveBeenCalled();

            callback.mockClear();
            state.off('change', callback);
            state.insertNote(7);
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('duration→grid coupling is REFINE-ONLY (minimal invariant)', () => {
        it('a finer duration refines a too-coarse grid', () => {
            state.setGridSubdivision(DURATIONS.quarter);
            state.setDuration(DURATIONS.sixteenth);
            expect(state.gridSubdivision).toBe(DURATIONS.sixteenth);
        });

        it('a coarser duration NEVER touches the grid (mixed-value entry)', () => {
            state.setDuration(DURATIONS.sixteenth); // grid → 1/16
            state.setDuration(DURATIONS.quarter);   // q places fine on 1/16
            expect(state.gridSubdivision).toBe(DURATIONS.sixteenth);
            state.setDuration(DURATIONS.whole);
            expect(state.gridSubdivision).toBe(DURATIONS.sixteenth);
        });

        it('a deliberate fine grid survives duration changes', () => {
            state.setGridSubdivision(DURATIONS.thirtySecond);
            state.setDuration(DURATIONS.eighth);
            state.setDuration(DURATIONS.quarter);
            expect(state.gridSubdivision).toBe(DURATIONS.thirtySecond);
        });

        it('whole/half need at most a quarter grid', () => {
            state.setGridSubdivision(DURATIONS.half); // hypothetical coarse grid
            state.setDuration(DURATIONS.whole);
            expect(state.gridSubdivision).toBe(DURATIONS.quarter);
        });

        it('triplet ↔ straight grids trade on divisibility', () => {
            state.setGridSubdivision(DURATIONS.sixteenth);
            state.toggleTripletMode(); // 1/16 can't place triplet eighths
            expect(state.gridSubdivision).toBe(DURATIONS.tripletEighth);
            state.setDuration(DURATIONS.eighth); // triplet grid can't place 1/8
            expect(state.gridSubdivision).toBe(DURATIONS.eighth);
        });

        it('explicit grid buttons are absolute (may coarsen)', () => {
            state.setDuration(DURATIONS.thirtySecond);
            state.setGridSubdivision(DURATIONS.quarter); // user's explicit call
            expect(state.gridSubdivision).toBe(DURATIONS.quarter);
        });
    });

    describe('trackId option (multi-track OTFs)', () => {
        const multiTrackOtf = () => ({
            otf_version: '1.0',
            metadata: { title: 'Multi', time_signature: '4/4' },
            timing: { ticks_per_beat: 480 },
            tracks: [
                { id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'] },
                { id: 'mandolin', instrument: 'mandolin', tuning: ['E5', 'A4', 'D4', 'G3'] },
            ],
            notation: {
                guitar: [{ measure: 1, events: [] }],
                mandolin: [{ measure: 1, events: [] }],
            },
        });

        it('edits the requested track instead of the first', () => {
            const s = new EditorState({ otf: multiTrackOtf(), trackId: 'mandolin' });
            expect(s.trackId).toBe('mandolin');
            expect(s.getStringCount()).toBe(4);
            s.insertNote(2, { string: 1 });
            expect(s.otf.notation.mandolin[0].events).toHaveLength(1);
            expect(s.otf.notation.guitar[0].events).toHaveLength(0);
        });

        it('falls back to the first track for unknown ids', () => {
            const s = new EditorState({ otf: multiTrackOtf(), trackId: 'kazoo' });
            expect(s.trackId).toBe('guitar');
        });
    });
});

describe('selection ops on ts-change docs (real-timeline ordering)', () => {
    // Metadata says 2/4 (uniform 960/measure) but measure 1 is really
    // 2/2 (1920 ticks). A selection from (m1,t1500) to (m2,t100) is
    // forward on the real timeline (1500 < 2020) but BACKWARD under
    // uniform math (1500 > 1060) — the old normalization swapped the
    // endpoints and copy/delete came back silently empty.
    function tsChangeState() {
        return new EditorState({
            otf: {
                otf_version: '1.0',
                metadata: {
                    title: 'ts test', time_signature: '2/4', tempo: 100,
                    time_signature_changes: [
                        { measure: 1, time_signature: '2/2' },
                        { measure: 2, time_signature: '2/4' },
                    ],
                },
                timing: { ticks_per_beat: 480 },
                tracks: [{
                    id: 'banjo', instrument: '5-string-banjo',
                    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead',
                }],
                notation: {
                    banjo: [1, 2, 3].map(m => ({ measure: m, events: [] })),
                },
            },
        });
    }

    it('copy captures a selection the uniform math would mis-order', () => {
        const state = tsChangeState();
        expect(state.facade.ticksFor(1)).toBe(1920); // sanity: real timeline

        state.cursor.measure = 1;
        state.cursor.tick = 1500;
        state.insertNote(7);

        state.selection = new SelectionRange(
            new CursorPosition(1, 1500, 3),
            new CursorPosition(2, 100, 3));
        state.copy();

        expect(state.facade.clipboard.data.length).toBe(1);
        expect(state.facade.clipboard.data[0].notes[0].f).toBe(7);
    });

    it('deleteSelection deletes instead of silently no-oping', () => {
        const state = tsChangeState();
        state.cursor.measure = 1;
        state.cursor.tick = 1500;
        state.insertNote(7);

        state.selection = new SelectionRange(
            new CursorPosition(1, 1500, 3),
            new CursorPosition(2, 100, 3));

        expect(state.deleteSelection()).toBe(true);
        expect(state.getMeasure(1).events.length).toBe(0);
    });
});

// ----------------------------------------------------------------------
// Duration editing at the cursor and over a selection (plan §3 P1-2)
// ----------------------------------------------------------------------

describe('EditorState — duration editing', () => {
    let state;
    beforeEach(() => {
        state = new EditorState();
        state.cursor.tick = 0;
        state.cursor.string = 3;
    });

    it('a duration key re-times the note under the cursor, and pins it', () => {
        state.insertNote(0);
        state.setDuration(DURATIONS.quarter);
        expect(state.getNoteAtCursor().dur).toBe(DURATIONS.quarter);
        expect(state.currentDuration).toBe(DURATIONS.quarter);
        expect(state.isDurationPinned({ measure: 1, tick: 0, string: 3 })).toBe(true);
    });

    it('a duration key on an empty slot only arms the next note', () => {
        state.setDuration(DURATIONS.half);
        expect(state.currentDuration).toBe(DURATIONS.half);
        expect(state.getNoteAtCursor()).toBeFalsy();
        expect(state.facade.canUndo()).toBe(false);
    });

    it('re-timing the note under the cursor is undoable', () => {
        state.insertNote(0);
        state.setDuration(DURATIONS.quarter);
        state.undo();
        expect(state.getNoteAtCursor().dur).toBe(DURATIONS.eighth);
    });

    it('applyDurationToSelection re-times every note in it', () => {
        state.insertNote(0);
        state.cursor.tick = 240;
        state.insertNote(2);
        state.selection = new SelectionRange(
            new CursorPosition(1, 0, 3), new CursorPosition(1, 240, 3));
        expect(state.applyDurationToSelection(DURATIONS.sixteenth)).toBe(true);
        const events = state.getMeasure(1).events;
        expect(events.map(e => e.notes[0].dur)).toEqual([120, 120]);
        expect(state.isDurationPinned({ measure: 1, tick: 240, string: 3 })).toBe(true);
    });

    it('applyDurationToSelection needs a selection', () => {
        state.selection = null;
        expect(state.applyDurationToSelection(120)).toBe(false);
    });

    it('scaleDurationAtCursor halves and doubles, pinning as it goes', () => {
        state.insertNote(0);
        expect(state.scaleDurationAtCursor(0.5)).toBe(true);
        expect(state.getNoteAtCursor().dur).toBe(120);
        expect(state.scaleDurationAtCursor(2)).toBe(true);
        expect(state.getNoteAtCursor().dur).toBe(240);
        expect(state.isDurationPinned({ measure: 1, tick: 0, string: 3 })).toBe(true);
    });

    it('scaleSelectionDuration scales the phrase', () => {
        state.insertNote(0);
        state.cursor.tick = 240;
        state.insertNote(2);
        state.selection = new SelectionRange(
            new CursorPosition(1, 0, 3), new CursorPosition(1, 240, 3));
        expect(state.scaleSelectionDuration(2)).toBe(true);
        expect(state.getMeasure(1).events.map(e => e.notes[0].dur)).toEqual([480, 480]);
    });

    it('scaleDurationAtCursor on an empty slot is false', () => {
        expect(state.scaleDurationAtCursor(2)).toBe(false);
    });
});

describe('EditorState — dotted durations', () => {
    it('DURATIONS and DURATION_NAMES carry the dotted values', () => {
        expect(DURATIONS.dottedHalf).toBe(1440);
        expect(DURATIONS.dottedQuarter).toBe(720);
        expect(DURATIONS.dottedEighth).toBe(360);
        expect(DURATIONS.dottedSixteenth).toBe(180);
        expect(DURATION_NAMES[720]).toBe('dotted quarter');
        expect(DURATION_NAMES[180]).toBe('dotted sixteenth');
    });

    it('toggleDotted multiplies and divides by 1.5', () => {
        const state = new EditorState();
        state.setDuration(DURATIONS.quarter);
        expect(state.toggleDotted()).toBe(true);
        expect(state.currentDuration).toBe(720);
        expect(state.toggleDotted()).toBe(true);
        expect(state.currentDuration).toBe(480);
    });

    it('refuses to dot a whole note (it would leave the range)', () => {
        const state = new EditorState();
        state.setDuration(DURATIONS.whole);
        expect(state.toggleDotted()).toBe(false);
        expect(state.currentDuration).toBe(1920);
    });

    it('refuses to dot a triplet (240 is a straight eighth, not a dotted anything)', () => {
        const state = new EditorState();
        state.setDuration(DURATIONS.tripletEighth);
        expect(state.toggleDotted()).toBe(false);
        expect(state.currentDuration).toBe(160);
    });

    it('refuses under automatic duration', () => {
        const state = new EditorState();
        state.setAutoDuration(true);
        expect(state.toggleDotted()).toBe(false);
        expect(state.currentDuration).toBe(null);
    });
});

// ----------------------------------------------------------------------
// Note fixes at the cursor
// ----------------------------------------------------------------------

describe('EditorState — note fixes', () => {
    let state;
    beforeEach(() => {
        state = new EditorState();
        state.cursor.string = 3;
        state.insertNote(5);
    });

    it('transposeFretAtCursor moves the fret', () => {
        expect(state.transposeFretAtCursor(1)).toBe(true);
        expect(state.getNoteAtCursor().f).toBe(6);
        expect(state.transposeFretAtCursor(-99)).toBe(true);
        expect(state.getNoteAtCursor().f).toBe(0);
    });

    it('moveNoteAcrossStrings preserves pitch and carries the cursor', () => {
        expect(state.moveNoteAcrossStrings(1)).toBe(true);
        expect(state.cursor.string).toBe(4);
        expect(state.getNoteAtCursor().f).toBe(10);   // G3 fret 5 = D3 fret 10
    });

    it('moveNoteAcrossStrings refuses off the neck, leaving the cursor put', () => {
        state.cursor.string = 4;
        state.insertNote(0);
        expect(state.moveNoteAcrossStrings(-1)).toBe(false);
        expect(state.cursor.string).toBe(4);
        expect(state.getNoteAtCursor().f).toBe(0);
    });

    // D1: the document and the cursor were both right, but nothing told
    // the status bar — it kept printing the OLD string until the next
    // ordinary arrow key. Re-stringing IS a cursor move; it has to
    // announce itself on the same channel every other move uses.
    it('moveNoteAcrossStrings announces the cursor move', () => {
        const seen = [];
        state.on('cursorMove', (cursor) => seen.push(cursor.string));
        expect(state.moveNoteAcrossStrings(1)).toBe(true);
        expect(seen).toEqual([4]);
        expect(state.cursor.string).toBe(4);
    });

    it('a refused re-string announces nothing (the cursor did not move)', () => {
        state.cursor.string = 4;
        state.insertNote(0);
        const seen = [];
        state.on('cursorMove', (cursor) => seen.push(cursor.string));
        expect(state.moveNoteAcrossStrings(-1)).toBe(false);
        expect(seen).toEqual([]);
    });

    it('moveNoteAcrossStrings carries the note pin with it', () => {
        state.setDuration(DURATIONS.quarter);
        expect(state.isDurationPinned({ measure: 1, tick: 0, string: 3 })).toBe(true);
        state.moveNoteAcrossStrings(1);
        expect(state.isDurationPinned({ measure: 1, tick: 0, string: 3 })).toBe(false);
        expect(state.isDurationPinned({ measure: 1, tick: 0, string: 4 })).toBe(true);
    });

    it('addArticulation passes x and b through', () => {
        expect(state.addArticulation('x')).toBe(true);
        expect(state.getNoteAtCursor().tech).toBe('x');
        expect(state.addArticulation('b')).toBe(true);
        expect(state.getNoteAtCursor().tech).toBe('b');
    });

    it('toggleTieAtCursor sets tie: true, never tech', () => {
        state.cursor.tick = 240;
        state.insertNote(5);
        expect(state.toggleTieAtCursor()).toBe(true);
        expect(state.getNoteAtCursor().tie).toBe(true);
        expect(state.getNoteAtCursor().tech).toBeUndefined();
        expect(state.toggleTieAtCursor()).toBe(false);
        expect(state.getNoteAtCursor().tie).toBeUndefined();
    });

    it('toggleTieAtCursor refuses with no same-string predecessor', () => {
        state.cursor.string = 1;
        state.insertNote(0);
        expect(state.toggleTieAtCursor()).toBe(false);
        expect(state.getNoteAtCursor().tie).toBeUndefined();
    });

    it("addArticulation('~') is routed to the tie", () => {
        state.cursor.tick = 240;
        state.insertNote(5);
        state.addArticulation('~');
        expect(state.getNoteAtCursor().tie).toBe(true);
        expect(state.getNoteAtCursor().tech).toBeUndefined();
    });

    it('removeArticulation clears tech and leaves the tie alone', () => {
        state.cursor.tick = 240;
        state.insertNote(5, { tech: 'h' });
        state.toggleTieAtCursor();
        state.removeArticulation();
        expect(state.getNoteAtCursor().tech).toBeUndefined();
        expect(state.getNoteAtCursor().tie).toBe(true);
    });

    // D5: TablEdit's N clears the note's EFFECTS — all of them. `n` only
    // cleared `tech`, so a tie survived a clear and there was no way to
    // take one back except toggling it.
    describe('clearEffectsAtCursor — TablEdit’s N', () => {
        beforeEach(() => {
            state.cursor.tick = 240;
            state.insertNote(5, { tech: 'b' });
            state.toggleTieAtCursor();
        });

        it('clears the tie AND the technique', () => {
            expect(state.getNoteAtCursor()).toMatchObject({ tech: 'b', tie: true });
            expect(state.clearEffectsAtCursor()).toBe(true);
            expect(state.getNoteAtCursor().tech).toBeUndefined();
            expect(state.getNoteAtCursor().tie).toBeUndefined();
        });

        it('is ONE undo step — u brings both back', () => {
            state.clearEffectsAtCursor();
            state.undo();
            expect(state.getNoteAtCursor()).toMatchObject({ tech: 'b', tie: true });
        });

        it('clears a lone tie, and a lone technique', () => {
            state.clearEffectsAtCursor();
            state.toggleTieAtCursor();
            expect(state.clearEffectsAtCursor()).toBe(true);
            expect(state.getNoteAtCursor().tie).toBeUndefined();

            state.addArticulation('h');
            expect(state.clearEffectsAtCursor()).toBe(true);
            expect(state.getNoteAtCursor().tech).toBeUndefined();
        });

        it('refuses on a clean note and on empty space — no undo step', () => {
            state.clearEffectsAtCursor();
            const before = state.history.canUndo();
            expect(state.clearEffectsAtCursor()).toBe(false);
            expect(state.history.canUndo()).toBe(before);
            state.cursor.tick = 960;
            expect(state.clearEffectsAtCursor()).toBe(false);
        });
    });
});

// ----------------------------------------------------------------------
// Measures: delete, ripple, repeat, append
// ----------------------------------------------------------------------

describe('EditorState — measure ops', () => {
    let state;
    beforeEach(() => {
        state = new EditorState();
        state.facade.addMeasures(3);        // measures 1..4
        state.cursor.string = 3;
    });

    it('deleteMeasureAtCursor removes it and keeps the cursor in the document', () => {
        state.cursor.measure = 4;
        expect(state.deleteMeasureAtCursor()).toBe(true);
        expect(state.getMeasureCount()).toBe(3);
        expect(state.cursor.measure).toBe(3);
    });

    it('deleteEmptyTrailingMeasure refuses when the last measure has notes', () => {
        state.cursor.measure = 4;
        state.insertNote(0);
        expect(state.deleteEmptyTrailingMeasure()).toBe(false);
        expect(state.getMeasureCount()).toBe(4);
    });

    it('deleteEmptyTrailingMeasure refuses when ANOTHER track still uses it', () => {
        const otf = state.export();
        otf.tracks.push({
            id: 'guitar', instrument: '6-string-guitar',
            tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0,
        });
        otf.notation.guitar = [1, 2, 3, 4].map(m => ({ measure: m, events: [] }));
        otf.notation.guitar[3].events = [{ tick: 0, notes: [{ s: 1, f: 3, dur: 240 }] }];
        const s = new EditorState({ otf });
        expect(s.deleteEmptyTrailingMeasure()).toBe(false);
        expect(s.facade.getMeasureCount('guitar')).toBe(4);
    });

    it('deleteEmptyTrailingMeasure drops an empty tail', () => {
        expect(state.deleteEmptyTrailingMeasure()).toBe(true);
        expect(state.getMeasureCount()).toBe(3);
    });

    it('ensureMeasure appends past the end and is idempotent', () => {
        expect(state.ensureMeasure(6)).toBe(true);
        expect(state.getMeasureCount()).toBe(6);
        expect(state.ensureMeasure(6)).toBe(false);
        expect(state.ensureMeasure(0)).toBe(false);
    });

    it('ensureMeasure fills a hole in the middle', () => {
        state.otf.notation[state.trackId] =
            state.otf.notation[state.trackId].filter(m => m.measure !== 2);
        state.facade._invalidateTiming();
        expect(state.ensureMeasure(2)).toBe(true);
        expect(state.getMeasure(2).events).toEqual([]);
    });

    it('repeatPreviousMeasure copies the bar before and lands at its start', () => {
        state.cursor.measure = 1;
        state.cursor.tick = 0;
        state.insertNote(0);
        state.cursor.tick = 240;
        state.insertNote(2);
        state.cursor.measure = 2;
        state.cursor.tick = 960;
        expect(state.repeatPreviousMeasure()).toBe(true);
        expect(state.cursor.tick).toBe(0);
        expect(state.getMeasure(2).events.length).toBe(2);
    });

    it('repeatPreviousMeasure refuses over existing notes', () => {
        state.cursor.measure = 1;
        state.insertNote(0);
        state.cursor.measure = 2;
        state.insertNote(7);
        expect(state.repeatPreviousMeasure()).toBe(false);
    });

    it('shiftRightAtCursor ripples by the current duration', () => {
        state.cursor.measure = 1;
        state.cursor.tick = 0;
        state.insertNote(0);
        state.cursor.tick = 240;
        state.insertNote(2);
        state.setDuration(DURATIONS.eighth);
        state.cursor.tick = 240;
        expect(state.shiftRightAtCursor()).toBe(true);
        expect(state.getMeasure(1).events.map(e => e.tick)).toEqual([0, 480]);
        state.cursor.tick = 480;
        expect(state.shiftLeftAtCursor(240)).toBe(true);
        expect(state.getMeasure(1).events.map(e => e.tick)).toEqual([0, 240]);
    });

    it('shiftLeftAtCursor closes a hole', () => {
        state.cursor.measure = 1;
        state.cursor.tick = 480;
        state.insertNote(0);
        state.cursor.tick = 480;
        expect(state.shiftLeftAtCursor(240)).toBe(true);
        expect(state.getMeasure(1).events.map(e => e.tick)).toEqual([240]);
    });

    it('rippleTicks follows the grid under automatic duration', () => {
        state.setDuration(DURATIONS.quarter);
        expect(state.rippleTicks()).toBe(480);
        state.setGridSubdivision(DURATIONS.sixteenth);
        state.setAutoDuration(true);
        expect(state.rippleTicks()).toBe(120);
    });
});

// ----------------------------------------------------------------------
// Automatic duration (plan §6) — the state half
// ----------------------------------------------------------------------

describe('EditorState — automatic duration', () => {
    let state;
    beforeEach(() => {
        state = new EditorState();
        state.cursor.string = 3;
        state.setAutoDuration(true);
    });

    it('null IS auto, and setAutoDuration(false) restores the last chosen value', () => {
        expect(state.currentDuration).toBe(null);
        expect(state.isAutoDuration).toBe(true);
        state.setAutoDuration(false);
        expect(state.currentDuration).toBe(DURATIONS.eighth);
        state.setDuration(DURATIONS.sixteenth);
        state.toggleAutoDuration();
        expect(state.isAutoDuration).toBe(true);
        state.toggleAutoDuration();
        expect(state.currentDuration).toBe(DURATIONS.sixteenth);
    });

    it('effectiveDuration predicts the cursor slot', () => {
        expect(state.effectiveDuration()).toBe(1920);   // empty 4/4 measure
        state.cursor.tick = 480;
        state.insertNote(0);
        state.cursor.tick = 0;
        expect(state.effectiveDuration()).toBe(480);
        state.setAutoDuration(false);
        expect(state.effectiveDuration()).toBe(DURATIONS.eighth);
    });

    it('a roll typed on the 1/8 grid comes out as eighths', () => {
        [5, 3, 2, 5, 3, 2, 5, 3].forEach((string, i) => {
            state.cursor.tick = i * 240;
            state.cursor.string = string;
            state.insertNote(0);
        });
        const durs = state.getMeasure(1).events.flatMap(e => e.notes.map(n => n.dur));
        expect(durs).toEqual(new Array(8).fill(240));
    });

    it('the first note fills the bar, then shortens, then fills again', () => {
        state.cursor.tick = 0;
        state.insertNote(0);
        expect(state.getNoteAtCursor().dur).toBe(1920);
        state.cursor.tick = 240;
        state.cursor.string = 2;
        state.insertNote(1);
        state.cursor.tick = 0;
        state.cursor.string = 3;
        expect(state.getNoteAtCursor().dur).toBe(240);

        state.cursor.tick = 240;
        state.cursor.string = 2;
        state.deleteNote();
        state.cursor.tick = 0;
        state.cursor.string = 3;
        expect(state.getNoteAtCursor().dur).toBe(1920);
    });

    it('an explicit duration key pins the note against auto', () => {
        state.cursor.tick = 0;
        state.insertNote(0);
        state.setDuration(DURATIONS.whole);          // pins it, leaves auto
        state.setAutoDuration(true);
        state.cursor.tick = 240;
        state.cursor.string = 2;
        state.insertNote(1);
        state.cursor.tick = 0;
        state.cursor.string = 3;
        expect(state.getNoteAtCursor().dur).toBe(1920);
    });

    it('a loaded document is never re-timed', () => {
        const otf = state.export();
        otf.notation[state.trackId][0].events = [
            { tick: 0, notes: [{ s: 3, f: 0, dur: 1920 }] },
        ];
        state.load(otf);
        state.setAutoDuration(true);
        state.cursor.tick = 240;
        state.cursor.string = 2;
        state.insertNote(1);
        const first = state.getMeasure(1).events[0].notes[0];
        expect(first.dur).toBe(1920);
        expect(state.autoEnteredDurations.size).toBe(1);
    });

    it('fixDurationsAtCursor repairs the measure and hands it to auto', () => {
        const otf = state.export();
        otf.notation[state.trackId][0].events = [
            { tick: 0, notes: [{ s: 3, f: 0, dur: 1920 }] },
            { tick: 240, notes: [{ s: 2, f: 1, dur: 1920 }] },
        ];
        state.load(otf);
        state.setAutoDuration(true);
        state.cursor.measure = 1;
        expect(state.fixDurationsAtCursor()).toBe(true);
        // J applies the SAME rule entry does: the last column takes the
        // interval before it, not the rest of the bar.
        expect(state.getMeasure(1).events.map(e => e.notes[0].dur)).toEqual([240, 240]);
        // now auto-managed: a new onset re-times them again
        state.cursor.tick = 480;
        state.cursor.string = 1;
        state.insertNote(0);
        expect(state.getMeasure(1).events[1].notes[0].dur).toBe(240);
    });

    it('fixDurationsInSelection needs a selection', () => {
        state.selection = null;
        expect(state.fixDurationsInSelection()).toBe(false);
        state.cursor.tick = 0;
        state.insertNote(0);
        state.selection = new SelectionRange(
            new CursorPosition(1, 0, 3), new CursorPosition(1, 240, 3));
        expect(state.fixDurationsInSelection()).toBe(false);   // already correct
    });

    it('one undo takes back the note and the neighbour re-timing', () => {
        state.cursor.tick = 0;
        state.insertNote(0);
        state.cursor.tick = 240;
        state.cursor.string = 2;
        state.insertNote(1);
        state.undo();
        state.cursor.tick = 0;
        state.cursor.string = 3;
        expect(state.getNoteAtCursor().dur).toBe(1920);
    });

    // ------------------------------------------------------------------
    // The manual's scenario, driven the way a person drives it: type,
    // move the cursor one step, type. Everything below is what the
    // status bar prints and the LENGTH row outlines.
    // ------------------------------------------------------------------

    const durs = () => state.getMeasure(1).events
        .flatMap(e => e.notes.map(n => n.dur));

    it('type at beat 1, step an eighth, type again → two eighths', () => {
        state.setGridSubdivision(DURATIONS.eighth);
        state.cursor.tick = 0;
        expect(state.effectiveDuration()).toBe(1920);   // predicts a whole
        state.insertNote(0);
        expect(durs()).toEqual([1920]);

        state.cursor.tick = 240;
        state.cursor.string = 2;
        expect(state.effectiveDuration()).toBe(240);    // predicts an eighth
        state.insertNote(1);
        expect(durs()).toEqual([240, 240]);
    });

    it('the prediction after the last note is the preceding interval', () => {
        state.cursor.tick = 0;
        state.insertNote(0);
        state.cursor.tick = 240;
        state.insertNote(1);
        state.cursor.tick = 480;
        expect(state.effectiveDuration()).toBe(240);
        state.cursor.tick = 720;
        expect(state.effectiveDuration()).toBe(480);
    });

    it('the prediction is the whole bar only when nothing sounds in it', () => {
        state.cursor.measure = 2;
        state.cursor.tick = 960;
        expect(state.effectiveDuration()).toBe(960);
    });

    it('deleting the second note re-extends the first to the whole bar', () => {
        state.cursor.tick = 0;
        state.insertNote(0);
        state.cursor.tick = 240;
        state.cursor.string = 2;
        state.insertNote(1);
        expect(state.deleteNote()).toBe(true);
        expect(durs()).toEqual([1920]);
    });

    it('a hand-set duration survives the delete (the manual\'s last sentence)', () => {
        state.cursor.tick = 0;
        state.insertNote(0);
        state.cursor.tick = 240;
        state.cursor.string = 2;
        state.insertNote(1);
        // park on the first note and choose a quarter: that pins it
        state.cursor.tick = 0;
        state.cursor.string = 3;
        state.setDuration(DURATIONS.quarter);
        state.setAutoDuration(true);
        state.cursor.tick = 240;
        state.cursor.string = 2;
        expect(state.deleteNote()).toBe(true);
        expect(durs()).toEqual([480]);
    });

    it('leaving auto emits autoDurationChange, and so does returning', () => {
        const seen = [];
        state.on('autoDurationChange', v => seen.push(v));
        state.setAutoDuration(false);
        state.setDuration(DURATIONS.quarter);   // already explicit: no event
        state.setAutoDuration(true);
        expect(seen).toEqual([false, true]);
    });
});

// ----------------------------------------------------------------------
// Entry-state flags the keyboard layer drives
// ----------------------------------------------------------------------

describe('EditorState — entry flags', () => {
    it('autoAdvance defaults on and emits on toggle', () => {
        const state = new EditorState();
        const seen = [];
        state.on('autoAdvanceChange', v => seen.push(v));
        expect(state.autoAdvance).toBe(true);
        expect(state.toggleAutoAdvance()).toBe(false);
        expect(state.setAutoAdvance(false)).toBe(false);   // already there
        expect(state.setAutoAdvance(true)).toBe(true);
        expect(seen).toEqual([false, true]);
    });

    it('lastTech follows both articulation paths', () => {
        const state = new EditorState();
        state.insertNote(0);
        state.addArticulation('h');
        expect(state.lastTech).toBe('h');
        state.setPendingArticulation('p');
        expect(state.lastTech).toBe('p');
    });

    it('repeatLastAction re-applies the last effect to the note at the cursor', () => {
        // TablEdit's F3: park on another note and repeat the effect —
        // the notes are already down, so nothing else intervenes.
        const state = new EditorState();
        state.cursor.string = 3;
        state.insertNote(0);
        state.cursor.tick = 240;
        state.insertNote(2);
        state.cursor.tick = 0;
        state.addArticulation('h');
        state.cursor.tick = 240;
        expect(state.repeatLastAction()).toBe(true);
        expect(state.getNoteAtCursor().tech).toBe('h');
    });

    it("repeatLastAction re-applies a tie when the last effect was '~'", () => {
        const state = new EditorState();
        state.cursor.string = 3;
        [0, 240, 480].forEach(tick => {
            state.cursor.tick = tick;
            state.insertNote(0);
        });
        state.cursor.tick = 240;
        state.addArticulation('~');
        expect(state.getNoteAtCursor().tie).toBe(true);
        state.cursor.tick = 480;
        expect(state.repeatLastAction()).toBe(true);
        expect(state.getNoteAtCursor().tie).toBe(true);
    });
});


// ----------------------------------------------------------------------
// Fingering wrappers: the SELECTION when there is one, else the cursor —
// the same rule `applyTech` follows, so marking a phrase is one undo step.
// ----------------------------------------------------------------------

describe('EditorState — fingering, both hands', () => {
    let state;

    /** Three eighth notes on string 3 of measure 1. */
    function threeNotes() {
        const s = new EditorState();
        s.cursor.string = 3;
        [0, 240, 480].forEach(tick => {
            s.cursor.tick = tick;
            s.insertNote(0);
        });
        s.cursor.tick = 0;
        return s;
    }

    beforeEach(() => {
        state = threeNotes();
    });

    it('marks the note at the cursor when there is no selection', () => {
        expect(state.setFingering('R')).toBe(true);
        expect(state.getNoteAtCursor().finger).toBe('R');
        expect(state.setLeftHand(2)).toBe(true);
        expect(state.getNoteAtCursor().lh).toBe(2);
        state.cursor.tick = 240;
        expect(state.getNoteAtCursor().finger).toBeUndefined();
    });

    it('marks the whole SELECTION when there is one', () => {
        state.setMode(EditorMode.VISUAL);
        state.selection = new SelectionRange(
            new CursorPosition(1, 0, 3), new CursorPosition(1, 480, 3));
        expect(state.setFingering('P')).toBe(true);
        expect(state.setLeftHand(4)).toBe(true);
        for (const tick of [0, 240, 480]) {
            state.cursor.tick = tick;
            expect(state.getNoteAtCursor().finger).toBe('P');
            expect(state.getNoteAtCursor().lh).toBe(4);
        }
    });

    it('takes the selection back in ONE undo per hand', () => {
        state.setMode(EditorMode.VISUAL);
        state.selection = new SelectionRange(
            new CursorPosition(1, 0, 3), new CursorPosition(1, 480, 3));
        state.setFingering('I');
        state.facade.undo();
        for (const tick of [0, 240, 480]) {
            state.cursor.tick = tick;
            expect(state.getNoteAtCursor().finger).toBeUndefined();
        }
    });

    it('clearFingerings clears BOTH hands in one step', () => {
        state.setFingering('T');
        state.setLeftHand(1);
        expect(state.clearFingerings()).toBe(true);
        expect(state.getNoteAtCursor().finger).toBeUndefined();
        expect(state.getNoteAtCursor().lh).toBeUndefined();
        state.facade.undo();
        expect(state.getNoteAtCursor().finger).toBe('T');
        expect(state.getNoteAtCursor().lh).toBe(1);
    });

    it('clearFingerings over a selection clears the phrase', () => {
        state.setMode(EditorMode.VISUAL);
        state.selection = new SelectionRange(
            new CursorPosition(1, 0, 3), new CursorPosition(1, 480, 3));
        state.setFingering('M');
        state.setLeftHand(3);
        expect(state.clearFingerings()).toBe(true);
        for (const tick of [0, 240, 480]) {
            state.cursor.tick = tick;
            expect(state.getNoteAtCursor().finger).toBeUndefined();
            expect(state.getNoteAtCursor().lh).toBeUndefined();
        }
    });

    it('clearFingerings with nothing to clear spends no history', () => {
        const depth = state.facade._history.length;
        expect(state.clearFingerings()).toBe(false);
        expect(state.facade._history.length).toBe(depth);
    });

    it('refuses on an empty slot', () => {
        state.cursor.string = 1;
        expect(state.setFingering('T')).toBe(false);
        expect(state.setLeftHand(0)).toBe(false);
        expect(state.clearFingerings()).toBe(false);
    });

    it('leaves the effects alone (they are different marks)', () => {
        state.addArticulation('h');
        state.setFingering('T');
        state.setLeftHand(2);
        state.clearEffectsAtCursor();
        expect(state.getNoteAtCursor().tech).toBeUndefined();
        expect(state.getNoteAtCursor().finger).toBe('T');
        expect(state.getNoteAtCursor().lh).toBe(2);
        state.addArticulation('p');
        state.clearFingerings();
        expect(state.getNoteAtCursor().tech).toBe('p');
        expect(state.getNoteAtCursor().finger).toBeUndefined();
    });
});
