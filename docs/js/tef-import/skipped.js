// What a .tef holds that OTF does not keep (G15e) — port of
// sources/banjo-hangout/src/tef_parser/skipped.py; read that file for the
// full list, what is deliberately not counted, and why. The two must agree
// (golden-gated). Labels for each key live in ../tef-skipped.js.

const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

export const SKIPPED_KEYS = [
    'tempo_changes', 'instrument_changes', 'scale_diagrams', 'accents',
    'slurs', 'picking_marks', 'special_characters', 'percussion',
    'chord_diagrams', 'free_text', 'tapping', 'vibrato', 'tremolo_bar', 'other',
];

const V3_COUNTED = new Map([
    [0x37, 'accents'], [0x38, 'accents'], [0x3d, 'slurs'], [0x3e, 'picking_marks'],
    [0x75, 'scale_diagrams'], [0x78, 'percussion'], [0x7e, 'instrument_changes'],
    [0xb6, 'special_characters'], [0xf5, 'special_characters'], [0xfe, 'tempo_changes'],
]);
const V3_IGNORED = new Set([0x35, 0x36, 0x39, 0x7d, 0xb7, 0xbd, 0xbe, 0xfd]);
const V3_REST = 0x33;

const V2_COUNTED = new Map([
    [0x1e, 'accents'], [0x9e, 'accents'], [0x3d, 'slurs'], [0x3e, 'picking_marks'],
    [0x3c, 'scale_diagrams'], [0x7c, 'scale_diagrams'], [0xbc, 'scale_diagrams'],
    [0x5d, 'special_characters'], [0xdd, 'special_characters'],
    [0xde, 'percussion'], [0x7e, 'instrument_changes'], [0xfe, 'tempo_changes'],
]);
const V2_IGNORED = new Set([0x1a, 0x1d, 0x1c, 0x5c, 0x9c, 0x5e, 0x7d, 0x9d, 0xbd, 0xbe, 0xfd]);
const V2_TIME_SIGNATURE = 0x1b;
const V2_LAYOUT_CODES = new Set([0x0b, 0x0c, 0x0d, 0x0e, 0xc0, 0xd0]);

const EFFECT_TAPPING = 9;
const EFFECT_VIBRATO = 10;
const V3_FREE_TEXT_PTR = 0x4c;

const tremoloBar = (attr) => (attr >> 4) !== 3 && ((attr & 0x0f) === 5 || (attr & 0x0f) === 6);

function bump(counts, key) {
    counts[key] = (counts[key] || 0) + 1;
}

/** Non-blank lines of the u16-length string at pointer 0x4C. */
function freeTextLines(data) {
    if (data.length < V3_FREE_TEXT_PTR + 4) return 0;
    const ptr = u32(data, V3_FREE_TEXT_PTR);
    if (!(ptr > 0 && ptr <= data.length - 2)) return 0;
    const length = u16(data, ptr);
    let lines = 0;
    let blank = true;
    const stop = Math.min(ptr + 2 + length, data.length);
    for (let i = ptr + 2; i < stop; i++) {
        const b = data[i];
        if (b === 10 || b === 13) {
            if (!blank) lines++;
            blank = true;
        } else if (b !== 32 && b !== 9 && b !== 0) {
            blank = false;
        }
    }
    if (!blank) lines++;
    return lines;
}

function countV3(data, counts) {
    if (data.length < 0x40) return;
    const start = u32(data, 0x3c);
    if (start < 0x100 || start >= data.length) return;
    let end = data.length;
    for (let ptr = 0x40; ptr < 0xa0; ptr += 4) {
        const target = u32(data, ptr);
        if (target > start && target < end) end = target;
    }
    for (let offset = start; offset + 12 <= end; offset += 12) {
        if (u32(data, offset) === 0xffffffff) break;
        const kind = data[offset + 4];
        if ((kind & 0x3f) < V3_REST) {
            const low = kind & 0x1f;
            if (low >= 1 && low <= 0x19) {                  // a note
                const effect = data[offset + 6] & 0x0f;
                if (effect === EFFECT_TAPPING) bump(counts, 'tapping');
                else if (effect === EFFECT_VIBRATO) bump(counts, 'vibrato');
                if (tremoloBar(data[offset + 8])) bump(counts, 'tremolo_bar');
            }
            continue;
        }
        if ((kind & 0x3f) === V3_REST || V3_IGNORED.has(kind)) continue;
        bump(counts, V3_COUNTED.get(kind) || 'other');
    }
}

function countV2(data, h, stride, counts) {
    let offset = h.v2_component_offset;
    for (let n = 0; n < h.v2_component_count; n++, offset += stride) {
        if (offset + stride > data.length) break;
        const fret = data[offset + 2];
        const raw = fret & 0x1f;
        if (raw === V2_TIME_SIGNATURE) continue;
        if ((raw >= 0x01 && raw <= 0x19) || (raw === 0x1a && fret !== 0x1a)) {
            if (stride < 6) continue;
            const e2 = data[offset + 5];
            if (!(fret & 0x80) && e2 === 0x07) continue;    // chord overlay, dropped on import
            const effect = data[offset + 4] & 0x0f;
            if (effect === EFFECT_TAPPING) bump(counts, 'tapping');
            else if (effect === EFFECT_VIBRATO) bump(counts, 'vibrato');
            if ((fret & 0xe0) === 0x80 && !V2_LAYOUT_CODES.has(e2) && tremoloBar(e2)) {
                bump(counts, 'tremolo_bar');
            }
            continue;
        }
        if (raw < 0x1a || V2_IGNORED.has(fret)) continue;   // raw 0 is filler
        bump(counts, V2_COUNTED.get(fret) || 'other');
    }
}

/** `{key: count}` for what this file holds that OTF does not keep (non-zero only). */
export function countSkipped(data, header, stride = 6) {
    const counts = {};
    if (header.isV2) {
        countV2(data, header, stride, counts);
    } else {
        countV3(data, counts);
        const freeText = freeTextLines(data);
        if (freeText) counts.free_text = freeText;
    }
    const out = {};
    for (const k of SKIPPED_KEYS) if (counts[k]) out[k] = counts[k];
    return out;
}
