// TEF -> OTF conversion — JavaScript port of tef_to_otf() and its helpers from
// sources/banjo-hangout/src/tef_parser/otf.py. Emits the OTF *document* shape
// that TabRenderer/TabPlayer consume (the works-view contract). Verified
// byte-exact against the Python converter by the golden-diff gate.

import { decodeDurationCode, isMelody, decodeStringFret } from './reader.js';

const fdiv = (a, b) => Math.floor(a / b);

// --- MIDI pitch names (24..83), matching MIDI_TO_PITCH -----------------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToPitchName(midi) {
    if (midi >= 24 && midi <= 83) {
        return NOTE_NAMES[midi % 12] + String(fdiv(midi, 12) - 1);
    }
    return `MIDI${midi}`;
}

const FINGERING_MAP = { 0x06: 'T', 0x0c: 'I', 0x12: 'M' };

// --- instrument identity -----------------------------------------------------
export function instrumentToOtfId(inst) {
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
export function isTiedNote(e) {
    const r = e.raw;
    if (r && r.length >= 6) {
        if (r.length === 6) return ((r[3] >> 5) & 0x07) === 7;   // V2 dynamic-7 sentinel
        return !!(r[5] & 0x80);                                   // V3 tie flag
    }
    return false;
}

/** V2 techniques: effect1 (byte 4) is an enum on the SOURCE note, attributed to
 *  the destination (next note, same track+string). Port of compute_articulations.
 *  Returns Map keyed "track:position:string" -> tech. */
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
            const tech = V2_TECH[e.raw[4] & 0x1f];           // mask off the 0x20 flag bit
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
 *  same track+string, within maxGap slots). Port of compute_articulations_v3. */
export function computeArticulationsV3(noteEvents, maxGap = 8) {
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
    // V2: half a measure in native grid units. V3: 8 slots (compute_articulations_v3).
    return header.isV2 ? fdiv(header.v2_ts_size || 256, 2) : 8;
}

/** Keys "track:position:string" of BEND/CHOKE notes. Port of
 *  bend_destination_keys. The tie bit means "connected to previous"; that's a
 *  tie only when the fret is unchanged. A fret change with no h/p/slide is a
 *  bend/choke → 'b', not a phantom tie. (Corpus-safe: 0 such notes exist in the
 *  corpus; only real bends like "Welcome to New York" m4 are affected. #184.) */
