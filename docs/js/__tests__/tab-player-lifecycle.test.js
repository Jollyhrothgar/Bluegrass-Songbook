// stop()/play() lifecycle: generation invalidation and loop-timer
// hygiene. No audio here — init is stubbed; these guard the state
// machine that decides WHETHER audio starts, not the audio itself.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TabPlayer } from '../renderers/tab-player.js';

/** A fake AudioContext. `runs: false` never leaves 'suspended' (iOS with a
 *  spent gesture activation — the clock stays frozen and nothing sounds). */
function stubAudio({ runs = true } = {}) {
    const ctx = {
        state: 'suspended',
        resume: vi.fn(() => {
            if (runs) ctx.state = 'running';
            return Promise.resolve();
        }),
    };
    const ctor = vi.fn(() => ctx);
    vi.stubGlobal('AudioContext', ctor);
    // primeAudioSession() plays a silent element; jsdom has no media stack
    vi.stubGlobal('Audio', class { setAttribute() {} play() { return Promise.resolve(); } });
    return { ctx, ctor };
}

afterEach(() => vi.unstubAllGlobals());

describe('TabPlayer lifecycle guards', () => {
    it('stop() invalidates an in-flight play() generation', async () => {
        const p = new TabPlayer();
        let release;
        p.init = () => new Promise(r => { release = r; });

        const playPromise = p.play({ tracks: [{ id: 't1', notation: [] }] });
        const genDuringLoad = p._playGen;

        p.stop(); // user hits Stop while soundfonts are still loading
        expect(p._playGen).toBeGreaterThan(genDuringLoad);

        release();
        await playPromise;
        expect(p.isPlaying).toBe(false); // the stale play never started
    });

    it('play() cancels a pending loop-restart timer even when idle', () => {
        // During the loop-wrap gap isPlaying is false but _loopTimer is
        // pending; a play() armed in that window must not be hijacked
        // 100ms later by the old loop restarting.
        vi.useFakeTimers();
        const p = new TabPlayer();
        p.init = () => new Promise(() => {}); // hold before scheduling
        const hijack = vi.fn();
        p._loopTimer = setTimeout(hijack, 100);

        p.play({ tracks: [] });
        vi.advanceTimersByTime(500);

        expect(hijack).not.toHaveBeenCalled();
        expect(p._loopTimer).toBe(null);
        vi.useRealTimers();
    });

    it('stop() clears the loop-restart timer and bumps the generation', () => {
        vi.useFakeTimers();
        const p = new TabPlayer();
        const restart = vi.fn();
        p._loopTimer = setTimeout(restart, 100);
        const gen = p._playGen || 0;

        p.stop();
        vi.advanceTimersByTime(500);

        expect(restart).not.toHaveBeenCalled();
        expect(p._playGen).toBeGreaterThan(gen);
        vi.useRealTimers();
    });
});

describe('TabPlayer iOS audio unlock', () => {
    it('unlockAudio() creates and resumes the context SYNCHRONOUSLY', () => {
        // No await anywhere in this test: that is the whole point. iOS grants
        // Web Audio only transient user activation, so a context built after
        // an await stays suspended and playback is silent.
        const { ctx, ctor } = stubAudio();
        const p = new TabPlayer();

        const got = p.unlockAudio();

        expect(got).toBe(ctx);
        expect(p.audioContext).toBe(ctx);
        expect(ctx.resume).toHaveBeenCalled();
        expect(ctx.state).toBe('running');

        // A second tap reuses the one context
        p.unlockAudio();
        expect(ctor).toHaveBeenCalledTimes(1);
    });

    it('play() fails cleanly when the context never reaches running', async () => {
        const { ctx } = stubAudio({ runs: false });
        const p = new TabPlayer();
        p.resumeGraceMs = 10;
        // Stand in for init(): unlock + a player stub, no CDN fetch
        p.init = async () => { p.unlockAudio(); p.player = {}; };

        await expect(p.play({ tracks: [{ id: 't1' }] }))
            .rejects.toThrow(/blocked/i);
        expect(ctx.state).toBe('suspended');
        expect(p.isPlaying).toBe(false);   // no Pause button left hanging
    });

    it('init() throws instead of half-initializing without Web Audio', async () => {
        vi.stubGlobal('AudioContext', undefined);
        vi.stubGlobal('webkitAudioContext', undefined);
        const p = new TabPlayer();

        await expect(p.init()).rejects.toThrow(/Web Audio/);
        expect(p.audioContext).toBe(null);
    });
});
