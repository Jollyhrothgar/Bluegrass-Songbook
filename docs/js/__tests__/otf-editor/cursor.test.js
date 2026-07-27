// Unit tests for OTF Editor Cursor
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EditorCursor } from '../../otf-editor/cursor.js';
import { EditorState, DURATIONS, TICKS_PER_BEAT } from '../../otf-editor/state.js';

describe('EditorCursor', () => {
    let state;
    let cursor;
    let mockContainer;

    beforeEach(() => {
        state = new EditorState();

        // Create a mock container
        mockContainer = document.createElement('div');
        document.body.appendChild(mockContainer);

        cursor = new EditorCursor(state);
    });

    afterEach(() => {
        if (cursor.overlay && cursor.overlay.parentNode) {
            cursor.destroy();
        }
        if (mockContainer.parentNode) {
            mockContainer.parentNode.removeChild(mockContainer);
        }
    });

    describe('constructor', () => {
        it('creates with default options', () => {
            expect(cursor.options.cursorColor).toBe('var(--accent, #007bff)');
            expect(cursor.options.cursorWidth).toBe(2);
            expect(cursor.options.insertBoxPadding).toBe(2);
            expect(cursor.options.ghostOpacity).toBe(0.4);
        });

        it('merges custom options', () => {
            const customCursor = new EditorCursor(state, {
                cursorColor: '#ff0000',
                cursorWidth: 4,
            });
            expect(customCursor.options.cursorColor).toBe('#ff0000');
            expect(customCursor.options.cursorWidth).toBe(4);
            expect(customCursor.options.insertBoxPadding).toBe(2); // default preserved
        });

        it('starts with null layout info', () => {
            expect(cursor.layoutInfo).toBeNull();
        });
    });

    describe('init', () => {
        it('creates overlay element', () => {
            cursor.init(mockContainer);
            expect(cursor.overlay).not.toBeNull();
            expect(cursor.overlay.className).toBe('editor-cursor-overlay');
        });

        it('creates cursor element', () => {
            cursor.init(mockContainer);
            expect(cursor.cursorElement).not.toBeNull();
            expect(cursor.cursorElement.className).toBe('editor-cursor');
        });

        it('creates ghost note element', () => {
            cursor.init(mockContainer);
            expect(cursor.ghostNote).not.toBeNull();
            expect(cursor.ghostNote.className).toBe('editor-ghost-note');
            expect(cursor.ghostNote.style.display).toBe('none');
        });

        it('appends overlay to container', () => {
            cursor.init(mockContainer);
            expect(mockContainer.contains(cursor.overlay)).toBe(true);
        });

        it('overlay has pointer-events none', () => {
            cursor.init(mockContainer);
            expect(cursor.overlay.style.pointerEvents).toBe('none');
        });
    });

    describe('_calculatePosition', () => {
        const mockLayoutInfo = {
            leftMargin: 40,
            topMargin: 30,
            stringSpacing: 16,
            measureWidth: 200,
            measuresPerRow: 2,
            ticksPerMeasure: 1920,
            rowHeight: 120,
            noteAreaStart: 10,
            noteAreaWidth: 180,
            trackInfoOffset: 50,
        };

        beforeEach(() => {
            cursor.init(mockContainer);
            cursor.setLayoutInfo(mockLayoutInfo);
        });

        it('returns null when no layout info', () => {
            const noCursor = new EditorCursor(state);
            expect(noCursor._calculatePosition()).toBeNull();
        });

        it('calculates position for measure 1, tick 0, string 1', () => {
            state.cursor.measure = 1;
            state.cursor.tick = 0;
            state.cursor.string = 1;

            const pos = cursor._calculatePosition();
            // X: leftMargin(40) + measureInRow(0) * measureWidth + noteAreaStart(10) + tickRatio(0) * noteAreaWidth(180)
            expect(pos.x).toBe(40 + 0 * 200 + 10 + 0 * 180);
            // Y: trackInfoOffset(50) + rowIndex(0) * rowHeight(120) + topMargin(30) + stringIndex(0) * stringSpacing(16)
            expect(pos.y).toBe(50 + 0 * 120 + 30 + 0 * 16);
            expect(pos.rowIndex).toBe(0);
        });

        it('calculates position for measure 1, tick 960 (half measure), string 3', () => {
            state.cursor.measure = 1;
            state.cursor.tick = 960;
            state.cursor.string = 3;

            const pos = cursor._calculatePosition();
            // tickRatio = 960/1920 = 0.5
            expect(pos.x).toBe(40 + 10 + 0.5 * 180);
            expect(pos.y).toBe(50 + 30 + 2 * 16); // string 3 = index 2
        });

        it('calculates position for measure 2 (second in first row)', () => {
            state.cursor.measure = 2;
            state.cursor.tick = 0;
            state.cursor.string = 1;

            const pos = cursor._calculatePosition();
            // measureInRow = 1
            expect(pos.x).toBe(40 + 1 * 200 + 10 + 0);
            expect(pos.rowIndex).toBe(0);
        });

        it('calculates position for measure 3 (first in second row)', () => {
            state.cursor.measure = 3;
            state.cursor.tick = 0;
            state.cursor.string = 1;

            const pos = cursor._calculatePosition();
            // rowIndex = floor(2/2) = 1, measureInRow = 0
            expect(pos.x).toBe(40 + 0 * 200 + 10 + 0);
            expect(pos.rowIndex).toBe(1);
            expect(pos.rowTop).toBe(50 + 1 * 120); // trackInfoOffset + rowIndex * rowHeight
        });

        it('accounts for trackInfoOffset in Y calculation', () => {
            state.cursor.measure = 1;
            state.cursor.tick = 0;
            state.cursor.string = 1;

            // Test with different trackInfoOffset
            cursor.setLayoutInfo({ ...mockLayoutInfo, trackInfoOffset: 100 });
            const pos = cursor._calculatePosition();
            expect(pos.y).toBe(100 + 30 + 0);
        });

        it('handles zero trackInfoOffset', () => {
            cursor.setLayoutInfo({ ...mockLayoutInfo, trackInfoOffset: 0 });
            state.cursor.string = 1;

            const pos = cursor._calculatePosition();
            expect(pos.y).toBe(0 + 30 + 0);
        });
    });

    describe('setLayoutInfo', () => {
        it('stores layout info', () => {
            const layoutInfo = { leftMargin: 50, topMargin: 30 };
            cursor.setLayoutInfo(layoutInfo);
            expect(cursor.layoutInfo).toBe(layoutInfo);
        });

        it('calls update', () => {
            cursor.init(mockContainer);
            const updateSpy = vi.spyOn(cursor, 'update');
            cursor.setLayoutInfo({ leftMargin: 50 });
            expect(updateSpy).toHaveBeenCalled();
        });
    });

    describe('update', () => {
        const mockLayoutInfo = {
            leftMargin: 40,
            topMargin: 30,
            stringSpacing: 16,
            measureWidth: 200,
            measuresPerRow: 2,
            ticksPerMeasure: 1920,
            rowHeight: 120,
            noteAreaStart: 10,
            noteAreaWidth: 180,
            trackInfoOffset: 50,
        };

        beforeEach(() => {
            cursor.init(mockContainer);
            cursor.setLayoutInfo(mockLayoutInfo);
        });

        it('does nothing without overlay', () => {
            const noCursor = new EditorCursor(state);
            expect(() => noCursor.update()).not.toThrow();
        });

        it('does nothing without layout info', () => {
            cursor.layoutInfo = null;
            expect(() => cursor.update()).not.toThrow();
        });

        it('updates cursor style based on mode', () => {
            state.mode = 'normal';
            cursor.update();
            // In normal mode, cursor is a crosshair container
            expect(cursor.cursorElement.style.width).toBe('50px'); // Container size

            state.mode = 'insert';
            cursor.update();
            // In insert mode, cursor center has a box border
            expect(cursor.cursorCenter.style.border).toContain('solid');
        });
    });

    describe('moveByTicks', () => {
        beforeEach(() => {
            // Add some measures so we have room to move
            state.getOrCreateMeasure(4);
        });

        it('moves cursor forward', () => {
            state.cursor.tick = 0;
            cursor.moveByTicks(240);
            expect(state.cursor.tick).toBe(240);
        });

        it('moves cursor backward', () => {
            state.cursor.tick = 480;
            cursor.moveByTicks(-240);
            expect(state.cursor.tick).toBe(240);
        });

        it('moves to next measure when exceeding current', () => {
            state.cursor.measure = 1;
            state.cursor.tick = 1680; // Near end of measure
            cursor.moveByTicks(480); // Move past measure boundary

            expect(state.cursor.measure).toBe(2);
            expect(state.cursor.tick).toBe(240);
        });

        it('moves to previous measure when going before 0', () => {
            state.cursor.measure = 2;
            state.cursor.tick = 120;
            cursor.moveByTicks(-240);

            expect(state.cursor.measure).toBe(1);
            expect(state.cursor.tick).toBe(1800);
        });

        it('clamps to start of document', () => {
            state.cursor.measure = 1;
            state.cursor.tick = 100;
            cursor.moveByTicks(-500);

            expect(state.cursor.measure).toBe(1);
            expect(state.cursor.tick).toBe(0);
        });

        it('clamps to end of document', () => {
            state.cursor.measure = 4;
            state.cursor.tick = 1800;
            cursor.moveByTicks(500);

            expect(state.cursor.measure).toBe(4);
            // Should be at last valid tick
        });

        it('emits cursorMove event', () => {
            const callback = vi.fn();
            state.on('cursorMove', callback);
            cursor.moveByTicks(240);
            expect(callback).toHaveBeenCalled();
        });

        it('updates selection end in visual mode', () => {
            state.setMode('visual');
            state.cursor.tick = 0;
            cursor.moveByTicks(480);

            expect(state.selection.end.tick).toBe(480);
        });
    });

    describe('moveByDuration', () => {
        it('moves forward by the SELECTED duration (the working increment)', () => {
            state.currentDuration = DURATIONS.quarter;
            state.gridSubdivision = DURATIONS.sixteenth; // ruler ≠ increment
            state.cursor.tick = 0;
            cursor.moveByDuration(1);
            expect(state.cursor.tick).toBe(480);
        });

        it('moves backward by the selected duration', () => {
            state.currentDuration = DURATIONS.eighth;
            state.cursor.tick = 480;
            cursor.moveByDuration(-1);
            expect(state.cursor.tick).toBe(240);
        });
    });

    describe('ts-aware navigation (short measures)', () => {
        // 2/2 tune with a 2/4 measure at m3 — the 27493 shape. The old
        // uniform math let the cursor park at m3 ticks 960..1919 (a
        // phantom half of the short measure); inserts there rendered
        // past the barline into m4's signature glyph.
        const tsOtf = () => ({
            otf_version: '1.0',
            metadata: {
                title: 'TS', time_signature: '2/2',
                time_signature_changes: [{ measure: 3, time_signature: '2/4' }],
            },
            timing: { ticks_per_beat: 480 },
            tracks: [{ id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
            notation: { banjo: [1, 2, 3, 4, 5].map(m => ({ measure: m, events: [] })) },
        });

        let tsState, tsCursor;
        beforeEach(() => {
            tsState = new EditorState({ otf: tsOtf() });
            tsCursor = new EditorCursor(tsState);
        });

        it('stepping past a short measure\'s end lands in the NEXT measure', () => {
            tsState.cursor.measure = 3;
            tsState.cursor.tick = 720;
            tsState.currentDuration = DURATIONS.eighth;
            tsCursor.moveByDuration(1); // 720 + 240 = 960 = end of the 2/4
            expect(tsState.cursor.measure).toBe(4);
            expect(tsState.cursor.tick).toBe(0);
        });

        it('cannot park in the phantom back half of a short measure', () => {
            tsState.cursor.measure = 3;
            tsState.cursor.tick = 0;
            tsState.currentDuration = DURATIONS.half; // 960 = whole short measure
            tsCursor.moveByDuration(1);
            expect(tsState.cursor.measure).toBe(4);
            expect(tsState.cursor.tick).toBe(0);
        });

        it('stepping backward across the seam is symmetric', () => {
            tsState.cursor.measure = 4;
            tsState.cursor.tick = 0;
            tsState.currentDuration = DURATIONS.eighth;
            tsCursor.moveByDuration(-1);
            expect(tsState.cursor.measure).toBe(3);
            expect(tsState.cursor.tick).toBe(720);
        });

        it('$ (measure end) uses the short measure\'s own length', () => {
            tsState.cursor.measure = 3;
            tsState.currentDuration = DURATIONS.eighth;
            tsCursor.moveToMeasureEnd();
            expect(tsState.cursor.tick).toBe(960 - 240);
        });
    });

    describe('moveByBeat', () => {
        it('moves to next beat boundary when moving forward', () => {
            state.cursor.tick = 100;
            cursor.moveByBeat(1);
            expect(state.cursor.tick).toBe(480); // Next beat
        });

        it('moves to previous beat boundary when moving backward', () => {
            state.cursor.tick = 600;
            cursor.moveByBeat(-1);
            expect(state.cursor.tick).toBe(480);
        });

        it('moves to previous beat when at beat boundary', () => {
            state.cursor.tick = 480;
            cursor.moveByBeat(-1);
            expect(state.cursor.tick).toBe(0);
        });
    });

    describe('moveString', () => {
        it('moves to higher string number', () => {
            state.cursor.string = 3;
            cursor.moveString(1);
            expect(state.cursor.string).toBe(4);
        });

        it('moves to lower string number', () => {
            state.cursor.string = 3;
            cursor.moveString(-1);
            expect(state.cursor.string).toBe(2);
        });

        it('clamps at string 1', () => {
            state.cursor.string = 1;
            cursor.moveString(-1);
            expect(state.cursor.string).toBe(1);
        });

        it('clamps at max string', () => {
            state.cursor.string = 5;
            cursor.moveString(1);
            expect(state.cursor.string).toBe(5);
        });
    });

    describe('moveToMeasureStart', () => {
        it('sets tick to 0', () => {
            state.cursor.tick = 480;
            cursor.moveToMeasureStart();
            expect(state.cursor.tick).toBe(0);
        });
    });

    describe('moveToMeasure', () => {
        beforeEach(() => {
            state.getOrCreateMeasure(5);
        });

        it('moves to specified measure', () => {
            cursor.moveToMeasure(3);
            expect(state.cursor.measure).toBe(3);
            expect(state.cursor.tick).toBe(0);
        });

        it('clamps to valid range', () => {
            cursor.moveToMeasure(10);
            expect(state.cursor.measure).toBe(5);

            cursor.moveToMeasure(0);
            expect(state.cursor.measure).toBe(1);
        });
    });

    describe('moveToStart', () => {
        it('moves to beginning of document', () => {
            state.cursor.measure = 3;
            state.cursor.tick = 480;
            cursor.moveToStart();
            expect(state.cursor.measure).toBe(1);
            expect(state.cursor.tick).toBe(0);
        });
    });

    describe('setFromCoordinates', () => {
        const mockLayoutInfo = {
            leftMargin: 40,
            topMargin: 30,
            stringSpacing: 16,
            measureWidth: 200,
            measuresPerRow: 2,
            ticksPerMeasure: 1920,
            rowHeight: 120,
            noteAreaStart: 10,
            noteAreaWidth: 180,
            trackInfoOffset: 50,
        };

        beforeEach(() => {
            cursor.init(mockContainer);
            cursor.setLayoutInfo(mockLayoutInfo);
            state.getOrCreateMeasure(4);
        });

        it('returns false without layout info', () => {
            cursor.layoutInfo = null;
            expect(cursor.setFromCoordinates(100, 100)).toBe(false);
        });

        it('sets cursor from valid coordinates', () => {
            // Click in measure 1, near tick 0, string 1
            const x = 40 + 10 + 5; // leftMargin + noteAreaStart + small offset
            const y = 50 + 30 - 5; // trackInfoOffset + topMargin - small offset (near string 1)

            expect(cursor.setFromCoordinates(x, y)).toBe(true);
            expect(state.cursor.measure).toBe(1);
        });

        it('snaps to current duration grid', () => {
            state.currentDuration = DURATIONS.quarter; // 480 ticks

            // Click at middle of measure
            const x = 40 + 10 + 90; // Should be around tick 960
            const y = 50 + 30;

            cursor.setFromCoordinates(x, y);
            expect(state.cursor.tick % 480).toBe(0); // Snapped to quarter note
        });

        it('calculates correct row from y coordinate', () => {
            // Click in second row
            const x = 40 + 10 + 5;
            const y = 50 + 120 + 30; // Second row

            cursor.setFromCoordinates(x, y);
            expect(state.cursor.measure).toBe(3); // First measure in second row
        });

        it('calculates correct string from y coordinate', () => {
            const x = 40 + 10 + 5;

            // Click near string 3 (index 2)
            const y = 50 + 30 + 2 * 16;
            cursor.setFromCoordinates(x, y);
            expect(state.cursor.string).toBe(3);
        });

        it('clamps string to valid range', () => {
            const x = 40 + 10 + 5;

            // Click way above strings
            cursor.setFromCoordinates(x, 0);
            expect(state.cursor.string).toBeGreaterThanOrEqual(1);

            // Click way below strings
            cursor.setFromCoordinates(x, 500);
            expect(state.cursor.string).toBeLessThanOrEqual(5);
        });

        it('returns false for invalid x position', () => {
            // Click before left margin
            expect(cursor.setFromCoordinates(5, 80)).toBe(false);
        });
    });

    describe('showGhostNote / hideGhostNote', () => {
        beforeEach(() => {
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
        });

        it('shows ghost note with fret number', () => {
            cursor.showGhostNote(5);
            expect(cursor.ghostNote.style.display).toBe('block');
            expect(cursor.ghostNote.textContent).toBe('5');
        });

        it('hides ghost note', () => {
            cursor.showGhostNote(5);
            cursor.hideGhostNote();
            expect(cursor.ghostNote.style.display).toBe('none');
        });
    });

    describe('destroy', () => {
        it('removes overlay from DOM', () => {
            cursor.init(mockContainer);
            expect(mockContainer.contains(cursor.overlay)).toBe(true);

            cursor.destroy();
            expect(mockContainer.contains(cursor.overlay)).toBe(false);
        });

        it('nullifies references', () => {
            cursor.init(mockContainer);
            cursor.destroy();

            expect(cursor.overlay).toBeNull();
            expect(cursor.cursorElement).toBeNull();
            expect(cursor.ghostNote).toBeNull();
        });
    });
});

describe('Cursor positioning edge cases', () => {
    let state;
    let cursor;
    let mockContainer;

    beforeEach(() => {
        state = new EditorState();
        cursor = new EditorCursor(state);
        mockContainer = document.createElement('div');
        document.body.appendChild(mockContainer);
        cursor.init(mockContainer);
    });

    afterEach(() => {
        cursor.destroy();
        mockContainer.parentNode.removeChild(mockContainer);
    });

    it('handles missing trackInfoOffset in layout info', () => {
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
            // trackInfoOffset intentionally missing
        });

        const pos = cursor._calculatePosition();
        expect(pos).not.toBeNull();
        // Should default to 0
        expect(pos.rowTop).toBe(0);
    });

    it('handles large measure numbers', () => {
        state.getOrCreateMeasure(100);
        state.cursor.measure = 50;
        cursor.setLayoutInfo({
            leftMargin: 40,
            topMargin: 30,
            stringSpacing: 16,
            measureWidth: 200,
            measuresPerRow: 4,
            ticksPerMeasure: 1920,
            rowHeight: 120,
            noteAreaStart: 10,
            noteAreaWidth: 180,
            trackInfoOffset: 50,
        });

        const pos = cursor._calculatePosition();
        expect(pos.rowIndex).toBe(12); // floor((50-1)/4) = 12
    });

    it('handles 3/4 time signature', () => {
        state.otf.metadata.time_signature = '3/4';
        state._updateTicksPerMeasure();

        expect(state.ticksPerMeasure).toBe(1440);

        cursor.setLayoutInfo({
            leftMargin: 40,
            topMargin: 30,
            stringSpacing: 16,
            measureWidth: 200,
            measuresPerRow: 2,
            ticksPerMeasure: 1440,
            rowHeight: 120,
            noteAreaStart: 10,
            noteAreaWidth: 180,
            trackInfoOffset: 0,
        });

        state.cursor.tick = 720; // Half of 3/4 measure
        const pos = cursor._calculatePosition();
        // tickRatio = 720/1440 = 0.5
        expect(pos.x).toBe(40 + 10 + 0.5 * 180);
    });
});
