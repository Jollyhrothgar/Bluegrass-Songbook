// Tests for EditEventRecorder
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditEventRecorder, dispatchEditorEvent } from '../../otf-editor/recorder.js';

describe('EditEventRecorder', () => {
    let recorder;

    beforeEach(() => {
        recorder = new EditEventRecorder();
    });

    describe('basic recording', () => {
        it('starts in non-recording state', () => {
            expect(recorder.recording).toBe(false);
            expect(recorder.length).toBe(0);
        });

        it('starts recording', () => {
            recorder.start();
            expect(recorder.recording).toBe(true);
        });

        it('stops recording', () => {
            recorder.start();
            recorder.stop();
            expect(recorder.recording).toBe(false);
        });

        it('records events while recording', () => {
            recorder.start();
            recorder.record('insertNote', { fret: 0, string: 3 });
            recorder.record('moveCursor', { measure: 1, tick: 240 });
            expect(recorder.length).toBe(2);
        });

        it('ignores events when not recording', () => {
            recorder.record('insertNote', { fret: 0 });
            expect(recorder.length).toBe(0);
        });

        it('ignores events after stop', () => {
            recorder.start();
            recorder.record('insertNote', { fret: 0 });
            recorder.stop();
            recorder.record('insertNote', { fret: 2 });
            expect(recorder.length).toBe(1);
        });

        it('clears events on new start', () => {
            recorder.start();
            recorder.record('insertNote', { fret: 0 });
            recorder.start();
            expect(recorder.length).toBe(0);
        });

        it('records timestamps relative to start', () => {
            const fakeNow = vi.spyOn(Date, 'now');
            fakeNow.mockReturnValueOnce(1000); // start time
            recorder.start();

            fakeNow.mockReturnValueOnce(1050); // first event
            recorder.record('insertNote', { fret: 0 });

            fakeNow.mockReturnValueOnce(1200); // second event
            recorder.record('moveCursor', { measure: 1 });

            expect(recorder.events[0].dt).toBe(50);
            expect(recorder.events[1].dt).toBe(200);

            fakeNow.mockRestore();
        });
    });

    describe('metadata', () => {
        it('stores metadata on start', () => {
            recorder.start({ title: 'Test Tab', instrument: '5-string-banjo' });
            expect(recorder.metadata.title).toBe('Test Tab');
            expect(recorder.metadata.instrument).toBe('5-string-banjo');
            expect(recorder.metadata.startedAt).toBeDefined();
        });

        it('adds stop metadata', () => {
            recorder.start();
            recorder.record('insertNote', { fret: 0 });
            recorder.stop();
            expect(recorder.metadata.stoppedAt).toBeDefined();
            expect(recorder.metadata.eventCount).toBe(1);
        });
    });

    describe('export/import', () => {
        it('exports as JSON string', () => {
            recorder.start({ title: 'Test' });
            recorder.record('insertNote', { fret: 0 });
            recorder.stop();

            const json = recorder.export();
            const parsed = JSON.parse(json);

            expect(parsed.version).toBe(1);
            expect(parsed.metadata.title).toBe('Test');
            expect(parsed.events).toHaveLength(1);
            expect(parsed.events[0].type).toBe('insertNote');
        });

        it('exports as plain object', () => {
            recorder.start();
            recorder.record('setDuration', { duration: 480 });
            recorder.stop();

            const obj = recorder.toJSON();
            expect(obj.version).toBe(1);
            expect(obj.events).toHaveLength(1);
        });

        it('imports from JSON string', () => {
            const json = JSON.stringify({
                version: 1,
                metadata: { title: 'Imported' },
                events: [
                    { type: 'insertNote', params: { fret: 5 }, dt: 100 },
                ],
            });

            const imported = EditEventRecorder.fromJSON(json);
            expect(imported.metadata.title).toBe('Imported');
            expect(imported.length).toBe(1);
            expect(imported.events[0].type).toBe('insertNote');
        });

        it('imports from object', () => {
            const data = {
                version: 1,
                metadata: {},
                events: [
                    { type: 'setDuration', params: { duration: 240 }, dt: 0 },
                    { type: 'insertNote', params: { fret: 0 }, dt: 50 },
                ],
            };

            const imported = EditEventRecorder.fromJSON(data);
            expect(imported.length).toBe(2);
        });

        it('roundtrips correctly', () => {
            recorder.start({ title: 'Roundtrip' });
            recorder.record('setDuration', { duration: 480 });
            recorder.record('insertNote', { measure: 1, tick: 0, string: 3, fret: 0, duration: 480 });
            recorder.record('moveCursorByDuration', { direction: 1 });
            recorder.stop();

            const exported = recorder.export();
            const imported = EditEventRecorder.fromJSON(exported);

            expect(imported.length).toBe(3);
            expect(imported.metadata.title).toBe('Roundtrip');
            expect(imported.events[0].type).toBe('setDuration');
            expect(imported.events[1].type).toBe('insertNote');
            expect(imported.events[1].params.fret).toBe(0);
            expect(imported.events[2].type).toBe('moveCursorByDuration');
        });
    });

    describe('duration', () => {
        it('returns 0 for empty recording', () => {
            expect(recorder.duration).toBe(0);
        });

        it('returns dt of last event', () => {
            recorder.start();
            recorder.events = [
                { type: 'a', params: {}, dt: 100 },
                { type: 'b', params: {}, dt: 500 },
            ];
            expect(recorder.duration).toBe(500);
        });
    });

    describe('replay', () => {
        function makeMockEditor() {
            return {
                state: {
                    cursor: { measure: 1, tick: 0, string: 3 },
                    insertNote: vi.fn(),
                    deleteNote: vi.fn(),
                    deleteTick: vi.fn(),
                    setDuration: vi.fn(),
                    setMode: vi.fn(),
                    addArticulation: vi.fn(),
                    removeArticulation: vi.fn(),
                    setPendingArticulation: vi.fn(),
                    copy: vi.fn(),
                    paste: vi.fn(),
                    undo: vi.fn(),
                    redo: vi.fn(),
                    repeatLastAction: vi.fn(),
                    setGridSubdivision: vi.fn(),
                    toggleGrid: vi.fn(),
                    toggleTripletMode: vi.fn(),
                    getNotation: vi.fn().mockReturnValue([]),
                    _emit: vi.fn(),
                },
                cursor: {
                    update: vi.fn(),
                    moveByDuration: vi.fn(),
                    moveByBeat: vi.fn(),
                    moveString: vi.fn(),
                    moveToMeasure: vi.fn(),
                    moveToStart: vi.fn(),
                    moveToEnd: vi.fn(),
                    moveToMeasureEnd: vi.fn(),
                },
            };
        }

        it('replays all events', async () => {
            const editor = makeMockEditor();
            recorder.events = [
                { type: 'setDuration', params: { duration: 480 }, dt: 0 },
                { type: 'insertNote', params: { measure: 1, tick: 0, string: 3, fret: 0, duration: 480 }, dt: 100 },
            ];

            const result = await recorder.replay(editor, { stepDelay: 0 });
            expect(result.completed).toBe(2);
            expect(result.total).toBe(2);
            expect(editor.state.setDuration).toHaveBeenCalledWith(480);
            expect(editor.state.insertNote).toHaveBeenCalledWith(0, { duration: 480, tech: null });
        });

        it('calls onEvent callback', async () => {
            const editor = makeMockEditor();
            recorder.events = [
                { type: 'undo', params: {}, dt: 0 },
            ];

            const onEvent = vi.fn();
            await recorder.replay(editor, { stepDelay: 0, onEvent });
            expect(onEvent).toHaveBeenCalledWith(recorder.events[0], 0);
        });

        it('respects abort signal', async () => {
            const editor = makeMockEditor();
            recorder.events = [
                { type: 'undo', params: {}, dt: 0 },
                { type: 'redo', params: {}, dt: 100 },
                { type: 'undo', params: {}, dt: 200 },
            ];

            const controller = new AbortController();
            controller.abort(); // Abort immediately

            const result = await recorder.replay(editor, {
                stepDelay: 10,
                signal: controller.signal,
            });
            expect(result.completed).toBe(0);
        });
    });
});

