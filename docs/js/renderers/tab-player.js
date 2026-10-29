// Tablature Audio Player using WebAudioFont
// Extracted from TablEdit_Reverse viewer for Bluegrass Songbook

import {
    TimelineTiming,
    readingListTimeline,
    expandNotation,
    buildMetronomeSchedule,
    maxMeasureIn,
    measureTimingFromOtf,
} from './measure-timing.js';
import { pitchedTracks } from './otf-tracks.js';
import { unlockAudioContext } from '../audio-unlock.js';

// Pitch name to MIDI mapping
const PITCH_TO_MIDI = {};
['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach((note, i) => {
    for (let oct = 0; oct <= 8; oct++) {
        PITCH_TO_MIDI[`${note}${oct}`] = 12 + oct * 12 + i;
    }
});

// WebAudioFont instrument configuration
const INSTRUMENTS = {
    banjo: { var: '_tone_1050_FluidR3_GM_sf2_file', name: 'Banjo' },
    guitar: { var: '_tone_0251_GeneralUserGS_sf2_file', name: 'Acoustic Guitar' },
    bass: { var: '_tone_0320_GeneralUserGS_sf2_file', name: 'Acoustic Bass' },
    violin: { var: '_tone_0400_GeneralUserGS_sf2_file', name: 'Violin' },
    // 0260 is the JAZZ ELECTRIC guitar (GM program 26) — Mike caught the
    // mandolin chops sounding 'like an electric guitar'. GM has no true
    // mandolin; the acoustic-steel 0253 is the closest plucky patch.
    mandolin: { var: '_tone_0253_GeneralUserGS_sf2_file', name: 'Acoustic Steel (mandolin)' },
    dobro: { var: '_tone_0253_GeneralUserGS_sf2_file', name: 'Acoustic Steel (dobro)' },
};

// CDN URLs for WebAudioFont resources
const WEBAUDIOFONT_URLS = {
    player: 'https://surikov.github.io/webaudiofont/npm/dist/WebAudioFontPlayer.js',
    instruments: {
        banjo: 'https://surikov.github.io/webaudiofontdata/sound/1050_FluidR3_GM_sf2_file.js',
        guitar: 'https://surikov.github.io/webaudiofontdata/sound/0251_GeneralUserGS_sf2_file.js',
        bass: 'https://surikov.github.io/webaudiofontdata/sound/0320_GeneralUserGS_sf2_file.js',
        violin: 'https://surikov.github.io/webaudiofontdata/sound/0400_GeneralUserGS_sf2_file.js',
        mandolin: 'https://surikov.github.io/webaudiofontdata/sound/0253_GeneralUserGS_sf2_file.js',
    }
};

/**
 * Map OTF instrument types to our instrument keys
 */
export function getInstrumentKey(instrumentType) {
    if (!instrumentType) return 'guitar';
    const t = instrumentType.toLowerCase();
    if (t.includes('banjo')) return 'banjo';
    if (t.includes('mandolin')) return 'mandolin';
    if (t.includes('bass')) return 'bass';
    if (t.includes('fiddle') || t.includes('violin')) return 'violin';
    if (t.includes('dobro') || t.includes('resonator')) return 'dobro';
    return 'guitar';
}

// How long to wait for a soundfont's buffers to decode before calling it a
// failure. Slow phones on hotel wifi need room; forever is not an option.
const DECODE_TIMEOUT_MS = 15000;

// One promise per URL. The tag-exists check alone is NOT enough: a second
// caller arriving between "tag inserted" and "script executed" used to
// resolve immediately and then read an undefined global — `new
// window.WebAudioFontPlayer()` throwing, or an instrument silently skipped.
// That window is real now that the editor warms soundfonts in the
// background while Play may be pressed at any moment.
const scriptLoads = new Map();

/**
 * Load a script dynamically (deduped: concurrent callers share one load)
 */
function loadScript(url) {
    const pending = scriptLoads.get(url);
    if (pending) return pending;

    const promise = new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();   // inserted by someone else (or a previous page state)
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => {
            scriptLoads.delete(url);   // a failed load may be retried
            reject(new Error(`Could not load ${url}`));
        };
        document.head.appendChild(script);
    });
    scriptLoads.set(url, promise);
    return promise;
}

/**
 * Extend note durations across tie chains: a tie continuation never
 * re-attacks, but the SOURCE note must ring through it. Pure.
 *
 * @param {Array} trackNotes - collected notes (absTick, string, ...)
 * @param {Array} ties - skipped tie continuations [{absTick, string, durTicks}]
 * @returns {void} mutates trackNotes' explicitEndTick
 */
export function applyTieExtensions(trackNotes, ties) {
    for (const tie of ties) {
        let source = null;
        for (const n of trackNotes) {
            if (n.string === tie.string && n.absTick < tie.absTick
                && (!source || n.absTick > source.absTick)) {
                source = n;
            }
        }
        if (!source) continue;
        const end = tie.absTick + (tie.durTicks || 0);
        source.explicitEndTick = Math.max(source.explicitEndTick || 0, end);
    }
}

/**
 * Audible duration for one scheduled note. Explicit durations
 * (editor-entered notes, tie chains) are honored — only a new attack
 * on the SAME string cuts them short. Ring-model notes (parsed tabs
 * without durations) keep the legacy behavior: cut at the next event
 * on ANY track, capped by the mixer decay. Pure.
 *
 * @param {Object} note - {explicitDurSec?, decay, sustain}
 * @param {number} stringGap - seconds to the next attack on this string
 * @param {number} rhythmicGap - seconds to the next event on any track
 */
/**
 * Pitch-glide waypoints for a slide, in WebAudioFont's `slides` format
 * (array of {delta: semitones from the note's start pitch, when: seconds from
 * the note's start}). One pick: the source note holds its start pitch, then
 * bends by `deltaSemitones` into the target, reaching it at `holdSec` (the
 * target's onset). The note then rings at target pitch for the rest of its
 * (already-extended) duration. Pure.
 *
 * @param {number} deltaSemitones - target midi - source midi (e.g. 5->8 = +3)
 * @param {number} holdSec - seconds from note start to the target onset
 * @param {number} noteDurSec - the source note's total (extended) duration
 */
