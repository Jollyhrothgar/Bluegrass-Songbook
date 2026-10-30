// In-browser TEF binary reader — JavaScript port of the V2 and V3 read paths
// from sources/banjo-hangout/src/tef_parser/reader.py. Faithful, line-for-line
// where it matters; verified byte-exact against the Python parser by the
// golden-diff gate (docs/js/__tests__/tef-import-golden.test.js).

import { countSkipped } from './skipped.js';

// --- Python-builtin shims --------------------------------------------------
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const fdiv = (a, b) => Math.floor(a / b);              // Python //
const latin1 = (bytes) => {                            // latin-1 is a 1:1 map
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
};

export class TefVersionError extends Error {}

// V2/V3 routing and V3 layout, as TablEdit's own loaders read them — see the
// matching constants in reader.py. The format byte at 205 picks the loader
// (>= 10 is V3); the first byte can't, since an untitled V2 file starts with
// 0x00 like a V3 one. V3 notes start at the u32 at 0x3C; the 'debt'/'tbed'
// magic before it is never read by TablEdit. V3 positions are 64ths of a
// whole note.
const V3_FORMAT_BYTE = 205;
const V3_MIN_FORMAT = 10;
const V3_NOTES_PTR = 0x3c;
const V3_HEADER_SIZE = 0x100;
export const V3_UNITS_PER_WHOLE = 64;

/** True when TablEdit would load these bytes with its V3 loader. */
export function isV3Layout(data) {
    return data.length > V3_FORMAT_BYTE && data[V3_FORMAT_BYTE] >= V3_MIN_FORMAT;
}

/** Port of reader.py TEFParseError — a decode that produced structurally
 *  impossible output (e.g. thousands of measures for a 62-measure tune).
 *  Deliberately loud: better a failed import than a plausible-looking
 *  garbage OTF. */
export class TefParseError extends Error {}

// TablEdit's own duration table (960 per whole), indexed by the 5-bit code —
// see _TABLEDIT_DURATIONS in reader.py.
const TABLEDIT_DURATIONS = [
    960, 720, 640, 480, 360, 320, 240, 180, 160, 120, 90, 80, 60, 45, 40, 30,
    22, 20, 15, 840, 48, 15, 420, 34, 15, 210, 26, 15, 105, 24, 240, 1440];

/** Duration codes TablEdit plays as triplets (3 in the time of 2). */
export const TRIPLET_DURATION_CODES = new Set([2, 5, 8, 11, 14, 17]);

/** Written duration in ticks (480/quarter) from a TEF duration code.
 *  Port of decode_duration_code(). */
export function decodeDurationCode(code) {
    return 2 * TABLEDIT_DURATIONS[code & 0x1f];
}

// GM program -> display name (subset seen in the corpus; matches reader.py).
const GM_PROGRAM_NAMES = {
    105: 'Banjo', 106: 'Banjo',
    24: 'Guitar', 25: 'Guitar', 26: 'Guitar', 27: 'Guitar',
    28: 'Guitar', 29: 'Guitar', 30: 'Guitar', 31: 'Guitar',
    32: 'Bass', 33: 'Bass', 34: 'Bass', 35: 'Bass',
    36: 'Bass', 37: 'Bass', 38: 'Bass', 39: 'Bass',
};

export function programToName(program, numStrings) {
    if (GM_PROGRAM_NAMES[program]) return GM_PROGRAM_NAMES[program];
    // reader.py falls back to a strings-count label; for the corpus this is
    // only reached for named tracks (name wins), so the exact label is inert.
    return numStrings === 4 ? 'Tenor Banjo' : `${numStrings}-string`;
}

// --- note event ------------------------------------------------------------
// Mirror of TEFNoteEvent (the fields tef_to_otf consumes). `raw` is the 6-byte
// V2 record. `extra` = 1-indexed local string; `pitchByte` = fret.
export function isMelody(e) {
    return e.extra >= 1 && e.extra <= 15 && e.pitchByte >= 0 && e.pitchByte <= 25;
}

export function decodeStringFret(e) {
    if (!(e.extra >= 1 && e.extra <= 15) || !(e.pitchByte >= 0 && e.pitchByte <= 25)) {
        return null;
    }
    return [e.extra, e.pitchByte];
}

// --- header ----------------------------------------------------------------
export function readHeader(data) {
    if (isV3Layout(data)) {
        const versionMajor = data[3];
        throw new TefVersionError(
            `TEF version ${versionMajor}.x is not supported by the browser parser (V2 only).`);
    }
    return readV2Header(data);
}

function readV2Header(data) {
    const info = data.subarray(0, 200);
    const strings = [];
    let pos = 0;
    for (let i = 0; i < 3; i++) {          // title, composer, comments
        let end = -1;
        for (let j = pos; j < info.length; j++) if (info[j] === 0) { end = j; break; }
        if (end < 0) break;
        strings.push(latin1(info.subarray(pos, end)));
        pos = end + 1;
    }
    const timeNum = data[202];
    const timeDenom = data[204];
    return {
        isV2: true,
        v2_title: strings[0] ?? '',
        v2_composer: strings[1] ?? '',
        v2_comments: strings[2] ?? '',
        v2_measures: u16(data, 200),
        v2_time_num: timeNum,
        v2_time_denom: timeDenom,
        v2_tempo: u16(data, 220),
        v2_repeats_count: data[222],
        v2_strings: data[240],
        v2_tracks: data[241] + 1,
        v2_anacrusis: u16(data, 244) === 1,
        v2_component_count: u16(data, 256),
        v2_component_offset: 258,
        get v2_ts_size() {
            return this.v2_time_denom === 0 ? 256
                : fdiv(256 * this.v2_time_num, this.v2_time_denom);
        },
    };
}

