// In-browser TEF binary reader — JavaScript port of the V2 read path from
// sources/banjo-hangout/src/tef_parser/reader.py. Faithful, line-for-line where
// it matters; verified byte-exact against the Python parser by the golden-diff
// gate (docs/js/__tests__/tef-import-golden.test.js).
//
// V3 is not yet ported (2 of 42 corpus files; see tef-import/README or the
// project plan). parse() throws TefVersionError for non-V2 input.

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

/** Written duration in ticks (480/quarter) from a TEF duration code.
 *  Port of decode_duration_code(). Oracle-validated corpus-wide. */
export function decodeDurationCode(code) {
    const doubleDot = code & 0x10;
    code &= 0x0f;
    let base = 1920 >> fdiv(code, 3);
    const mod = code % 3;
    if (mod === 1) base = fdiv(base * 3, 4);
    else if (mod === 2) base = fdiv(base * 2, 3);
    if (doubleDot) base = fdiv(base * 7, 4);
    return base;
}

// GM program -> display name (subset seen in the corpus; matches reader.py).
const GM_PROGRAM_NAMES = {
    105: 'Banjo', 106: 'Banjo',
    24: 'Guitar', 25: 'Guitar', 26: 'Guitar', 27: 'Guitar',
    28: 'Guitar', 29: 'Guitar', 30: 'Guitar', 31: 'Guitar',
    32: 'Bass', 33: 'Bass', 34: 'Bass', 35: 'Bass',
    36: 'Bass', 37: 'Bass', 38: 'Bass', 39: 'Bass',
};

function programToName(program, numStrings) {
    if (GM_PROGRAM_NAMES[program]) return GM_PROGRAM_NAMES[program];
    // reader.py falls back to a strings-count label; for the corpus this is
    // only reached for named tracks (name wins), so the exact label is inert.
    return numStrings === 4 ? 'Tenor Banjo' : `${numStrings}-string`;
}

// --- note event ------------------------------------------------------------
// Mirror of TEFNoteEvent (the fields tef_to_otf consumes). `raw` is the 6-byte
// V2 record. `extra` = 1-indexed local string; `pitchByte` = fret.
export function isMelody(e) {
    return e.extra >= 1 && e.extra <= 15 && e.pitchByte >= 0 && e.pitchByte <= 24;
}

export function decodeStringFret(e) {
    if (!(e.extra >= 1 && e.extra <= 15) || !(e.pitchByte >= 0 && e.pitchByte <= 24)) {
        return null;
    }
    return [e.extra, e.pitchByte];
}