export function slideWaypoints(deltaSemitones, holdSec, noteDurSec) {
    // A slide is a QUICK finger-travel (unlike a slow, expressive bend): keep
    // the pitch move short and snappy — the source dwells at pitch, then darts
    // up into the target. ~45ms reads as a slide; longer drifts toward a bend.
    const GLIDE_SEC = 0.045;
    const glideSec = Math.min(GLIDE_SEC, noteDurSec * 0.3, holdSec > 0 ? holdSec : GLIDE_SEC);
    return [
        { delta: 0, when: Math.max(0, holdSec - glideSec) },
        { delta: deltaSemitones, when: holdSec },
    ];
}

const LEGATO_TECHS = new Set(['h', 'p', '/', '\\']);
const GLIDE_TECHS = new Set(['/', '\\']);

/**
 * Fold a legato target into the note it continues: a hammer-on, pull-off or
 * slide is ONE pick, so the target is not attacked; the preceding note on
 * its string rings on and steps (h/p) or glides (slide) to the target pitch
 * at the target's onset. Chains (0h2p0) keep extending the same source.
 * Returns true when the note was absorbed. Before fix-it A15 only slides did
 * this; h/p targets were re-picked at full volume.
 */
export function absorbLegato(lastByString, note, midi, absTick) {
    if (!LEGATO_TECHS.has(note.tech)) return false;
    const source = lastByString[note.s];
    if (!source) return false;
    source.explicitEndTick = absTick + (note.dur || 0);
    (source.legs ||= []).push({ toMidi: midi, atTick: absTick, glide: GLIDE_TECHS.has(note.tech) });
    return true;
}

/**
 * Pitch waypoints (WebAudioFont `slides`) for a source note and its legato
 * legs: hold, then a near-instant step (hammer/pull) or a ~45ms glide
 * (slide, as slideWaypoints) into each target, relative to the source
 * pitch. `legs[].atSec` is seconds from the note start. Pure.
 */
export function legatoWaypoints(sourceMidi, legs, noteDurSec) {
    const STEP_SEC = 0.008;
    const GLIDE_SEC = 0.045;
    const wp = [];
    let prev = 0;
    for (const leg of legs) {
        const move = Math.min(leg.glide ? GLIDE_SEC : STEP_SEC, noteDurSec * 0.3,
            leg.atSec > 0 ? leg.atSec : GLIDE_SEC);
        wp.push({ delta: prev, when: Math.max(0, leg.atSec - move) });
        prev = leg.toMidi - sourceMidi;
        wp.push({ delta: prev, when: leg.atSec });
    }
    return wp;
}

// A bend/choke (OTF tech "b") rises a QUARTER TONE above the fretted note.
// Banjo chokes typically bend a half step to a full step; a quarter tone is a
// subtle, expressive micro-bend. Adjust here to taste.
export const BEND_SEMITONES = 0.5;   // 0.5 semitone = a quarter tone

/**
 * Pitch-glide waypoints for a bend/choke, in WebAudioFont's `slides` format.
 * Unlike a slide (a quick finger-dart), a choke is a slow, expressive rise: the
 * note attacks at pitch, then bends up by `semitones` over the first part of its
 * duration and holds. Pure.
 */
export function bendWaypoints(semitones, noteDurSec) {
    const riseSec = Math.min(Math.max(noteDurSec * 0.5, 0.06), 0.18);
    return [
        { delta: 0, when: 0 },
        { delta: semitones, when: riseSec },
    ];
}

// ---------------------------------------------------------------------------
// TablEdit note effects (`note.fx`) and grace notes (`note.grace`), fix-it A15.
// The format is docs/schema/otf.md. Every helper
// below is pure; play() only collects, calls them, and queues the result.
// ---------------------------------------------------------------------------

// brush: a strummed chord. The stroke crosses the strings low (highest s) to
// high: ~15ms a string, never more than ~70ms for the whole chord.
export const BRUSH_STEP_SEC = 0.015;
export const BRUSH_MAX_SEC = 0.07;
// roll: an arpeggiated chord — audibly one string at a time.
export const ROLL_STEP_SEC = 0.05;
export const ROLL_MAX_SEC = 0.25;
// staccato: TablEdit halves the playback duration.
export const STACCATO_FACTOR = 0.5;
// ghost: a barely-there note.
export const GHOST_GAIN = 0.4;
// let-ring: ring until the next note on the same string, but not forever.
export const LET_RING_MAX_SEC = 4;
// muted (palm mute): pitched, damped, a little softer. Not tech 'x' (the
// pitchless dead-note chop, 0.09s at 0.55x).
export const MUTED_SEC = 0.13;
export const MUTED_GAIN = 0.7;
// choke: attack, bend up a semitone quickly, then stopped.
export const CHOKE_SEMITONES = 1;
export const CHOKE_RISE_SEC = 0.08;
export const CHOKE_MAX_SEC = 0.3;
// harmonics: a touch softer, and they ring a little longer.
export const HARMONIC_GAIN = 0.85;
export const HARMONIC_RING_FACTOR = 1.5;
// slap: slightly accented.
export const SLAP_GAIN = 1.15;
// vibrato: ±a quarter semitone at ~5.5 Hz.
export const VIBRATO_DEPTH = 0.25;
export const VIBRATO_HZ = 5.5;
// bend-release: a whole step up and back.
export const BEND_RELEASE_SEMITONES = 2;
// tremolo: re-picked every 1/32 note; the repeats slightly quieter.
export const TREMOLO_REPEAT_GAIN = 0.8;
const TREMOLO_MAX_ATTACKS = 128;
// grace: sounds a 1/32 note (or this, if shorter) before the main note.
export const GRACE_MAX_LEAD_SEC = 0.045;
export const GRACE_GAIN = 0.8;
const LEGATO_GRACE_KINDS = new Set(['hp', 'slide']);

// Natural harmonic nodes: fret -> semitones above the OPEN string.
const HARMONIC_NODES = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28, 3: 31 };

const hasFx = (fx, name) => !!fx && fx.includes(name);

/**
 * Sounding pitch of a natural harmonic touched at `fret`. Off the nodes it
 * falls back to the fretted pitch an octave up. Pure.
 */
export function harmonicPitch(openMidi, fret) {
    const node = HARMONIC_NODES[fret];
    return openMidi + (node ?? fret + 12);
}

/**
 * The pitch a note sounds: fretted, or its harmonic (`harmonic` from the
 * node table; `artificial-harmonic` is the fretted pitch +12). Pure.
 */
