// TEF -> OTF conversion — JavaScript port of tef_to_otf() and its helpers from
// sources/banjo-hangout/src/tef_parser/otf.py. Emits the OTF *document* shape
// that TabRenderer/TabPlayer consume (the works-view contract). Verified
// byte-exact against the Python converter by the golden-diff gate.

import {
    decodeDurationCode, isMelody, decodeStringFret, TRIPLET_DURATION_CODES, V3_UNITS_PER_WHOLE, v3Locate,
} from './reader.js';
import { OTF_VERSION, DYN_LEVELS, decodeMarkRaw } from '../otf-editor/otf-validate.js';
import { SKIPPED_KEYS } from './skipped.js';

const fdiv = (a, b) => Math.floor(a / b);

// --- MIDI pitch names (24..83), matching MIDI_TO_PITCH -----------------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToPitchName(midi) {
    if (midi >= 24 && midi <= 83) {
        return NOTE_NAMES[midi % 12] + String(fdiv(midi, 12) - 1);
    }
    return `MIDI${midi}`;
}

// Fingering byte (V3 note byte 10; V2 effect2 on 0x20-flagged notes) packs BOTH hands base-6: value = 6*pluck + lh_code.
// pluck 1..5 -> picking finger T/I/M/R/P; lh_code 0 = none, else fretting
// digit = lh_code - 1. Oracle-verified against TablEdit's MusicXML
// <pluck>/<fingering> (see otf.py).
export const V3_PLUCK_LETTERS = { 1: 'T', 2: 'I', 3: 'M', 4: 'R', 5: 'P' };

function decodeFingering(code) {
    if (!(code > 0 && code <= 35)) return [null, null];
    const pluck = V3_PLUCK_LETTERS[fdiv(code, 6)] ?? null;
    const lhCode = code % 6;
    return [pluck, lhCode ? lhCode - 1 : null];
}

function v3Fingering(evt) {
    return decodeFingering((evt.raw && evt.raw.length >= 12) ? evt.raw[10] : 0);
}

// --- instrument identity -----------------------------------------------------
export function instrumentToOtfId(inst) {
    // The structural percussion flag wins over every name/string-count rule
    // below — a drum track's name can lie ("Guitar Standard" in 2613).
    if (inst.is_percussion) return 'percussion';
    const name = inst.name.toLowerCase();
    if (inst.num_strings === 4 && (name.includes('banjo') || name.includes('tenor')
        || name.includes('cgdg') || name.includes('cgda'))) return 'tenor-banjo';
    for (const [keyword, id] of [
        ['mandolin', 'mandolin'], ['ukulele', 'ukulele'], ['dobro', 'dobro'],
        ['resonator', 'dobro'], ['fiddle', 'fiddle'], ['violin', 'fiddle'],
        ['bass', 'bass'], ['guitar', 'guitar'], ['banjo', 'banjo'],
        ['piano', 'piano'], ['click', 'clicks'],
    ]) {
        if (name.includes(keyword)) return id;
    }
    if (inst.num_strings === 5) return 'banjo';
    let n = name;
    for (const suffix of [' open g', ' standard', ' gdae', ' gda']) n = n.split(suffix).join('');
    return n.split(' ').join('-');
}

export function instrumentToType(inst) {
    if (inst.is_percussion) return 'percussion';
    const name = inst.name.toLowerCase();
    if (inst.num_strings === 4 && (name.includes('banjo') || name.includes('tenor')
        || name.includes('cgdg') || name.includes('cgda'))) return 'tenor-banjo';
    if (name.includes('banjo') || inst.num_strings === 5) return '5-string-banjo';
    if (name.includes('mandolin')) return 'mandolin';
    if (name.includes('guitar')) return '6-string-guitar';
    if (name.includes('bass')) return 'upright-bass';
    if (name.includes('dobro') || name.includes('resonator')) return 'dobro';
    if (name.includes('fiddle') || name.includes('violin')) return 'fiddle';
    return `${inst.num_strings}-string`;
}

// --- articulation / tie helpers ---------------------------------------------
// TablEdit's per-note effects (fix-it A15) — a port of otf.py note_fx /
// note_grace / is_dead_note; see there for the bytes and the evidence.
export const EFFECT_FX = { 4: 'choke', 5: 'brush', 6: 'harmonic', 7: 'artificial-harmonic',
    8: 'muted', 9: 'tap', 10: 'vibrato', 11: 'tremolo', 12: 'bend', 13: 'bend-release', 14: 'roll' };
