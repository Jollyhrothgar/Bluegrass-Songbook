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

/**
 * Load a script dynamically
 */
function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
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
     * Initialize audio context and load WebAudioFont
     */
    async init() {
        if (this.audioContext) return;

        // Load WebAudioFont player
        await loadScript(WEBAUDIOFONT_URLS.player);

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.player = new window.WebAudioFontPlayer();

        // Master metronome gain — clicks route through this so the
        // metronome toggle works during playback.
        this.metronomeGain = this.audioContext.createGain();
        this.metronomeGain.gain.value = this._metronomeEnabled ? 1 : 0;
        this.metronomeGain.connect(this.audioContext.destination);
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

            await new Promise((resolve) => {
                this.player.adjustPreset(this.audioContext, instrumentData);
                const checkDecoded = () => {
                    const allDecoded = instrumentData.zones.every(zone => zone.buffer);
                    if (allDecoded) {
                        resolve();
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

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            if (gen !== this._playGen) return;
        }

        // ALL tracks are scheduled; options.trackIds only sets which are
        // AUDIBLE at start. Each track plays through its own gain bus so
        // parts can be toggled LIVE mid-loop (setTrackEnabled) without
        // restarting playback.
        const tracksToPlay = otfData.tracks;
        const audibleAtStart = new Set(
            options.trackIds ?? otfData.tracks.map(t => t.id));

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
                        const midi = tuning[stringIdx] + note.f + transpose;

                        // Slide: a "/" (or "\") note is the slide DESTINATION.
                        // A banjo slide is one pick — the source note rings and
                        // its pitch glides up into the target, which then hangs.
                        // So we DON'T re-attack the target: we extend the source
                        // through it and ramp the source's pitch at schedule
                        // time (see below). Falls back to a normal attack if
                        // there is no preceding note on the string.
                        const source = (note.tech === '/' || note.tech === '\\')
                            ? lastByString[note.s] : null;
                        if (source) {
                            source.explicitEndTick = absTick + (note.dur || 0);
                            source.slide = { toMidi: midi, atTick: absTick };
                            return;  // suppress the target's independent attack
                        }

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
                            bend: note.tech === 'b'    // choke: pitch rises a quarter tone
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
                    note.duration = duration;
                    notes.push(note);
                }
            }
        }

        notes.sort((a, b) => a.time - b.time);

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
        playNotes.forEach(note => {
            const startTime = this.playbackStartTime + note.time;
            try {
                // Slide articulation (one pick): the source note rings for its
                // written length, then its pitch bends up into the target,
                // which hangs for the rest of the (extended) note. Uses
                // WebAudioFont's native `slides` param — an array of
                // {delta (semitones), when (s from note start)} pitch waypoints.
                let slides;
                if (note.slide) {
                    const holdSec = Math.max(0,
                        (note.slide.atTick - note.absTick) * secondsPerTick);
                    slides = slideWaypoints(
                        note.slide.toMidi - note.midi, holdSec, note.duration);
                } else if (note.bend) {
                    // Choke: the note attacks, then its pitch bends up a quarter tone.
                    slides = bendWaypoints(BEND_SEMITONES, note.duration);
                }
                const envelope = this.player.queueWaveTable(
                    this.audioContext,
                    this.trackGains[note.trackId] ?? this.audioContext.destination,
                    note.instrumentData,
                    startTime,
                    note.midi,
                    note.duration,
                    note.volume,
                    slides   // 8th arg; undefined for non-slide notes (no-op)
                );
                this.scheduledNodes.push(envelope);

                // Track note timing for visualization callbacks
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
        // repeat in time); open-ended playback keeps the old +1s tail.
        const totalDuration = rangeEnd !== Infinity
            ? (rangeEnd - rangeStart) * secondsPerTick
            : (playNotes.length > 0 ? playNotes[playNotes.length - 1].time + 1 : 0);
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
                            { ...options, countInBeats: 0, trackIds: liveIds }), 100);
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
