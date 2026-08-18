// Note-entry feedback routes through the PLAYER's sampled voice.
//
// Typing a note should sound like the tab sounds, so the editor plays the
// same WebAudioFont preset TabPlayer plays — and falls back to the synth
// beep whenever that voice isn't ready. Nothing in the entry path may
// await: on iOS the context has to be created/resumed inside the
// keystroke's own call stack (audio-unlock.js), and a note that waits on a
// CDN fetch is a note you don't hear.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { OTFEditor } from '../../otf-editor/editor.js';
import { INSTRUMENTS, PITCH_TO_MIDI } from '../../renderers/tab-player.js';

const BANJO_TUNING = ['D4', 'B3', 'G3', 'D3', 'G4'];
const BANJO_VAR = INSTRUMENTS.banjo.var;

/** An AudioContext stub that records every oscillator it hands out. */
function stubContext({ state = 'running' } = {}) {
    const oscillators = [];
    return {
        state,
        currentTime: 5,
        destination: { id: 'destination' },
        oscillators,
        createOscillator() {
            const osc = {
                type: null, frequency: { value: 0 },
                connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
            };
            oscillators.push(osc);
            return osc;
        },
        createGain() {
            return {
                gain: {
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn(),
                    exponentialRampToValueAtTime: vi.fn(),
                },
                connect: vi.fn(),
            };
        },
    };
}

/**
 * An editor stripped to what _playNoteFeedback touches — mounting the real
 * thing would drag in a renderer and a live layout for no extra signal.
 */
function fakeEditor({ ctx, waf = null, track } = {}) {
    const editor = Object.create(OTFEditor.prototype);
    editor.player = {
        player: waf,
        unlockAudio: vi.fn(() => ctx),
        init: vi.fn(() => Promise.resolve()),
        loadInstruments: vi.fn(() => Promise.resolve()),
    };
    editor._warmedVoices = new Set();
    editor.feedbackEnabled = true;
    editor.state = {
        getCurrentTrack: () => (track === undefined
            ? { instrument: '5-string-banjo', tuning: BANJO_TUNING }
            : track),
    };
    return editor;
}

const wafStub = () => ({ queueWaveTable: vi.fn() });

/** Let queued microtasks (the background warm-up) settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** Publish a soundfont global the way the CDN script does. */
function publishPreset({ decoded = true } = {}) {
    globalThis[BANJO_VAR] = { zones: [{ buffer: decoded ? {} : null }] };
}

afterEach(() => {
    delete globalThis[BANJO_VAR];
    vi.restoreAllMocks();
});