export const BEND_EFFECTS = new Set([12, 13]);
export const ATTRIBUTE_FX = { 1: 'let-ring', 2: 'slap', 4: 'ghost', 7: 'staccato' };
export const SECOND_FX = { 3: 'roll', 5: 'brush', 6: 'harmonic', 7: 'artificial-harmonic',
    8: 'let-ring', 9: 'ghost' };
export const SECOND_DEAD = 10;
const V2_LAYOUT_CODES = new Set([0x0b, 0x0c, 0x0d, 0x0e, 0xc0, 0xd0]);
export const FX_ORDER = ['brush', 'roll', 'choke', 'ghost', 'staccato', 'let-ring', 'muted',
    'harmonic', 'artificial-harmonic', 'tap', 'vibrato', 'tremolo', 'bend', 'bend-release', 'slap'];
export const GRACE_KINDS = [null, 'hp', 'slide', 'bend', 'mordent', 'double', 'gruppetto', 'trill'];

function attributeByte(e) {
    const r = e.raw;
    if (!r) return 0;
    if (r.length >= 12) return r[8];
    if (r.length >= 6 && (r[2] & 0xe0) === 0x80 && !V2_LAYOUT_CODES.has(r[5])) return r[5];
    return 0;
}

export function noteFx(e) {
    const r = e.raw;
    if (!r || r.length < 6) return [];
    const effect = r.length >= 12 ? r[6] & 0x0f : r[4] & 0x0f;
    const fx = new Set();
    if (EFFECT_FX[effect]) fx.add(EFFECT_FX[effect]);
    const attr = attributeByte(e);
    const hi = attr >> 4, lo = attr & 0x0f;
    if (hi !== 3 && ATTRIBUTE_FX[lo]) fx.add(ATTRIBUTE_FX[lo]);
    if (SECOND_FX[hi]) fx.add(SECOND_FX[hi]);
    return FX_ORDER.filter(f => fx.has(f));
}

export function noteGrace(e) {
    const r = e.raw;
    if (!r) return null;
    let g;
    if (r.length >= 12 && (r[4] & 0x40)) g = r[7];
    else if (r.length >= 6 && r.length < 12 && (r[2] & 0xe0) === 0x40) g = r[5];
    else return null;
    const grace = { f: g & 0x1f };
    if (GRACE_KINDS[g >> 5]) grace.kind = GRACE_KINDS[g >> 5];
    return grace;
}

// The note effect is the low nibble of V3 byte 6 / V2 effect1 (bits 4-5 are
// the voice); 15 is 'Dead note', and so is second effect 10.
export function isDeadNote(e) {
    const r = e.raw;
    if (!r) return false;
    if ((attributeByte(e) >> 4) === SECOND_DEAD) return true;
    if (r.length >= 12) return (r[6] & 0x0f) === 0x0f;
    return r.length >= 6 && (r[4] & 0x0f) === 0x0f;
}

export function isTiedNote(e) {
    const r = e.raw;
    if (r && r.length >= 6) {
        if (r.length === 6) return ((r[3] >> 5) & 0x07) === 7;   // V2 dynamic-7 sentinel
        return ((r[5] >> 5) & 0x07) === 7;                        // V3: same byte, same rule
    }
    return false;
}

/** The note's dynamic code 0-6 (0 = fff, the LOUDEST, .. 6 = pp), or null for a
 *  tied note (code 7) or a record with no duration byte. Bits 5-7 of V3 cell
 *  byte 5 / V2 byte 3 (the 4-byte V2 variant keeps it in byte 3 too).
 *  Velocity = 127 - 16 * code (TablEdit's Rich-MIDI export). Port of
 *  dynamic_code(). */
export function dynamicCode(e) {
    const r = e.raw;
    if (!r || r.length < 4) return null;
    const code = ((r.length >= 12 ? r[5] : r[3]) >> 5) & 0x07;
    return code === 7 ? null : code;
}

/** Collapse per-note levels (note.dyn on every non-tie note) into
 *  tracks[].dyn (most common; the louder one on a tie) plus the exceptions.
 *  Port of assign_dynamics(). */
function assignDynamics(doc) {
    for (const track of doc.tracks) {
        const notes = [];
        for (const m of doc.notation[track.id] || [])
            for (const e of m.events) for (const n of e.notes) if (n.dyn) notes.push(n);
        if (!notes.length) continue;
        const counts = new Map();
        for (const n of notes) counts.set(n.dyn, (counts.get(n.dyn) || 0) + 1);
        let best = null;
        for (const lv of DYN_LEVELS) {       // loudest first, so ties go loud
            if (counts.has(lv) && (best === null || counts.get(lv) > counts.get(best))) best = lv;
        }
        track.dyn = best;
        for (const n of notes) if (n.dyn === best) n.dyn = null;
    }
}