export function soundingMidi(openMidi, fret, fx) {
    if (hasFx(fx, 'harmonic')) return harmonicPitch(openMidi, fret);
    if (hasFx(fx, 'artificial-harmonic')) return openMidi + fret + 12;
    return openMidi + fret;
}

/** Vibrato waypoints (WebAudioFont `slides`): a ±VIBRATO_DEPTH triangle at
 *  VIBRATO_HZ through the whole note. Pure. */
export function vibratoWaypoints(noteDurSec) {
    const quarter = 1 / VIBRATO_HZ / 4;
    const shape = [0, VIBRATO_DEPTH, 0, -VIBRATO_DEPTH];
    const wp = [];
    for (let k = 0; k * quarter <= noteDurSec; k++) {
        wp.push({ delta: shape[k % 4], when: k * quarter });
    }
    return wp;
}

/** Bend-release: up a whole step over the first third, hold, back down over
 *  the last third. Pure. */
export function bendReleaseWaypoints(noteDurSec) {
    return [
        { delta: 0, when: 0 },
        { delta: BEND_RELEASE_SEMITONES, when: noteDurSec / 3 },
        { delta: BEND_RELEASE_SEMITONES, when: noteDurSec * 2 / 3 },
        { delta: 0, when: noteDurSec },
    ];
}

/** Choke: a quick semitone bend (the stop is the shortened duration). Pure. */
export function chokeWaypoints(noteDurSec) {
    return [
        { delta: 0, when: 0 },
        { delta: CHOKE_SEMITONES, when: Math.min(CHOKE_RISE_SEC, noteDurSec * 0.4) },
    ];
}

/**
 * Attack offsets (seconds) for a strummed chord column, by string: the stroke
 * starts on the lowest string (highest s) AT the written tick and crosses to
 * the highest. `kind` is 'brush' or 'roll'. Pure.
 */
export function strumOffsets(strings, kind) {
    const order = [...new Set(strings)].sort((a, b) => b - a);
    const [step, max] = kind === 'roll'
        ? [ROLL_STEP_SEC, ROLL_MAX_SEC] : [BRUSH_STEP_SEC, BRUSH_MAX_SEC];
    const gap = order.length > 1 ? Math.min(step, max / (order.length - 1)) : 0;
    const out = {};
    order.forEach((s, i) => { out[s] = i * gap; });
    return out;
}

/**
 * Tremolo: one attack every `stepSec` across the note; repeats a little
 * quieter, the last one trimmed to the note's end. Pure.
 */
export function tremoloAttacks(noteDurSec, stepSec) {
    const out = [];
    for (let k = 0; k < TREMOLO_MAX_ATTACKS; k++) {
        const offset = k * stepSec;
        if (offset >= noteDurSec - 1e-9) break;
        out.push({
            offset,
            duration: Math.min(stepSec, noteDurSec - offset),
            gain: k === 0 ? 1 : TREMOLO_REPEAT_GAIN,
        });
    }
    return out;
}

/** How far ahead of its main note a grace note sounds: a 1/32 note, or
 *  GRACE_MAX_LEAD_SEC if that is shorter. Pure. */
export function graceLeadSeconds(secondsPerTick, ticksPerBeat) {
    return Math.min(ticksPerBeat / 8 * secondsPerTick, GRACE_MAX_LEAD_SEC);
}

/**
 * Apply the duration/volume fx to a note whose ring-model or explicit
 * duration is already computed. Order matters and is deliberate: let-ring
 * sets the length first, so a damping effect (muted, staccato, choke) still
 * wins over it, and the gains multiply. Notes without fx pass through. Pure.
 *
 * @param {string[]|undefined} fx
 * @param {{duration:number, volume:number, stringGap:number, sustain:number}} n
 *   stringGap = seconds to the next attack on this string (Infinity if none)
 */
export function fxDurationVolume(fx, { duration, volume, stringGap, sustain }) {
    if (!fx || fx.length === 0) return { duration, volume };
    if (hasFx(fx, 'let-ring')) {
        duration = Math.min(stringGap, LET_RING_MAX_SEC) * sustain;
    } else if (hasFx(fx, 'harmonic') || hasFx(fx, 'artificial-harmonic')) {
        duration = Math.min(duration * HARMONIC_RING_FACTOR, stringGap);
    }
    if (hasFx(fx, 'harmonic') || hasFx(fx, 'artificial-harmonic')) volume *= HARMONIC_GAIN;
    if (hasFx(fx, 'muted')) {
        duration = Math.min(duration, MUTED_SEC);
        volume *= MUTED_GAIN;
    }
    if (hasFx(fx, 'choke')) duration = Math.min(duration, CHOKE_MAX_SEC);
    if (hasFx(fx, 'staccato')) duration *= STACCATO_FACTOR;
    if (hasFx(fx, 'ghost')) volume *= GHOST_GAIN;
    if (hasFx(fx, 'slap')) volume *= SLAP_GAIN;
    return { duration, volume };
}

/**
 * Brush/roll: give every strummed note in a chord column (same track, same
 * tick) its stroke offset, shortening it by that much so it still stops where
 * it would have (a re-attack on its string). Mutates `notes`; returns nothing.
 */
export function applyStrumOffsets(notes) {
    const columns = new Map();
    for (const n of notes) {
        if (!hasFx(n.fx, 'brush') && !hasFx(n.fx, 'roll')) continue;
        const key = `${n.trackId}@${n.absTick}`;
        if (!columns.has(key)) columns.set(key, []);
        columns.get(key).push(n);
    }
    for (const col of columns.values()) {
        const kind = col.some(n => hasFx(n.fx, 'roll')) ? 'roll' : 'brush';
        const off = strumOffsets(col.map(n => n.string), kind);
        for (const n of col) {
            const o = off[n.string];
            if (!o) continue;
            n.strumOffsetSec = o;
            n.duration = Math.max(0.03, n.duration - o);
        }
    }
}

/** Pitch waypoints for a single picked note (no grace): legato legs win,
 *  then bend-release, choke, the tech-b bend, vibrato. Pure. */
function pitchWaypoints(note, secondsPerTick) {
    if (note.legs) {
        return legatoWaypoints(note.midi, legSeconds(note, secondsPerTick, 0), note.duration);
    }
    if (hasFx(note.fx, 'bend-release')) return bendReleaseWaypoints(note.duration);
    if (hasFx(note.fx, 'choke')) return chokeWaypoints(note.duration);
    // Choke (tech b): the note attacks, then its pitch bends up a quarter tone.
    if (note.bend) return bendWaypoints(BEND_SEMITONES, note.duration);
    if (hasFx(note.fx, 'vibrato')) return vibratoWaypoints(note.duration);
    return undefined;
}