// --- track records ---------------------------------------------------------
const V2_TRACK_RECORD_SIZE = 50;

// u16 @ record+6 === 98 marks a PERCUSSION (drum) track; its "tuning" bytes
// are drum-kit line assignments, so the `96 - b` pitch formula must not run.
// Mirror of TEFReader._PERCUSSION_FLAG — see reader.py for the corpus survey.
const PERCUSSION_FLAG = 98;

function recordToInstruments(data, o) {
    const numStrings = u16(data, o);
    const split = u16(data, o + 4);
    const isPercussion = u16(data, o + 6) === PERCUSSION_FLAG;
    const program = data[o + 8];
    const program2 = data[o + 10];
    const capo = data[o + 12];
    const capo2 = data[o + 14];
    const tuning = Array.from(data.subarray(o + 20, o + 20 + numStrings));
    let nameBytes = data.subarray(o + 32, o + 48);
    const nul = nameBytes.indexOf(0);
    if (nul >= 0) nameBytes = nameBytes.subarray(0, nul);
    const name = latin1(nameBytes).trim();

    // A drum track is never a packed pair of melodic sub-tracks.
    const isPacked = !isPercussion && numStrings >= 9 && split >= 3 && split <= 8
        && (numStrings - split) >= 3 && (numStrings - split) <= 8
        && program2 <= 127;

    const mk = (nm, ns, tun, cp, prog) => ({
        name: nm, tuning_name: '', num_strings: ns,
        tuning_pitches: tun.map(b => 96 - b), capo: cp <= 12 ? cp : 0, midi_program: prog,
        is_percussion: false,
    });

    if (isPercussion) {
        return [{
            name: name || 'Percussion', tuning_name: '', num_strings: numStrings,
            tuning_pitches: [], capo: 0, midi_program: program, is_percussion: true,
        }];
    }

    if (isPacked) {
        const rest = numStrings - split;
        return [
            mk(name || programToName(program, split), split, tuning.slice(0, split), capo, program),
            mk(programToName(program2, rest), rest, tuning.slice(split), capo2, program2),
        ];
    }
    return [mk(name || programToName(program, numStrings), numStrings, tuning, capo, program)];
}

export function parseTrackRecordsV2(data, h) {
    const nTracks = h.v2_tracks, nStrings = h.v2_strings;
    const chain = V2_TRACK_RECORD_SIZE * nTracks;
    if (nStrings <= 0 || nTracks < 1 || data.length < chain + 258) return [];

    for (let start = data.length - chain; start > 257; start--) {
        let cum = 0;
        const offsets = [];
        let ok = true;
        for (let i = 0; i < nTracks; i++) {
            const o = start + i * V2_TRACK_RECORD_SIZE;
            const ns = u16(data, o), fs = u16(data, o + 2);
            if (!(ns >= 1 && ns <= 24) || fs !== cum) { ok = false; break; }
            if (data[o + 8] > 127) { ok = false; break; }
            let tuningOk = true;
            for (let k = 0; k < ns; k++) {
                const b = data[o + 20 + k];
                if (!(b >= 0x06 && b <= 0x5a)) { tuningOk = false; break; }
            }
            if (!tuningOk) { ok = false; break; }
            const nameFirst = data[o + 32];
            if (nameFirst !== 0 && nameFirst < 0x20) { ok = false; break; }
            cum += ns;
            offsets.push(o);
        }
        if (ok && cum === nStrings) {                  // Python for/else success
            const insts = [];
            for (const o of offsets) insts.push(...recordToInstruments(data, o));
            return insts;
        }
    }
    return [];
}

export function parseInstrumentsV2(data, h) {
    // Structural track records are authoritative. The reader's name-pattern
    // fallback (for the oldest sub-variant with zeroed 240/241) is not ported
    // yet; the golden gate flags any corpus file that needs it.
    return parseTrackRecordsV2(data, h);
}

// --- V2 component-record sub-variants --------------------------------------
// The common V2 layout is a 6-byte component record on a 256-units-per-whole-
// note position grid. An OLDER sub-variant packs the same leading fields into
// 4 bytes (bytes 0-1 location, byte 2 type+fret, byte 3 duration+dynamic) with
// NO effect bytes, and uses a 64-units-per-whole-note grid.
//
// Detection is STRUCTURAL, not a magic byte: a 4-byte file's component region
// cannot hold `count` 6-byte records without running past EOF. Port of
// reader.py TEFReader.v2_component_stride — see the long comment there.
const V2_GRID_BY_STRIDE = { 6: 256, 4: 64 };
const V2_CANONICAL_GRID = 256;

/** Size in bytes of one V2 component record in this file (4 or 6). */
export function v2ComponentStride(data, h) {
    const endAt6 = h.v2_component_offset + 6 * h.v2_component_count;
    return endAt6 > data.length ? 4 : 6;
}