/** V2 techniques: effect1 (byte 4) is an enum on the SOURCE note, attributed to
 *  the destination (next note, same track+string). Port of compute_articulations.
 *  Returns Map keyed "track:position:string" -> tech. */
/** The note's duration code when TablEdit plays it as a triplet, else null.
 *  Port of triplet_duration_code(). */
function tripletDurationCode(evt) {
    const raw = evt.raw;
    if (!raw) return null;
    let code;
    if (raw.length === 12) code = raw[5] & 0x1f;        // V3 duration byte
    else if (raw.length >= 4) code = raw[3] & 0x1f;     // V2 duration byte
    else return null;
    return TRIPLET_DURATION_CODES.has(code) ? code : null;
}

/** Triplet timing (V2 and V3): TRIPLET_DURATION_CODES are 3:2. TablEdit stores
 *  a triplet's position straight; only a note on the straight storage step
 *  (3/4 of its triplet duration) is stretched by 4/3, and only while it stays
 *  inside the measure. The .tef writer inverts this (tef-export/notes.js). */
export function retimeTriplet(tick, code, measureTicks) {
    const span = 2 * (1920 >> fdiv(code, 3));
    const step = fdiv(decodeDurationCode(code) * 3, 4);
    const inSpan = tick % span;
    if (inSpan % step !== 0) return tick;
    const retimed = tick - inSpan + fdiv(inSpan * 4, 3);
    return retimed < measureTicks ? retimed : tick;
}

export function computeArticulations(noteEvents, maxGap) {
    const V2_TECH = { 1: 'h', 2: 'p', 3: '/' };
    const out = new Map();
    if (maxGap == null) maxGap = 128;

    const byTrackString = new Map();
    for (const e of noteEvents) {
        if (!isMelody(e)) continue;
        if (!e.raw || e.raw.length !== 6) continue;          // V2 records only
        const r = decodeStringFret(e);
        if (!r) continue;
        const key = e.track + ':' + r[0];
        if (!byTrackString.has(key)) byTrackString.set(key, []);
        byTrackString.get(key).push(e);
    }

    for (const notes of byTrackString.values()) {
        notes.sort((a, b) => a.position - b.position);
        for (let i = 0; i < notes.length; i++) {
            const e = notes[i];
            const tech = V2_TECH[e.raw[4] & 0x0f];           // enum is the low nibble; bits 4-5 are flags
            if (!tech || i + 1 >= notes.length) continue;
            const next = notes[i + 1];
            if (maxGap && next.position - e.position > maxGap) continue;
            // Open-string destinations pair only when adjacent (dest starts
            // exactly when the source's written duration ends).
            const nr = decodeStringFret(next);
            if (nr && nr[1] === 0) {
                const durUnits = decodeDurationCode(e.raw[3] & 0x1f) / 7.5;
                if (next.position - e.position > durUnits) continue;
            }
            const string = decodeStringFret(e)[0];
            out.set(e.track + ':' + next.position + ':' + string, tech);
        }
    }
    return out;
}

/** V3 articulations: byte 6 of the 12-byte record on the SOURCE note names the
 *  transition (1 h / 2 p / 3 slide), attributed to the destination note (next,
 *  same track+string, within maxGap 64th-note units). Port of compute_articulations_v3. */
export function computeArticulationsV3(noteEvents, maxGap = V3_UNITS_PER_WHOLE / 2) {
    const V3_TECH = { 1: 'h', 2: 'p', 3: '/' };
    const out = new Map();
    const byString = new Map();
    for (const e of noteEvents) {
        if (!isMelody(e)) continue;
        if (!e.raw || e.raw.length < 12) continue;
        const r = decodeStringFret(e);
        if (!r) continue;
        const key = e.track + ':' + r[0];
        if (!byString.has(key)) byString.set(key, []);
        byString.get(key).push(e);
    }
    for (const notes of byString.values()) {
        notes.sort((a, b) => a.position - b.position);
        for (let i = 0; i < notes.length; i++) {
            const e = notes[i];
            const tech = V3_TECH[e.raw[6] & 0x1f];
            if (!tech || i + 1 >= notes.length) continue;
            const next = notes[i + 1];
            if (next.position - e.position <= maxGap) {
                const string = decodeStringFret(e)[0];
                out.set(e.track + ':' + next.position + ':' + string, tech);
            }
        }
    }
    return out;
}

function articulationMaxGap(header) {
    // Half a measure: native grid units for V2, 64th-note units for V3.
    return header.isV2 ? fdiv(header.v2_ts_size || 256, 2) : V3_UNITS_PER_WHOLE / 2;
}