function legSeconds(note, secondsPerTick, offsetSec) {
    return (note.legs || []).map(leg => ({
        ...leg,
        atSec: Math.max(0, (leg.atTick - note.absTick) * secondsPerTick) + offsetSec,
    }));
}

/**
 * Everything one scheduled note actually sounds, as attacks relative to the
 * note's written onset: [{offset (s), midi, duration, volume, slides}].
 * A plain note is exactly one attack at offset 0 with its legato/bend
 * waypoints — what play() queued before fx existed. Pure.
 *
 * - strumOffsetSec (brush/roll) shifts every attack
 * - tremolo re-picks every 1/32 (`thirtySecondSec`)
 * - grace kind 'hp'/'slide': ONE pick from the grace pitch, stepping or
 *   gliding into the main pitch at the main onset (the main note is not
 *   attacked again); any other kind (or none): a short separate attack
 *
 * @param {Object} note - scheduled note (midi, duration, volume, absTick,
 *   fx?, legs?, bend?, grace? {midi, kind?}, strumOffsetSec?)
 * @param {{secondsPerTick:number, thirtySecondSec:number}} o
 */
export function noteAttacks(note, { secondsPerTick, thirtySecondSec }) {
    const base = note.strumOffsetSec || 0;
    const attacks = [];
    const tremolo = hasFx(note.fx, 'tremolo');
    const grace = note.grace;
    const lead = grace ? Math.min(thirtySecondSec, GRACE_MAX_LEAD_SEC) : 0;
    const legatoGrace = grace && LEGATO_GRACE_KINDS.has(grace.kind) && !tremolo;

    if (grace && legatoGrace) {
        const duration = note.duration + lead;
        const legs = [{ toMidi: note.midi, atSec: lead, glide: grace.kind === 'slide' },
            ...legSeconds(note, secondsPerTick, lead)];
        attacks.push({
            offset: base - lead, midi: grace.midi, duration, volume: note.volume,
            slides: legatoWaypoints(grace.midi, legs, duration),
        });
        return attacks;
    }
    if (grace) {
        attacks.push({ offset: base - lead, midi: grace.midi, duration: lead,
            volume: note.volume * GRACE_GAIN, slides: undefined });
    }
    if (tremolo) {
        for (const t of tremoloAttacks(note.duration, thirtySecondSec)) {
            attacks.push({ offset: base + t.offset, midi: note.midi, duration: t.duration,
                volume: note.volume * t.gain, slides: undefined });
        }
        return attacks;
    }
    attacks.push({ offset: base, midi: note.midi, duration: note.duration,
        volume: note.volume, slides: pitchWaypoints(note, secondsPerTick) });
    return attacks;
}

export function effectiveDurationSeconds(note, stringGap, rhythmicGap) {
    let duration;
    if (note.explicitDurSec != null) {
        duration = Math.min(note.explicitDurSec, stringGap);
    } else {
        duration = Math.min(stringGap, rhythmicGap) * 0.95;
        duration = Math.min(duration, note.decay);
    }
    duration = Math.max(duration, 0.03);
    return duration * note.sustain;
}

/**
 * Clip a schedule to a tick range and rebase times so the range starts
 * at t=0. Pure — this is the heart of play-from-cursor / loop-a-phrase.
 *
 * @param {Array} items - scheduled items with a tick field and {time} seconds
 * @param {Object} o
 * @param {number} o.startTick - inclusive range start (absolute ticks)
 * @param {number} o.endTick - exclusive range end (absolute ticks)
 * @param {number} o.secondsPerTick
 * @param {string} [o.tickKey='absTick'] - which field holds the tick
 * @returns {Array} filtered copies with rebased time
 */
export function clipScheduleToRange(items, {
    startTick = 0,
    endTick = Infinity,
    secondsPerTick,
    tickKey = 'absTick',
} = {}) {
    const offset = startTick * secondsPerTick;
    return items
        .filter(it => it[tickKey] >= startTick && it[tickKey] < endTick)
        .map(it => ({ ...it, time: it.time - offset }));
}

/**
 * TabPlayer - WebAudioFont-based playback for OTF tablature
 */
export class TabPlayer {
    constructor() {
        this.audioContext = null;
        this.player = null;
        this.isPlaying = false;
        this.scheduledNodes = [];
        this.playbackStartTime = 0;
        this.animationFrame = null;
        this.onPositionUpdate = null;
        this.onPlaybackEnd = null;
        this.loop = false;

        // Mixer settings per track
        this.mixerSettings = {};
        this.DEFAULT_MIXER = { volume: 0.7, sustain: 1.0, decay: 1.5 };

        // Playback visualization callbacks
        this.onNoteStart = null;      // (absTick) => void - called when note starts
        this.onNoteEnd = null;        // (absTick) => void - called when note ends
        this.onBeat = null;           // (absTick) => void - called on each beat
        this.onTick = null;           // (absTick) => void - called on animation frame

        // Metronome state
        this._metronomeEnabled = false;
        this.metronomeVolume = 0.3;
        this.metronomeNodes = [];  // Track oscillators for cleanup on stop
        this.metronomeGain = null; // Master gain: lets the toggle work LIVE

        // How long play() waits for a resumed context to actually reach
        // 'running' before giving up (tests shorten this).
        this.resumeGraceMs = 1000;
    }

    /**
     * Metronome toggle. Clicks are always scheduled (at play start) through
     * a master gain node, so flipping this during playback takes effect
     * immediately instead of doing nothing until the next Play.
     */
    get metronomeEnabled() {
        return this._metronomeEnabled;
    }

    set metronomeEnabled(v) {
        this._metronomeEnabled = !!v;
        if (this.metronomeGain) {
            this.metronomeGain.gain.value = this._metronomeEnabled ? 1 : 0;
        }
    }

