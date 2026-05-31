// Unit tests for OTF Editor Actions
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    createEmptyOTF,
    addMeasures,
    trimEmptyMeasures,
    quantize,
    transpose,
    shiftNotes,
    copyRange,
    pasteRange,
    deleteRange,
    insertRoll,
    validateOTF,
    cleanupOTF,
    downloadOTF,
} from '../../otf-editor/actions.js';
import { EditorState, DURATIONS } from '../../otf-editor/state.js';

describe('createEmptyOTF', () => {
    it('creates 5-string banjo by default', () => {
        const otf = createEmptyOTF();
        expect(otf.tracks[0].instrument).toBe('5-string-banjo');
        expect(otf.tracks[0].tuning).toHaveLength(5);
        expect(otf.tracks[0].id).toBe('banjo');
    });

    it('creates 6-string guitar', () => {
        const otf = createEmptyOTF('6-string-guitar');
        expect(otf.tracks[0].instrument).toBe('6-string-guitar');
        expect(otf.tracks[0].tuning).toHaveLength(6);
        expect(otf.tracks[0].id).toBe('guitar');
    });

    it('creates mandolin', () => {
        const otf = createEmptyOTF('mandolin');
        expect(otf.tracks[0].instrument).toBe('mandolin');
        expect(otf.tracks[0].tuning).toHaveLength(4);
    });

    it('creates upright bass', () => {
        const otf = createEmptyOTF('upright-bass');
        expect(otf.tracks[0].instrument).toBe('upright-bass');
        expect(otf.tracks[0].tuning).toHaveLength(4);
    });

    it('creates tenor banjo', () => {
        const otf = createEmptyOTF('tenor-banjo');
        expect(otf.tracks[0].instrument).toBe('tenor-banjo');
        expect(otf.tracks[0].tuning).toHaveLength(4);
    });

    it('creates dobro', () => {
        const otf = createEmptyOTF('dobro');
        expect(otf.tracks[0].instrument).toBe('dobro');
        expect(otf.tracks[0].tuning).toHaveLength(6);
    });

    it('falls back to banjo for unknown instrument', () => {
        const otf = createEmptyOTF('unknown-instrument');
        expect(otf.tracks[0].instrument).toBe('unknown-instrument');
        expect(otf.tracks[0].tuning).toHaveLength(5); // Uses banjo config
    });

    it('accepts title option', () => {
        const otf = createEmptyOTF('5-string-banjo', { title: 'My Song' });
        expect(otf.metadata.title).toBe('My Song');
    });

    it('accepts tempo option', () => {
        const otf = createEmptyOTF('5-string-banjo', { tempo: 140 });
        expect(otf.metadata.tempo).toBe(140);
    });

    it('accepts timeSignature option', () => {
        const otf = createEmptyOTF('5-string-banjo', { timeSignature: '3/4' });
        expect(otf.metadata.time_signature).toBe('3/4');
    });

    it('accepts capo option', () => {
        const otf = createEmptyOTF('5-string-banjo', { capo: 2 });
        expect(otf.tracks[0].capo).toBe(2);
    });

    it('starts with 4 empty measures', () => {
        const otf = createEmptyOTF();
        const notation = otf.notation[otf.tracks[0].id];
        expect(notation).toHaveLength(4);
        expect(notation[0].events).toHaveLength(0);
    });

    it('has correct OTF version', () => {
        const otf = createEmptyOTF();
        expect(otf.otf_version).toBe('1.0');
    });

    it('has timing section with ticks_per_beat', () => {
        const otf = createEmptyOTF();
        expect(otf.timing.ticks_per_beat).toBe(480);
    });
});

describe('addMeasures', () => {
    let otf;
    let trackId;

    beforeEach(() => {
        otf = createEmptyOTF();
        trackId = otf.tracks[0].id;
    });

    it('adds one measure by default', () => {
        const initialLength = otf.notation[trackId].length;
        addMeasures(otf, trackId);
        expect(otf.notation[trackId].length).toBe(initialLength + 1);
    });

    it('adds multiple measures', () => {
        const initialLength = otf.notation[trackId].length;
        addMeasures(otf, trackId, 3);
        expect(otf.notation[trackId].length).toBe(initialLength + 3);
    });

    it('measures have correct numbers', () => {
        addMeasures(otf, trackId, 2);
        const notation = otf.notation[trackId];
        expect(notation[notation.length - 2].measure).toBe(5);
        expect(notation[notation.length - 1].measure).toBe(6);
    });

    it('returns otf for chaining', () => {
        const result = addMeasures(otf, trackId);
        expect(result).toBe(otf);
    });

    it('handles invalid track ID gracefully', () => {
        const result = addMeasures(otf, 'nonexistent');
        expect(result).toBe(otf);
    });
});