/** The note effect enum (V3 byte 6 / V2 effect1) & 0x0f; 0 if unreadable. */
function effectCode(e) {
    const r = e.raw;
    if (!r || r.length < 6) return 0;
    return r.length >= 12 ? r[6] & 0x0f : r[4] & 0x0f;
}

function notesByTrackString(noteEvents) {
    const byTrackString = new Map();
    for (const e of noteEvents) {
        if (!isMelody(e)) continue;
        const sf = decodeStringFret(e);
        if (!sf) continue;
        const key = e.track + ':' + sf[0];
        if (!byTrackString.has(key)) byTrackString.set(key, []);
        byTrackString.get(key).push({ position: e.position, fret: sf[1], e, string: sf[0] });
    }
    for (const notes of byTrackString.values()) notes.sort((a, b) => a.position - b.position);
    return byTrackString;
}

/** Keys "track:position:string" of BEND TARGETS (G15d2). Port of
 *  bend_target_keys: a note with effect 12 (bend) or 13 (bend-release) bends
 *  into the NEXT note on the same string of its track, tied or not, possibly
 *  in a later measure. There is no amount field (it is target.f - source.f),
 *  and the target is never re-attacked. A bend with no later note, a target
 *  that is already an h/p/slide destination, or one on the same fret is left
 *  alone. */
export function bendTargetKeys(noteEvents, articulations) {
    const keys = new Set();
    for (const notes of notesByTrackString(noteEvents).values()) {
        for (let i = 0; i + 1 < notes.length; i++) {
            const { position, fret, e, string } = notes[i];
            if (!BEND_EFFECTS.has(effectCode(e))) continue;
            const next = notes[i + 1];
            if (next.position === position || next.fret === fret) continue;
            const key = e.track + ':' + next.position + ':' + string;
            if (articulations.get(key) != null) continue;
            keys.add(key);
        }
    }
    return keys;
}

/** Keys of notes that carry the tie bit on a different fret than the previous
 *  note on their string, with no h/p/slide owning the connection. Port of
 *  fret_changed_tie_keys: not ties (they would go silent) and, since G15d2,
 *  not bends either; they import as plain re-attacked notes. */
export function fretChangedTieKeys(noteEvents, articulations) {
    const keys = new Set();
    for (const notes of notesByTrackString(noteEvents).values()) {
        for (let i = 1; i < notes.length; i++) {
            const { position, fret, e, string } = notes[i];
            if (!isTiedNote(e)) continue;
            if (notes[i - 1].fret === fret) continue;              // same fret = tie
            const key = e.track + ':' + position + ':' + string;
            if (articulations.get(key) != null) continue;
            keys.add(key);
        }
    }
    return keys;
}

// --- slide-timing normalization ---------------------------------------------
export function retimedSlideTarget(targetTick, targetDur, targetTech,
    sourceTick, sourceDur, ticksPerBeat) {
    if ((targetTech !== '/' && targetTech !== '\\') || !targetDur) return [targetTick, targetDur];
    const whole = ticksPerBeat * 4;
    const sixteenth = fdiv(ticksPerBeat, 4);
    const isTripletDur = whole % targetDur === 0 && (fdiv(whole, targetDur)) % 3 === 0;
    const offGrid = targetTick % sixteenth !== 0;
    if (!(isTripletDur && offGrid)) return [targetTick, targetDur];
    if (sourceTick == null || sourceDur == null) return [targetTick, targetDur];
    const newTick = sourceTick + sourceDur;
    if (newTick % sixteenth !== 0 || newTick > targetTick) return [targetTick, targetDur];
    return [newTick, (targetTick + targetDur) - newTick];
}

export function normalizeSlideTiming(doc) {
    const tpb = doc.timing.ticks_per_beat;
    for (const measures of Object.values(doc.notation)) {
        for (const measure of measures) {
            const events = [...measure.events].sort((a, b) => a.tick - b.tick);
            const lastOnString = new Map();      // string -> {tick, note}
            const moves = [];
            for (const event of events) {
                for (const note of event.notes) {
                    if ((note.tech === '/' || note.tech === '\\') && event.notes.length === 1) {
                        const src = lastOnString.get(note.s);
                        if (src) {
                            const [nt, nd] = retimedSlideTarget(
                                event.tick, note.dur, note.tech, src.tick, src.note.dur, tpb);
                            if (nt !== event.tick) moves.push({ event, note, nt, nd });
                        }
                    }
                    lastOnString.set(note.s, { tick: event.tick, note });
                }
            }
            for (const { event: oldEvent, note, nt, nd } of moves) {
                note.dur = nd;
                const idx = measure.events.indexOf(oldEvent);
                if (idx >= 0) measure.events.splice(idx, 1);
                const existing = measure.events.find(e => e.tick === nt);
                if (existing) existing.notes.push(note);
                else measure.events.push({ tick: nt, notes: [note] });
            }
            measure.events.sort((a, b) => a.tick - b.tick);
        }
    }
}

