// OTF -> TablEdit 3 (V3) .tef bytes. The inverse of tef-import/{reader,otf}.js,
// and like them it runs in the browser and in Node: no fetch, no DOM.
//
// Everything OTF models is rewritten from the document. Everything it does not
// (unknown header bytes, per-track settings, the page-layout block, notes and
// links, measure flags) is carried over from a template file: the original
// .tef when the document came from one whose tracks are unchanged, else the
// default template (template.tef, saved by TablEdit 3.06). The file layout
// is TablEdit's own order: strings, text table, chord table, measures, tracks,
// the opaque blocks, reading list, then the components, ending in 0xFFFFFFFF.
//
// Nothing is dropped silently: whatever a .tef cannot hold is counted in the
// returned `notices` (see notices.js).

import { isV3Layout, parseTrackRecordsV3, headerString } from '../tef-import/reader.js';
import { instrumentToOtfId, instrumentToType } from '../tef-import/otf.js';
import { emptyNotices } from './notices.js';
import { buildNoteCells, UNIT_TICKS } from './notes.js';

export class TefWriteError extends Error {}

const HEADER_SIZE = 0x100;
const SLOT_COMPONENTS = 0x3c;
const SLOT_TITLE = 0x40, SLOT_AUTHOR = 0x44, SLOT_COMMENTS = 0x48, SLOT_NOTES = 0x4c, SLOT_EXTRA = 0x50;
const SLOT_TEXT = 0x54, SLOT_CHORDS = 0x58, SLOT_MEASURES = 0x5c, SLOT_TRACKS = 0x60, SLOT_LAYOUT = 0x64;
const SLOT_READING = 0x80, SLOT_URL = 0x84, SLOT_COPYRIGHT = 0x8c;
// Strings TablEdit keeps in its "Title information" box: title, author (what we
// call composer), comments, notes, URL, copyright, and one nothing in the
// corpus uses. Written in the order TablEdit saves them.
const STRING_SLOTS = [SLOT_TITLE, SLOT_AUTHOR, SLOT_COMMENTS, SLOT_NOTES, SLOT_URL, SLOT_COPYRIGHT, SLOT_EXTRA];
// Blocks nothing models; carried over verbatim (size = distance to the next block).
const OPAQUE_SLOTS = [SLOT_LAYOUT, 0x6c, 0x70, 0x74, 0x78, 0x7c];
const ALL_SLOTS = [SLOT_COMPONENTS, ...STRING_SLOTS, SLOT_TEXT, SLOT_CHORDS, SLOT_MEASURES,
    SLOT_TRACKS, ...OPAQUE_SLOTS, SLOT_READING];

const TRACK_RECORD = 68;
const MAX_TRACKS = 15, MAX_STRINGS = 12, MAX_MEASURES = 2048;
const CHORD_RECORD = 36, CHORD_STRINGS = 14, CHORD_NAME_AT = 14, CHORD_NAME_MAX = 16;
const READING_ENTRY = 32, READING_NAME_MAX = 27, READING_MAX = 100;
const TEXT_MAX = 998, TEXT_INDEX_MAX = 256, TITLE_MAX = 255;
const SIGNATURE_DENOMINATORS = [1, 2, 4, 8, 16];
const TAB_BY_LINE = /^Tab by: /;
const DEFAULT_PROGRAM = { '5-string-banjo': 105, 'tenor-banjo': 105, 'fiddle': 110, 'upright-bass': 32, percussion: 0 };
const PERCUSSION_LINES = [0x23, 0x2b, 0x34, 0x3c, 0x44, 0x4c, 0x54, 0x58, 0x59, 0x5a, 0x5a, 0x5a];

const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const pack16 = (n) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff);

function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

/** Latin-1 bytes, '?' for anything else; `changed` says whether text was altered. */
function latin1(text, maxChars, notices) {
    let s = String(text ?? '');
    let changed = false;
    if (s.length > maxChars) { s = s.slice(0, maxChars); changed = true; }
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c > 0xff) { bytes[i] = 0x3f; changed = true; } else bytes[i] = c;
    }
    if (changed && notices) notices.text_changed += 1;
    return bytes;
}

/** A u16-length-prefixed string, NUL included in the length. */
function lengthPrefixed(bytes) {
    return concat([pack16(bytes.length + 1), bytes, Uint8Array.of(0)]);
}

