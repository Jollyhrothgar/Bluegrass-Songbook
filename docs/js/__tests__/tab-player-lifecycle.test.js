// stop()/play() lifecycle: generation invalidation and loop-timer
// hygiene. No audio here — init is stubbed; these guard the state
// machine that decides WHETHER audio starts, not the audio itself.
import { describe, it, expect, vi } from 'vitest';
import { TabPlayer } from '../renderers/tab-player.js';

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