// --- chord diagrams (G15d3) ---------------------------------------------------
/** Index of the track whose strings contain the cumulative string row (null = none). */
function diagramTrackIndex(stringCounts, row) {
    if (!stringCounts.length) return 0;
    for (let idx = 0; idx < stringCounts.length; idx++) {
        if (row < stringCounts[idx]) return idx;
        row -= stringCounts[idx];
    }
    return null;
}

/** One chord-table record as an OTF `chords` entry (see chord_record_to_otf in otf.py). */
function chordRecordToOtf(rec, stringCount) {
    const out = { name: rec.name };
    if (rec.strings.some(b => b !== 0xff)) {
        const raw = Array.from(rec.strings.subarray(0, stringCount));
        out.frets = raw.map(b => (b === 0xff ? null : b & 0x1f));
        // high 3 bits: 0 plain dot, 1 special glyph (never seen), 2-5 = finger 1-4
        const fingers = raw.map(b => (b !== 0xff && (b >> 5) >= 2 && (b >> 5) <= 5 ? (b >> 5) - 1 : null));
        if (fingers.some(f => f !== null)) out.fingers = fingers;
    }
    if (rec.first_fret !== 1) out.first_fret = rec.first_fret;
    return out;
}

/**
 * Port of chord_diagrams_to_otf(): the `chords` table, the `chord_diagrams`
 * anchors, and the count of diagrams that could not be kept. The `frets`
 * length of a record is byte 32 when non-zero, else the string count of the
 * track of the first diagram pointing at it, else (unused record) the file's
 * longest track.
 */
function chordDiagramsToOtf(tef, tracks, unitsPerMeasure, ticksPerUnit) {
    const isV2 = tef.header.isV2;
    let dropped = tef.chord_anchors_dropped || 0;
    const table = tef.chord_table || [];
    const stringCounts = tef.instruments.map(i => i.num_strings);
    const diagrams = [];
    const ownerStrings = new Map();
    for (const a of (tef.chord_anchors || [])) {
        const idx = diagramTrackIndex(stringCounts, a.stringRow);
        if (idx === null || idx >= tracks.length) { dropped += 1; continue; }
        let measure, tick;
        if (isV2) {
            measure = fdiv(a.position, unitsPerMeasure);
            tick = fdiv(((a.position % unitsPerMeasure) & ~3) * 15, 2);
        } else {
            const [m, offset] = v3Locate(tef, a.position);
            measure = m;
            tick = offset * ticksPerUnit;
        }
        const d = { measure: measure + 1, tick, track: tracks[idx].id, chord: a.index };
        if (a.dx) d.dx = a.dx;
        if (a.dy) d.dy = a.dy;
        diagrams.push(d);
        if (!ownerStrings.has(a.index)) ownerStrings.set(a.index, stringCounts.length ? stringCounts[idx] : 5);
    }
    const longest = stringCounts.length ? Math.max(...stringCounts) : 5;
    const chords = table.map((rec, i) => {
        const n = rec.string_count || ownerStrings.get(i) || longest;
        return chordRecordToOtf(rec, Math.max(1, Math.min(14, n)));
    });
    return { chords, diagrams, dropped };
}

// --- main conversion ---------------------------------------------------------
const DEFAULT_TUNINGS = {
    '5-string-banjo': [62, 59, 55, 50, 67],
    'tenor-banjo': [67, 62, 55, 48],
    'mandolin': [76, 69, 62, 55],
    '6-string-guitar': [64, 59, 55, 50, 45, 40],
};