// --- note events -----------------------------------------------------------
export function parseNoteEventsV2(data, h, instruments) {
    const events = [];
    const tsChanges = [];
    // Text components (fret byte 0x1d = TablEdit type 0x39): byte 3 indexes
    // the text table after the reading list. Resolved by parseV2.
    const textRefs = [];
    // Reading-guide marks (fret byte 0x5e, G15d4): the flag byte is record
    // byte 4, OR-ed into the measure holding the record. Only the 6-byte
    // layout has a byte 4. Mirrors reader.py (_v2_measure_flags).
    const measureFlags = {};
    let markRecords = 0;
    // Chord-diagram anchors (fret byte 0x1c/0x5c/0x9c = type 0x35): byte 3 is the chord index.
    const chordRefs = [];
    const numStrings = h.v2_strings;

    const stride = v2ComponentStride(data, h);
    const grid = V2_GRID_BY_STRIDE[stride];
    // Native grid -> the canonical 256-per-whole-note grid that event.position
    // is reported in (1 for 6-byte, 4 for 4-byte), so otf.js / the anacrusis
    // shift / articulationMaxGap keep reading h.v2_ts_size unchanged.
    const posScale = fdiv(V2_CANONICAL_GRID, grid);
    const tsSize = grid === V2_CANONICAL_GRID ? h.v2_ts_size
        : (h.v2_time_denom === 0 ? grid : fdiv(grid * h.v2_time_num, h.v2_time_denom));
    // The 6-byte duration code is 5 bits (bit 4 = double dot). The 4-byte
    // layout uses only bits 0-3 — reading bit 4 as a double dot makes 266 of
    // 10591's notes overrun the next note on their own string; masking it off
    // yields zero overruns. See reader.py for the full evidence.
    const durationMask = stride === 6 ? 0x1f : 0x0f;

    if (tsSize === 0 || numStrings === 0) return { events, tsChanges, textRefs, measureFlags, markRecords, chordRefs };

    let trackStringCounts = instruments.map(i => i.num_strings);
    if (trackStringCounts.length === 0) trackStringCounts = [numStrings];

    let mData = 0, mIndex = 0, tsMove = 0;
    let offset = h.v2_component_offset;

    // Loud-failure backstop: a stream read at the wrong stride still decodes
    // into "notes", just at impossible measure numbers (10591 read as 6-byte
    // records reported 324 notes across 5510 measures for a 62-measure tune).
    // Across the whole 6-byte corpus the highest decoded measure is EXACTLY
    // h.v2_measures, so this bound is enormously slack.
    const measureLimit = h.v2_measures > 0 ? 2 * h.v2_measures + 16 : 0;

    for (let n = 0; n < h.v2_component_count; n++) {
        if (offset + stride > data.length) break;
        const rec = data.subarray(offset, offset + stride);

        let location = (rec[0] & 0xff) + 256 * (mData + (rec[1] & 0xff));
        if (fdiv(location, tsSize * numStrings) < mIndex) {
            mData += 256;
            location = (rec[0] & 0xff) + 256 * (mData + (rec[1] & 0xff));
        }

        let positionInMeasure = location % tsSize;
        const cumulativeString = fdiv(location, tsSize) % numStrings;
        const measure = fdiv(location, tsSize * numStrings);

        if (measureLimit && measure >= measureLimit) {
            throw new TefParseError(
                `V2 component stream decoded measure ${measure + 1} but the `
                + `header declares only ${h.v2_measures} measures `
                + `(stride=${stride}, grid=${grid}). Refusing to emit garbage `
                + `— this file is probably an unsupported V2 `
                + `component-record sub-variant.`);
        }

        if (measure !== mIndex) tsMove = 0;
        mIndex = measure;

        const fretByte = rec[2];
        const fretRaw = fretByte & 0x1f;

        if (fretRaw === 27) {                          // type-27 = ts change
            const d3 = rec[3];
            const top = fretByte >> 5;
            const den = top > 0 ? fdiv(Math.pow(2, top), 2) : h.v2_time_denom;
            // byte3 counts 64th notes: 4 units on the 256 grid, 1 on the 64
            // grid. (No type-27 component exists in the one known 4-byte
            // file, so this is a unit conversion by construction.)
            const unitsPer64th = fdiv(4, posScale);
            const gridLen = tsSize - unitsPer64th * d3;
            const num = den > 0 ? fdiv(gridLen * den, grid) : 0;
            tsMove = unitsPer64th * d3;
            if (num > 0 && (d3 > 0 || !(num === h.v2_time_num && den === h.v2_time_denom))) {
                tsChanges.push({ measure: measure + 1, numerator: num, denominator: den });
            }
            offset += stride;
            continue;
        }

        if (tsMove && positionInMeasure >= tsMove) positionInMeasure -= tsMove;

        if (fretByte === 0x5e && stride === 6) {
            measureFlags[measure] = (measureFlags[measure] || 0) | rec[4];
            markRecords += 1;
            offset += stride;
            continue;
        }

        if (fretByte === 0x1d) {
            textRefs.push({ position: (measure * tsSize + positionInMeasure) * posScale,
                            stringRow: cumulativeString, index: rec[3] });
            offset += stride;
            continue;
        }

        if (fretByte === 0x1c || fretByte === 0x5c || fretByte === 0x9c) {
            chordRefs.push({ position: (measure * tsSize + positionInMeasure) * posScale,
                             stringRow: cumulativeString, index: rec[3], dx: 0, dy: 0 });
            offset += stride;
            continue;
        }

        // Fret field 0x1a is fret 25 unless the byte is a bare 0x1a (a special; 11056 m9).
        if ((fretRaw >= 0x01 && fretRaw <= 0x19) || (fretRaw === 0x1a && fretByte !== 0x1a)) {
            const fret = fretRaw - 1;
            const durationByte = rec[3];
            const markerChar = (durationByte >= 0x40 && durationByte <= 0x5a)
                ? String.fromCharCode(durationByte) : 'F';

            let trackIdx = 0, localString = cumulativeString;
            for (let idx = 0; idx < trackStringCounts.length; idx++) {
                if (localString < trackStringCounts[idx]) { trackIdx = idx; break; }
                localString -= trackStringCounts[idx];
            }

            events.push({
                // posScale lifts the 4-byte variant's 64-unit grid into the
                // canonical 256-unit grid; nothing downstream has to know.
                position: (measure * tsSize + positionInMeasure) * posScale,
                track: trackIdx,
                marker: markerChar,
                extra: localString + 1,
                pitchByte: fret,
                // The record AS STORED (6 or 4 bytes). The length is
                // load-bearing: every effect/articulation consumer in otf.js
                // gates on raw.length, so a 4-byte record correctly yields no
                // effect1/effect2 instead of reading into the next record.
                raw: Uint8Array.from(rec),
                durationTicks: decodeDurationCode(rec[3] & durationMask),
            });
        }
        offset += stride;
    }
    return { events, tsChanges, textRefs, measureFlags, markRecords, chordRefs };
}