// --- the template ---------------------------------------------------------------
/** Where each block of a V3 file lives: { slot -> [start, end) }. */
function regionsOf(data) {
    const pointers = ALL_SLOTS.map(slot => [slot, u32(data, slot)]).filter(([, p]) => p !== 0);
    const starts = [...new Set(pointers.map(([, p]) => p))].sort((a, b) => a - b);
    const out = new Map();
    for (const [slot, p] of pointers) {
        if (p < HEADER_SIZE || p >= data.length) throw new TefWriteError('The template file is damaged.');
        const next = starts.find(s => s > p);
        out.set(slot, [p, next ?? data.length]);
    }
    return out;
}

function checkTemplate(data) {
    if (!(data instanceof Uint8Array) || data.length < HEADER_SIZE || !isV3Layout(data)) {
        throw new TefWriteError('The template is not a TablEdit 3 file.');
    }
}

/** The original file when it is V3 and has these tracks, else the default template. */
function chooseBase(tracks, source, template) {
    if (source instanceof Uint8Array && isV3Layout(source)) {
        const have = parseTrackRecordsV3(source);
        if (have.length === tracks.length && have.every((h, i) =>
            h.num_strings === tracks[i].strings && h.is_percussion === tracks[i].perc)) {
            return { data: source, fromSource: true };
        }
    }
    if (!template) throw new TefWriteError('No template: pass the default template bytes.');
    return { data: template, fromSource: false };
}