describe('dispatchEditorEvent', () => {
    function makeMockEditor() {
        return {
            state: {
                cursor: { measure: 1, tick: 0, string: 3 },
                insertNote: vi.fn(),
                deleteNote: vi.fn(),
                deleteTick: vi.fn(),
                setDuration: vi.fn(),
                setMode: vi.fn(),
                addArticulation: vi.fn(),
                removeArticulation: vi.fn(),
                setPendingArticulation: vi.fn(),
                copy: vi.fn(),
                paste: vi.fn(),
                undo: vi.fn(),
                redo: vi.fn(),
                repeatLastAction: vi.fn(),
                setGridSubdivision: vi.fn(),
                toggleGrid: vi.fn(),
                toggleTripletMode: vi.fn(),
                getNotation: vi.fn().mockReturnValue([]),
                _emit: vi.fn(),
            },
            cursor: {
                update: vi.fn(),
                moveByDuration: vi.fn(),
                moveByBeat: vi.fn(),
                moveString: vi.fn(),
                moveToMeasure: vi.fn(),
                moveToStart: vi.fn(),
                moveToEnd: vi.fn(),
                moveToMeasureEnd: vi.fn(),
            },
        };
    }

    it('dispatches insertNote', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, {
            type: 'insertNote',
            params: { measure: 2, tick: 240, string: 1, fret: 5, duration: 480 },
        });

        expect(editor.state.cursor.measure).toBe(2);
        expect(editor.state.cursor.tick).toBe(240);
        expect(editor.state.cursor.string).toBe(1);
        expect(editor.state.insertNote).toHaveBeenCalledWith(5, { duration: 480, tech: null });
    });

    it('dispatches deleteNote', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, {
            type: 'deleteNote',
            params: { measure: 1, tick: 0, string: 3 },
        });
        expect(editor.state.deleteNote).toHaveBeenCalled();
    });

    it('dispatches moveCursor', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, {
            type: 'moveCursor',
            params: { measure: 3, tick: 120, string: 2 },
        });
        expect(editor.state.cursor.measure).toBe(3);
        expect(editor.state.cursor.tick).toBe(120);
        expect(editor.state.cursor.string).toBe(2);
        expect(editor.cursor.update).toHaveBeenCalled();
    });

    it('dispatches moveCursorByDuration', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, {
            type: 'moveCursorByDuration',
            params: { direction: -1 },
        });
        expect(editor.cursor.moveByDuration).toHaveBeenCalledWith(-1);
    });

    it('dispatches setDuration', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, {
            type: 'setDuration',
            params: { duration: 240 },
        });
        expect(editor.state.setDuration).toHaveBeenCalledWith(240);
    });

    it('dispatches setMode', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, {
            type: 'setMode',
            params: { mode: 'visual' },
        });
        expect(editor.state.setMode).toHaveBeenCalledWith('visual');
    });

    it('dispatches addArticulation', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, {
            type: 'addArticulation',
            params: { measure: 1, tick: 0, string: 3, tech: 'h' },
        });
        expect(editor.state.addArticulation).toHaveBeenCalledWith('h');
    });

    it('dispatches undo', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, { type: 'undo', params: {} });
        expect(editor.state.undo).toHaveBeenCalled();
    });

    it('dispatches redo', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, { type: 'redo', params: {} });
        expect(editor.state.redo).toHaveBeenCalled();
    });

    it('dispatches copy', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, { type: 'copy', params: {} });
        expect(editor.state.copy).toHaveBeenCalled();
    });

    it('dispatches paste', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, { type: 'paste', params: {} });
        expect(editor.state.paste).toHaveBeenCalled();
    });

    it('dispatches moveCursorToStart', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, { type: 'moveCursorToStart', params: {} });
        expect(editor.cursor.moveToStart).toHaveBeenCalled();
    });

    it('dispatches moveCursorToEnd', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, { type: 'moveCursorToEnd', params: {} });
        expect(editor.cursor.moveToEnd).toHaveBeenCalled();
    });

    it('dispatches toggleGrid', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, { type: 'toggleGrid', params: {} });
        expect(editor.state.toggleGrid).toHaveBeenCalled();
    });

    it('dispatches toggleTripletMode', () => {
        const editor = makeMockEditor();
        dispatchEditorEvent(editor, { type: 'toggleTripletMode', params: {} });
        expect(editor.state.toggleTripletMode).toHaveBeenCalled();
    });

    it('warns on unknown event type', () => {
        const editor = makeMockEditor();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        dispatchEditorEvent(editor, { type: 'unknownEvent', params: {} });
        expect(warnSpy).toHaveBeenCalledWith('Unknown replay event type: unknownEvent');
        warnSpy.mockRestore();
    });
});