// V2 free-text table: u16 count at header 228, entries right after the
// reading list (u16 length + NUL-terminated latin-1 bytes). See reader.py.
export function parseTextTableV2(data, h) {
    const count = data.length >= 230 ? u16(data, 228) : 0;
    let off = h.v2_component_offset + h.v2_component_count * v2ComponentStride(data, h)
        + 2 * h.v2_repeats_count;
    const table = [];
    for (let i = 0; i < count; i++) {
        if (off + 2 > data.length) break;
        const len = u16(data, off);
        if (off + 2 + len > data.length) break;
        let s = '';
        for (let j = off + 2; j < off + 2 + len && data[j] !== 0; j++) {
            s += String.fromCharCode(data[j]);      // latin1 parity with Python
        }
        table.push(s.trim());
        off += 2 + len;
    }
    return table;
}

// --- chord-diagram table (G15d3) -------------------------------------------
const CHORD_STRING_BYTES = 14;
const CHORD_NAME_AT = 14;      // 17 bytes, NUL-terminated, then leftover memory

/** One record -> {name, strings, first_fret, string_count}; null when the name
 *  is not plain ASCII (the table was read at the wrong place). */
function chordRecord(rec, withStringCount) {
    let end = -1;
    for (let i = CHORD_NAME_AT; i < 31; i++) if (rec[i] === 0) { end = i; break; }
    if (end < 0) return null;
    let name = '';
    for (let i = CHORD_NAME_AT; i < end; i++) {
        if (rec[i] < 0x20 || rec[i] >= 0x7f) return null;
        name += String.fromCharCode(rec[i]);
    }
    return {
        name,
        strings: Uint8Array.from(rec.subarray(0, CHORD_STRING_BYTES)),
        first_fret: rec[31] > 127 ? rec[31] - 256 : rec[31],
        string_count: withStringCount ? rec[32] : 0,
    };
}

/** V3: header pointer 88 -> [u16 entry size 36][u16 count] + records. null = absent/unreadable. */
export function parseChordTableV3(data) {
    if (data.length < 92) return null;
    const ptr = u32(data, 88);
    if (ptr < V3_HEADER_SIZE || ptr + 4 > data.length) return null;
    const size = u16(data, ptr), count = u16(data, ptr + 2);
    if (size !== 36 || ptr + 4 + size * count > data.length) return null;
    const table = [];
    for (let i = 0; i < count; i++) {
        const o = ptr + 4 + i * size;
        const rec = chordRecord(data.subarray(o, o + size), true);
        if (!rec) return null;
        table.push(rec);
    }
    return table;
}

/** V2: u16 count at file offset 236; 32-byte records after the free-text table. */
export function parseChordTableV2(data, h) {
    if (data.length < 238) return null;
    const count = u16(data, 236);
    if (count === 0) return null;
    let off = h.v2_component_offset + h.v2_component_count * v2ComponentStride(data, h)
        + 2 * h.v2_repeats_count;
    for (let i = 0, n = u16(data, 228); i < n; i++) {
        if (off + 2 > data.length) return null;
        off += 2 + u16(data, off);
    }
    if (off + 32 * count > data.length) return null;
    const table = [];
    for (let i = 0; i < count; i++) {
        const rec = chordRecord(data.subarray(off + 32 * i, off + 32 * i + 32), false);
        if (!rec) return null;
        table.push(rec);
    }
    return table;
}

/** Keep the anchors that point into the table; count the rest. */
function resolveChordAnchors(table, refs) {
    if (!table) return { anchors: [], dropped: refs.length };
    const anchors = refs.filter(a => a.index < table.length);
    return { anchors, dropped: refs.length - anchors.length };
}