// --- tracks ---------------------------------------------------------------------
const NOTE_NAMES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function pitchToMidi(name) {
    const m = /^([A-G][#b]?)(-?\d+)$/.exec(name);
    if (m) return NOTE_NAMES[m[1]] + 12 * (Number(m[2]) + 1);
    const raw = /^MIDI(\d+)$/.exec(name);
    if (raw) return Number(raw[1]);
    throw new TefWriteError(`Cannot write the tuning note "${name}".`);
}

function planTracks(otf) {
    if (!Array.isArray(otf.tracks) || !otf.tracks.length) throw new TefWriteError('The tab has no tracks.');
    if (otf.tracks.length > MAX_TRACKS) throw new TefWriteError(`A .tef holds at most ${MAX_TRACKS} tracks.`);
    let rowBase = 0;
    return otf.tracks.map((t) => {
        const perc = Boolean(t.percussion);
        const strings = perc ? t.lines : t.tuning.length;
        if (!(strings >= 1 && strings <= MAX_STRINGS)) {
            throw new TefWriteError(`Track ${t.id} has ${strings} strings; a .tef track has 1 to ${MAX_STRINGS}.`);
        }
        const plan = {
            id: t.id, instrument: t.instrument, role: t.role, perc, strings, rowBase,
            midi: perc ? [] : t.tuning.map(pitchToMidi), capo: t.capo || 0, dyn: t.dyn,
        };
        rowBase += strings;
        return plan;
    });
}

const prettyName = (id) => id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Would the importer turn this track name back into the track we have? */
function nameSurvives(name, track) {
    const inst = { name, num_strings: track.strings, is_percussion: track.perc };
    const lower = name.toLowerCase();
    const role = track.perc ? 'percussion' : (lower.includes('banjo') || lower.includes('mandolin')) ? 'lead' : 'rhythm';
    const id = instrumentToOtfId(inst);
    return (id === track.id || id === track.id.replace(/-\d+$/, ''))
        && instrumentToType(inst) === track.instrument && role === track.role;
}

function trackRecord(track, baseRecord, keepBytes, notices) {
    const rec = new Uint8Array(TRACK_RECORD);
    rec.set(baseRecord);
    const view = new DataView(rec.buffer);
    view.setUint16(0, track.strings, true);
    view.setUint16(2, track.rowBase, true);
    rec[4] = track.perc ? rec[4] | 0x80 : rec[4] & 0x7f;
    if (!keepBytes) view.setUint16(8, DEFAULT_PROGRAM[track.instrument] ?? 25, true);
    let capo = track.capo;
    if (capo > 12) { capo = 12; notices.values_clamped += 1; }
    rec.fill(0, 20, 32);
    if (track.perc) {
        view.setUint16(12, 0, true);
        view.setUint16(10, 0, true);
        PERCUSSION_LINES.slice(0, track.strings).forEach((b, i) => { rec[20 + i] = b; });
    } else {
        view.setUint16(12, capo, true);
        track.midi.forEach((m, i) => {
            if (m < 6 || m > 90) throw new TefWriteError(`Track ${track.id}: string ${i + 1} is outside TablEdit's range.`);
            rec[20 + i] = 96 - m;
        });
        // TablEdit recomputes a 5-string track's capo offset on load (V2 loader
        // FUN_10004632c): rec[10] low nibble = capo + t1 - t5 - 5 when positive.
        let fifth = 0;
        if (track.strings === 5 && capo > 0) {
            const v = capo + rec[20] - rec[24] - 5;
            if (v > 0 && v < 0x0b) fifth = v;
        }
        rec[10] = (rec[10] & 0xf0) | fifth;
        rec[11] = 0;
    }
    // Name: the original's if the importer reads it back as this track, else the track id.
    const nameBytes = baseRecord.subarray(32);
    const nul = nameBytes.indexOf(0);
    const original = String.fromCharCode(...(nul >= 0 ? nameBytes.subarray(0, nul) : nameBytes));
    // The importer derives id, instrument and role from the name alone, so pick
    // the first name it reads back as this track.
    const candidates = [keepBytes ? original : '', prettyName(track.id), prettyName(track.instrument), 'Rhythm'];
    let name = candidates.find(c => c && nameSurvives(c, track));
    if (name === undefined) { name = prettyName(track.id); notices.track_details_changed += 1; }
    name = name.slice(0, 35);
    rec.fill(0, 32);
    for (let i = 0; i < name.length; i++) rec[32 + i] = name.charCodeAt(i) & 0xff;
    return rec;
}

// --- measures -------------------------------------------------------------------
function parseSignature(sig) {
    const m = /^(\d+)\/(\d+)$/.exec(sig || '');
    if (!m) return null;
    const num = Number(m[1]), den = Number(m[2]);
    return num >= 1 && num <= 32 && SIGNATURE_DENOMINATORS.includes(den) ? [num, den] : null;
}

function measureCount(otf) {
    let n = 1;
    for (const ms of Object.values(otf.notation || {})) for (const m of ms) n = Math.max(n, m.measure);
    for (const a of otf.annotations || []) n = Math.max(n, a.measure);
    for (const d of otf.chord_diagrams || []) n = Math.max(n, d.measure);
    for (const m of otf.measure_marks || []) n = Math.max(n, m.measure);
    for (const c of otf.metadata?.time_signature_changes || []) n = Math.max(n, c.measure);
    if (n > MAX_MEASURES) throw new TefWriteError(`A .tef holds at most ${MAX_MEASURES} measures.`);
    return n;
}

/** [[num, den] per measure], plus the first 64th and length (in 64ths) of each. */
function planMeasures(otf, count, notices) {
    const changes = new Map((otf.metadata.time_signature_changes || []).map(c => [c.measure, c.time_signature]));
    const sigs = [];
    for (let m = 1; m <= count; m++) {
        const text = changes.get(m) ?? otf.metadata.time_signature;
        let sig = parseSignature(text);
        if (!sig) { sig = [4, 4]; notices.time_signatures_changed += 1; }
        sigs.push(sig);
    }
    const slots = sigs.map(([n, d]) => Math.floor((64 * n) / d));
    const starts = [];
    let at = 0;
    for (const s of slots) { starts.push(at); at += s; }
    return { sigs, slots, starts };
}

function measureTable(plan, base, fromSource) {
    const count = plan.sigs.length;
    const out = new Uint8Array(8 + 8 * count);
    const view = new DataView(out.buffer);
    view.setUint16(0, 12, true);
    view.setUint16(2, count, true);
    const old = base.regions.get(SLOT_MEASURES);
    const oldCount = old ? u16(base.data, old[0] + 2) : 0;
    for (let j = 0; j < count; j++) {
        const o = 8 + 8 * j;
        const [num, den] = plan.sigs[j];
        // Bytes 0-2 are per-measure flags nothing models: keep them while the
        // measure is the same one.
        if (fromSource && j < oldCount) {
            const b = old[0] + 8 + 8 * j;
            if (base.data[b + 4] === den && base.data[b + 5] === num) out.set(base.data.subarray(b, b + 3), o);
        }
        out[o + 3] = plan.slots[j];
        out[o + 4] = den;
        out[o + 5] = num;
    }
    return out;
}

// --- the small tables -----------------------------------------------------------
function textTable(otf, plan, totalRows, occupied, notices) {
    const entries = [];
    const items = (otf.annotations || []).filter(a => a.text);
    const share = items.length > TEXT_INDEX_MAX;     // an index is one byte
    const index = new Map();
    const cells = new Map();
    for (const a of items) {
        if (a.measure < 1 || a.measure > plan.starts.length) { notices.annotations_not_written += 1; continue; }
        let i = share ? index.get(a.text) : undefined;
        if (i === undefined) {
            if (entries.length >= TEXT_INDEX_MAX) { notices.annotations_not_written += 1; continue; }
            i = entries.length;
            entries.push(lengthPrefixed(latin1(a.text, TEXT_MAX, notices)));
            if (share) index.set(a.text, i);
        }
        const mi = a.measure - 1;
        const last = plan.starts[mi] + plan.slots[mi] - 1;
        const pos = Math.min(plan.starts[mi] + Math.round(a.tick / UNIT_TICKS), last);
        const key = freeCell(occupied, totalRows, pos, last, range(0, totalRows));
        if (key === null) { notices.annotations_not_written += 1; continue; }
        const rec = component(key, 0x39);
        rec[5] = i;
        rec[9] = 3;
        cells.set(key, rec);
    }
    return { table: entries.length ? concat([pack16(entries.length), ...entries]) : null, cells };
}

const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);

/** A 12-byte component record of `type` at the cell `key` (pos * totalRows + row). */
function component(key, type) {
    const rec = new Uint8Array(12);
    new DataView(rec.buffer).setUint32(0, 8 * key, true);
    rec[4] = type;
    return rec;
}

/** Claim the first free (position, row) from `pos` on; returns its cell key or null. */
function freeCell(occupied, totalRows, pos, lastPos, rows) {
    for (let p = pos; p <= lastPos; p++) {
        for (const r of rows) {
            const key = p * totalRows + r;
            if (!occupied.has(key)) { occupied.add(key); return key; }
        }
    }
    return null;
}

function chordTable(otf, tracks, notices) {
    const chords = otf.chords || [];
    if (!chords.length) return null;
    const owner = new Map();
    for (const d of otf.chord_diagrams || []) {
        const t = tracks.find(x => x.id === d.track);
        if (t && !owner.has(d.chord)) owner.set(d.chord, t.strings);
    }
    const longest = Math.max(...tracks.map(t => t.strings));
    const out = new Uint8Array(4 + CHORD_RECORD * chords.length);
    const view = new DataView(out.buffer);
    view.setUint16(0, CHORD_RECORD, true);
    view.setUint16(2, chords.length, true);
    chords.forEach((c, i) => {
        const o = 4 + CHORD_RECORD * i;
        out.fill(0xff, o, o + CHORD_STRINGS);
        const frets = c.frets || [];
        frets.slice(0, CHORD_STRINGS).forEach((f, s) => {
            if (f === null || f === undefined) return;
            const finger = c.fingers?.[s];
            out[o + s] = (f & 0x1f) | (finger ? (finger + 1) << 5 : 0);
        });
        const name = latin1(c.name, CHORD_NAME_MAX, null);
        if (String(c.name ?? '').length > CHORD_NAME_MAX) notices.text_changed += 1;
        out.set(name.map(b => (b < 0x20 || b >= 0x7f ? 0x3f : b)), o + CHORD_NAME_AT);
        out[o + 31] = (c.first_fret ?? 1) & 0xff;
        // Byte 32 is the diagram's string count, 0 = the owning track's: the
        // importer takes frets.length from it, else from the first diagram's
        // track, else the longest track.
        if (frets.length) {
            const inferred = owner.get(i) ?? longest;
            out[o + 32] = frets.length === inferred ? 0 : frets.length;
        }
    });
    return out;
}

function readingList(otf, notices) {
    const list = otf.reading_list || [];
    if (!list.length) return null;
    if (list.length > READING_MAX) notices.reading_list_entries_dropped += list.length - READING_MAX;
    const kept = list.slice(0, READING_MAX);
    const out = new Uint8Array(4 + READING_ENTRY * kept.length);
    const view = new DataView(out.buffer);
    view.setUint16(0, READING_ENTRY, true);
    view.setUint16(2, kept.length, true);
    kept.forEach((e, i) => {
        const o = 4 + READING_ENTRY * i;
        view.setUint16(o, Math.min(e.from_measure, 0xffff), true);
        view.setUint16(o + 2, Math.min(e.to_measure, 0xffff), true);
        const name = e.name || '';
        if (name.length > READING_NAME_MAX) notices.reading_list_names_truncated += 1;
        out.set(latin1(name, READING_NAME_MAX, notices), o + 4);
    });
    return out;
}

function creditLine(tabBy) {
    const name = tabBy.name.replace(/\s+/g, ' ').trim();
    return `Tab by: ${name}${tabBy.url ? ` <${tabBy.url}>` : ''}`;
}

function stringRegion(base, slot) {
    const r = base.regions.get(slot);
    return r ? base.data.subarray(r[0], r[0] + 2 + u16(base.data, r[0])) : null;
}

/** The comments, with this tab's "Tab by:" credit as the last line. */
function commentsRegion(otf, base, notices) {
    const old = stringRegion(base, SLOT_COMMENTS);
    const text = headerString(base.data, SLOT_COMMENTS);
    const hasCredit = text !== null && text.split(/\r?\n/).some(l => TAB_BY_LINE.test(l.trim()));
    if (!otf.metadata.tab_by && !hasCredit) return old ?? lengthPrefixed(new Uint8Array(0));
    const lines = (text ?? '').split(/\r?\n/).filter(l => !TAB_BY_LINE.test(l.trim()));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (otf.metadata.tab_by) lines.push(creditLine(otf.metadata.tab_by));
    return lengthPrefixed(latin1(lines.join('\r\n'), TEXT_MAX, notices));
}

// --- the file ---------------------------------------------------------------------
/**
 * @param {object} otf OTF document (any 1.x)
 * @param {{source?: Uint8Array, template?: Uint8Array}} [options]
 *   source: the .tef bytes the document was opened from; used as the template
 *   when it is V3 and its tracks match. template: the default template bytes.
 * @returns {{bytes: Uint8Array, notices: object}}
 */
export function writeTef(otf, { source, template } = {}) {
    const notices = emptyNotices();
    const tracks = planTracks(otf);
    const chosen = chooseBase(tracks, source, template);
    checkTemplate(chosen.data);
    const base = { ...chosen, regions: regionsOf(chosen.data) };
    const totalRows = tracks.reduce((n, t) => n + t.strings, 0);
    const plan = planMeasures(otf, measureCount(otf), notices);

    const { cells, occupied } = buildNoteCells(otf, tracks, plan.starts, plan.slots, totalRows, notices);
    const text = textTable(otf, plan, totalRows, occupied, notices);
    for (const [key, rec] of text.cells) cells.set(key, rec);

    // Repeat signs: one 0xb7 per marked measure, on the first free cell of its first position.
    for (const mark of otf.measure_marks || []) {
        if (mark.measure < 1 || mark.measure > plan.starts.length) continue;
        const mi = mark.measure - 1;
        const key = freeCell(occupied, totalRows, plan.starts[mi], plan.starts[mi] + plan.slots[mi] - 1, range(0, totalRows));
        if (key === null) { notices.repeat_signs_not_written += 1; continue; }
        const rec = component(key, 0xb7);
        rec[5] = 1;
        rec[6] = mark.raw;
        rec[7] = 1;
        cells.set(key, rec);
    }

    // Chord diagrams: an anchor on a row of the diagram's own track.
    for (const d of otf.chord_diagrams || []) {
        const track = tracks.find(t => t.id === d.track);
        const mi = d.measure - 1;
        const key = track && mi >= 0 && mi < plan.starts.length
            ? freeCell(occupied, totalRows, Math.min(plan.starts[mi] + Math.round(d.tick / UNIT_TICKS), plan.starts[mi] + plan.slots[mi] - 1),
                plan.starts[mi] + plan.slots[mi] - 1, range(track.rowBase, track.rowBase + track.strings))
            : null;
        if (key === null) { notices.chord_diagrams_not_written += 1; continue; }
        const rec = component(key, 0x35);
        rec[5] = d.chord & 0xff;
        rec[6] = d.chord >> 8;
        rec[7] = (d.dy || 0) & 0xff;
        rec[8] = (d.dx || 0) & 0xff;
        cells.set(key, rec);
    }

    if (otf.metadata.key) notices.key_not_written += 1;

    // --- assemble the blocks in TablEdit's order ---
    const blocks = new Map();                       // slot -> bytes
    const title = String(otf.metadata.title ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
    if (title !== String(otf.metadata.title ?? '').trim()) notices.text_changed += 1;
    // An unedited title keeps its original bytes (a multi-line title reads back as it did).
    const oldTitle = stringRegion(base, SLOT_TITLE);
    const oldText = (headerString(base.data, SLOT_TITLE) ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
    blocks.set(SLOT_TITLE, oldTitle && oldText === title ? oldTitle
        : lengthPrefixed(latin1(title, TITLE_MAX, notices)));
    blocks.set(SLOT_AUTHOR, otf.metadata.composer
        ? lengthPrefixed(latin1(otf.metadata.composer, TEXT_MAX, notices))
        : stringRegion(base, SLOT_AUTHOR) ?? lengthPrefixed(new Uint8Array(0)));
    blocks.set(SLOT_COMMENTS, commentsRegion(otf, base, notices));
    for (const slot of [SLOT_NOTES, SLOT_URL, SLOT_COPYRIGHT, SLOT_EXTRA]) {
        const keep = stringRegion(base, slot);
        if (keep) blocks.set(slot, keep);
    }
    if (text.table) blocks.set(SLOT_TEXT, text.table);
    const chords = chordTable(otf, tracks, notices);
    if (chords) blocks.set(SLOT_CHORDS, chords);
    blocks.set(SLOT_MEASURES, measureTable(plan, base, chosen.fromSource));

    const oldTracks = base.regions.get(SLOT_TRACKS);
    const oldRecords = oldTracks ? u16(base.data, oldTracks[0] + 2) : 0;
    const records = tracks.map((t, i) => {
        const at = oldTracks[0] + 4 + TRACK_RECORD * (i < oldRecords ? i : 0);
        return trackRecord(t, base.data.subarray(at, at + TRACK_RECORD), chosen.fromSource, notices);
    });
    blocks.set(SLOT_TRACKS, concat([pack16(TRACK_RECORD), pack16(tracks.length), ...records]));

    for (const slot of OPAQUE_SLOTS) {
        const r = base.regions.get(slot);
        if (r) blocks.set(slot, base.data.subarray(r[0], r[1]));
    }
    const reading = readingList(otf, notices);
    if (reading) blocks.set(SLOT_READING, reading);

    const sorted = [...cells.entries()].sort((a, b) => a[0] - b[0]);
    const components = new Uint8Array(12 * sorted.length + 4);
    sorted.forEach(([, rec], i) => components.set(rec, 12 * i));
    components.set([0xff, 0xff, 0xff, 0xff], 12 * sorted.length);
    blocks.set(SLOT_COMPONENTS, components);

    const header = new Uint8Array(base.data.subarray(0, HEADER_SIZE));
    for (const slot of ALL_SLOTS) header.fill(0, slot, slot + 4);
    header.fill(0, 0x10, 0x14);                      // cells are not XOR-encrypted
    // The magic at 0x38 ('debt' or 'tbed') is never read by TablEdit but our reader needs one.
    if (!['debt', 'tbed'].includes(String.fromCharCode(...header.subarray(0x38, 0x3c)))) header.set([0x64, 0x65, 0x62, 0x74], 0x38);
    let tempo = otf.metadata.tempo;
    if (!(tempo >= 30 && tempo <= 500)) { tempo = Math.min(500, Math.max(30, tempo || 120)); notices.values_clamped += 1; }
    new DataView(header.buffer).setUint16(6, tempo, true);

    const parts = [header];
    let at = HEADER_SIZE;
    const order = [...STRING_SLOTS, SLOT_TEXT, SLOT_CHORDS, SLOT_MEASURES, SLOT_TRACKS, ...OPAQUE_SLOTS, SLOT_READING, SLOT_COMPONENTS];
    for (const slot of order) {
        const bytes = blocks.get(slot);
        if (!bytes) continue;
        new DataView(header.buffer).setUint32(slot, at, true);
        parts.push(bytes);
        at += bytes.length;
    }
    return { bytes: concat(parts), notices };
}
