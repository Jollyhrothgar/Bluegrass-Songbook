// The iOS audio-session shim: ringer-switch escape (audioSession type +
// silent HTML5 element) and a resume that never awaits first.
import { describe, it, expect, vi } from 'vitest';
import { unlockAudioContext, primeAudioSession } from '../audio-unlock.js';

describe('audio unlock', () => {
    it('promotes the audio session once and resumes the context', () => {
        const session = { type: 'ambient' };
        Object.defineProperty(navigator, 'audioSession',
            { value: session, configurable: true });
        const plays = vi.fn(() => Promise.resolve());
        vi.stubGlobal('Audio', class {
            constructor(src) { this.src = src; plays.mock.src = src; }
            setAttribute() {}
            play() { return plays(); }
        });

        const ctx = { state: 'suspended', resume: vi.fn(() => Promise.resolve()) };
        expect(unlockAudioContext(ctx)).toBe(ctx);

        // Ring/silent switch mutes the 'ambient' category — get out of it
        expect(session.type).toBe('playback');
        expect(plays).toHaveBeenCalledTimes(1);
        expect(ctx.resume).toHaveBeenCalledTimes(1);

        // Idempotent: the session priming is a one-time promotion, but every
        // gesture still gets its own resume attempt
        primeAudioSession();
        unlockAudioContext(ctx);
        expect(plays).toHaveBeenCalledTimes(1);
        expect(ctx.resume).toHaveBeenCalledTimes(2);

        vi.unstubAllGlobals();
    });

    it('leaves a running context alone and tolerates no context', () => {
        const ctx = { state: 'running', resume: vi.fn() };
        unlockAudioContext(ctx);
        expect(ctx.resume).not.toHaveBeenCalled();
        expect(unlockAudioContext(null)).toBe(null);
    });
});