// --- reading list ----------------------------------------------------------
export function parseReadingListV2(data, h) {
    const entries = [];
    const count = h.v2_repeats_count;
    if (count === 0) return entries;
    // Sits immediately after the components, so the offset depends on the
    // component-record stride (4 or 6) too.
    const base = h.v2_component_offset
        + h.v2_component_count * v2ComponentStride(data, h);
    for (let i = 0; i < count; i++) {
        const o = base + i * 2;
        if (o + 1 >= data.length) break;
        entries.push({ from_measure: data[o], to_measure: data[o + 1] });
    }
    return entries;
}

// --- orchestration ---------------------------------------------------------
export function parseV2(data, name) {
    const header = readV2Header(data);
    const instruments = parseInstrumentsV2(data, header);
    let { events: noteEvents, tsChanges, textRefs, measureFlags, markRecords, chordRefs } = parseNoteEventsV2(data, header, instruments);
    let timeSignatureChanges = tsChanges;
    const textTable = parseTextTableV2(data, header);
    const textEvents = textRefs
        .filter(r => r.index < textTable.length && textTable[r.index])
        .map(r => ({ position: r.position, string_row: r.stringRow, text: textTable[r.index] }));

    // effect2 == 0x07 chord-overlay filter — but keep notes whose fret byte
    // has bit 7 set: there effect2 is a note attribute and 0x07 is staccato
    // (TablEdit's V2 upgrade; fix-it A15; 11514/11245 bass modules).
    noteEvents = noteEvents.filter(e =>
        !(e.raw.length > 5 && e.raw[5] === 0x07 && !(e.raw[2] & 0x80)));

    // Anacrusis: shift measure-1 notes left, record the shortened signature.
    if (header.v2_anacrusis && !timeSignatureChanges.some(c => c.measure === 1)) {
        const tsSize = header.v2_ts_size;
        const m0 = noteEvents.filter(e => e.position < tsSize);
        const shift = m0.length ? Math.min(...m0.map(e => e.position)) : 0;
        if (shift > 0) {
            for (const e of m0) e.position -= shift;
            for (const te of textEvents) {
                if (te.position < tsSize) te.position = Math.max(0, te.position - shift);
            }
            for (const ca of chordRefs) {
                if (ca.position < tsSize) ca.position = Math.max(0, ca.position - shift);
            }
            let den = header.v2_time_denom || 4;
            const grid = tsSize - shift;
            let num = fdiv(grid * den, 256);
            while (num * 256 !== grid * den && den < 64) {
                den *= 2;
                num = fdiv(grid * den, 256);
            }
            if (num > 0 && num * 256 === grid * den) {
                timeSignatureChanges = [{ measure: 1, numerator: num, denominator: den },
                    ...timeSignatureChanges];
            }
        }
    }

    const readingList = parseReadingListV2(data, header);
    const chordTable = parseChordTableV2(data, header);
    const { anchors: chordAnchors, dropped: chordDropped } = resolveChordAnchors(chordTable, chordRefs);

    return {
        path_stem: name,
        header,
        title: header.v2_title,
        tab_by: tabByFromComments(header.v2_comments),
        instruments,
        note_events: noteEvents,
        text_events: textEvents,
        reading_list: readingList,
        measure_flags: measureFlags,
        mark_records: markRecords,
        time_signature_changes: timeSignatureChanges,
        chord_table: chordTable,
        chord_anchors: chordAnchors,
        chord_anchors_dropped: chordDropped,
        v3_global_ts: null,
        skipped: countSkipped(data, header, v2ComponentStride(data, header)),
    };
}

// ===========================================================================
// V3 path (binary container, 12-byte note records) — port of the reader.py V3
// methods. The name-pattern instrument fallback is not ported; a V3 file whose
// note pointer is unusable throws TefVersionError (Python parses it empty).
// ===========================================================================

function bisectRight(arr, x) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (x < arr[mid]) hi = mid; else lo = mid + 1;
    }
    return lo;
}

function magicAt0x38(data) {
    const m = latin1(data.subarray(0x38, 0x3c));
    return m === 'debt' || m === 'tbed';
}

export function readV3Header(data) {
    const v3Tempo = u16(data, 6);
    return {
        isV2: false,
        v3_tempo: (v3Tempo >= 30 && v3Tempo <= 500) ? v3Tempo : 0,
        // tick math uses these header defaults (4/4) for V3, exactly as reader.py
        // constructs the V3 TEFHeader; the real meter comes from v3_global_ts.
        v2_time_num: 4,
        v2_time_denom: 4,
    };
}

export function findStrings(data) {
    const strings = [];
    let i = 0;
    while (i < data.length - 2) {
        const length = u16(data, i);
        if (length >= 3 && length <= 100 && i + 2 + length <= data.length) {
            let end = i + 2 + length;
            if (data[end - 1] === 0) end -= 1;                 // strip trailing null
            const candidate = data.subarray(i + 2, end);
            let printable = candidate.length > 0;
            for (let k = 0; k < candidate.length; k++) {
                const b = candidate[k];
                if (!((b >= 32 && b < 127) || b === 0)) { printable = false; break; }
            }
            if (printable) {
                const value = latin1(candidate).replace(/\x00+$/, '');
                if (value && /[A-Za-z]/.test(value)) {
                    strings.push({ offset: i, value, length });
                    i += 2 + length;
                    continue;
                }
            }
        }
        i += 1;
    }
    return strings;
}

/** A u16-length-prefixed string at the header pointer `slot` (latin-1, up to
 *  the first NUL), or null when the pointer or length is unusable. */
