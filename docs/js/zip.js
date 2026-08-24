// Minimal ZIP writer (stored, no compression).
//
// Exists because some ChordPro readers import a folder of one-song-per-file
// rather than a multi-song file, and there is no bundler here to pull in a zip
// library. Stored entries keep this small and dependency-free; ChordPro files
// are a few KB each, so compression would buy little.
//
// Implements the subset of APPNOTE.TXT needed for a flat archive of small
// files: local headers, a central directory, and an end-of-central-directory
// record. No Zip64, no directory entries, no encryption.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

/** MS-DOS packed date/time, which is what the ZIP header format stores. */
function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    return {
        time: ((d.getHours() & 0x1F) << 11)
            | ((d.getMinutes() & 0x3F) << 5)
            | ((d.getSeconds() >> 1) & 0x1F),
        date: (((year - 1980) & 0x7F) << 9)
            | (((d.getMonth() + 1) & 0x0F) << 5)
            | (d.getDate() & 0x1F),
    };
}

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, content: string|Uint8Array}>} files
 * @param {{date?: Date}} opts  Fixed date makes output byte-stable for tests.
 * @returns {Uint8Array}
 */
export function createZip(files, { date = new Date() } = {}) {
    const encoder = new TextEncoder();
    const { time: dosTime, date: dosDate } = dosDateTime(date);

    const entries = files.map(f => {
        const nameBytes = encoder.encode(f.name);
        const dataBytes = typeof f.content === 'string'
            ? encoder.encode(f.content)
            : f.content;
        return { nameBytes, dataBytes, crc: crc32(dataBytes), offset: 0 };
    });

    let size = 22; // end-of-central-directory record
    for (const e of entries) {
        size += 30 + e.nameBytes.length + e.dataBytes.length; // local header
        size += 46 + e.nameBytes.length;                      // central header
    }

    const buf = new Uint8Array(size);
    const view = new DataView(buf.buffer);
    let off = 0;

    // Bit 11 declares the name is UTF-8, so non-ASCII song titles survive.
    const FLAG_UTF8 = 0x0800;
    const METHOD_STORED = 0;
    const VERSION = 20;

    for (const e of entries) {
        e.offset = off;
        view.setUint32(off, 0x04034B50, true); off += 4;  // local file header
        view.setUint16(off, VERSION, true); off += 2;
        view.setUint16(off, FLAG_UTF8, true); off += 2;
        view.setUint16(off, METHOD_STORED, true); off += 2;
        view.setUint16(off, dosTime, true); off += 2;
        view.setUint16(off, dosDate, true); off += 2;
        view.setUint32(off, e.crc, true); off += 4;
        view.setUint32(off, e.dataBytes.length, true); off += 4;  // compressed
        view.setUint32(off, e.dataBytes.length, true); off += 4;  // uncompressed
        view.setUint16(off, e.nameBytes.length, true); off += 2;
        view.setUint16(off, 0, true); off += 2;           // extra field length
        buf.set(e.nameBytes, off); off += e.nameBytes.length;
        buf.set(e.dataBytes, off); off += e.dataBytes.length;
    }

    const centralStart = off;
    for (const e of entries) {
        view.setUint32(off, 0x02014B50, true); off += 4;  // central directory
        view.setUint16(off, VERSION, true); off += 2;     // version made by
        view.setUint16(off, VERSION, true); off += 2;     // version needed
        view.setUint16(off, FLAG_UTF8, true); off += 2;
        view.setUint16(off, METHOD_STORED, true); off += 2;
        view.setUint16(off, dosTime, true); off += 2;
        view.setUint16(off, dosDate, true); off += 2;
        view.setUint32(off, e.crc, true); off += 4;
        view.setUint32(off, e.dataBytes.length, true); off += 4;
        view.setUint32(off, e.dataBytes.length, true); off += 4;
        view.setUint16(off, e.nameBytes.length, true); off += 2;
        view.setUint16(off, 0, true); off += 2;           // extra
        view.setUint16(off, 0, true); off += 2;           // comment
        view.setUint16(off, 0, true); off += 2;           // disk number start
        view.setUint16(off, 0, true); off += 2;           // internal attrs
        view.setUint32(off, 0, true); off += 4;           // external attrs
        view.setUint32(off, e.offset, true); off += 4;    // local header offset
        buf.set(e.nameBytes, off); off += e.nameBytes.length;
    }
    const centralEnd = off;

    view.setUint32(off, 0x06054B50, true); off += 4;      // end of central dir
    view.setUint16(off, 0, true); off += 2;               // this disk
    view.setUint16(off, 0, true); off += 2;               // disk with central
    view.setUint16(off, entries.length, true); off += 2;  // entries this disk
    view.setUint16(off, entries.length, true); off += 2;  // entries total
    view.setUint32(off, centralEnd - centralStart, true); off += 4;
    view.setUint32(off, centralStart, true); off += 4;
    view.setUint16(off, 0, true); off += 2;               // comment length

    return buf;
}