    /**
     * SYNCHRONOUS audio unlock — call this as the FIRST statement of any
     * user-gesture handler that can lead to playback. iOS WebKit grants Web
     * Audio only transient user activation, so a context created (or resumed)
     * after an await never leaves 'suspended': its clock stays frozen, every
     * note is scheduled into a time that never arrives, and playback is
     * silent. Nothing here may await (see audio-unlock.js).
     *
     * @returns {AudioContext|null} null when the browser has no Web Audio
     */
    unlockAudio() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!this.audioContext) this.audioContext = new Ctx();
        return unlockAudioContext(this.audioContext);
    }

    /**
     * Initialize audio context and load WebAudioFont.
     *
     * Concurrency-safe: the editor warms soundfonts for note-entry feedback
     * in the background while Play may be pressed at any moment, and two
     * inits racing would build two WebAudioFontPlayers and two metronome
     * buses (the second orphaning the first mid-tune).
     *
     * @returns {Promise<void>}
     */
    init() {
        if (this.player) return Promise.resolve();
        if (!this._initPromise) {
            this._initPromise = this._initOnce().catch(err => {
                this._initPromise = null;   // a failed init may be retried
                throw err;
            });
        }
        return this._initPromise;
    }

    async _initOnce() {
        if (this.player) return;

        // Context FIRST, synchronously: unlockAudio() has normally already
        // made it inside the tap, but a caller that skipped the gesture hook
        // still must not construct it after the CDN await below.
        if (!this.unlockAudio()) {
            throw new Error('This browser has no Web Audio support.');
        }

        // Load WebAudioFont player
        await loadScript(WEBAUDIOFONT_URLS.player);

        this.player = new window.WebAudioFontPlayer();

        // Master metronome gain — clicks route through this so the
        // metronome toggle works during playback.
        this.metronomeGain = this.audioContext.createGain();
        this.metronomeGain.gain.value = this._metronomeEnabled ? 1 : 0;
        this.metronomeGain.connect(this.audioContext.destination);
    }

    /**
     * Wait (briefly) for the context to actually be running, resuming it once
     * more if needed. iOS ignores a resume() whose gesture activation was
     * already spent, so this is where a blocked context is caught.
     * @throws {Error} when the context stays suspended past the grace window
     */
    async _awaitRunningContext() {
        const ctx = this.audioContext;
        if (ctx.state !== 'running') {
            // 'suspended' or Safari's 'interrupted' (route change, phone
            // call) — both clear via resume()
            try { await ctx.resume(); } catch (e) { /* reported below */ }
        }
        const deadline = Date.now() + this.resumeGraceMs;
        while (ctx.state !== 'running' && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (ctx.state !== 'running') {
            throw new Error('Sound is blocked by this browser — tap Play again.');
        }
    }

    /**
     * Create a pleasant metronome click sound
     * Uses a short sine wave with quick decay for a wood block-like sound
     */
    playMetronomeClick(time, isDownbeat = false, force = false) {
        // Always schedule; audibility is controlled live by metronomeGain.
        if (!this.audioContext) return;

        const ctx = this.audioContext;

        // Use higher pitch and slightly louder for downbeat
        const freq = isDownbeat ? 1200 : 900;
        const volume = this.metronomeVolume * (isDownbeat ? 1.0 : 0.7);

        // Create oscillator for the click
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        // Create gain for envelope
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        // Connect and schedule
        osc.connect(gain);
        gain.connect(force ? ctx.destination : (this.metronomeGain || ctx.destination));
        osc.start(time);
        osc.stop(time + 0.05);

        // Track for cleanup on stop
        this.metronomeNodes.push({ osc, gain });
    }

    /**
     * Load instruments needed for a set of tracks
     */
    async loadInstruments(tracks) {
        const instrumentsNeeded = new Set();
        for (const track of tracks) {
            instrumentsNeeded.add(getInstrumentKey(track.instrument));
        }

        for (const instKey of instrumentsNeeded) {
            // Load instrument script if not already loaded
            const url = WEBAUDIOFONT_URLS.instruments[instKey];
            if (url) {
                await loadScript(url);
            }

            // Decode instrument
            const instConfig = INSTRUMENTS[instKey];
            const instrumentData = window[instConfig.var];
            if (!instrumentData) continue;

            // BOUNDED: an undecodable soundfont used to poll forever, which
            // showed up as a Pause button that never advanced and no error.
            await new Promise((resolve, reject) => {
                this.player.adjustPreset(this.audioContext, instrumentData);
                const deadline = Date.now() + DECODE_TIMEOUT_MS;
                const checkDecoded = () => {
                    const allDecoded = instrumentData.zones.every(zone => zone.buffer);
                    if (allDecoded) {
                        resolve();
                    } else if (Date.now() >= deadline) {
                        reject(new Error(
                            `Timed out decoding the ${instConfig.name} sound.`));
                    } else {
                        setTimeout(checkDecoded, 50);
                    }
                };
                checkDecoded();
            });
        }
    }

    /**
     * Toggle a track's audio LIVE (mid-playback). Short ramp avoids
     * clicks. No-op when that track has no bus (not playing).
     */
    setTrackEnabled(trackId, enabled) {
        const g = this.trackGains?.[trackId];
        if (!g || !this.audioContext) return;
        const t = this.audioContext.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(enabled ? 1 : 0, t + 0.02);
    }

    /**
     * Set mixer settings for a track
     */
    setMixerSettings(trackId, settings) {
        this.mixerSettings[trackId] = { ...this.DEFAULT_MIXER, ...settings };
    }

    /**
     * Get mixer settings for a track
     */
    getMixerSettings(trackId) {
        if (!this.mixerSettings[trackId]) {
            this.mixerSettings[trackId] = { ...this.DEFAULT_MIXER };
        }
        return this.mixerSettings[trackId];
    }

    /**
     * Play OTF data
     * @param {Object} otfData - The OTF document
     * @param {Object} options - Playback options
     * @param {string[]} options.trackIds - Which tracks to play (default: all)
     * @param {number} options.tempo - BPM override
     * @param {number} options.transpose - Semitones to transpose (capo simulation)
     * @param {boolean} options.loop - Loop playback
     * @param {number} options.startTick - play from this absolute tick (default 0)
     * @param {number} options.endTick - stop at this absolute tick, exclusive
     *   (default: end of tune). With loop, the range repeats.
     */
    async play(otfData, options = {}) {
        // GENERATION GUARD: play() awaits (init, resume, instrument
        // loads) — un-debounced rapid calls used to interleave and
        // schedule two overlapping performances ('the parts don't all
        // start from the same spot'). Only the newest call survives
        // its awaits.
        // stop() FIRST, unconditionally, then claim the generation:
        // stop() bumps _playGen (invalidating older in-flight plays)
        // and clears a pending loop-restart timer — which exists while
        // isPlaying is false during the loop-wrap gap, so a play()
        // started in that window used to get hijacked 100ms later by
        // the old loop restarting.
        this.stop();
        const gen = this._playGen = (this._playGen || 0) + 1;
        this._loopSource = otfData; // for loop restarts

        await this.init();
        if (gen !== this._playGen) return;

        // A context that never reaches 'running' has a frozen clock: notes
        // would be scheduled into a time that never arrives (silence with a
        // Pause button). Throw instead of pretending.
        await this._awaitRunningContext();
        if (gen !== this._playGen) return;

        // ALL tracks are scheduled; options.trackIds only sets which are
        // AUDIBLE at start. Each track plays through its own gain bus so
        // parts can be toggled LIVE mid-loop (setTrackEnabled) without
        // restarting playback.
        //
        // Percussion is excluded outright: a drum track has no tuning, and
        // its `s`/`f` are kit line + hit variant, so the pitched scheduling
        // below would sound it as arbitrary guitar notes (otf-tracks.js).
        // Playing drums properly needs a kit soundfont, not this path.
        const tracksToPlay = pitchedTracks(otfData.tracks);
        const audibleAtStart = new Set(
            options.trackIds ?? tracksToPlay.map(t => t.id));

        if (tracksToPlay.length === 0) return;

        await this.loadInstruments(tracksToPlay);
        if (gen !== this._playGen) return;

        // Per-track gain buses (live mute/unmute)
        this.trackGains = {};
        for (const t of tracksToPlay) {
            const g = this.audioContext.createGain();
            g.gain.value = audibleAtStart.has(t.id) ? 1 : 0;
            g.connect(this.audioContext.destination);
            this.trackGains[t.id] = g;
        }

        this.isPlaying = true;
        this.loop = options.loop || false;

        const bpm = options.tempo || otfData.metadata?.tempo || 160;
        const transpose = options.transpose || 0;
        const ticksPerBeat = otfData.timing?.ticks_per_beat || 480;
        const secondsPerTick = 60 / bpm / ticksPerBeat;

        // Ts-aware playback timeline: reading-list order (repeats unrolled),
        // per-measure lengths from metadata.time_signature_changes. The
        // timeline keeps EVERY slot, so sparse tracks stay aligned.
        // options.feel ('two') presents 4/4 as cut time — metronome clicks
        // halves instead of quarters.
        const measureTiming = measureTimingFromOtf(otfData, { feel: options.feel });
        const timeline = readingListTimeline(
            otfData.reading_list, maxMeasureIn(otfData.notation));
        const timing = new TimelineTiming(measureTiming, timeline);
        this._timing = timing;

        // Collect all notes
        const notesByTrack = {};
        for (const track of tracksToPlay) {
            let notation = otfData.notation?.[track.id];
            if (!notation) continue;

            // Expand notation onto the playback timeline
            notation = expandNotation(notation, timeline);

            // Default tunings by instrument (MIDI note numbers)
            const DEFAULT_TUNINGS = {
                'banjo': [62, 59, 55, 50, 67],      // D4, B3, G3, D3, G4 (open G)
                '5-string-banjo': [62, 59, 55, 50, 67],
                'mandolin': [76, 69, 62, 55],       // E5, A4, D4, G3
                'guitar': [64, 59, 55, 50, 45, 40], // E4, B3, G3, D3, A2, E2
                'default': [62, 59, 55, 50, 67]
            };
            const instrumentType = track.instrument || 'default';
            const defaultTuning = DEFAULT_TUNINGS[instrumentType] || DEFAULT_TUNINGS['default'];
            const tuning = (track.tuning?.length > 0)
                ? track.tuning.map(p => PITCH_TO_MIDI[p] || 60)
                : defaultTuning;
            const instrumentKey = getInstrumentKey(track.instrument);
            const instConfig = INSTRUMENTS[instrumentKey];
            const instrumentData = window[instConfig.var];
            const mix = this.getMixerSettings(track.id);

            // Apply instrument-specific defaults
            if (track.instrument?.includes('bass') && mix === this.DEFAULT_MIXER) {
                mix.decay = 0.5;
            }

            const trackNotes = [];
            const ties = [];
            const lastByString = {};  // string -> last attacked note (for slide pairing)
            notation.forEach(measure => {
                const measureTick = timing.startTick(measure.measure);
                measure.events?.forEach(event => {
                    const absTick = measureTick + event.tick;
                    event.notes.forEach(note => {
                        // Tie continuations never re-attack; they extend
                        // their source note (applied below)
                        if (note.tie) {
                            ties.push({ absTick, string: note.s, durTicks: note.dur || 0 });
                            return;
                        }

                        const stringIdx = note.s - 1;
                        if (stringIdx < 0 || stringIdx >= tuning.length) return;
                        const openMidi = tuning[stringIdx] + transpose;
                        const fx = note.fx?.length ? note.fx : undefined;
                        const midi = soundingMidi(openMidi, note.f, fx);

                        // Hammer-on / pull-off / slide DESTINATION: one pick.
                        // The source rings through it and its pitch steps or
                        // glides at schedule time (see below). Falls back to a
                        // normal attack if there is no preceding note.
                        if (absorbLegato(lastByString, note, midi, absTick)) return;

                        const tn = {
                            time: absTick * secondsPerTick,
                            tick: event.tick,
                            absTick,
                            string: note.s,
                            fret: note.f,
                            midi,
                            measure: measure.measure,
                            // Editor-entered notes carry explicit durations
                            explicitEndTick: note.dur ? absTick + note.dur : undefined,
                            instrumentData,
                            volume: mix.volume,
                            sustain: mix.sustain,
                            decay: mix.decay,
                            trackId: track.id,
                            instrument: track.instrument,
                            muted: note.tech === 'x',  // dead note (chop)
                            bend: note.tech === 'b',   // choke: pitch rises a quarter tone
                            // TablEdit effects + grace note (noteAttacks)
                            fx,
                            grace: note.grace
                                ? { midi: openMidi + note.grace.f, kind: note.grace.kind }
                                : undefined,
                        };
                        trackNotes.push(tn);
                        lastByString[note.s] = tn;
                    });
                });
            });
            applyTieExtensions(trackNotes, ties);
            trackNotes.sort((a, b) => a.time - b.time);
            notesByTrack[track.id] = trackNotes;
        }

        // Collect all notes into a single sorted list
        const allNotes = [];
        for (const trackId in notesByTrack) {
            allNotes.push(...notesByTrack[trackId]);
        }
        allNotes.sort((a, b) => a.time - b.time);

        // Build a map of note index by time for quick lookup of "next musical event"
        const noteTimeIndex = new Map();
        allNotes.forEach((note, idx) => {
            if (!noteTimeIndex.has(note.time)) {
                noteTimeIndex.set(note.time, idx);
            }
        });
        const sortedTimes = [...noteTimeIndex.keys()].sort((a, b) => a - b);

        // Calculate durations based on rhythmic context AND per-string sustain
        const notes = [];
        for (const trackId in notesByTrack) {
            const trackNotes = notesByTrack[trackId];
            const notesByString = {};

            trackNotes.forEach(note => {
                if (!notesByString[note.string]) notesByString[note.string] = [];
                notesByString[note.string].push(note);
            });

            for (const stringNum in notesByString) {
                const stringNotes = notesByString[stringNum];
                stringNotes.sort((a, b) => a.time - b.time);

                for (let i = 0; i < stringNotes.length; i++) {
                    const note = stringNotes[i];

                    // 1. Gap to next note on same string (string-based
                    // sustain). No following note = nothing cuts it:
                    // explicit durations must play their full written
                    // length even on the last note of a phrase (ring-
                    // model notes are still decay-capped downstream).
                    let stringGap = Infinity;
                    if (i + 1 < stringNotes.length) {
                        stringGap = stringNotes[i + 1].time - note.time;
                    }

                    // 2. Gap to next musical event (any note) - rhythmic duration
                    let rhythmicGap = note.decay;
                    const timeIdx = sortedTimes.indexOf(note.time);
                    if (timeIdx >= 0 && timeIdx + 1 < sortedTimes.length) {
                        rhythmicGap = sortedTimes[timeIdx + 1] - note.time;
                    }

                    // Explicit durations (editor-entered notes, tie
                    // chains) play their FULL length — only a re-attack
                    // on the same string cuts them. Ring-model notes
                    // keep the legacy any-track truncation. (This was
                    // the tied-melody-note-cut-short-by-backing-tracks
                    // playback nuance.)
                    if (note.explicitEndTick != null) {
                        note.explicitDurSec =
                            (note.explicitEndTick - note.absTick) * secondsPerTick;
                    }
                    let duration = effectiveDurationSeconds(note, stringGap, rhythmicGap);

                    // Instrument-specific chop/mute rules apply only to
                    // ring-model notes (explicit durations already say
                    // exactly how long to sound)
                    if (note.explicitDurSec == null) {
                        if (note.instrument?.includes('bass')) {
                            const isOnBeat = (note.tick % 480) === 0;
                            if (isOnBeat) {
                                const ticksToOffBeat = 240;
                                const timeToMute = ticksToOffBeat * secondsPerTick;
                                duration = Math.min(duration, timeToMute * 0.9 * note.sustain);
                            } else {
                                duration = Math.min(duration, 0.1 * note.sustain);
                            }
                        } else if (note.instrument?.includes('guitar')) {
                            const isOnBeat = (note.tick % 480) === 0;
                            if (isOnBeat) {
                                duration *= 0.8;
                            }
                        }
                    }

                    // Dead notes (chop ×): short percussive chuck, damped
                    if (note.muted) {
                        duration = Math.min(duration, 0.09);
                        note.volume *= 0.55;
                    }
                    // TablEdit effects: let-ring, staccato, ghost, palm
                    // mute, choke, harmonics, slap (no-op without fx)
                    ({ duration, volume: note.volume } = fxDurationVolume(note.fx, {
                        duration, volume: note.volume, stringGap, sustain: note.sustain,
                    }));
                    note.duration = duration;
                    notes.push(note);
                }
            }
        }

        notes.sort((a, b) => a.time - b.time);

        // Brushed / rolled chords: stagger the column's attacks
        applyStrumOffsets(notes);

        // Optional tick range (play-from-cursor / loop-a-phrase): clip
        // AFTER durations are computed so edge notes keep their gap-based
        // lengths, then rebase times so the range starts at t=0.
        const rangeStart = Math.max(0, options.startTick || 0);
        const rangeEnd = options.endTick ?? Infinity;
        const playNotes = (rangeStart > 0 || rangeEnd !== Infinity)
            ? clipScheduleToRange(notes, { startTick: rangeStart, endTick: rangeEnd, secondsPerTick })
            : notes;
        this._rangeStartTick = rangeStart;

        // Optional COUNT-IN: N beats of clicks before the music starts.
        // Everything anchors on playbackStartTime, so shifting it delays
        // notes, metronome, and the position clock together. Clicks are
        // FORCED audible (they're the point) even with the metronome off.
        // Scheduling headroom scales with the schedule size: queueing a
        // full multi-track tune takes real time, and a fixed 100ms let
        // the earliest notes' start times slip into the past — tracks
        // then STARTED LATE by different amounts (the ensemble smear).
        const headroom = 0.15 + Math.min(0.35, playNotes.length * 0.0003);

        const countInBeats = options.countInBeats || 0;
        let countInSeconds = 0;
        if (countInBeats > 0) {
            const startSlot = timing.locate(rangeStart);
            const beatTicks = measureTiming.beatTicksFor
                ? measureTiming.beatTicksFor(timing.originalAt(startSlot.display))
                : ticksPerBeat;
            const beatSeconds = beatTicks * secondsPerTick;
            countInSeconds = countInBeats * beatSeconds;
            for (let i = 0; i < countInBeats; i++) {
                this.playMetronomeClick(
                    this.audioContext.currentTime + headroom + i * beatSeconds,
                    i === 0, /* force */ true);
            }
        }

        // Schedule playback
        this.playbackStartTime = this.audioContext.currentTime + headroom + countInSeconds;
        this.scheduledNodes = [];

        // Store timing info for position updates
        this._ticksPerBeat = ticksPerBeat;
        this._secondsPerTick = secondsPerTick;
        this._ticksPerMeasure = measureTiming.defaultTicks;

        // Schedule notes and track for visualization
        this._scheduledNotes = [];
        const attackOpts = { secondsPerTick, thirtySecondSec: ticksPerBeat / 8 * secondsPerTick };
        playNotes.forEach(note => {
            const startTime = this.playbackStartTime + note.time;
            try {
                // One note may sound as several attacks (grace, tremolo) at
                // offsets from its onset (brush/roll). Pitch moves — legato
                // (one pick: the source steps or glides into each target),
                // bends, vibrato — use WebAudioFont's native `slides` param:
                // {delta (semitones), when (s from attack start)} waypoints,
                // undefined for a plain note (no-op).
                for (const a of noteAttacks(note, attackOpts)) {
                    const envelope = this.player.queueWaveTable(
                        this.audioContext,
                        this.trackGains[note.trackId] ?? this.audioContext.destination,
                        note.instrumentData,
                        startTime + a.offset,
                        a.midi,
                        a.duration,
                        a.volume,
                        a.slides
                    );
                    this.scheduledNodes.push(envelope);
                }

                // Track note timing for visualization callbacks (keyed by
                // the MAIN note's tick, even when a grace sounds first)
                this._scheduledNotes.push({
                    time: note.time,
                    absTick: note.absTick,
                    duration: note.duration,
                    started: false,
                    ended: false
                });
            } catch (e) {
                console.error('Error scheduling note:', e);
            }
        });

        // Schedule metronome clicks: per-measure beats from each measure's
        // own signature (3 clicks in a 3/4 pickup, 2 half-note clicks in 2/2),
        // through the end of the last measure containing notes — clipped to
        // the playback range and rebased like the notes.
        const lastNoteMeasure = playNotes.reduce((mx, n) => Math.max(mx, n.measure), 1);
        const clickEnd = Math.min(
            timing.startTick(lastNoteMeasure) + timing.ticksAt(lastNoteMeasure),
            rangeEnd);
        for (const click of buildMetronomeSchedule(timing)) {
            if (click.tick >= clickEnd) break;
            if (click.tick < rangeStart) continue;
            this.playMetronomeClick(
                this.playbackStartTime + (click.tick - rangeStart) * secondsPerTick,
                click.isDownbeat);
        }

        // A bounded range plays for EXACTLY its musical length (so loops
        // repeat in time); open-ended playback keeps the old +1s tail, longer
        // only when an effect (let-ring, harmonic) rings past it — stop()
        // would otherwise cut a ringing final chord.
        const fxTail = playNotes.reduce((mx, n) => (n.fx
            ? Math.max(mx, n.time + (n.strumOffsetSec || 0) + n.duration) : mx), 0);
        const totalDuration = rangeEnd !== Infinity
            ? (rangeEnd - rangeStart) * secondsPerTick
            : (playNotes.length > 0
                ? Math.max(playNotes[playNotes.length - 1].time + 1, fxTail) : 0);
        this._startPositionUpdate(totalDuration, options);
    }

    _startPositionUpdate(totalDuration, options) {
        const update = () => {
            if (!this.isPlaying) return;
            const elapsed = this.audioContext.currentTime - this.playbackStartTime;
            if (elapsed < 0) { // count-in in progress
                this.animationFrame = requestAnimationFrame(update);
                return;
            }

            if (this.onPositionUpdate) {
                this.onPositionUpdate(elapsed, totalDuration);
            }

            // Calculate current tick position (absolute: range-rebased
            // elapsed time plus the range's start tick)
            const currentTick = elapsed / this._secondsPerTick + (this._rangeStartTick || 0);

            // Fire tick callback for beat cursor
            if (this.onTick) {
                this.onTick(currentTick);
            }

            // Fire note start/end callbacks
            if (this._scheduledNotes) {
                for (const note of this._scheduledNotes) {
                    // Note start
                    if (!note.started && elapsed >= note.time) {
                        note.started = true;
                        if (this.onNoteStart) {
                            this.onNoteStart(note.absTick);
                        }
                    }
                    // Note end (after duration)
                    if (note.started && !note.ended && elapsed >= note.time + note.duration) {
                        note.ended = true;
                        if (this.onNoteEnd) {
                            this.onNoteEnd(note.absTick);
                        }
                    }
                }
            }

            if (elapsed < totalDuration) {
                this.animationFrame = requestAnimationFrame(update);
            } else {
                if (this.loop && this._loopSource) {
                    // Capture the LIVE mix BEFORE stop() — stop tears the
                    // gain buses down, and reading them afterwards fell
                    // back to the loop's ORIGINAL trackIds: every wrap
                    // silently reverted mid-loop toggles (Mike: 'a
                    // reaction, but not the right one').
                    const liveIds = this.trackGains
                        ? Object.entries(this.trackGains)
                            .filter(([, g]) => g.gain.value > 0.5)
                            .map(([id]) => id)
                        : options.trackIds;
                    this.stop();
                    // Tracked so a user stop() during the gap cancels it
                    // count-in only on the FIRST pass
                    this._loopTimer = setTimeout(
                        () => this.play(this._loopSource,
                            { ...options, countInBeats: 0, trackIds: liveIds })
                            .catch(err => {
                                console.warn('Loop restart failed:', err);
                                this.stop();
                                if (this.onPlaybackEnd) this.onPlaybackEnd();
                            }), 100);
                } else {
                    this.stop();
                    if (this.onPlaybackEnd) this.onPlaybackEnd();
                }
            }
        };
        this.animationFrame = requestAnimationFrame(update);
    }

    /**
     * Stop playback
     */
    stop() {
        this.isPlaying = false;

        // Invalidate any play() still inside its awaits (init/resume/
        // soundfont loads) — otherwise a Stop pressed during a slow
        // first load is ignored and audio starts anyway, possibly with
        // no UI left to stop it.
        this._playGen = (this._playGen || 0) + 1;

        // Tear down per-track gain buses
        if (this.trackGains) {
            for (const g of Object.values(this.trackGains)) {
                try { g.disconnect(); } catch (e) { /* already gone */ }
            }
            this.trackGains = null;
        }

        // Cancel a pending loop restart (stop during the loop gap)
        if (this._loopTimer) {
            clearTimeout(this._loopTimer);
            this._loopTimer = null;
        }

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.player && this.audioContext) {
            this.player.cancelQueue(this.audioContext);
        }
        this.scheduledNodes = [];

        // Stop and disconnect metronome oscillators
        for (const { osc, gain } of this.metronomeNodes) {
            try {
                osc.stop();
                osc.disconnect();
                gain.disconnect();
            } catch (e) {
                // Ignore errors if already stopped
            }
        }
        this.metronomeNodes = [];
    }

    /**
     * Check if currently playing
     */
    get playing() {
        return this.isPlaying;
    }
}

export { PITCH_TO_MIDI, INSTRUMENTS, WEBAUDIOFONT_URLS };