/** Port of tef_to_otf(). Returns the OTF document as a plain dict (== to_dict()). */
export function tefToOtf(tef) {
    const header = tef.header;
    const isV2 = header.isV2;

    // ---- metadata ----
    const metadata = {
        title: tef.title || tef.path_stem,
        time_signature: '4/4',
        tempo: 100,
    };
    if (isV2) {
        metadata.time_signature = `${header.v2_time_num}/${header.v2_time_denom}`;
        if (header.v2_composer) metadata.composer = header.v2_composer;
    } else if (tef.v3_global_ts) {
        metadata.time_signature = `${tef.v3_global_ts[0]}/${tef.v3_global_ts[1]}`;
    } else {
        metadata.time_signature = '2/2';
    }
    if (!isV2 && tef.composer) metadata.composer = tef.composer;

    if (tef.tab_by) metadata.tab_by = tef.tab_by;

    let tsChanges = tef.time_signature_changes.map(c => ({
        measure: c.measure, time_signature: `${c.numerator}/${c.denominator}`,
    }));

    // Promote a uniform all-measure re-label to the global signature.
    if (isV2 && tsChanges.length) {
        const sigs = new Set(tsChanges.map(c => c.time_signature));
        const total = header.v2_measures || 0;
        const measuresCovered = new Set(tsChanges.map(c => c.measure));
        const allCovered = total > 0 && measuresCovered.size === total
            && [...Array(total).keys()].every(i => measuresCovered.has(i + 1));
        if (sigs.size === 1 && allCovered) {
            metadata.time_signature = [...sigs][0];
            tsChanges = [];
        }
    }

    // tempo
    const tempoRaw = isV2 ? header.v2_tempo : (header.v3_tempo || 0);
    metadata.tempo = (tempoRaw >= 30 && tempoRaw <= 500) ? tempoRaw : 100;

    // ---- tracks ----
    const tracks = [];
    const seenTrackIds = new Map();
    for (const inst of tef.instruments) {
        let trackId = instrumentToOtfId(inst);
        const count = (seenTrackIds.get(trackId) || 0) + 1;
        seenTrackIds.set(trackId, count);
        if (count > 1) trackId = `${trackId}-${count}`;

        const instType = instrumentToType(inst);

        // A drum track has no tuning to fall back to — the banjo default
        // below is exactly what made percussion play back as pitched notes.
        if (inst.is_percussion) {
            tracks.push({
                id: trackId, instrument: instType, tuning: [], capo: 0,
                role: 'percussion', percussion: true, lines: inst.num_strings,
            });
            continue;
        }

        let tuning;
        if (inst.tuning_pitches && inst.tuning_pitches.length) {
            tuning = inst.tuning_pitches.map(midiToPitchName);
        } else {
            const dp = DEFAULT_TUNINGS[instType] || DEFAULT_TUNINGS['5-string-banjo'];
            tuning = dp.map(midiToPitchName);
        }
        const nm = inst.name.toLowerCase();
        tracks.push({
            id: trackId, instrument: instType, tuning, capo: inst.capo,
            role: (nm.includes('banjo') || nm.includes('mandolin')) ? 'lead' : 'rhythm',
        });
    }
    if (tracks.length === 0) {
        tracks.push({
            id: 'banjo', instrument: '5-string-banjo',
            tuning: DEFAULT_TUNINGS['5-string-banjo'].map(midiToPitchName),
            capo: 0, role: 'lead',
        });
    }

    // ---- articulations ----
    const articulations = isV2
        ? computeArticulations(tef.note_events, articulationMaxGap(header))
        : computeArticulationsV3(tef.note_events);
    // Bend targets: the next note on the string after an effect-12/13 note → 'b'.
    const bendKeys = bendTargetKeys(tef.note_events, articulations);
    const retieKeys = fretChangedTieKeys(tef.note_events, articulations);

    // ---- group events by track + measure ----
    // V3 positions: continuous 64ths (30 ticks each), split by v3Locate.
    const V3_TICKS_PER_UNIT = fdiv(1920, V3_UNITS_PER_WHOLE);
    const unitsPerMeasure = header.v2_ts_size || 256;
    const trackEvents = new Map();   // trackId -> Map(measure -> [{tick, evt}])

    for (const event of tef.note_events) {
        if (!isMelody(event)) continue;
        const trackId = event.track < tracks.length ? tracks[event.track].id : 'unknown';
        if (!trackEvents.has(trackId)) trackEvents.set(trackId, new Map());

        let measure, positionInMeasure;
        if (isV2) {
            measure = fdiv(event.position, unitsPerMeasure) + 1;
            positionInMeasure = event.position % unitsPerMeasure;
        } else {
            const [index, offset] = v3Locate(tef, event.position);
            measure = index + 1;
            positionInMeasure = offset;
        }
        // V2: TablEdit's loader floors each record to the 64th grid ((loc << 1) & ~3).
        let tick = isV2 ? fdiv((positionInMeasure & ~3) * 15, 2) : positionInMeasure * V3_TICKS_PER_UNIT;

        // Triplet timing (V2 and V3): TRIPLET_DURATION_CODES are 3:2. Only a note
        // on the straight storage step (3/4 of its triplet duration) is compressed.
        const code = tripletDurationCode(event);
        if (code !== null) {
            // Barline guard (G15d5, port of otf.py): TablEdit's MusicXML export
            // keeps 10676 m7's slot-3 note inside the measure (945/240 divisions),
            // never on or past the barline, so keep the stored tick then.
            let measureTicks = 1920;
            if (isV2) measureTicks = fdiv(unitsPerMeasure * 15, 2);
            else if (tef.v3_measure_starts && tef.v3_measure_starts.length
                     && measure - 1 < tef.v3_measure_lengths.length) {
                measureTicks = tef.v3_measure_lengths[measure - 1] * V3_TICKS_PER_UNIT;
            }
            tick = retimeTriplet(tick, code, measureTicks);
        }

        const measures = trackEvents.get(trackId);
        if (!measures.has(measure)) measures.set(measure, []);
        measures.get(measure).push({ tick, evt: event });
    }

    // ---- build notation ----
    const notation = {};
    for (const [trackId, measures] of trackEvents) {
        const outMeasures = [];
        for (const measureNum of [...measures.keys()].sort((a, b) => a - b)) {
            const events = measures.get(measureNum);
            const byTick = new Map();
            for (const { tick, evt } of events) {
                if (!byTick.has(tick)) byTick.set(tick, []);
                byTick.get(tick).push(evt);
            }
            const outEvents = [];
            for (const tick of [...byTick.keys()].sort((a, b) => a - b)) {
                const notes = [];
                const notePairs = [];   // [evt, note], for foldSlideSourceGraces
                for (const evt of byTick.get(tick)) {
                    const r = decodeStringFret(evt);
                    if (!r) continue;
                    const [string, fret] = r;
                    let tech = articulations.get(evt.track + ':' + evt.position + ':' + string) ?? null;
                    // technique_from_event is a retired no-op (returns null).
                    if (isDeadNote(evt)) tech = 'x';
                    let tie = isTiedNote(evt);
                    // ...unless it's a bend target (the next note after an
                    // effect-12/13 note): 'b', never a tie or a re-attack.
                    const noteKey = evt.track + ':' + evt.position + ':' + string;
                    if (bendKeys.has(noteKey)) {
                        tie = false;
                        tech = 'b';
                    } else if (retieKeys.has(noteKey)) {
                        tie = false;
                    }
                    // Fingering: a V2 note whose fret-byte flags are exactly
                    // 0x20 carries the same base-6 fingering byte in effect2
                    // that V3 stores at byte 10 (see otf.py).
                    let finger = null, lh = null;
                    if (isV2) {
                        if (evt.raw && evt.raw.length > 5 && (evt.raw[2] & 0xe0) === 0x20) {
                            [finger, lh] = decodeFingering(evt.raw[5]);
                        }
                    } else {
                        [finger, lh] = v3Fingering(evt);
                    }
                    const fx = noteFx(evt);
                    const dc = tie ? null : dynamicCode(evt);
                    const note = { s: string, f: fret, tech, finger, lh, tie, dur: evt.durationTicks,
                        fx: fx.length ? fx : null, grace: noteGrace(evt),
                        dyn: dc === null ? null : DYN_LEVELS[dc] };
                    notes.push(note);
                    notePairs.push([evt, note]);
                }
                foldSlideSourceGraces(notes, notePairs, tef.note_events);
                if (notes.length) outEvents.push({ tick, notes });
            }
            if (outEvents.length) outMeasures.push({ measure: measureNum, events: outEvents });
        }
        notation[trackId] = outMeasures;
    }

    // Placed free-text annotations (V3 0x39 components: "Long Choke",
    // chord letters, section banners). Positions share the note grid.
    const annotations = (tef.text_events || []).map(te => {
        if (isV2) {
            const index = fdiv(te.position, unitsPerMeasure);
            const offset = te.position % unitsPerMeasure;
            return { measure: index + 1, tick: fdiv((offset & ~3) * 15, 2), text: te.text };
        }
        const [index, offset] = v3Locate(tef, te.position);
        return { measure: index + 1, tick: offset * V3_TICKS_PER_UNIT, text: te.text };
    });

    // Repeat signs (schema 1.2): one entry per marked measure, ascending; the
    // flag byte is the OR of every mark in the measure, as TablEdit ORs them.
    const measureMarks = Object.keys(tef.measure_flags || {}).map(Number)
        .sort((a, b) => a - b)
        .map(index => {
            const raw = tef.measure_flags[index];
            return { measure: index + 1, ...decodeMarkRaw(raw), raw };
        });

    const chordOut = chordDiagramsToOtf(tef, tracks, unitsPerMeasure, V3_TICKS_PER_UNIT);

    // One skipped map: the reader's counts plus the chord importer's own
    // `chord_diagrams` (anchors it could not place), in SKIPPED_KEYS order.
    const skippedAll = { ...(tef.skipped || {}) };
    if (chordOut.dropped) skippedAll.chord_diagrams = chordOut.dropped;

    const doc = {
        otf_version: OTF_VERSION,
        metadata, timing: { ticks_per_beat: 480 },
        tracks, notation,
        annotations,
        reading_list: tef.reading_list.map(e => (
            e.name ? { from_measure: e.from_measure, to_measure: e.to_measure, name: e.name }
                   : { from_measure: e.from_measure, to_measure: e.to_measure }
        )),
        measure_marks: measureMarks,
        chords: chordOut.chords,
        chord_diagrams: chordOut.diagrams,
        _tsChanges: tsChanges,
        skipped: Object.fromEntries(
            SKIPPED_KEYS.filter(k => skippedAll[k]).map(k => [k, skippedAll[k]])),
    };

    normalizeSlideTiming(doc);
    assignDynamics(doc);
    return doc;
}

