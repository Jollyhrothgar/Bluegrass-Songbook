// Tests for the minimal ZIP writer used by list export.
//
// These parse the archive back out of the bytes rather than trusting the
// writer's own arithmetic — a zip with a plausible-looking but wrong central
// directory offset opens fine in some tools and fails in others, so the
// structure is checked explicitly.
import { describe, it, expect } from 'vitest';

import { createZip, crc32 } from '../zip.js';

const FIXED_DATE = new Date(2026, 7, 15, 12, 34, 56);
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Minimal reader: walk the central directory the way an unzip tool would. */
function readZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // End-of-central-directory is the last 22 bytes (no archive comment here).
    const eocd = bytes.length - 22;
    if (view.getUint32(eocd, true) !== 0x06054B50) throw new Error('no EOCD');

    const count = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);

    const files = [];
    let off = cdOffset;
    for (let i = 0; i < count; i++) {
        if (view.getUint32(off, true) !== 0x02014B50) throw new Error('bad central header');
        const flags = view.getUint16(off + 8, true);
        const method = view.getUint16(off + 10, true);
        const crc = view.getUint32(off + 16, true);
        const compSize = view.getUint32(off + 20, true);
        const uncompSize = view.getUint32(off + 24, true);
        const nameLen = view.getUint16(off + 28, true);
        const localOff = view.getUint32(off + 42, true);
        const name = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));

        // Follow the pointer into the local header and pull the data out.
        if (view.getUint32(localOff, true) !== 0x04034B50) throw new Error('bad local header');
        const localNameLen = view.getUint16(localOff + 26, true);
        const localExtraLen = view.getUint16(localOff + 28, true);
        const dataStart = localOff + 30 + localNameLen + localExtraLen;
        const content = dec.decode(bytes.subarray(dataStart, dataStart + uncompSize));

        files.push({ name, content, crc, method, flags, compSize, uncompSize });
        off += 46 + nameLen;
    }

    return { count, cdSize, cdOffset, cdSizeActual: off - cdOffset, files };
}

describe('crc32', () => {
    it('matches the known checksum for a standard input', () => {
        // "123456789" -> 0xCBF43926 is the canonical CRC-32 check value.
        expect(crc32(enc.encode('123456789'))).toBe(0xCBF43926);
    });

    it('is zero for empty input', () => {
        expect(crc32(new Uint8Array(0))).toBe(0);
    });
});

describe('createZip', () => {
    const FILES = [
        { name: 'How Long Blues.pro', content: '{title: How Long Blues}\n[E]How long\n' },
        { name: 'Sally Goodin.pro', content: '{title: Sally Goodin}\n[A]Had a piece of pie\n' },
    ];

    it('produces an archive whose central directory matches its contents', () => {
        const zip = readZip(createZip(FILES, { date: FIXED_DATE }));
        expect(zip.count).toBe(2);
        // The declared central directory size must match what is actually there.
        expect(zip.cdSize).toBe(zip.cdSizeActual);
    });

    it('round-trips names and content', () => {
        const zip = readZip(createZip(FILES, { date: FIXED_DATE }));
        expect(zip.files.map(f => f.name)).toEqual(FILES.map(f => f.name));
        expect(zip.files.map(f => f.content)).toEqual(FILES.map(f => f.content));
    });

    it('stores a correct CRC for each entry', () => {
        const zip = readZip(createZip(FILES, { date: FIXED_DATE }));
        zip.files.forEach((f, i) => {
            expect(f.crc).toBe(crc32(enc.encode(FILES[i].content)));
        });
    });

    it('marks entries as stored with equal compressed and uncompressed sizes', () => {
        const zip = readZip(createZip(FILES, { date: FIXED_DATE }));
        for (const f of zip.files) {
            expect(f.method).toBe(0);
            expect(f.compSize).toBe(f.uncompSize);
        }
    });

    it('flags names as UTF-8 and round-trips non-ASCII titles', () => {
        const zip = readZip(createZip(
            [{ name: 'Über Blues — Café.pro', content: '{title: Über}\n' }],
            { date: FIXED_DATE }
        ));
        expect(zip.files[0].flags & 0x0800).toBe(0x0800);
        expect(zip.files[0].name).toBe('Über Blues — Café.pro');
        // Byte length differs from character length for multi-byte names.
        expect(zip.files[0].content).toBe('{title: Über}\n');
    });

    it('is byte-stable for the same input and date', () => {
        const a = createZip(FILES, { date: FIXED_DATE });
        const b = createZip(FILES, { date: FIXED_DATE });
        expect(Array.from(a)).toEqual(Array.from(b));
    });

    it('handles an empty archive', () => {
        const zip = readZip(createZip([], { date: FIXED_DATE }));
        expect(zip.count).toBe(0);
        expect(zip.files).toEqual([]);
    });
});