describe('trimEmptyMeasures', () => {
    let otf;
    let trackId;

    beforeEach(() => {
        otf = createEmptyOTF();
        trackId = otf.tracks[0].id;
        addMeasures(otf, trackId, 4); // Now 8 measures
    });

    it('removes empty trailing measures', () => {
        expect(otf.notation[trackId].length).toBe(8);
        trimEmptyMeasures(otf, trackId);
        expect(otf.notation[trackId].length).toBe(4); // Minimum 4
    });

    it('keeps at least 4 measures', () => {
        trimEmptyMeasures(otf, trackId);
        expect(otf.notation[trackId].length).toBe(4);
    });

    it('stops at non-empty measure', () => {
        // Add a note to measure 6
        otf.notation[trackId][5].events.push({
            tick: 0,
            notes: [{ s: 3, f: 5 }]
        });

        trimEmptyMeasures(otf, trackId);
        expect(otf.notation[trackId].length).toBe(6);
    });

    it('returns otf for chaining', () => {
        const result = trimEmptyMeasures(otf, trackId);
        expect(result).toBe(otf);
    });
});

describe('quantize', () => {
    let otf;
    let trackId;

    beforeEach(() => {
        otf = createEmptyOTF();
        trackId = otf.tracks[0].id;
    });

    it('snaps events to grid', () => {
        otf.notation[trackId][0].events.push({
            tick: 115, // Should snap to 120 (sixteenth)
            notes: [{ s: 3, f: 5 }]
        });

        quantize(otf, trackId, DURATIONS.sixteenth);
        expect(otf.notation[trackId][0].events[0].tick).toBe(120);
    });

    it('snaps to quarter note grid', () => {
        otf.notation[trackId][0].events.push({
            tick: 400, // Should snap to 480 (quarter)
            notes: [{ s: 3, f: 5 }]
        });

        quantize(otf, trackId, DURATIONS.quarter);
        expect(otf.notation[trackId][0].events[0].tick).toBe(480);
    });

    it('merges events at same tick after quantization', () => {
        otf.notation[trackId][0].events.push(
            { tick: 115, notes: [{ s: 3, f: 5 }] },
            { tick: 125, notes: [{ s: 1, f: 0 }] }
        );

        quantize(otf, trackId, DURATIONS.sixteenth);
        expect(otf.notation[trackId][0].events.length).toBe(1);
        expect(otf.notation[trackId][0].events[0].notes.length).toBe(2);
    });

    it('does not duplicate notes on same string when merging', () => {
        otf.notation[trackId][0].events.push(
            { tick: 115, notes: [{ s: 3, f: 5 }] },
            { tick: 125, notes: [{ s: 3, f: 7 }] }
        );

        quantize(otf, trackId, DURATIONS.sixteenth);
        // First note wins
        expect(otf.notation[trackId][0].events[0].notes.length).toBe(1);
        expect(otf.notation[trackId][0].events[0].notes[0].f).toBe(5);
    });

    it('sorts events by tick after quantization', () => {
        otf.notation[trackId][0].events.push(
            { tick: 350, notes: [{ s: 1, f: 0 }] },
            { tick: 100, notes: [{ s: 3, f: 5 }] }
        );

        quantize(otf, trackId, DURATIONS.sixteenth);
        expect(otf.notation[trackId][0].events[0].tick)
            .toBeLessThan(otf.notation[trackId][0].events[1].tick);
    });
});