/** Fold a slide source that the triplet retime stacked on its target.
 *  Port of fold_slide_source_graces() (see otf.py for the why): the earlier
 *  note becomes the later note's `grace: {f, kind: 'slide'}` and is removed
 *  from `notes` in place; the target's "/" goes with it. */
function foldSlideSourceGraces(notes, pairs, allEvents) {
    const byString = new Map();
    for (const pair of pairs) {
        const s = pair[1].s;
        if (!byString.has(s)) byString.set(s, []);
        byString.get(s).push(pair);
    }
    for (const [string, group] of byString) {
        if (group.length !== 2) continue;
        group.sort((a, b) => a[0].position - b[0].position);
        const [[srcEvt, src], [tgtEvt, tgt]] = group;
        if (srcEvt.position === tgtEvt.position || (tgt.tech !== '/' && tgt.tech !== '\\')) continue;
        if (src.grace || tgt.grace || src.tie || tgt.tie || src.f > 31) continue;
        const between = allEvents.some(e => {
            if (e.track !== tgtEvt.track || !(srcEvt.position < e.position && e.position < tgtEvt.position)) return false;
            const r = decodeStringFret(e);
            return !!r && r[0] === string;
        });
        if (between) continue;
        tgt.grace = { f: src.f, kind: 'slide' };
        tgt.tech = null;
        notes.splice(notes.indexOf(src), 1);
    }
}