export function headerString(data, slot) {
    if (data.length < slot + 4) return null;
    const p = u32(data, slot);
    if (p < V3_HEADER_SIZE || p + 2 > data.length) return null;
    const len = u16(data, p);
    if (p + 2 + len > data.length) return null;
    let s = '';
    for (let j = p + 2; j < p + 2 + len && data[j] !== 0; j++) s += String.fromCharCode(data[j]);
    return s;
}

/** The V3 title as TablEdit stores it (header pointer 64), or null when it
 *  holds control characters (a multi-line title): the caller then falls back
 *  to the first-printable-string heuristic. */
export function titleFromHeader(data) {
    const s = headerString(data, 0x40);
    if (s === null || /[\x00-\x1f\x7f]/.test(s)) return null;
    return s.trim();
}

const TAB_BY_LINE = /^Tab by: (.+?)(?: <(https?:\/\/[^\s<>]+)>)?$/;

/** The "Tab by: NAME <URL>" credit line that the .tef writer puts in the
 *  comments (G15f), as metadata.tab_by, or null. The last such line wins. */
export function tabByFromComments(text) {
    let found = null;
    for (const line of String(text || '').split(/\r?\n/)) {
        const m = TAB_BY_LINE.exec(line.trim());
        if (!m) continue;
        const name = m[1].trim();
        if (!name || name.length > 100 || (m[2] && m[2].length > 500)) continue;
        found = m[2] ? { name, url: m[2] } : { name };
    }
    return found;
}

export function parseMeasureTableV3(data) {
    if (data.length < 0x64 || !magicAt0x38(data)) return [];
    const ptr = u32(data, 0x5c);
    if (!(ptr > 0 && ptr < data.length - 4)) return [];
    // [u16 tag][u16 count][u32 pad], then count 8-byte records; record j is
    // measure j+1 with byte 4 = denominator, byte 5 = numerator.
    const count = u16(data, ptr + 2);
    const first = ptr + 8;
    if (!(count >= 1 && count <= 2048) || first + count * 8 > data.length) return [];
    const out = [];
    for (let j = 0; j < count; j++) {
        const o = first + j * 8;
        const den = data[o + 4], num = data[o + 5];
        if (![0, 1, 2, 4, 8, 16].includes(den) || num > 32) return [];
        out.push([num, den]);
    }
    return out;
}

export function parseTrackRecordsV3(data) {
    if (data.length < 0x64 || !magicAt0x38(data)) return [];
    const ptr = u32(data, 0x60);
    if (!(ptr > 0 && ptr < data.length - 4)) return [];
    const recSize = u16(data, ptr), count = u16(data, ptr + 2);
    if (recSize !== 68 || !(count >= 1 && count <= 15)) return [];
    if (ptr + 4 + recSize * count > data.length) return [];

    const instruments = [];
    let cum = 0;
    for (let i = 0; i < count; i++) {
        const o = ptr + 4 + i * recSize;
        const ns = u16(data, o), fs = u16(data, o + 2);
        const program = u16(data, o + 8);
        const capo = u16(data, o + 12);
        if (!(ns >= 1 && ns <= 12) || fs !== cum || program > 127) return [];
        const tuning = Array.from(data.subarray(o + 20, o + 20 + ns));
        if (!tuning.every(b => b >= 0x06 && b <= 0x5a)) return [];
        let nameBytes = data.subarray(o + 32, o + 68);
        const nul = nameBytes.indexOf(0);
        if (nul >= 0) nameBytes = nameBytes.subarray(0, nul);
        const name = latin1(nameBytes).trim();
        cum += ns;
        // V3 drum track: bit 7 of byte +4 (see reader.py).
        const isPercussion = (data[o + 4] & 0x80) !== 0;
        instruments.push({
            name: isPercussion ? (name || 'Percussion') : (name || programToName(program, ns)),
            tuning_name: '', num_strings: ns,
            tuning_pitches: isPercussion ? [] : tuning.map(b => 96 - b),
            capo: isPercussion ? 0 : (capo <= 12 ? capo : 0), midi_program: program,
            is_percussion: isPercussion,
        });
    }
    return instruments;
}

function findComponentOffset(data) {
    if (data.length < V3_NOTES_PTR + 4) return -1;
    const ptr = u32(data, V3_NOTES_PTR);
    if (ptr < V3_HEADER_SIZE || ptr >= data.length) return -1;
    return ptr;
}

function findReadingListOffset(data) {
    if (data.length < 132) return -1;
    const p = u32(data, 128);
    if (p === 0 || p >= data.length) return -1;
    return p;
}

export function parseReadingListV3(data) {
    const entries = [];
    const off = findReadingListOffset(data);
    if (off < 0 || off + 4 > data.length) return entries;
    const entrySize = u16(data, off), entryCount = u16(data, off + 2);
    if (entrySize < 4 || entrySize > 256 || entryCount > 100) return entries;
    const start = off + 4;
    for (let i = 0; i < entryCount; i++) {
        const eo = start + i * entrySize;
        if (eo + 4 > data.length) break;
        const from = u16(data, eo), to = u16(data, eo + 2);
        if (from === 0 && to === 0) continue;
        // Bytes 4+ carry the entry's label ("Intro", "Part A1", ...) —
        // TablEdit prints it above the range's first measure.
        let name = '';
        for (let j = eo + 4; j < eo + entrySize && data[j] !== 0; j++) {
            name += String.fromCharCode(data[j]);   // latin1 parity with Python
        }
        entries.push({ from_measure: from, to_measure: to, name });
    }
    return entries;
}

