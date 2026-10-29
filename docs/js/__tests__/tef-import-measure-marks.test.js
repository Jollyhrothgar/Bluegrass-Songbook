// Repeat signs (G15d4): V3 0xb7 / V2 0x5e reading-guide marks -> measure_marks.
//
// The fixtures are frozen copies in tests/parser/fixtures/ (carried in
// golden.json, which the golden gate already compares with the Python
// importer); see tests/parser/test_tef_measure_marks.py for what each one
// isolates. Only cell byte 2 is read, OR-ed into the measure holding it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTefBytes } from '../tef-import/reader.js';
import { tefToOtf, toOtfDict } from '../tef-import/otf.js';
import { decodeMarkRaw } from '../otf-editor/otf-validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../tef-import/__fixtures__/golden.json'), 'utf8'));

const EXPECTED = {
    'marks_v3_26282_fire_on_the_mountain.tef':
        [5, [[5, 0x81], [6, 0x0a], [10, 0x81], [11, 0x0a], [13, 0x08]]],
    'marks_v3_27159_cumberland_gap.tef': [2, [[1, 0x40], [8, 0x80]]],
    'marks_v3_25911_golden_slippers.tef': [5, [[2, 0x40], [9, 0x81], [10, 0x0a]]],
    'marks_v2_21612_wild_horse.tef': [3, [[1, 0x40], [8, 0x81], [9, 0x0a]]],
    'marks_v2_21420_lone_end_bar.tef': [2, [[1, 0x40], [8, 0x08]]],
    'marks_only_banjo_22933_soldiers_joy.tef': [4, [[1, 0x40], [8, 0x80], [9, 0x40], [16, 0x80]]],
    'marks_v2_24144_huckleberry_hornpipe.tef':
        [11, [[1, 0x40], [4, 0x81], [5, 0x02], [6, 0x40], [9, 0x81], [10, 0x02],
              [11, 0x40], [14, 0x81], [15, 0x02]]],
    'marks_v2_17542_unspecified_ending.tef':
        [5, [[1, 0x07], [8, 0x80], [9, 0x40], [16, 0x80], [17, 0x08]]],
};

function load(name) {
    const entry = golden.files[name];
    if (!entry) throw new Error(`missing golden entry: ${name}`);
    const tef = parseTefBytes(Uint8Array.from(Buffer.from(entry.bytes_b64, 'base64')), name);
    return { tef, doc: toOtfDict(tefToOtf(tef)) };
}

describe('measure_marks import', () => {
    it.each(Object.keys(EXPECTED))('%s: one ascending entry per measure', (name) => {
        const [records, want] = EXPECTED[name];
        const { tef, doc } = load(name);
        expect(tef.mark_records).toBe(records);
        expect(doc.measure_marks.map(m => [m.measure, m.raw])).toEqual(want);
        const ms = doc.measure_marks.map(m => m.measure);
        expect(ms).toEqual([...new Set(ms)].sort((a, b) => a - b));
    });

    it.each(Object.keys(EXPECTED))('%s: fields come from decodeMarkRaw', (name) => {
        for (const m of load(name).doc.measure_marks) {
            expect(m).toEqual({ measure: m.measure, ...decodeMarkRaw(m.raw), raw: m.raw });
        }
    });

    it('Red Haired Boy style 0x81 / 0x0a, in V3 and V2', () => {
        for (const [name, a, b] of [['marks_v3_26282_fire_on_the_mountain.tef', 5, 6],
                                    ['marks_v2_21612_wild_horse.tef', 8, 9]]) {
            const by = Object.fromEntries(load(name).doc.measure_marks.map(m => [m.measure, m]));
            expect(by[a]).toEqual({ measure: a, repeat_end: true, ending: 1, raw: 0x81 });
            expect(by[b]).toEqual({ measure: b, ending: 2, end_bar: true, raw: 0x0a });
        }
    });

    it('a lone 0x08 is an end bar', () => {
        expect(load('marks_v3_26282_fire_on_the_mountain.tef').doc.measure_marks)
            .toContainEqual({ measure: 13, end_bar: true, raw: 0x08 });
        expect(load('marks_v2_21420_lone_end_bar.tef').doc.measure_marks)
            .toContainEqual({ measure: 8, end_bar: true, raw: 0x08 });
    });

    it('a 0x40 / 0x80 pair is a repeat start and end', () => {
        for (const name of ['marks_v3_27159_cumberland_gap.tef', 'marks_only_banjo_22933_soldiers_joy.tef']) {
            const [a, b] = load(name).doc.measure_marks;
            expect(a).toEqual({ measure: 1, repeat_start: true, raw: 0x40 });
            expect(b.repeat_end).toBe(true);
            expect(b.ending).toBeUndefined();
        }
    });

    it('records in one measure are OR-ed', () => {
        const v3 = load('marks_v3_25911_golden_slippers.tef');
        expect([v3.tef.mark_records, v3.doc.measure_marks.length]).toEqual([5, 3]);
        const v2 = load('marks_v2_24144_huckleberry_hornpipe.tef');
        expect([v2.tef.mark_records, v2.doc.measure_marks.length]).toEqual([11, 9]);
    });

    it('ending 7 models nothing and keeps raw', () => {
        expect(load('marks_v2_17542_unspecified_ending.tef').doc.measure_marks[0])
            .toEqual({ measure: 1, raw: 0x07 });
    });

    it('a marks-only file has no reading list', () => {
        const { doc } = load('marks_only_banjo_22933_soldiers_joy.tef');
        expect(doc.reading_list).toBeUndefined();
        expect(doc.measure_marks.length).toBe(4);
    });

    it('a file without marks has no measure_marks key', () => {
        expect(load('21802_fingering_annotations.tef').doc.measure_marks).toBeUndefined();
    });
});