export function bendDestinationKeys(noteEvents, articulations) {
    const byTrackString = new Map();
    for (const e of noteEvents) {
        if (!isMelody(e)) continue;
        const sf = decodeStringFret(e);
        if (!sf) continue;
        const key = e.track + ':' + sf[0];
        if (!byTrackString.has(key)) byTrackString.set(key, []);
        byTrackString.get(key).push({ position: e.position, fret: sf[1], e });
    }
    const keys = new Set();
    for (const notes of byTrackString.values()) {
        notes.sort((a, b) => a.position - b.position);
        for (let i = 0; i < notes.length; i++) {
            const { position, fret, e } = notes[i];
            if (i === 0 || !isTiedNote(e)) continue;
            if (notes[i - 1].fret === fret) continue;              // same fret = tie
            const string = decodeStringFret(e)[0];
            if (articulations.get(e.track + ':' + position + ':' + string) != null) continue;
            keys.add(e.track + ':' + position + ':' + string);
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
    // Bend/choke notes (connect-bit + fret change + no h/p/slide) → 'b', not a tie.
    const bendKeys = bendDestinationKeys(tef.note_events, articulations);

    // ---- group events by track + measure ----
    // V3 position grid: 16 slots/measure. ticks_per_measure uses the header
    // meter (4/4 defaults for V3), matching tef_to_otf.
    const POSITIONS_PER_MEASURE = 16;
    const beatsPerMeasure = header.v2_time_num;
    const denom = header.v2_time_denom || 4;
    const ticksPerMeasure = fdiv(beatsPerMeasure * 480 * 4, denom);
    const TICKS_PER_POSITION = fdiv(ticksPerMeasure, POSITIONS_PER_MEASURE);
    const unitsPerMeasure = isV2 ? (header.v2_ts_size || 256) : POSITIONS_PER_MEASURE;
    const trackEvents = new Map();   // trackId -> Map(measure -> [{tick, evt}])

    for (const event of tef.note_events) {
        if (!isMelody(event)) continue;
        const trackId = event.track < tracks.length ? tracks[event.track].id : 'unknown';
        if (!trackEvents.has(trackId)) trackEvents.set(trackId, new Map());

        const measure = fdiv(event.position, unitsPerMeasure) + 1;
        const positionInMeasure = event.position % unitsPerMeasure;
        let tick = isV2 ? fdiv(positionInMeasure * 15, 2) : positionInMeasure * TICKS_PER_POSITION;

        // V2 triplet timing: duration code % 3 == 2 (3:2).
        if (isV2 && event.raw && event.raw.length >= 4 && (event.raw[3] & 0x1f) % 3 === 2) {
            const code = event.raw[3] & 0x1f;
            const span = 2 * (1920 >> fdiv(code, 3));
            const inSpan = tick % span;
            tick = tick - inSpan + fdiv(inSpan * 4, 3);
        }

        const measures = trackEvents.get(trackId);
        if (!measures.has(measure)) measures.set(measure, []);
        measures.get(measure).push({ tick, evt: event });
    }

    // V3-only: K-marker triplet group heuristic (groups of 3 consecutive 'K'
    // notes within 2 positions retimed to 160-tick spacing). Skipped for V2,
    // which handles triplets per-note above. Port of the tef_to_otf block.
    if (!isV2) {
        const TRIPLET_SPACING = fdiv(480, 3);   // 160
        for (const measures of trackEvents.values()) {
            for (const events of measures.values()) {
                const triplets = events
                    .filter(x => x.evt.marker === 'K')
                    .sort((a, b) => a.tick - b.tick);
                if (triplets.length >= 3) {
                    let i = 0;
                    while (i <= triplets.length - 3) {
                        const [a, b, c] = [triplets[i], triplets[i + 1], triplets[i + 2]];
                        if (b.evt.position - a.evt.position <= 2 && c.evt.position - b.evt.position <= 2) {
                            const base = a.tick;
                            const newTicks = [base, base + TRIPLET_SPACING, base + 2 * TRIPLET_SPACING];
                            [a, b, c].forEach((grp, j) => {
                                const k = events.findIndex(x => x.evt === grp.evt);
                                if (k >= 0) events[k].tick = newTicks[j];
                            });
                            i += 3;
                        } else {
                            i += 1;
                        }
                    }
                }
            }
        }
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
                for (const evt of byTick.get(tick)) {
                    const r = decodeStringFret(evt);
                    if (!r) continue;
                    const [string, fret] = r;
                    let tech = articulations.get(evt.track + ':' + evt.position + ':' + string) ?? null;
                    // technique_from_event is a retired no-op (returns null).
                    if (evt.raw && evt.raw.length >= 12 && evt.raw[6] === 0x0f) tech = 'x';
                    let tie = isTiedNote(evt);
                    // ...unless it's a bend/choke (connect bit but a fret change,
                    // no h/p/slide): render 'b', not a tie.
                    if (bendKeys.has(evt.track + ':' + evt.position + ':' + string)) {
                        tie = false;
                        tech = 'b';
                    }
                    let finger = null;
                    if (evt.raw && evt.raw.length > 5) {
                        const fretByte = evt.raw[2];
                        const effect2 = evt.raw[5];
                        if (((fretByte >> 5) & 0x01) && FINGERING_MAP[effect2]) {
                            finger = FINGERING_MAP[effect2];
                        }
                    }
                    notes.push({ s: string, f: fret, tech, finger, tie, dur: evt.durationTicks });
                }
                if (notes.length) outEvents.push({ tick, notes });
            }
            if (outEvents.length) outMeasures.push({ measure: measureNum, events: outEvents });
        }
        notation[trackId] = outMeasures;
    }

    const doc = {
        otf_version: '1.0',
        metadata, timing: { ticks_per_beat: 480 },
        tracks, notation,
        reading_list: tef.reading_list.map(e => ({
            from_measure: e.from_measure, to_measure: e.to_measure,
        })),
        _tsChanges: tsChanges,
    };

    normalizeSlideTiming(doc);
    return doc;
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

    const result = {
        otf_version: doc.otf_version,
        metadata,
        timing: { ticks_per_beat: doc.timing.ticks_per_beat },
        tracks: doc.tracks.map(t => ({
            id: t.id, instrument: t.instrument, tuning: t.tuning, capo: t.capo, role: t.role,
        })),
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
                    if (n.dur) out.dur = n.dur;
                    if (n.tie) out.tie = true;
                    return out;
                }),
            })),
        }));
    }
    if (doc.reading_list && doc.reading_list.length) result.reading_list = doc.reading_list;
    return result;
}