/**
 * V3 free-text table: header offset 84 holds a pointer to
 * [u16 count] + count x [u16 len][len bytes incl. trailing NUL].
 * Note components of type 0x39 reference entries by 0-based index.
 */
export function parseTextTableV3(data) {
    if (data.length < 88) return [];
    const ptr = u32(data, 84);
    if (!(ptr > 0 && ptr < data.length - 2)) return [];
    const count = u16(data, ptr);
    if (count > 1000) return [];
    const table = [];
    let off = ptr + 2;
    for (let i = 0; i < count; i++) {
        if (off + 2 > data.length) break;
        const len = u16(data, off);
        if (len > 1000 || off + 2 + len > data.length) break;
        let s = '';
        for (let j = off + 2; j < off + 2 + len && data[j] !== 0; j++) {
            s += String.fromCharCode(data[j]);      // latin1 parity with Python
        }
        table.push(s);
        off += 2 + len;
    }
    return table;
}

// Special (non-note) components: low 6 bits of the type byte >= 0x33.
const V3_FIRST_SPECIAL_TYPE = 0x33;

export function parseNoteEventsV3(data, instruments) {
    const events = [];
    const textRefs = [];   // 0x39 components: {position, stringRow, index}
    // Reading-guide marks (type 0xb7, G15d4): {position, flags}; only cell
    // byte 2 (file byte 6) is read. Resolved to measures by parseV3.
    const markRefs = [];
    // 0x35 chord-diagram anchors (full type byte; 0x75 is a scale diagram, 0xf5 a
    // special character): cell bytes 1-2 chord index, 3 signed dy, 4 signed dx.
    const chordRefs = [];
    const startOffset = findComponentOffset(data);
    let globalTs = null;
    const tsChanges = [];
    if (startOffset < 0) return { events, textRefs, markRefs, chordRefs, tsChanges, globalTs, slotStarts: [], slotCounts: [] };

    let totalStrings = instruments.reduce((s, i) => s + i.num_strings, 0);
    if (totalStrings === 0) totalStrings = 5;
    // Location = 8 * (pos * totalStrings + string), pos in 64ths.
    const VALUE_PER_STRING = 8;
    const VALUE_PER_POSITION = VALUE_PER_STRING * totalStrings;
    const UNITS = V3_UNITS_PER_WHOLE;
    let trackStringCounts = instruments.map(i => i.num_strings);
    if (trackStringCounts.length === 0) trackStringCounts = [5];

    const measureTs = parseMeasureTableV3(data);
    const explicit = (measureTs || []).filter(([n, d]) => n && d);
    if (explicit.length) {
        const counts = new Map();
        for (const [n, d] of explicit) {
            const key = n + '/' + d;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        let best = null, bestN = -1;
        for (const [key, c] of counts) if (c > bestN) { bestN = c; best = key; }
        const [n, d] = best.split('/').map(Number);
        globalTs = [n, d];
    }
    if (measureTs && globalTs) {
        for (let k = 0; k < measureTs.length; k++) {
            const [num, den] = measureTs[k];
            if (num && den && !(num === globalTs[0] && den === globalTs[1])) {
                tsChanges.push({ measure: k + 1, numerator: num, denominator: den });
            }
        }
    }

    const slotStarts = [], slotCounts = [];
    if (measureTs && measureTs.some(([num, den]) => num && den && fdiv(UNITS * num, den) !== UNITS)) {
        let start = 0;
        for (const [num, den] of measureTs) {
            const slots = (num && den) ? fdiv(UNITS * num, den) : UNITS;
            slotStarts.push(start);
            slotCounts.push(slots);
            start += slots;
        }
    }
    // Positions stay continuous; v3Locate() maps them to measures (reader.py parity).

    let offset = startOffset;
    let consecutiveInvalid = 0;
    const maxInvalid = 20;
    while (offset + 12 <= data.length) {
        const record = data.subarray(offset, offset + 12);
        const location = u32(record, 0);
        const componentType = record[4];
        if ((componentType & 0x3f) >= V3_FIRST_SPECIAL_TYPE) {
            if (componentType === 0xb7) {
                markRefs.push({ position: fdiv(location, VALUE_PER_POSITION), flags: record[6] });
            }
            if (componentType === 0x39) {
                textRefs.push({
                    position: fdiv(location, VALUE_PER_POSITION),
                    stringRow: fdiv(location % VALUE_PER_POSITION, VALUE_PER_STRING),
                    index: record[5],
                });
            } else if (componentType === 0x35) {
                chordRefs.push({
                    position: fdiv(location, VALUE_PER_POSITION),
                    stringRow: fdiv(location % VALUE_PER_POSITION, VALUE_PER_STRING),
                    index: record[5] | (record[6] << 8),
                    dy: (record[7] << 24) >> 24,
                    dx: (record[8] << 24) >> 24,
                });
            }
            offset += 12;
            continue;
        }
        const lowerBits = componentType & 0x1f;
        if (lowerBits < 0x01 || lowerBits > 0x19) {
            offset += 12;
            consecutiveInvalid += 1;
            if (consecutiveInvalid >= maxInvalid) break;
            continue;
        }
        consecutiveInvalid = 0;
        const fret = lowerBits - 1;
        const cumulativeString = fdiv(location % VALUE_PER_POSITION, VALUE_PER_STRING);
        let trackIdx = 0, localString = cumulativeString;
        for (let idx = 0; idx < trackStringCounts.length; idx++) {
            if (localString < trackStringCounts[idx]) { trackIdx = idx; break; }
            localString -= trackStringCounts[idx];
        }
        const position = fdiv(location, VALUE_PER_POSITION);
        const mb = record[5];
        let marker;
        if (mb === 0x49) marker = 'I';
        else if (mb === 0x46) marker = 'F';
        else if (mb === 0x4c) marker = 'L';
        else if (mb === 0x43) marker = 'C';
        else if (mb === 0x40) marker = '@';
        else if (mb === 0x41) marker = 'A';
        else marker = (mb >= 32 && mb <= 126) ? String.fromCharCode(mb) : 'F';

        events.push({
            position, track: trackIdx, marker,
            extra: localString + 1, pitchByte: fret,
            raw: Uint8Array.from(record),          // 12 bytes
            durationTicks: decodeDurationCode(record[5] & 0x1f),
        });
        offset += 12;
    }
    return { events, textRefs, markRefs, chordRefs, tsChanges, globalTs, slotStarts, slotCounts };
}

/** Continuous V3 position -> [0-based measure, 64ths into it] (TEFFile.v3_locate). */
export function v3Locate(tef, position) {
    const starts = tef.v3_measure_starts || [], lengths = tef.v3_measure_lengths || [];
    if (starts.length === 0) return [fdiv(position, V3_UNITS_PER_WHOLE), position % V3_UNITS_PER_WHOLE];
    const idx = bisectRight(starts, position) - 1;
    const rel = position - starts[idx];
    if (rel >= lengths[idx] && idx === starts.length - 1) {
        const extra = rel - lengths[idx];   // beyond the table: whole-note measures
        return [idx + 1 + fdiv(extra, V3_UNITS_PER_WHOLE), extra % V3_UNITS_PER_WHOLE];
    }
    return [idx, rel];
}

export function parseV3(data, name) {
    if (findComponentOffset(data) < 0) {
        // Note pointer outside the file — nothing to read. Message stays
        // internal; callers surface a format-agnostic error.
        throw new TefVersionError('Unreadable TablEdit file (no note records).');
    }
    const header = readV3Header(data);
    const strings = findStrings(data);
    // Title: header pointer 64, which is where TablEdit keeps it. A title with
    // control characters (a multi-line one) and files with no usable pointer
    // fall back to the FIRST substantial string below 0x200, not the longest —
    // see reader.py. Skips verbose credits and decorative "____INTRO____" separators.
    let title = titleFromHeader(data);
    if (title === null) {
        title = '';
        for (const s of strings) {
            if (s.offset >= 0x200) continue;
            const v = s.value.trim();
            if (v.length < 3 || v.includes('Part') || v[0] === '(' || v[0] === '-') continue;
            const nonspace = [...v].filter(c => !/\s/.test(c)).length;
            const alnum = [...v].filter(c => /[a-zA-Z0-9]/.test(c)).length;
            if (nonspace && alnum / nonspace < 0.5) continue;   // skip decorative separators
            title = v;
            break;
        }
    }
    const instruments = parseTrackRecordsV3(data);   // name-pattern fallback not ported
    const { events, textRefs, markRefs, chordRefs, tsChanges, globalTs, slotStarts, slotCounts } = parseNoteEventsV3(data, instruments);
    const chordTable = parseChordTableV3(data);
    const { anchors: chordAnchors, dropped: chordDropped } = resolveChordAnchors(chordTable, chordRefs);
    const readingList = parseReadingListV3(data);

    // Resolve 0x39 text components against the text table; unresolvable
    // indexes and empty strings are dropped (reader.py parity).
    const textTable = parseTextTableV3(data);
    const textEvents = [];
    for (const ref of textRefs) {
        if (ref.index >= 0 && ref.index < textTable.length && textTable[ref.index]) {
            textEvents.push({
                position: ref.position,
                string_row: ref.stringRow,
                text: textTable[ref.index],
            });
        }
    }

    const tef = {
        path_stem: name,
        header,
        title,
        tab_by: tabByFromComments(headerString(data, 0x48)),
        composer: headerString(data, 0x44) || '',
        instruments,
        note_events: events,
        text_events: textEvents,
        reading_list: readingList,
        measure_flags: {},
        mark_records: 0,
        time_signature_changes: tsChanges,
        chord_table: chordTable,
        chord_anchors: chordAnchors,
        chord_anchors_dropped: chordDropped,
        v3_global_ts: globalTs,
        v3_measure_starts: slotStarts,
        v3_measure_lengths: slotCounts,
        skipped: countSkipped(data, header),
    };
    // Reading-guide marks (0xb7): OR each into the measure holding it.
    for (const ref of markRefs) {
        const [index] = v3Locate(tef, ref.position);
        tef.measure_flags[index] = (tef.measure_flags[index] || 0) | ref.flags;
        tef.mark_records += 1;
    }
    return tef;
}

export function parseTefBytes(data, name) {
    return isV3Layout(data) ? parseV3(data, name) : parseV2(data, name);
}