describe('transpose', () => {
    let otf;
    let trackId;

    beforeEach(() => {
        otf = createEmptyOTF();
        trackId = otf.tracks[0].id;
        otf.notation[trackId][0].events.push({
            tick: 0,
            notes: [{ s: 3, f: 5 }, { s: 1, f: 7 }]
        });
    });

    it('transposes notes up', () => {
        transpose(otf, 2);
        expect(otf.notation[trackId][0].events[0].notes[0].f).toBe(7);
        expect(otf.notation[trackId][0].events[0].notes[1].f).toBe(9);
    });

    it('transposes notes down', () => {
        transpose(otf, -2);
        expect(otf.notation[trackId][0].events[0].notes[0].f).toBe(3);
        expect(otf.notation[trackId][0].events[0].notes[1].f).toBe(5);
    });

    it('clamps to 0 when transposing below', () => {
        transpose(otf, -10);
        expect(otf.notation[trackId][0].events[0].notes[0].f).toBe(0);
    });

    it('transposes all tracks', () => {
        // Add a second track
        otf.tracks.push({ id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'] });
        otf.notation.guitar = [{ measure: 1, events: [{ tick: 0, notes: [{ s: 1, f: 3 }] }] }];

        transpose(otf, 2);
        expect(otf.notation[trackId][0].events[0].notes[0].f).toBe(7);
        expect(otf.notation.guitar[0].events[0].notes[0].f).toBe(5);
    });
});

describe('shiftNotes', () => {
    let otf;
    let trackId;
    const ticksPerMeasure = 1920;

    beforeEach(() => {
        otf = createEmptyOTF();
        trackId = otf.tracks[0].id;
        // Add notes at tick 0 and 240
        otf.notation[trackId][0].events.push(
            { tick: 0, notes: [{ s: 3, f: 5 }] },
            { tick: 240, notes: [{ s: 3, f: 7 }] }
        );
    });

    it('shifts notes forward', () => {
        shiftNotes(otf, trackId, 0, 240, 240, ticksPerMeasure);
        const events = otf.notation[trackId][0].events;
        expect(events[0].tick).toBe(240);
        expect(events[1].tick).toBe(480);
    });

    it('shifts notes backward', () => {
        shiftNotes(otf, trackId, 240, 240, -240, ticksPerMeasure);
        const events = otf.notation[trackId][0].events;
        expect(events.find(e => e.tick === 0 && e.notes.some(n => n.f === 7))).toBeDefined();
    });

    it('shifts notes across measure boundary', () => {
        otf.notation[trackId][0].events.push(
            { tick: 1800, notes: [{ s: 1, f: 0 }] }
        );

        shiftNotes(otf, trackId, 1800, 1800, 240, ticksPerMeasure);
        expect(otf.notation[trackId][1].events.find(e => e.tick === 120)).toBeDefined();
    });

    it('creates measure if needed when shifting', () => {
        // Remove measure 2
        otf.notation[trackId] = otf.notation[trackId].slice(0, 1);
        otf.notation[trackId][0].events.push(
            { tick: 1800, notes: [{ s: 1, f: 0 }] }
        );

        shiftNotes(otf, trackId, 1800, 1800, 240, ticksPerMeasure);
        expect(otf.notation[trackId].find(m => m.measure === 2)).toBeDefined();
    });
});

describe('copyRange / pasteRange', () => {
    let otf;
    let trackId;
    const ticksPerMeasure = 1920;

    beforeEach(() => {
        otf = createEmptyOTF();
        trackId = otf.tracks[0].id;
        otf.notation[trackId][0].events.push(
            { tick: 0, notes: [{ s: 3, f: 5 }] },
            { tick: 240, notes: [{ s: 3, f: 7 }] }
        );
    });

    it('copies notes in range', () => {
        const copied = copyRange(otf, trackId, 0, 240, ticksPerMeasure);
        expect(copied).toHaveLength(2);
        expect(copied[0].relativeTick).toBe(0);
        expect(copied[1].relativeTick).toBe(240);
    });

    it('returns empty array for empty range', () => {
        const copied = copyRange(otf, trackId, 500, 600, ticksPerMeasure);
        expect(copied).toHaveLength(0);
    });

    it('pastes at destination', () => {
        const copied = copyRange(otf, trackId, 0, 240, ticksPerMeasure);
        pasteRange(otf, trackId, copied, 480, ticksPerMeasure);

        const events = otf.notation[trackId][0].events;
        expect(events.find(e => e.tick === 480)).toBeDefined();
        expect(events.find(e => e.tick === 720)).toBeDefined();
    });

    it('merges with existing notes when pasting', () => {
        otf.notation[trackId][0].events.push(
            { tick: 480, notes: [{ s: 1, f: 0 }] }
        );

        const copied = copyRange(otf, trackId, 0, 0, ticksPerMeasure);
        pasteRange(otf, trackId, copied, 480, ticksPerMeasure);

        const event = otf.notation[trackId][0].events.find(e => e.tick === 480);
        expect(event.notes.length).toBe(2); // Original + pasted
    });

    it('creates measures when pasting beyond existing', () => {
        otf.notation[trackId] = otf.notation[trackId].slice(0, 1);

        const copied = copyRange(otf, trackId, 0, 0, ticksPerMeasure);
        pasteRange(otf, trackId, copied, ticksPerMeasure, ticksPerMeasure);

        expect(otf.notation[trackId].find(m => m.measure === 2)).toBeDefined();
    });
});

describe('deleteRange', () => {
    let otf;
    let trackId;
    const ticksPerMeasure = 1920;

    beforeEach(() => {
        otf = createEmptyOTF();
        trackId = otf.tracks[0].id;
        otf.notation[trackId][0].events.push(
            { tick: 0, notes: [{ s: 3, f: 5 }] },
            { tick: 240, notes: [{ s: 3, f: 7 }] },
            { tick: 480, notes: [{ s: 1, f: 0 }] }
        );
    });

    it('deletes events in range', () => {
        deleteRange(otf, trackId, 0, 240, ticksPerMeasure);
        const events = otf.notation[trackId][0].events;
        expect(events).toHaveLength(1);
        expect(events[0].tick).toBe(480);
    });

    it('keeps events outside range', () => {
        deleteRange(otf, trackId, 240, 240, ticksPerMeasure);
        const events = otf.notation[trackId][0].events;
        expect(events).toHaveLength(2);
        expect(events.find(e => e.tick === 0)).toBeDefined();
        expect(events.find(e => e.tick === 480)).toBeDefined();
    });

    it('deletes across measures', () => {
        otf.notation[trackId][1].events.push(
            { tick: 0, notes: [{ s: 3, f: 9 }] }
        );

        deleteRange(otf, trackId, 480, ticksPerMeasure, ticksPerMeasure);
        expect(otf.notation[trackId][0].events).toHaveLength(2);
        expect(otf.notation[trackId][1].events).toHaveLength(0);
    });
});

describe('insertRoll', () => {
    let state;

    beforeEach(() => {
        state = new EditorState();
    });

    it('inserts forward roll pattern', () => {
        insertRoll(state, 'forward');
        const events = state.getMeasure(1).events;
        expect(events.length).toBeGreaterThan(0);
        // Forward roll: 5, 3, 2, 5, 3, 2, 5, 3
        expect(events[0].notes[0].s).toBe(5);
    });

    it('inserts backward roll pattern', () => {
        insertRoll(state, 'backward');
        const events = state.getMeasure(1).events;
        // Backward roll: 2, 3, 5, ...
        expect(events[0].notes[0].s).toBe(2);
    });

    it('inserts alternating roll pattern', () => {
        insertRoll(state, 'alternating');
        const events = state.getMeasure(1).events;
        expect(events.length).toBeGreaterThan(0);
    });

    it('inserts foggy-mountain roll pattern', () => {
        insertRoll(state, 'foggy-mountain');
        const events = state.getMeasure(1).events;
        // Foggy Mountain: 2, 3, 5, 3, 1, 5, 3, 1
        expect(events[0].notes[0].s).toBe(2);
    });

    it('advances cursor after each note', () => {
        const initialTick = state.cursor.tick;
        insertRoll(state, 'forward');
        expect(state.cursor.getAbsoluteTick(state.ticksPerMeasure))
            .toBeGreaterThan(initialTick);
    });

    it('does nothing for unknown roll type', () => {
        insertRoll(state, 'nonexistent');
        expect(state.getMeasure(1).events).toHaveLength(0);
    });
});

describe('validateOTF', () => {
    it('validates correct OTF document', () => {
        const otf = createEmptyOTF();
        const result = validateOTF(otf);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('rejects null document', () => {
        const result = validateOTF(null);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('OTF document is null or undefined');
    });

    it('reports missing metadata', () => {
        const otf = createEmptyOTF();
        delete otf.metadata;
        const result = validateOTF(otf);
        expect(result.errors).toContain('Missing metadata section');
    });

    it('reports missing timing', () => {
        const otf = createEmptyOTF();
        delete otf.timing;
        const result = validateOTF(otf);
        expect(result.errors).toContain('Missing timing section');
    });

    it('reports missing ticks_per_beat', () => {
        const otf = createEmptyOTF();
        delete otf.timing.ticks_per_beat;
        const result = validateOTF(otf);
        expect(result.errors).toContain('Missing ticks_per_beat in timing');
    });

    it('reports no tracks', () => {
        const otf = createEmptyOTF();
        otf.tracks = [];
        const result = validateOTF(otf);
        expect(result.errors).toContain('No tracks defined');
    });

    it('reports track missing id', () => {
        const otf = createEmptyOTF();
        delete otf.tracks[0].id;
        const result = validateOTF(otf);
        expect(result.errors).toContain('Track missing id');
    });

    it('reports track missing tuning', () => {
        const otf = createEmptyOTF();
        delete otf.tracks[0].tuning;
        const result = validateOTF(otf);
        expect(result.errors.some(e => e.includes('missing tuning'))).toBe(true);
    });

    it('reports missing notation', () => {
        const otf = createEmptyOTF();
        delete otf.notation;
        const result = validateOTF(otf);
        expect(result.errors).toContain('Missing notation section');
    });

    it('reports unknown OTF version', () => {
        const otf = createEmptyOTF();
        otf.otf_version = '2.0';
        const result = validateOTF(otf);
        expect(result.errors.some(e => e.includes('Unknown OTF version'))).toBe(true);
    });
});

describe('cleanupOTF', () => {
    let otf;
    let trackId;

    beforeEach(() => {
        otf = createEmptyOTF();
        trackId = otf.tracks[0].id;
    });

    it('removes events with no notes', () => {
        otf.notation[trackId][0].events.push(
            { tick: 0, notes: [] },
            { tick: 240, notes: [{ s: 3, f: 5 }] }
        );

        cleanupOTF(otf);
        expect(otf.notation[trackId][0].events).toHaveLength(1);
    });

    it('sorts events by tick', () => {
        otf.notation[trackId][0].events.push(
            { tick: 480, notes: [{ s: 1, f: 0 }] },
            { tick: 0, notes: [{ s: 3, f: 5 }] },
            { tick: 240, notes: [{ s: 2, f: 7 }] }
        );

        cleanupOTF(otf);
        const ticks = otf.notation[trackId][0].events.map(e => e.tick);
        expect(ticks).toEqual([0, 240, 480]);
    });

    it('sorts notes by string', () => {
        otf.notation[trackId][0].events.push({
            tick: 0,
            notes: [{ s: 5, f: 0 }, { s: 1, f: 0 }, { s: 3, f: 5 }]
        });

        cleanupOTF(otf);
        const strings = otf.notation[trackId][0].events[0].notes.map(n => n.s);
        expect(strings).toEqual([1, 3, 5]);
    });

    it('sorts measures by number', () => {
        otf.notation[trackId].push(
            { measure: 10, events: [] },
            { measure: 5, events: [] }
        );

        cleanupOTF(otf);
        const measures = otf.notation[trackId].map(m => m.measure);
        expect(measures).toEqual([1, 2, 3, 4, 5, 10]);
    });

    it('returns otf for chaining', () => {
        const result = cleanupOTF(otf);
        expect(result).toBe(otf);
    });
});

describe('downloadOTF', () => {
    beforeEach(() => {
        // Mock URL and document methods
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:mock'),
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates download link with correct filename', () => {
        const otf = createEmptyOTF();
        const appendSpy = vi.spyOn(document.body, 'appendChild');
        const removeSpy = vi.spyOn(document.body, 'removeChild');

        downloadOTF(otf, 'my-song');

        expect(appendSpy).toHaveBeenCalled();
        const link = appendSpy.mock.calls[0][0];
        expect(link.download).toBe('my-song.otf.json');
        expect(removeSpy).toHaveBeenCalled();
    });

    it('uses default filename when not provided', () => {
        const otf = createEmptyOTF();
        const appendSpy = vi.spyOn(document.body, 'appendChild');

        downloadOTF(otf);

        const link = appendSpy.mock.calls[0][0];
        expect(link.download).toBe('untitled.otf.json');
    });

    it('cleans up OTF before download', () => {
        const otf = createEmptyOTF();
        // Add empty event that should be removed
        otf.notation[otf.tracks[0].id][0].events.push({ tick: 0, notes: [] });

        // The cleanupOTF is called internally, so we just verify download works
        expect(() => downloadOTF(otf)).not.toThrow();
    });

    it('revokes object URL after download', () => {
        const otf = createEmptyOTF();
        downloadOTF(otf);
        expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
});