// --- header ----------------------------------------------------------------
export function readHeader(data) {
    // v2 files start with printable ASCII text; v3 with the 0x10 0x00 format id.
    if (!(data[0] >= 0x20 && data[0] < 0x7f)) {
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

function recordToInstruments(data, o) {
    const numStrings = u16(data, o);
    const split = u16(data, o + 4);
    const program = data[o + 8];
    const program2 = data[o + 10];
    const capo = data[o + 12];
    const capo2 = data[o + 14];
    const tuning = Array.from(data.subarray(o + 20, o + 20 + numStrings));
    let nameBytes = data.subarray(o + 32, o + 48);
    const nul = nameBytes.indexOf(0);
    if (nul >= 0) nameBytes = nameBytes.subarray(0, nul);
    const name = latin1(nameBytes).trim();

    const isPacked = numStrings >= 9 && split >= 3 && split <= 8
        && (numStrings - split) >= 3 && (numStrings - split) <= 8
        && program2 <= 127;

    const mk = (nm, ns, tun, cp, prog) => ({
        name: nm, tuning_name: '', num_strings: ns,
        tuning_pitches: tun.map(b => 96 - b), capo: cp <= 12 ? cp : 0, midi_program: prog,
    });

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

// --- note events -----------------------------------------------------------
export function parseNoteEventsV2(data, h, instruments) {
    const events = [];
    const tsChanges = [];
    const tsSize = h.v2_ts_size, numStrings = h.v2_strings;
    if (tsSize === 0 || numStrings === 0) return { events, tsChanges };

    let trackStringCounts = instruments.map(i => i.num_strings);
    if (trackStringCounts.length === 0) trackStringCounts = [numStrings];

    let mData = 0, mIndex = 0, tsMove = 0;
    let offset = h.v2_component_offset;

    for (let n = 0; n < h.v2_component_count; n++) {
        if (offset + 6 > data.length) break;
        const rec = data.subarray(offset, offset + 6);

        let location = (rec[0] & 0xff) + 256 * (mData + (rec[1] & 0xff));
        if (fdiv(location, tsSize * numStrings) < mIndex) {
            mData += 256;
            location = (rec[0] & 0xff) + 256 * (mData + (rec[1] & 0xff));
        }

        let positionInMeasure = location % tsSize;
        const cumulativeString = fdiv(location, tsSize) % numStrings;
        const measure = fdiv(location, tsSize * numStrings);

        if (measure !== mIndex) tsMove = 0;
        mIndex = measure;

        const fretByte = rec[2];
        const fretRaw = fretByte & 0x1f;

        if (fretRaw === 27) {                          // type-27 = ts change
            const d3 = rec[3];
            const top = fretByte >> 5;
            const den = top > 0 ? fdiv(Math.pow(2, top), 2) : h.v2_time_denom;
            const gridLen = tsSize - 4 * d3;
            const num = den > 0 ? fdiv(gridLen * den, 256) : 0;
            tsMove = 4 * d3;
            if (num > 0 && (d3 > 0 || !(num === h.v2_time_num && den === h.v2_time_denom))) {
                tsChanges.push({ measure: measure + 1, numerator: num, denominator: den });
            }
            offset += 6;
            continue;
        }

        if (tsMove && positionInMeasure >= tsMove) positionInMeasure -= tsMove;

        if (fretRaw >= 0x01 && fretRaw <= 0x19) {
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
                position: measure * tsSize + positionInMeasure,
                track: trackIdx,
                marker: markerChar,
                extra: localString + 1,
                pitchByte: fret,
                raw: Uint8Array.from(rec),              // own copy of the 6 bytes
                durationTicks: decodeDurationCode(rec[3] & 0x1f),
            });
        }
        offset += 6;
    }
    return { events, tsChanges };
}

// --- reading list ----------------------------------------------------------
export function parseReadingListV2(data, h) {
    const entries = [];
    const count = h.v2_repeats_count;
    if (count === 0) return entries;
    const base = h.v2_component_offset + h.v2_component_count * 6;
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
    let { events: noteEvents, tsChanges } = parseNoteEventsV2(data, header, instruments);
    let timeSignatureChanges = tsChanges;

    // effect2 == 0x07 chord-overlay filter — but keep real accompaniment
    // notes whose fret byte has bit 7 set (11514/11245 bass modules).
    noteEvents = noteEvents.filter(e =>
        !(e.raw.length > 5 && e.raw[5] === 0x07 && !(e.raw[2] & 0x80)));

    // Anacrusis: shift measure-1 notes left, record the shortened signature.
    if (header.v2_anacrusis && !timeSignatureChanges.some(c => c.measure === 1)) {
        const tsSize = header.v2_ts_size;
        const m0 = noteEvents.filter(e => e.position < tsSize);
        const shift = m0.length ? Math.min(...m0.map(e => e.position)) : 0;
        if (shift > 0) {
            for (const e of m0) e.position -= shift;
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

    return {
        path_stem: name,
        header,
        title: header.v2_title,
        instruments,
        note_events: noteEvents,
        reading_list: readingList,
        time_signature_changes: timeSignatureChanges,
        v3_global_ts: null,
    };
}

export function parseTefBytes(data, name) {
    if (!(data[0] >= 0x20 && data[0] < 0x7f)) {
        const versionMajor = data[3];
        throw new TefVersionError(
            `TEF version ${versionMajor}.x is not supported by the browser parser (V2 only).`);
    }
    return parseV2(data, name);
}
