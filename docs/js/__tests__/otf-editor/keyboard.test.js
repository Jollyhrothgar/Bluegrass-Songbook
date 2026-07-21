// Unit tests for OTF Editor Keyboard Handler
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { KeyboardHandler } from '../../otf-editor/keyboard.js';
import { EditorState, EditorMode, DURATIONS } from '../../otf-editor/state.js';
import { EditorCursor } from '../../otf-editor/cursor.js';

// Helper to create keyboard events
function createKeyEvent(key, options = {}) {
    return new KeyboardEvent('keydown', {
        key,
        ctrlKey: options.ctrl || false,
        metaKey: options.meta || false,
        shiftKey: options.shift || false,
        bubbles: true,
        cancelable: true,
    });
}

describe('KeyboardHandler', () => {
    let state;
    let cursor;
    let keyboard;
    let mockContainer;
    let mockCallbacks;

    beforeEach(() => {
        state = new EditorState();
        state.getOrCreateMeasure(4); // Create a few measures to work with

        cursor = new EditorCursor(state);
        mockContainer = document.createElement('div');
        document.body.appendChild(mockContainer);
        cursor.init(mockContainer);
        cursor.setLayoutInfo({
            leftMargin: 40,
            topMargin: 30,
            stringSpacing: 16,
            measureWidth: 200,
            measuresPerRow: 2,
            ticksPerMeasure: 1920,
            rowHeight: 120,
            noteAreaStart: 10,
            noteAreaWidth: 180,
            trackInfoOffset: 0,
        });

        mockCallbacks = {
            onSave: vi.fn(),
            onShowHelp: vi.fn(),
        };

        keyboard = new KeyboardHandler(state, cursor, mockCallbacks);
    });

    afterEach(() => {
        keyboard.detach();
        cursor.destroy();
        if (mockContainer.parentNode) {
            mockContainer.parentNode.removeChild(mockContainer);
        }
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('creates with references to state and cursor', () => {
            expect(keyboard.state).toBe(state);
            expect(keyboard.cursor).toBe(cursor);
        });

        it('starts with no pending key', () => {
            expect(keyboard.pendingKey).toBeNull();
        });

        it('starts with empty fret buffer', () => {
            expect(keyboard.fretBuffer).toBe('');
        });
    });

    describe('attach/detach', () => {
        it('attaches keydown listener to element', () => {
            const element = document.createElement('div');
            const addEventSpy = vi.spyOn(element, 'addEventListener');

            keyboard.attach(element);
            expect(addEventSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
        });

        it('detaches keydown listener from element', () => {
            const element = document.createElement('div');
            keyboard.attach(element);

            const removeEventSpy = vi.spyOn(element, 'removeEventListener');
            keyboard.detach();
            expect(removeEventSpy).toHaveBeenCalled();
        });
    });

    describe('global shortcuts', () => {
        it('Escape returns to normal mode from visual', () => {
            state.setMode(EditorMode.VISUAL);
            keyboard.handleKeyDown(createKeyEvent('Escape'));
            expect(state.mode).toBe(EditorMode.NORMAL);
        });

        it('Escape returns to normal mode from annotation', () => {
            state.setMode(EditorMode.ANNOTATION);
            keyboard.handleKeyDown(createKeyEvent('Escape'));
            expect(state.mode).toBe(EditorMode.NORMAL);
        });

        it('Ctrl+S calls onSave', () => {
            keyboard.handleKeyDown(createKeyEvent('s', { ctrl: true }));
            expect(mockCallbacks.onSave).toHaveBeenCalled();
        });

        it('Cmd+S calls onSave on Mac', () => {
            keyboard.handleKeyDown(createKeyEvent('s', { meta: true }));
            expect(mockCallbacks.onSave).toHaveBeenCalled();
        });

        it('Ctrl+Z calls undo', () => {
            state.insertNote(5);
            expect(state.getMeasure(1).events.length).toBe(1);

            keyboard.handleKeyDown(createKeyEvent('z', { ctrl: true }));
            expect(state.getMeasure(1).events.length).toBe(0);
        });

        it('Ctrl+Shift+Z calls redo', () => {
            state.insertNote(5);
            state.undo();
            expect(state.getMeasure(1).events.length).toBe(0);

            keyboard.handleKeyDown(createKeyEvent('z', { ctrl: true, shift: true }));
            expect(state.getMeasure(1).events.length).toBe(1);
        });

        it('Ctrl+Y calls redo', () => {
            state.insertNote(5);
            state.undo();
            keyboard.handleKeyDown(createKeyEvent('y', { ctrl: true }));
            expect(state.getMeasure(1).events.length).toBe(1);
        });

        it('? shows help', () => {
            keyboard.handleKeyDown(createKeyEvent('?'));
            expect(mockCallbacks.onShowHelp).toHaveBeenCalled();
        });
    });

    describe('normal mode navigation', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
        });

        it('h moves cursor left', () => {
            state.cursor.tick = 240;
            keyboard.handleKeyDown(createKeyEvent('h'));
            expect(state.cursor.tick).toBe(0);
        });

        it('l moves cursor right', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('l'));
            expect(state.cursor.tick).toBe(240);
        });

        it('j moves to higher string', () => {
            state.cursor.string = 3;
            keyboard.handleKeyDown(createKeyEvent('j'));
            expect(state.cursor.string).toBe(4);
        });

        it('k moves to lower string', () => {
            state.cursor.string = 3;
            keyboard.handleKeyDown(createKeyEvent('k'));
            expect(state.cursor.string).toBe(2);
        });

        it('ArrowLeft works like h', () => {
            state.cursor.tick = 240;
            keyboard.handleKeyDown(createKeyEvent('ArrowLeft'));
            expect(state.cursor.tick).toBe(0);
        });

        it('ArrowRight works like l', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('ArrowRight'));
            expect(state.cursor.tick).toBe(240);
        });

        it('ArrowDown works like j', () => {
            state.cursor.string = 3;
            keyboard.handleKeyDown(createKeyEvent('ArrowDown'));
            expect(state.cursor.string).toBe(4);
        });

        it('ArrowUp works like k', () => {
            state.cursor.string = 3;
            keyboard.handleKeyDown(createKeyEvent('ArrowUp'));
            expect(state.cursor.string).toBe(2);
        });

        it('w moves to next beat', () => {
            state.cursor.tick = 100;
            keyboard.handleKeyDown(createKeyEvent('w'));
            expect(state.cursor.tick).toBe(480);
        });

        it('b moves to previous beat', () => {
            state.cursor.tick = 600;
            keyboard.handleKeyDown(createKeyEvent('b'));
            expect(state.cursor.tick).toBe(480);
        });

        it('space advances cursor by duration', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent(' '));
            expect(state.cursor.tick).toBe(240);
        });

        it('Enter moves to next measure', () => {
            state.cursor.measure = 1;
            keyboard.handleKeyDown(createKeyEvent('Enter'));
            expect(state.cursor.measure).toBe(2);
            expect(state.cursor.tick).toBe(0);
        });

        it('gg moves to document start', () => {
            state.cursor.measure = 3;
            state.cursor.tick = 480;
            keyboard.handleKeyDown(createKeyEvent('g'));
            keyboard.handleKeyDown(createKeyEvent('g'));
            expect(state.cursor.measure).toBe(1);
            expect(state.cursor.tick).toBe(0);
        });

        it('G moves to document end', () => {
            state.cursor.measure = 1;
            keyboard.handleKeyDown(createKeyEvent('G'));
            expect(state.cursor.measure).toBe(4);
        });
    });

    describe('normal mode note entry', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('0-9 enters fret numbers', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('5'));
            vi.advanceTimersByTime(350);
            // Cursor auto-advanced, so check note at original position
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(5);
        });

        it('auto-advances cursor after note entry', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('5'));
            vi.advanceTimersByTime(350);
            expect(state.cursor.tick).toBe(240); // Advanced by duration
        });

        it('f enters high fret mode for frets 10+', () => {
            keyboard.handleKeyDown(createKeyEvent('f'));
            expect(keyboard.highFretMode).toBe(true);
        });

        it('f12 enters fret 12', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('f'));
            keyboard.handleKeyDown(createKeyEvent('1'));
            keyboard.handleKeyDown(createKeyEvent('2'));
            // Cursor auto-advanced, check original position
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(12);
            expect(keyboard.highFretMode).toBe(false);
        });

        it('Backspace deletes previous note and moves back', () => {
            state.cursor.tick = 0;
            // Insert a note first
            keyboard.handleKeyDown(createKeyEvent('5'));
            vi.advanceTimersByTime(350);
            expect(state.cursor.tick).toBe(240);

            keyboard.handleKeyDown(createKeyEvent('Backspace'));
            expect(state.cursor.tick).toBe(0);
        });
    });

    describe('normal mode duration shortcuts', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
        });

        it('q sets quarter note duration', () => {
            keyboard.handleKeyDown(createKeyEvent('q'));
            expect(state.currentDuration).toBe(DURATIONS.quarter);
        });

        it('e sets eighth note duration', () => {
            keyboard.handleKeyDown(createKeyEvent('e'));
            expect(state.currentDuration).toBe(DURATIONS.eighth);
        });

        it('s sets sixteenth note duration', () => {
            keyboard.handleKeyDown(createKeyEvent('s'));
            expect(state.currentDuration).toBe(DURATIONS.sixteenth);
        });

        it('t sets thirty-second note duration', () => {
            keyboard.handleKeyDown(createKeyEvent('t'));
            expect(state.currentDuration).toBe(DURATIONS.thirtySecond);
        });

        it('W sets whole note duration', () => {
            keyboard.handleKeyDown(createKeyEvent('W'));
            expect(state.currentDuration).toBe(DURATIONS.whole);
        });

        it('H sets half note duration', () => {
            keyboard.handleKeyDown(createKeyEvent('H'));
            expect(state.currentDuration).toBe(DURATIONS.half);
        });
    });

    describe('normal mode articulations', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
        });

        it('Ctrl+h sets pending hammer-on articulation', () => {
            keyboard.handleKeyDown(createKeyEvent('h', { ctrl: true }));
            expect(state.pendingArticulation).toBe('h');
        });

        it('Ctrl+p sets pending pull-off articulation', () => {
            keyboard.handleKeyDown(createKeyEvent('p', { ctrl: true }));
            expect(state.pendingArticulation).toBe('p');
        });

        it('Ctrl+/ sets pending slide articulation', () => {
            keyboard.handleKeyDown(createKeyEvent('/', { ctrl: true }));
            expect(state.pendingArticulation).toBe('/');
        });

        it('Ctrl+t sets pending tie articulation', () => {
            keyboard.handleKeyDown(createKeyEvent('t', { ctrl: true }));
            expect(state.pendingArticulation).toBe('~');
        });
    });

    describe('normal mode mode switching', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
        });

        it('v enters visual mode', () => {
            keyboard.handleKeyDown(createKeyEvent('v'));
            expect(state.mode).toBe(EditorMode.VISUAL);
        });

        it('A enters annotation mode', () => {
            keyboard.handleKeyDown(createKeyEvent('A'));
            expect(state.mode).toBe(EditorMode.ANNOTATION);
        });
    });

    describe('normal mode editing', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
            state.insertNote(5);
        });

        it('x deletes note at cursor', () => {
            keyboard.handleKeyDown(createKeyEvent('x'));
            expect(state.getNoteAtCursor()).toBeNull();
        });

        it('dd deletes entire tick', () => {
            state.cursor.string = 1;
            state.insertNote(0);
            state.cursor.string = 3;

            keyboard.handleKeyDown(createKeyEvent('d'));
            keyboard.handleKeyDown(createKeyEvent('d'));
            expect(state.getEventAtCursor()).toBeUndefined();
        });

        it('u undoes last action', () => {
            keyboard.handleKeyDown(createKeyEvent('u'));
            expect(state.getNoteAtCursor()).toBeNull();
        });

        it('y copies note at cursor', () => {
            keyboard.handleKeyDown(createKeyEvent('y'));
            expect(state.clipboard).not.toBeNull();
        });

        it('p pastes clipboard', () => {
            state.copy();
            state.cursor.tick = 240;
            keyboard.handleKeyDown(createKeyEvent('p'));
            expect(state.getEventAtCursor()).toBeDefined();
        });

        it('. repeats last action', () => {
            state.cursor.tick = 240;
            keyboard.handleKeyDown(createKeyEvent('.'));
            expect(state.getNoteAtCursor().f).toBe(5);
        });
    });

    describe('visual mode', () => {
        beforeEach(() => {
            state.setMode(EditorMode.VISUAL);
        });

        it('navigation extends selection', () => {
            const startTick = state.cursor.tick;
            keyboard.handleKeyDown(createKeyEvent('l'));
            expect(state.selection.end.tick).not.toBe(startTick);
        });

        it('y copies selection and returns to normal', () => {
            keyboard.handleKeyDown(createKeyEvent('l'));
            keyboard.handleKeyDown(createKeyEvent('l'));
            keyboard.handleKeyDown(createKeyEvent('y'));

            expect(state.clipboard).not.toBeNull();
            expect(state.mode).toBe(EditorMode.NORMAL);
        });

        it('d deletes selection and returns to normal', () => {
            state.insertNote(5);
            state.cursor.tick = 240;
            state.insertNote(7);

            state.setMode(EditorMode.VISUAL);
            state.cursor.tick = 0;
            state.selection.start.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('l'));
            keyboard.handleKeyDown(createKeyEvent('l'));
            keyboard.handleKeyDown(createKeyEvent('d'));

            expect(state.mode).toBe(EditorMode.NORMAL);
        });
    });

    describe('annotation mode', () => {
        beforeEach(() => {
            state.insertNote(5);
            state.setMode(EditorMode.ANNOTATION);
        });

        it('h adds hammer-on articulation', () => {
            keyboard.handleKeyDown(createKeyEvent('h'));
            expect(state.getNoteAtCursor().tech).toBe('h');
        });

        it('p adds pull-off articulation', () => {
            keyboard.handleKeyDown(createKeyEvent('p'));
            expect(state.getNoteAtCursor().tech).toBe('p');
        });

        it('/ adds slide articulation', () => {
            keyboard.handleKeyDown(createKeyEvent('/'));
            expect(state.getNoteAtCursor().tech).toBe('/');
        });

        it('x removes articulation', () => {
            state.addArticulation('h');
            keyboard.handleKeyDown(createKeyEvent('x'));
            expect(state.getNoteAtCursor().tech).toBeUndefined();
        });

        it('t adds thumb fingering', () => {
            keyboard.handleKeyDown(createKeyEvent('t'));
            expect(state.getNoteAtCursor().finger).toBe('T');
        });

        it('i adds index fingering', () => {
            keyboard.handleKeyDown(createKeyEvent('i'));
            expect(state.getNoteAtCursor().finger).toBe('I');
        });

        it('m adds middle fingering', () => {
            keyboard.handleKeyDown(createKeyEvent('m'));
            expect(state.getNoteAtCursor().finger).toBe('M');
        });
    });

    describe('multi-key sequences', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
        });

        it('g starts pending sequence', () => {
            keyboard.handleKeyDown(createKeyEvent('g'));
            expect(keyboard.pendingKey).toBe('g');
        });

        it('pending key times out', async () => {
            vi.useFakeTimers();
            keyboard.handleKeyDown(createKeyEvent('g'));
            expect(keyboard.pendingKey).toBe('g');

            vi.advanceTimersByTime(1100);
            expect(keyboard.pendingKey).toBeNull();
            vi.useRealTimers();
        });

        it('Escape clears pending key', () => {
            keyboard.handleKeyDown(createKeyEvent('g'));
            keyboard.handleKeyDown(createKeyEvent('Escape'));
            expect(keyboard.pendingKey).toBeNull();
        });

        it('d starts pending for dd', () => {
            keyboard.handleKeyDown(createKeyEvent('d'));
            expect(keyboard.pendingKey).toBe('d');
        });
    });

    describe('fret buffer in normal mode', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('inserts the first digit immediately — no timeout latency', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('7'));
            // No advanceTimersByTime: the note must already be there
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(7);
        });

        it('a quick second digit refines to a two-digit fret IN PLACE', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('1'));
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(1); // visible at once
            keyboard.handleKeyDown(createKeyEvent('2'));
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(12); // refined, same slot
            state.cursor.tick = 240;
            expect(state.getNoteAtCursor()).toBeFalsy(); // no stray second note
        });

        it('after the refine window, digits are separate notes', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('1'));
            vi.advanceTimersByTime(350);
            keyboard.handleKeyDown(createKeyEvent('2'));
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(1);
            state.cursor.tick = 240;
            expect(state.getNoteAtCursor()?.f).toBe(2);
        });

        it('digits that cannot start a fret ≤ 24 never combine', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('5'));
            keyboard.handleKeyDown(createKeyEvent('5'));
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(5);
            state.cursor.tick = 240;
            expect(state.getNoteAtCursor()?.f).toBe(5);
        });

        it('combinations above fret 24 stay separate notes', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('2'));
            keyboard.handleKeyDown(createKeyEvent('9'));
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(2);
            state.cursor.tick = 240;
            expect(state.getNoteAtCursor()?.f).toBe(9);
        });

        it('navigation between digits cancels the refine', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('1'));
            keyboard.handleKeyDown(createKeyEvent('ArrowRight'));
            keyboard.handleKeyDown(createKeyEvent('2'));
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(1); // not combined to 12
        });

        it('Delete removes the note under the cursor and stays put', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('5'));
            state.cursor.tick = 0; // back onto the note
            keyboard.handleKeyDown(createKeyEvent('Delete'));
            expect(state.getNoteAtCursor()).toBeFalsy();
            expect(state.cursor.tick).toBe(0);
        });

        it('Backspace (Mac delete key) removes the note under the cursor', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('5'));
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('Backspace'));
            expect(state.getNoteAtCursor()).toBeFalsy();
            expect(state.cursor.tick).toBe(0); // stays on the slot
        });

        it('arrows step by the GRID — same increment as the ruler', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('q')); // quarter duration
            state.setGridSubdivision(DURATIONS.sixteenth); // finer working grid
            keyboard.handleKeyDown(createKeyEvent('ArrowRight'));
            expect(state.cursor.tick).toBe(DURATIONS.sixteenth); // ruler-true
            keyboard.handleKeyDown(createKeyEvent('ArrowLeft'));
            expect(state.cursor.tick).toBe(0);
        });

        it('Shift+digit stacks a chord tone WITHOUT advancing', () => {
            state.cursor.tick = 0;
            state.cursor.string = 3;
            keyboard.handleKeyDown(createKeyEvent('5')); // advances
            state.cursor.tick = 0;                        // back onto it
            state.cursor.string = 2;
            keyboard.handleKeyDown(new KeyboardEvent('keydown', {
                key: '%', code: 'Digit5', shiftKey: true, bubbles: true, cancelable: true,
            }));
            expect(state.cursor.tick).toBe(0); // did NOT advance
            const notes = state.getMeasure(1).events[0].notes;
            expect(notes.map(n => n.s).sort()).toEqual([2, 3]); // a pinch
        });

        it('an eighth note can be placed at a sixteenth offset', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('e')); // eighth duration
            state.setGridSubdivision(DURATIONS.sixteenth); // fine grid override
            keyboard.handleKeyDown(createKeyEvent('ArrowRight')); // +120
            keyboard.handleKeyDown(createKeyEvent('5'));
            state.cursor.tick = 120;
            expect(state.getNoteAtCursor()).toMatchObject({ f: 5, dur: DURATIONS.eighth });
        });

        it('auto-advance after a note follows the selected duration', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('q')); // quarter
            keyboard.handleKeyDown(createKeyEvent('5'));
            expect(state.cursor.tick).toBe(DURATIONS.quarter);
        });

        it('Cmd+C copies, Cmd+V pastes at cursor', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('5'));
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('c', { meta: true }));
            expect(state.clipboard?.data).toHaveLength(1);
            state.cursor.tick = 480;
            keyboard.handleKeyDown(createKeyEvent('v', { meta: true }));
            expect(state.getNoteAtCursor()?.f).toBe(5);
        });

        it('Cmd+X with a selection cuts it (undoably)', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('5'));
            state.cursor.tick = 0;
            state.setMode(EditorMode.VISUAL);
            keyboard.handleKeyDown(createKeyEvent('x', { meta: true }));
            expect(state.mode).toBe(EditorMode.NORMAL);
            expect(state.getMeasure(1).events).toHaveLength(0);
            expect(state.clipboard?.data.length).toBeGreaterThan(0);
            state.undo(); // the cut is a real history entry
            expect(state.getMeasure(1).events).toHaveLength(1);
        });

        it('Delete in visual mode deletes the selection and exits', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('5'));
            state.cursor.tick = 0;
            state.setMode(EditorMode.VISUAL);
            keyboard.handleKeyDown(createKeyEvent('Delete'));
            expect(state.mode).toBe(EditorMode.NORMAL);
            expect(state.getMeasure(1).events).toHaveLength(0);
            state.undo();
            expect(state.getMeasure(1).events).toHaveLength(1); // undoable
        });

        it('Shift+Space fires the play-from-cursor callback', () => {
            const onPlayFromCursor = vi.fn();
            keyboard.options.onPlayFromCursor = onPlayFromCursor;
            keyboard.handleKeyDown(createKeyEvent(' ', { shift: true }));
            expect(onPlayFromCursor).toHaveBeenCalled();
        });

        it('plain Space still advances (no playback)', () => {
            const onPlayFromCursor = vi.fn();
            keyboard.options.onPlayFromCursor = onPlayFromCursor;
            const before = state.cursor.tick;
            keyboard.handleKeyDown(createKeyEvent(' '));
            expect(onPlayFromCursor).not.toHaveBeenCalled();
            expect(state.cursor.tick).toBe(before + state.currentDuration);
        });

        it('L fires the loop-selection callback in any mode', () => {
            const onLoopSelection = vi.fn();
            keyboard.options.onLoopSelection = onLoopSelection;
            keyboard.handleKeyDown(createKeyEvent('L', { shift: true }));
            expect(onLoopSelection).toHaveBeenCalledTimes(1);
            state.setMode(EditorMode.VISUAL);
            keyboard.handleKeyDown(createKeyEvent('L', { shift: true }));
            expect(onLoopSelection).toHaveBeenCalledTimes(2);
        });

        it('high fret mode allows entering frets 10+', () => {
            state.cursor.tick = 0;
            keyboard.handleKeyDown(createKeyEvent('f'));
            keyboard.handleKeyDown(createKeyEvent('1'));
            keyboard.handleKeyDown(createKeyEvent('5'));

            // Cursor auto-advanced, check note at original position
            state.cursor.tick = 0;
            expect(state.getNoteAtCursor()?.f).toBe(15);
            expect(keyboard.highFretMode).toBe(false);
        });
    });

    describe('grid subdivision shortcuts', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
        });

        it('Shift+Q sets grid to quarter', () => {
            keyboard.handleKeyDown(createKeyEvent('Q', { shift: true }));
            expect(state.gridSubdivision).toBe(DURATIONS.quarter);
        });

        it('Shift+E sets grid to eighth', () => {
            keyboard.handleKeyDown(createKeyEvent('E', { shift: true }));
            expect(state.gridSubdivision).toBe(DURATIONS.eighth);
        });

        it('Shift+S sets grid to sixteenth', () => {
            keyboard.handleKeyDown(createKeyEvent('S', { shift: true }));
            expect(state.gridSubdivision).toBe(DURATIONS.sixteenth);
        });

        it('Shift+T sets grid to thirty-second', () => {
            keyboard.handleKeyDown(createKeyEvent('T', { shift: true }));
            expect(state.gridSubdivision).toBe(DURATIONS.thirtySecond);
        });

        it('\\ toggles grid visibility', () => {
            const initialState = state.showGrid;
            keyboard.handleKeyDown(createKeyEvent('\\'));
            expect(state.showGrid).toBe(!initialState);
        });
    });

    describe('measure ops are undoable (facade-routed)', () => {
        beforeEach(() => {
            state.setMode(EditorMode.NORMAL);
        });

        it('o inserts a measure that shifts later notes and undoes cleanly', () => {
            state.cursor.measure = 2;
            state.cursor.tick = 0;
            state.insertNote(5);

            state.cursor.measure = 1;
            keyboard.handleKeyDown(createKeyEvent('o')); // insert after m1

            expect(state.getMeasure(3).events.length).toBe(1); // note shifted
            expect(state.cursor.measure).toBe(2);              // cursor on new measure

            keyboard.handleKeyDown(createKeyEvent('z', { ctrl: true }));
            expect(state.getMeasure(2).events.length).toBe(1); // shift reverted
        });

        it('o renumbers reading_list so repeat signs stay on their measures', () => {
            state.otf.reading_list = [
                { from_measure: 1, to_measure: 2 },
                { from_measure: 1, to_measure: 2 },
                { from_measure: 3, to_measure: 4 },
            ];
            state.cursor.measure = 2;
            keyboard.handleKeyDown(createKeyEvent('o')); // insert as m3

            expect(state.otf.reading_list).toEqual([
                { from_measure: 1, to_measure: 2 },
                { from_measure: 1, to_measure: 2 },
                { from_measure: 4, to_measure: 5 },
            ]);
        });

        it('O inserts before the cursor measure and undoes cleanly', () => {
            state.cursor.measure = 2;
            state.cursor.tick = 0;
            state.insertNote(7);

            keyboard.handleKeyDown(createKeyEvent('O')); // insert as m2

            expect(state.getMeasure(3).events.length).toBe(1);
            keyboard.handleKeyDown(createKeyEvent('z', { ctrl: true }));
            expect(state.getMeasure(2).events.length).toBe(1);
        });

        it('D deletes to measure end as ONE undoable step', () => {
            state.cursor.measure = 1;
            state.cursor.tick = 0;
            state.insertNote(3);
            state.cursor.tick = 960;
            state.insertNote(5);
            state.cursor.tick = 1440;
            state.insertNote(7);

            state.cursor.tick = 480;
            keyboard.handleKeyDown(createKeyEvent('D'));
            expect(state.getMeasure(1).events.length).toBe(1); // only tick 0 left

            keyboard.handleKeyDown(createKeyEvent('z', { ctrl: true }));
            expect(state.getMeasure(1).events.length).toBe(3); // one undo restores all
        });

        it('fingering annotation is undoable', () => {
            state.cursor.measure = 1;
            state.cursor.tick = 0;
            state.insertNote(2);

            state.setMode(EditorMode.ANNOTATION);
            keyboard.handleKeyDown(createKeyEvent('t'));
            expect(state.getNoteAtCursor().finger).toBe('T');

            keyboard.handleKeyDown(createKeyEvent('z', { ctrl: true }));
            expect(state.getNoteAtCursor().finger).toBeUndefined();
        });
    });

    describe('macOS modifier handling', () => {
        // Real browsers report key 'Z' (uppercase) when Shift is held —
        // the synthetic lowercase-'z' redo test above can't catch a
        // case-sensitive comparison.
        it('Cmd+Shift+Z (uppercase key, as browsers send it) redoes', () => {
            state.insertNote(5);
            state.undo();
            expect(state.getMeasure(1).events.length).toBe(0);

            keyboard.handleKeyDown(createKeyEvent('Z', { meta: true, shift: true }));
            expect(state.getMeasure(1).events.length).toBe(1);
        });

        it('Ctrl+Shift+Z (uppercase key) redoes too', () => {
            state.insertNote(5);
            state.undo();
            keyboard.handleKeyDown(createKeyEvent('Z', { ctrl: true, shift: true }));
            expect(state.getMeasure(1).events.length).toBe(1);
        });

        it('Cmd+digit does not insert a fret and stays unhandled', () => {
            state.setMode(EditorMode.NORMAL);
            const event = createKeyEvent('1', { meta: true }); // Cmd+1 = browser tab switch
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

            keyboard.handleKeyDown(event);
            expect(state.getMeasure(1).events.length).toBe(0);
            expect(preventDefaultSpy).not.toHaveBeenCalled();
        });

        it('Cmd+F does not enter high-fret mode (browser find wins)', () => {
            state.setMode(EditorMode.NORMAL);
            const event = createKeyEvent('f', { meta: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

            keyboard.handleKeyDown(event);
            expect(keyboard.highFretMode).toBeFalsy();
            expect(preventDefaultSpy).not.toHaveBeenCalled();
        });

        it('Cmd+L does not move the cursor (address bar wins)', () => {
            state.setMode(EditorMode.NORMAL);
            const before = state.cursor.tick;
            const event = createKeyEvent('l', { meta: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

            keyboard.handleKeyDown(event);
            expect(state.cursor.tick).toBe(before);
            expect(preventDefaultSpy).not.toHaveBeenCalled();
        });

        it('Cmd+P does not paste (print dialog wins)', () => {
            state.setMode(EditorMode.NORMAL);
            const event = createKeyEvent('p', { meta: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

            keyboard.handleKeyDown(event);
            expect(preventDefaultSpy).not.toHaveBeenCalled();
        });

        it('visual mode also releases Cmd combos to the browser', () => {
            state.setMode(EditorMode.VISUAL);
            const before = state.cursor.tick;
            const event = createKeyEvent('h', { meta: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

            keyboard.handleKeyDown(event);
            expect(state.cursor.tick).toBe(before);
            expect(preventDefaultSpy).not.toHaveBeenCalled();
        });
    });

    describe('event prevention', () => {
        it('prevents default on handled events', () => {
            state.setMode(EditorMode.NORMAL);
            const event = createKeyEvent('v'); // enters visual mode
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

            keyboard.handleKeyDown(event);
            expect(preventDefaultSpy).toHaveBeenCalled();
        });

        it('does not prevent default on unhandled events', () => {
            state.setMode(EditorMode.NORMAL);
            const event = createKeyEvent('Z'); // Not a valid normal mode command
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

            keyboard.handleKeyDown(event);
            expect(preventDefaultSpy).not.toHaveBeenCalled();
        });
    });
});
