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
