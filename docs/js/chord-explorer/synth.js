// Warm synth module for chord progression explorer
// Uses Web Audio API with subtractive synthesis

/**
 * ChordSynth - A warm-sounding polyphonic synthesizer
 * Signal chain: Sawtooth → LowPass Filter → ADSR Envelope → Master Gain
 */
export class ChordSynth {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.activeVoices = [];
        this.scheduledEvents = [];

        // ADSR envelope settings (in seconds)
        this.envelope = {
            attack: 0.05,
            decay: 0.1,
            sustain: 0.6,
            release: 0.3
        };

        // Filter settings
        this.filterFreq = 2000;
        this.filterQ = 1;

        // Slight detuning for warmth (cents)
        this.detuneSpread = 3;

        // Vibrato settings
        this.vibratoEnabled = false;
        this.vibratoRate = 5;      // Hz (cycles per second)
        this.vibratoDepth = 10;    // Cents of pitch deviation
    }

    /**
     * Lazily initialize AudioContext (required for browser autoplay policy)
     */
    async init() {
        if (this.masterGain) return;  // Check masterGain, not audioContext (avoid race condition)

        // Create AudioContext with fallback for Safari
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();

        // Resume if suspended (required after user interaction)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // Create master gain node
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.3; // Overall volume
        this.masterGain.connect(this.audioContext.destination);
    }

    /**
     * Convert MIDI note number to frequency
     * A4 (MIDI 69) = 440 Hz
     */
    midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    /**
     * Create a single voice (oscillator + filter + envelope + optional vibrato)
     */
    createVoice(freq, startTime, duration, detuneAmount = 0) {
        const ctx = this.audioContext;

        // Oscillator (sawtooth for harmonic richness)
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = detuneAmount;

        // Vibrato LFO (modulates detune)
        let lfo = null;
        let lfoGain = null;
        if (this.vibratoEnabled) {
            lfo = ctx.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = this.vibratoRate;

            lfoGain = ctx.createGain();
            lfoGain.gain.value = this.vibratoDepth;

            lfo.connect(lfoGain);
            lfoGain.connect(osc.detune);
            lfo.start(startTime);
            lfo.stop(startTime + duration + 0.1);
        }

        // Low-pass filter for warmth
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = this.filterFreq;
        filter.Q.value = this.filterQ;

        // Gain for ADSR envelope
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0;

        // Connect: Osc → Filter → Gain → Master
        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Apply ADSR envelope
        const { attack, decay, sustain, release } = this.envelope;
        const endTime = startTime + duration;

        // Attack
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.25, startTime + attack);

        // Decay to sustain
        gainNode.gain.linearRampToValueAtTime(0.25 * sustain, startTime + attack + decay);

        // Hold at sustain until release
        gainNode.gain.setValueAtTime(0.25 * sustain, endTime - release);

        // Release
        gainNode.gain.linearRampToValueAtTime(0.001, endTime);

        // Start and stop oscillator
        osc.start(startTime);
        osc.stop(endTime + 0.1); // Small buffer for release tail

        return { osc, filter, gainNode, lfo, lfoGain, endTime };
    }

    /**
     * Toggle vibrato on/off
     */
    setVibrato(enabled, rate = 5, depth = 10) {
        this.vibratoEnabled = enabled;
        this.vibratoRate = rate;
        this.vibratoDepth = depth;
    }

    /**
     * Play a chord immediately (for preview/hover)
     * @param {number[]} midiNotes - Array of MIDI note numbers
     * @param {number} duration - Duration in seconds
     */
    async playChord(midiNotes, duration = 1.0) {
        await this.init();

        const now = this.audioContext.currentTime;
        const voices = [];

        midiNotes.forEach((midi, i) => {
            const freq = this.midiToFreq(midi);
            // Slight detuning between voices for warmth
            const detune = (i - (midiNotes.length - 1) / 2) * this.detuneSpread;
            const voice = this.createVoice(freq, now, duration, detune);
            voices.push(voice);
        });

        this.activeVoices.push(...voices);

        // Clean up voices after they finish
        const cleanupTime = (duration + this.envelope.release + 0.2) * 1000;
        setTimeout(() => {
            voices.forEach(voice => {
                const index = this.activeVoices.indexOf(voice);
                if (index > -1) {
                    this.activeVoices.splice(index, 1);
                }
            });
        }, cleanupTime);
    }

    /**
     * Schedule a chord for future playback (for grid sequencing)
     * @param {number[]} midiNotes - Array of MIDI note numbers
     * @param {number} startTime - AudioContext time to start
     * @param {number} duration - Duration in seconds
     */
    scheduleChord(midiNotes, startTime, duration) {
        const voices = [];

        midiNotes.forEach((midi, i) => {
            const freq = this.midiToFreq(midi);
            const detune = (i - (midiNotes.length - 1) / 2) * this.detuneSpread;
            const voice = this.createVoice(freq, startTime, duration, detune);
            voices.push(voice);
        });

        this.scheduledEvents.push({ voices, startTime, endTime: startTime + duration });
    }

    /**
     * Get current AudioContext time
     */
    getCurrentTime() {
        return this.audioContext?.currentTime || 0;
    }

    /**
     * Stop all playing and scheduled sounds
     */
    stopAll() {
        if (!this.audioContext) return;

        const now = this.audioContext.currentTime;
        const fastRelease = 0.05;

        // Stop all active voices
        this.activeVoices.forEach(voice => {
            try {
                voice.gainNode.gain.cancelScheduledValues(now);
                voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
                voice.gainNode.gain.linearRampToValueAtTime(0.001, now + fastRelease);
                voice.osc.stop(now + fastRelease + 0.01);
            } catch (e) {
                // Voice may have already stopped
            }
        });

        // Stop all scheduled events
        this.scheduledEvents.forEach(event => {
            event.voices.forEach(voice => {
                try {
                    voice.gainNode.gain.cancelScheduledValues(now);
                    voice.gainNode.gain.setValueAtTime(0, now);
                    voice.osc.stop(now + 0.01);
                } catch (e) {
                    // Voice may not have started yet
                }
            });
        });

        this.activeVoices = [];
        this.scheduledEvents = [];
    }

    /**
     * Set master volume
     * @param {number} value - Volume 0.0 to 1.0
     */
    setVolume(value) {
        if (this.masterGain) {
            this.masterGain.gain.value = Math.max(0, Math.min(1, value)) * 0.5;
        }
    }

    /**
     * Set filter frequency for tone control
     * @param {number} freq - Frequency in Hz (500-5000 typical)
     */
    setFilterFreq(freq) {
        this.filterFreq = Math.max(200, Math.min(8000, freq));
    }
}

// Default synth instance
let defaultSynth = null;

/**
 * Get or create the default synth instance
 */
export function getSynth() {
    if (!defaultSynth) {
        defaultSynth = new ChordSynth();
    }
    return defaultSynth;
}
