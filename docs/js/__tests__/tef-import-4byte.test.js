// V2 sub-variant with 4-byte component records (64-unit position grid).
//
// The byte-exactness of the decode is already pinned by the golden gate
// (tef-import-golden.test.js includes 10591_fire_on_the_mountain_v2_4byte.tef).
// This file pins the two behaviours the golden diff cannot express: that the
// stride is chosen STRUCTURALLY, and that a stream decoding to impossible
// measure numbers fails loudly instead of emitting plausible garbage.
//
// Python counterpart: tests/parser/test_tef_v2_4byte_components.py
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHeader, v2ComponentStride, parseV2, TefParseError } from '../tef-import/reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../tef-import/__fixtures__/golden.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const FOUR_BYTE = '10591_fire_on_the_mountain_v2_4byte.tef';
const SIX_BYTE = '21802_fingering_annotations.tef';

function bytesOf(name) {
    const entry = fixture.files[name];
    if (!entry) throw new Error(`missing golden entry: ${name}`);
    return Uint8Array.from(Buffer.from(entry.bytes_b64, 'base64'));
}

describe('V2 4-byte component records', () => {
    it('picks stride 4 because 6-byte records would overrun EOF', () => {
        const data = bytesOf(FOUR_BYTE);
        const h = readHeader(data);
        expect([h.v2_component_offset, h.v2_component_count]).toEqual([258, 638]);
        expect(data.length).toBe(3632);
        expect(h.v2_component_offset + 6 * h.v2_component_count).toBeGreaterThan(data.length);
        expect(v2ComponentStride(data, h)).toBe(4);
    });

    it('leaves the common layout on stride 6', () => {
        const data = bytesOf(SIX_BYTE);
        expect(v2ComponentStride(data, readHeader(data))).toBe(6);
    });

    it('decodes 551 notes across the header\'s 62 measures', () => {
        const data = bytesOf(FOUR_BYTE);
        const tef = parseV2(data, FOUR_BYTE);
        expect(tef.note_events.length).toBe(551);
        const tsSize = tef.header.v2_ts_size;        // canonical 256 grid
        const measures = tef.note_events.map(e => Math.floor(e.position / tsSize) + 1);
        expect(Math.min(...measures)).toBe(1);
        expect(Math.max(...measures)).toBe(62);
        expect(tef.header.v2_measures).toBe(62);
    });

    it('stores 4-byte records verbatim so no effect bytes are invented', () => {
        const tef = parseV2(bytesOf(FOUR_BYTE), FOUR_BYTE);
        expect(new Set(tef.note_events.map(e => e.raw.length))).toEqual(new Set([4]));
    });

    it('reads the reading list at the stride-4 offset', () => {
        const tef = parseV2(bytesOf(FOUR_BYTE), FOUR_BYTE);
        expect(tef.reading_list.map(e => [e.from_measure, e.to_measure])).toEqual([
            [1, 8], [1, 8], [9, 12], [9, 12], [13, 22], [15, 32], [33, 58], [1, 14], [59, 62],
        ]);
    });

    it('throws instead of emitting a 5510-measure document', () => {
        // Corrupt the component count so the structural check no longer sees an
        // EOF overrun: the file is then read at stride 6, which is exactly the
        // misread that used to produce 324 notes across 5510 measures.
        const data = bytesOf(FOUR_BYTE);
        const h = readHeader(data);
        const forcedSix = { ...h, v2_ts_size: h.v2_ts_size, v2_component_count: 550 };
        expect(v2ComponentStride(data, forcedSix)).toBe(6);
        const corrupted = Uint8Array.from(data);
        corrupted[256] = 550 & 0xff;
        corrupted[257] = 550 >> 8;
        expect(() => parseV2(corrupted, FOUR_BYTE)).toThrow(TefParseError);
        expect(() => parseV2(corrupted, FOUR_BYTE)).toThrow(/stride=6/);
    });
});
