// Chord diagrams (G15d3): the TEF importer's chord table and anchors.
//
// The fixtures are the two hand-built files from
// tests/parser/fixtures/build_chord_diagram_fixtures.py (it documents the
// song they share). The golden gate already pins JS == Python on both; this
// file pins the shape in plain words, and the failure paths the golden
// cannot reach.
//
// Python counterpart: tests/parser/test_tef_chord_diagrams.py
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';
import { parseV3 } from '../tef-import/reader.js';
import { validateOTF } from '../otf-editor/otf-validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../../../tests/parser/fixtures');
const load = (name) => Uint8Array.from(fs.readFileSync(path.join(FIXTURES, name)));
// The V3 fixture also holds a decoy 0x75 scale diagram and 0xf5 special character,
// which the G15e report counts.
const DECOYS = { scale_diagrams: 1, special_characters: 1 };

const G = { name: 'G', frets: [3, 0, 0, 0, 2, 3], fingers: [3, null, null, null, 1, 2] };
const AM7 = { name: 'Am7' };
const D = { name: 'D', frets: [0, 3, 2, 0, 0] };
const C7 = { name: 'C7', frets: [0, 1, 0, 2, 3, null] };   // unreferenced -> longest track (6)
const DIAGRAMS = [
    { measure: 1, tick: 0, track: 'guitar', chord: 0 },
    { measure: 1, tick: 480, track: 'banjo', chord: 2 },
    { measure: 2, tick: 0, track: 'banjo', chord: 1 },
    { measure: 2, tick: 960, track: 'guitar', chord: 4 },
];

describe('chord diagrams: V3 import', () => {
    const otf = parseTef(load('chord_diagrams_v3.tef'), 'chord_diagrams_v3.tef');

    it('reads the table: shapes, fingers, name-only, unreferenced, first_fret, byte-32 length', () => {
        expect(otf.chords).toEqual([
            G, AM7, D, C7, { name: 'F', frets: [1, 3, 3, 2], first_fret: 3 }]);
    });

    it('anchors each diagram to the track that owns its string row, with the dx/dy bytes', () => {
        const expected = DIAGRAMS.map(d => ({ ...d }));
        Object.assign(expected[2], { dx: 3, dy: -5 });
        expect(otf.chord_diagrams).toEqual(expected);
    });

    it('does not take the 0x75 scale diagram or the 0xf5 special character for anchors', () => {
        const data = load('chord_diagrams_v3.tef');
        const tef = parseV3(data, 'x');
        expect(tef.chord_anchors).toHaveLength(4);
    });

    it('keeps the text annotation and emits a valid document', () => {
        expect(otf.annotations).toEqual([{ measure: 1, tick: 240, text: 'G', track: 'banjo' }]);
        expect(otf.x_source).toEqual({ skipped: DECOYS });
        expect(validateOTF(otf).errors).toEqual([]);
    });

    it('drops an anchor past the table and counts it', () => {
        const data = load('chord_diagrams_v3.tef');
        const at = new DataView(data.buffer).getUint32(0x3c, true);
        const anchors = [];
        for (let o = at; o + 12 <= data.length; o += 12) if (data[o + 4] === 0x35) anchors.push(o);
        data[anchors[anchors.length - 1] + 5] = 99;
        const broken = parseTef(data, 'x.tef');
        expect(broken.chord_diagrams).toHaveLength(3);
        expect(broken.x_source).toEqual({ skipped: { ...DECOYS, chord_diagrams: 1 } });
    });

    it('drops every diagram when the table pointer is gone', () => {
        const data = load('chord_diagrams_v3.tef');
        data.fill(0, 88, 92);
        const broken = parseTef(data, 'x.tef');
        expect(broken.chords).toBeUndefined();
        expect(broken.chord_diagrams).toBeUndefined();
        expect(broken.x_source).toEqual({ skipped: { ...DECOYS, chord_diagrams: 4 } });
    });
});

describe('chord diagrams: V2 import', () => {
    const otf = parseTef(load('chord_diagrams_v2.tef'), 'chord_diagrams_v2.tef');

    it('reads the table after the text slots; no byte 32, so F takes its track\'s six strings', () => {
        expect(otf.chords).toEqual([
            G, AM7, D, C7, { name: 'F', frets: [1, 3, 3, 2, null, null], first_fret: 3 }]);
    });

    it('reads all three anchor codes (0x1c, 0x5c, 0x9c)', () => {
        expect(otf.chord_diagrams).toEqual(DIAGRAMS);
        expect(validateOTF(otf).errors).toEqual([]);
    });

    it('reports the diagrams of a table that does not parse instead of guessing', () => {
        const data = load('chord_diagrams_v2.tef');
        // the first record's name byte becomes a control character
        let first = -1;
        for (let i = 0; i + 5 < data.length; i++) {
            if (data[i] === 0x83 && data[i + 4] === 0x42) { first = i + 14; break; }
        }
        expect(data[first]).toBe(0x47);   // 'G'
        data[first] = 0x01;
        const broken = parseTef(data, 'x.tef');
        expect(broken.chords).toBeUndefined();
        expect(broken.chord_diagrams).toBeUndefined();
        expect(broken.x_source).toEqual({ skipped: { chord_diagrams: 4 } });
    });
});
