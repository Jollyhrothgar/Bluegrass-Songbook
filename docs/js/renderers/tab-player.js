// Tablature Audio Player using WebAudioFont
// Extracted from TablEdit_Reverse viewer for Bluegrass Songbook

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
    mandolin: { var: '_tone_0260_GeneralUserGS_sf2_file', name: 'Steel Guitar (mandolin)' },
    dobro: { var: '_tone_0260_GeneralUserGS_sf2_file', name: 'Steel Guitar' },
};

// CDN URLs for WebAudioFont resources
const WEBAUDIOFONT_URLS = {
    player: 'https://surikov.github.io/webaudiofont/npm/dist/WebAudioFontPlayer.js',
    instruments: {
        banjo: 'https://surikov.github.io/webaudiofontdata/sound/1050_FluidR3_GM_sf2_file.js',
        guitar: 'https://surikov.github.io/webaudiofontdata/sound/0251_GeneralUserGS_sf2_file.js',
        bass: 'https://surikov.github.io/webaudiofontdata/sound/0320_GeneralUserGS_sf2_file.js',
        violin: 'https://surikov.github.io/webaudiofontdata/sound/0400_GeneralUserGS_sf2_file.js',
        mandolin: 'https://surikov.github.io/webaudiofontdata/sound/0260_GeneralUserGS_sf2_file.js',
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
        this.metronomeEnabled = false;
        this.metronomeVolume = 0.3;
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
    }

    /**
     * Create a pleasant metronome click sound
     * Uses a short sine wave with quick decay for a wood block-like sound
     */
    playMetronomeClick(time, isDownbeat = false) {
        if (!this.audioContext || !this.metronomeEnabled) return;

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
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + 0.05);
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
     */
    async play(otfData, options = {}) {
        if (this.isPlaying) this.stop();

        await this.init();

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        const tracksToPlay = options.trackIds
            ? otfData.tracks.filter(t => options.trackIds.includes(t.id))
            : otfData.tracks;

        if (tracksToPlay.length === 0) return;

        await this.loadInstruments(tracksToPlay);

        this.isPlaying = true;
        this.loop = options.loop || false;

        const bpm = options.tempo || otfData.metadata?.tempo || 160;
        const transpose = options.transpose || 0;
        const ticksPerBeat = otfData.timing?.ticks_per_beat || 480;
        const secondsPerTick = 60 / bpm / ticksPerBeat;
        const ticksPerMeasure = 2 * ticksPerBeat; // 2/2 time

        // Collect all notes
        const notesByTrack = {};
        for (const track of tracksToPlay) {
            const notation = otfData.notation?.[track.id];
            if (!notation) continue;

            const tuning = track.tuning?.map(p => PITCH_TO_MIDI[p] || 60) || [62, 59, 55, 50, 67];
            const instrumentKey = getInstrumentKey(track.instrument);
            const instConfig = INSTRUMENTS[instrumentKey];
            const instrumentData = window[instConfig.var];
            const mix = this.getMixerSettings(track.id);

            // Apply instrument-specific defaults
            if (track.instrument?.includes('bass') && mix === this.DEFAULT_MIXER) {
                mix.decay = 0.5;
            }

            const trackNotes = [];
            notation.forEach(measure => {
                const measureTick = (measure.measure - 1) * ticksPerMeasure;
                measure.events?.forEach(event => {
                    const absTick = measureTick + event.tick;
                    event.notes.forEach(note => {
                        const stringIdx = note.s - 1;
                        if (stringIdx >= 0 && stringIdx < tuning.length) {
                            trackNotes.push({
                                time: absTick * secondsPerTick,
                                tick: event.tick,
                                absTick,
                                string: note.s,
                                fret: note.f,
                                midi: tuning[stringIdx] + note.f + transpose,
                                measure: measure.measure,
                                instrumentData,
                                volume: mix.volume,
                                sustain: mix.sustain,
                                decay: mix.decay,
                                trackId: track.id,
                                instrument: track.instrument
                            });
                        }
                    });
                });
            });
            trackNotes.sort((a, b) => a.time - b.time);
            notesByTrack[track.id] = trackNotes;
        }

        // Calculate durations based on per-string sustain
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
                    let duration;

                    if (i + 1 < stringNotes.length) {
                        const gap = stringNotes[i + 1].time - note.time;
                        duration = gap * 0.95;
                    } else {
                        duration = note.decay;
                    }

                    duration = Math.min(duration, note.decay);
                    duration = Math.max(duration, 0.03);
                    duration *= note.sustain;

                    // Instrument-specific rules
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

                    note.duration = duration;
                    notes.push(note);
                }
            }
        }

        notes.sort((a, b) => a.time - b.time);

        // Schedule playback
        this.playbackStartTime = this.audioContext.currentTime + 0.1;
        this.scheduledNodes = [];

        // Store timing info for position updates
        this._ticksPerBeat = ticksPerBeat;
        this._secondsPerTick = secondsPerTick;
        this._ticksPerMeasure = ticksPerMeasure;

        // Schedule notes and track for visualization
        this._scheduledNotes = [];
        notes.forEach(note => {
            const startTime = this.playbackStartTime + note.time;
            try {
                const envelope = this.player.queueWaveTable(
                    this.audioContext,
                    this.audioContext.destination,
                    note.instrumentData,
                    startTime,
                    note.midi,
                    note.duration,
                    note.volume
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

        // Schedule metronome clicks
        const totalMeasures = Math.max(...notes.map(n => n.measure)) || 1;
        const beatsPerMeasure = 2;  // 2/2 time
        for (let m = 0; m < totalMeasures; m++) {
            for (let beat = 0; beat < beatsPerMeasure; beat++) {
                const beatTick = m * ticksPerMeasure + beat * ticksPerBeat;
                const beatTime = beatTick * secondsPerTick;
                const isDownbeat = beat === 0;
                this.playMetronomeClick(this.playbackStartTime + beatTime, isDownbeat);
            }
        }

        const totalDuration = notes.length > 0 ? notes[notes.length - 1].time + 1 : 0;
        this._startPositionUpdate(totalDuration, options);
    }

    _startPositionUpdate(totalDuration, options) {
        const update = () => {
            if (!this.isPlaying) return;
            const elapsed = this.audioContext.currentTime - this.playbackStartTime;

            if (this.onPositionUpdate) {
                this.onPositionUpdate(elapsed, totalDuration);
            }

            // Calculate current tick position
            const currentTick = elapsed / this._secondsPerTick;

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
                if (this.loop) {
                    this.stop();
                    setTimeout(() => this.play(options._otfData, options), 100);
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

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.player && this.audioContext) {
            this.player.cancelQueue(this.audioContext);
        }
        this.scheduledNodes = [];
    }

    /**
     * Check if currently playing
     */
    get playing() {
        return this.isPlaying;
    }
}

export { PITCH_TO_MIDI, INSTRUMENTS, WEBAUDIOFONT_URLS };