describe('OTFEditor note-entry feedback', () => {
    it('plays the decoded sampled voice — no beep', () => {
        publishPreset();
        const ctx = stubContext();
        const waf = wafStub();
        const editor = fakeEditor({ ctx, waf });

        editor._playNoteFeedback(5, 3);   // 5th fret, 3rd string (G3)

        expect(waf.queueWaveTable).toHaveBeenCalledTimes(1);
        const [audioCtx, target, preset, when, midi] = waf.queueWaveTable.mock.calls[0];
        expect(audioCtx).toBe(ctx);
        expect(target).toBe(ctx.destination);
        expect(preset).toBe(globalThis[BANJO_VAR]);
        expect(when).toBe(ctx.currentTime);       // now, not "soon"
        expect(midi).toBe(PITCH_TO_MIDI.G3 + 5);
        expect(ctx.oscillators).toHaveLength(0);  // the beep stayed home
    });

    it('unlocks the context synchronously, before anything else', () => {
        publishPreset();
        const ctx = stubContext();
        const editor = fakeEditor({ ctx, waf: wafStub() });

        editor._playNoteFeedback(0, 1);

        expect(editor.player.unlockAudio).toHaveBeenCalled();
        expect(editor.audioContext).toBe(ctx);   // one shared audio stack
    });

    it('maps each string through its own tuning', () => {
        publishPreset();
        const waf = wafStub();
        const editor = fakeEditor({ ctx: stubContext(), waf });

        editor._playNoteFeedback(0, 1);   // open 1st string: D4
        editor._playNoteFeedback(2, 5);   // 5th string G4, 2 frets up

        expect(waf.queueWaveTable.mock.calls[0][4]).toBe(PITCH_TO_MIDI.D4);
        expect(waf.queueWaveTable.mock.calls[1][4]).toBe(PITCH_TO_MIDI.G4 + 2);
    });

    it('beeps when the soundfont has not arrived yet, and warms it once', () => {
        const ctx = stubContext();
        const waf = wafStub();
        const editor = fakeEditor({ ctx, waf });

        editor._playNoteFeedback(0, 3);
        editor._playNoteFeedback(2, 3);

        expect(waf.queueWaveTable).not.toHaveBeenCalled();
        expect(ctx.oscillators).toHaveLength(2);          // feedback is never silent
        expect(editor.player.init).toHaveBeenCalledTimes(1);   // warmed once
    });

    it('beeps while the soundfont is fetched but not yet decoded', () => {
        publishPreset({ decoded: false });
        const ctx = stubContext();
        const waf = wafStub();

        fakeEditor({ ctx, waf })._playNoteFeedback(0, 3);

        expect(waf.queueWaveTable).not.toHaveBeenCalled();
        expect(ctx.oscillators).toHaveLength(1);
    });

    it('beeps before the player has ever been initialised', () => {
        publishPreset();
        const ctx = stubContext();
        const editor = fakeEditor({ ctx, waf: null });   // no WebAudioFontPlayer yet

        editor._playNoteFeedback(0, 3);

        expect(ctx.oscillators).toHaveLength(1);
    });

    it('beeps rather than queueing into a suspended (frozen-clock) context', () => {
        publishPreset();
        const ctx = stubContext({ state: 'suspended' });
        const waf = wafStub();

        fakeEditor({ ctx, waf })._playNoteFeedback(0, 3);

        expect(waf.queueWaveTable).not.toHaveBeenCalled();
        expect(ctx.oscillators).toHaveLength(1);
    });

    it('falls back to the beep when the sampled voice throws', () => {
        publishPreset();
        const ctx = stubContext();
        const waf = { queueWaveTable: vi.fn(() => { throw new Error('bad zone'); }) };

        fakeEditor({ ctx, waf })._playNoteFeedback(0, 3);

        expect(ctx.oscillators).toHaveLength(1);
    });

    it('does nothing at all when the browser has no Web Audio', () => {
        publishPreset();
        const editor = fakeEditor({ ctx: null, waf: wafStub() });

        expect(() => editor._playNoteFeedback(0, 3)).not.toThrow();
        expect(editor.player.player.queueWaveTable).not.toHaveBeenCalled();
        expect(editor.player.init).not.toHaveBeenCalled();
    });

    it('warms the voice without blocking the note — the beep sounds first', async () => {
        const ctx = stubContext();
        const editor = fakeEditor({ ctx });
        let releaseInit;
        editor.player.init = vi.fn(() => new Promise(r => { releaseInit = r; }));

        editor._playNoteFeedback(0, 3);

        // The beep already happened while the load sits unresolved
        expect(ctx.oscillators).toHaveLength(1);
        expect(editor.player.loadInstruments).not.toHaveBeenCalled();
        releaseInit();
        await flush();
        expect(editor.player.loadInstruments).toHaveBeenCalledTimes(1);
    });

    it('swallows a failed warm-up and keeps beeping', async () => {
        const ctx = stubContext();
        const editor = fakeEditor({ ctx });
        editor.player.init = vi.fn(() => Promise.reject(new Error('CDN blocked')));

        editor._playNoteFeedback(0, 3);
        await flush();

        editor._playNoteFeedback(1, 3);
        expect(ctx.oscillators).toHaveLength(2);
    });

    it('falls back to a banjo tuning when the track has none', () => {
        publishPreset();
        const waf = wafStub();
        const editor = fakeEditor({
            ctx: stubContext(), waf, track: { instrument: '5-string-banjo' },
        });

        editor._playNoteFeedback(0, 3);

        expect(waf.queueWaveTable.mock.calls[0][4]).toBe(PITCH_TO_MIDI.G3);
    });
});