/** Serialize the working doc to the canonical OTF dict (== OTFDocument.to_dict()),
 *  applying the same omit-when-falsy rules on note fields and optional metadata. */
export function toOtfDict(doc) {
    const metadata = {
        title: doc.metadata.title,
        time_signature: doc.metadata.time_signature,
        tempo: doc.metadata.tempo,
    };
    if (doc._tsChanges && doc._tsChanges.length) metadata.time_signature_changes = doc._tsChanges;
    if (doc.metadata.composer) metadata.composer = doc.metadata.composer;
    if (doc.metadata.key) metadata.key = doc.metadata.key;
    if (doc.metadata.tab_by) metadata.tab_by = { ...doc.metadata.tab_by };

    const result = {
        otf_version: doc.otf_version,
        metadata,
        timing: { ticks_per_beat: doc.timing.ticks_per_beat },
        tracks: doc.tracks.map(t => {
            const out = {
                id: t.id, instrument: t.instrument, tuning: t.tuning,
                capo: t.capo, role: t.role,
            };
            // Emitted only for drum tracks, so pitched tabs stay byte-identical
            if (t.percussion) { out.percussion = true; out.lines = t.lines; }
            if (t.dyn) out.dyn = t.dyn;
            return out;
        }),
        notation: {},
    };
    for (const [trackId, measures] of Object.entries(doc.notation)) {
        result.notation[trackId] = measures.map(m => ({
            measure: m.measure,
            events: m.events.map(e => ({
                tick: e.tick,
                notes: e.notes.map(n => {
                    const out = { s: n.s, f: n.f };
                    if (n.tech) out.tech = n.tech;
                    if (n.finger) out.finger = n.finger;
                    if (n.lh !== null && n.lh !== undefined) out.lh = n.lh;
                    if (n.dur) out.dur = n.dur;
                    if (n.tie) out.tie = true;
                    if (n.fx) out.fx = [...n.fx];
                    if (n.grace) out.grace = { ...n.grace };
                    if (n.dyn) out.dyn = n.dyn;
                    return out;
                }),
            })),
        }));
    }
    if (doc.annotations && doc.annotations.length) result.annotations = doc.annotations;
    if (doc.reading_list && doc.reading_list.length) result.reading_list = doc.reading_list;
    if (doc.measure_marks && doc.measure_marks.length) result.measure_marks = doc.measure_marks;
    if (doc.chords && doc.chords.length) result.chords = doc.chords;
    if (doc.chord_diagrams && doc.chord_diagrams.length) result.chord_diagrams = doc.chord_diagrams;
    if (doc.skipped && Object.keys(doc.skipped).length) result.x_source = { skipped: { ...doc.skipped } };
    return result;
}
