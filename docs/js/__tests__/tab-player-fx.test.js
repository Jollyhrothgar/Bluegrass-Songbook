// TablEdit note effects (`note.fx`) and grace notes (`note.grace`) are PLAYED,
// not only drawn (fix-it A15): imported TablEdit tabs should sound the way
// TablEdit plays them. Pure helpers first; then the play() wiring through a
// stub WebAudioFont player that records every queueWaveTable call.
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    TabPlayer,
    harmonicPitch,
    soundingMidi,
    vibratoWaypoints,
    bendReleaseWaypoints,
    chokeWaypoints,
    strumOffsets,
    tremoloAttacks,
    graceLeadSeconds,
    fxDurationVolume,
    noteAttacks,
    BRUSH_STEP_SEC,
    BRUSH_MAX_SEC,
    ROLL_STEP_SEC,
    MUTED_SEC,
    GHOST_GAIN,
    LET_RING_MAX_SEC,
    GRACE_MAX_LEAD_SEC,
} from '../renderers/tab-player.js';

describe('harmonicPitch (natural harmonics, from the open string)', () => {
    it('maps the harmonic nodes to their partials', () => {
        const open = 50;
        expect(harmonicPitch(open, 12)).toBe(62);
        expect(harmonicPitch(open, 7)).toBe(69);
        expect(harmonicPitch(open, 19)).toBe(69);
        expect(harmonicPitch(open, 5)).toBe(74);
        expect(harmonicPitch(open, 24)).toBe(74);
        for (const f of [4, 9, 16]) expect(harmonicPitch(open, f)).toBe(78);
        expect(harmonicPitch(open, 3)).toBe(81);
    });

    it('falls back to the fretted pitch an octave up off the nodes', () => {
        expect(harmonicPitch(50, 2)).toBe(64);
        expect(harmonicPitch(50, 10)).toBe(72);
    });
});

describe('soundingMidi', () => {
    it('is the fretted pitch without harmonic fx', () => {
        expect(soundingMidi(50, 3)).toBe(53);
        expect(soundingMidi(50, 3, ['ghost'])).toBe(53);
    });
    it('natural harmonic follows the node table; artificial is fretted +12', () => {
        expect(soundingMidi(50, 7, ['harmonic'])).toBe(69);
        expect(soundingMidi(50, 3, ['artificial-harmonic'])).toBe(65);
    });
});

describe('pitch-waypoint fx', () => {
    it('vibrato oscillates ±0.25 semitone at ~5-6 Hz through the note', () => {
        const wp = vibratoWaypoints(1);
        const deltas = wp.map(w => w.delta);
        expect(Math.max(...deltas)).toBeCloseTo(0.25);
        expect(Math.min(...deltas)).toBeCloseTo(-0.25);
        expect(wp[0]).toEqual({ delta: 0, when: 0 });
        expect(wp[wp.length - 1].when).toBeLessThanOrEqual(1);
        // peaks per second = cycles per second
        const peaks = deltas.filter(d => d > 0.2).length;
        expect(peaks).toBeGreaterThanOrEqual(5);
        expect(peaks).toBeLessThanOrEqual(6);
        for (let i = 1; i < wp.length; i++) expect(wp[i].when).toBeGreaterThan(wp[i - 1].when);
    });

    it('bend-release: up a whole step over the first third, hold, back down over the last', () => {
        expect(bendReleaseWaypoints(0.9)).toEqual([
            { delta: 0, when: 0 },
            { delta: 2, when: expect.closeTo(0.3, 6) },
            { delta: 2, when: expect.closeTo(0.6, 6) },
            { delta: 0, when: expect.closeTo(0.9, 6) },
        ]);
    });

    it('choke bends up a semitone quickly', () => {
        const wp = chokeWaypoints(0.3);
        expect(wp[0]).toEqual({ delta: 0, when: 0 });
        expect(wp[1].delta).toBe(1);
        expect(wp[1].when).toBeLessThanOrEqual(0.1);
        expect(wp[1].when).toBeGreaterThan(0);
    });
});

describe('strumOffsets (brush / roll)', () => {
    it('spreads a brush low string (highest s) to high, first attack on the tick', () => {
        const off = strumOffsets([1, 2, 3, 4], 'brush');
        expect(off[4]).toBe(0);
        expect(off[3]).toBeCloseTo(BRUSH_STEP_SEC);
        expect(off[1]).toBeCloseTo(3 * BRUSH_STEP_SEC);
        expect(off[1]).toBeLessThanOrEqual(BRUSH_MAX_SEC);
    });

    it('caps a wide brush at the max total spread', () => {
        const off = strumOffsets([1, 2, 3, 4, 5, 6], 'brush');
        expect(off[6]).toBe(0);
        expect(off[1]).toBeCloseTo(BRUSH_MAX_SEC);
    });

    it('a roll is slower', () => {
        const off = strumOffsets([1, 2, 3], 'roll');
        expect(off[3]).toBe(0);
        expect(off[2]).toBeCloseTo(ROLL_STEP_SEC);
        expect(ROLL_STEP_SEC).toBeGreaterThanOrEqual(0.04);
    });

    it('a single note is not offset', () => {
        expect(strumOffsets([2], 'brush')).toEqual({ 2: 0 });
    });
});

describe('tremoloAttacks', () => {
    it('re-attacks every step for the duration, repeats slightly quieter', () => {
        const a = tremoloAttacks(0.25, 0.0625);
        expect(a.map(x => x.offset)).toEqual([0, 0.0625, 0.125, 0.1875]);
        expect(a[0].gain).toBe(1);
        expect(a[1].gain).toBeLessThan(1);
        expect(a[1].gain).toBeGreaterThan(0.5);
        expect(a[3].duration).toBeCloseTo(0.0625);
    });

    it('trims the last attack to the note end', () => {
        const a = tremoloAttacks(0.1, 0.0625);
        expect(a).toHaveLength(2);
        expect(a[1].duration).toBeCloseTo(0.0375);
    });
});

describe('graceLeadSeconds', () => {
    it('is a 1/32 note or GRACE_MAX_LEAD_SEC, whichever is shorter', () => {
        expect(graceLeadSeconds(60 / 120 / 480, 480)).toBeCloseTo(GRACE_MAX_LEAD_SEC); // 1/32 = 62.5ms
        expect(graceLeadSeconds(60 / 300 / 480, 480)).toBeCloseTo(0.025);              // 1/32 = 25ms
    });
});

describe('fxDurationVolume', () => {
    const base = { duration: 0.4, volume: 0.7, stringGap: 2, sustain: 1 };

    it('passes plain notes through untouched', () => {
        expect(fxDurationVolume(undefined, base)).toEqual({ duration: 0.4, volume: 0.7 });
        expect(fxDurationVolume(['tap'], base)).toEqual({ duration: 0.4, volume: 0.7 });
    });

    it('staccato halves the sounded duration', () => {
        expect(fxDurationVolume(['staccato'], base).duration).toBeCloseTo(0.2);
    });

    it('ghost is much quieter', () => {
        const { volume } = fxDurationVolume(['ghost'], base);
        expect(volume).toBeCloseTo(0.7 * GHOST_GAIN);
        expect(GHOST_GAIN).toBeGreaterThanOrEqual(0.35);
        expect(GHOST_GAIN).toBeLessThanOrEqual(0.45);
    });

    it('let-ring rings to the next note on the string, capped', () => {
        expect(fxDurationVolume(['let-ring'], base).duration).toBeCloseTo(2);
        expect(fxDurationVolume(['let-ring'], { ...base, stringGap: Infinity }).duration)
            .toBeCloseTo(LET_RING_MAX_SEC);
    });

    it('muted (palm mute) is short and softer', () => {
        const r = fxDurationVolume(['muted'], base);
        expect(r.duration).toBeCloseTo(MUTED_SEC);
        expect(r.volume).toBeCloseTo(0.7 * 0.7);
    });

    it('choke is cut short', () => {
        expect(fxDurationVolume(['choke'], { ...base, duration: 1 }).duration).toBeLessThanOrEqual(0.3);
    });

    it('combines: let-ring + ghost rings long AND quiet', () => {
        const r = fxDurationVolume(['ghost', 'let-ring'], base);
        expect(r.duration).toBeCloseTo(2);
        expect(r.volume).toBeCloseTo(0.7 * GHOST_GAIN);
    });

    it('slap is slightly accented; harmonics a touch softer and longer', () => {
        expect(fxDurationVolume(['slap'], base).volume).toBeGreaterThan(0.7);
        const h = fxDurationVolume(['harmonic'], base);
        expect(h.volume).toBeLessThan(0.7);
        expect(h.duration).toBeGreaterThan(0.4);
        expect(h.duration).toBeLessThanOrEqual(2);
    });
});

describe('noteAttacks', () => {
    const SPT = 0.001;
    const opts = { secondsPerTick: SPT, thirtySecondSec: 0.06 };
    const plain = () => ({ absTick: 0, midi: 62, duration: 0.5, volume: 0.7 });

    it('a plain note is one attack with no pitch waypoints (unchanged behaviour)', () => {
        expect(noteAttacks(plain(), opts)).toEqual([
            { offset: 0, midi: 62, duration: 0.5, volume: 0.7, slides: undefined },
        ]);
    });

    it('keeps legato legs and the tech-b bend', () => {
        const legs = noteAttacks({ ...plain(), legs: [{ toMidi: 64, atTick: 240, glide: false }] }, opts);
        expect(legs).toHaveLength(1);
        expect(legs[0].slides[1]).toEqual({ delta: 2, when: 0.24 });
        const bend = noteAttacks({ ...plain(), bend: true }, opts);
        expect(bend[0].slides[1].delta).toBe(0.5);
    });

    it('vibrato / bend-release / choke add pitch waypoints', () => {
        expect(noteAttacks({ ...plain(), fx: ['vibrato'] }, opts)[0].slides.length).toBeGreaterThan(4);
        expect(noteAttacks({ ...plain(), fx: ['bend-release'] }, opts)[0].slides[1].delta).toBe(2);
        expect(noteAttacks({ ...plain(), fx: ['choke'] }, opts)[0].slides[1].delta).toBe(1);
    });

    it('brush/roll offset shifts the attack', () => {
        const [a] = noteAttacks({ ...plain(), strumOffsetSec: 0.03 }, opts);
        expect(a.offset).toBeCloseTo(0.03);
    });

    it('tremolo re-attacks every 1/32', () => {
        const a = noteAttacks({ ...plain(), duration: 0.24, fx: ['tremolo'] }, opts);
        expect(a.map(x => x.offset)).toEqual([0, 0.06, 0.12, 0.18]);
        expect(a.every(x => x.midi === 62)).toBe(true);
        expect(a[1].volume).toBeLessThan(0.7);
    });

    it('a plain grace is a short separate attack just before the main note', () => {
        const a = noteAttacks({ ...plain(), grace: { midi: 60 } }, opts);
        expect(a).toHaveLength(2);
        expect(a[0].midi).toBe(60);
        expect(a[0].offset).toBeCloseTo(-GRACE_MAX_LEAD_SEC);
        expect(a[0].duration).toBeCloseTo(GRACE_MAX_LEAD_SEC);
        expect(a[1]).toMatchObject({ offset: 0, midi: 62, duration: 0.5 });
    });

    it('a hammer/slide grace is ONE pick that steps/glides into the main pitch', () => {
        for (const kind of ['hp', 'slide']) {
            const a = noteAttacks({ ...plain(), grace: { midi: 60, kind } }, opts);
            expect(a).toHaveLength(1);
            expect(a[0].midi).toBe(60);
            expect(a[0].offset).toBeCloseTo(-GRACE_MAX_LEAD_SEC);
            expect(a[0].duration).toBeCloseTo(0.5 + GRACE_MAX_LEAD_SEC);
            const last = a[0].slides[a[0].slides.length - 1];
            expect(last).toEqual({ delta: 2, when: expect.closeTo(GRACE_MAX_LEAD_SEC, 6) });
        }
    });

    it('a legato grace keeps the main note\'s own legato legs (shifted)', () => {
        const a = noteAttacks({ ...plain(), grace: { midi: 60, kind: 'hp' },
            legs: [{ toMidi: 64, atTick: 240, glide: false }] }, opts);
        expect(a).toHaveLength(1);
        const last = a[0].slides[a[0].slides.length - 1];
        expect(last.delta).toBe(4);
        expect(last.when).toBeCloseTo(0.24 + GRACE_MAX_LEAD_SEC);
    });

    it('the grace lead is 1/32 when that is shorter', () => {
        const a = noteAttacks({ ...plain(), grace: { midi: 60 } }, { ...opts, thirtySecondSec: 0.02 });
        expect(a[0].offset).toBeCloseTo(-0.02);
    });
});

// ---------------------------------------------------------------------------
// play() wiring, through a stub WebAudioFont player
// ---------------------------------------------------------------------------

function stubPlayer() {
    const calls = [];
    const node = () => ({
        gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        frequency: { value: 0 },
        connect() {}, disconnect() {}, start() {}, stop() {},
    });
    const ctx = {
        state: 'running', currentTime: 0, destination: {},
        createGain: node, createOscillator: node, resume: () => Promise.resolve(),
    };
    const p = new TabPlayer();
    p.init = async () => {
        p.audioContext = ctx;
        p.player = {
            queueWaveTable: (...args) => { calls.push(args); return {}; },
            cancelQueue() {},
        };
    };
    p.loadInstruments = async () => {};
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const sounded = () => calls.map(([, , , when, midi, duration, volume, slides]) =>
        ({ when, midi, duration, volume, slides }));
    return { p, sounded };
}

// 120 BPM, 480 tpq: one tick = 1/960 s; a quarter = 0.5 s
const SPT = 60 / 120 / 480;
const otf = (notes, extraEvents = []) => ({
    metadata: { tempo: 120 },
    timing: { ticks_per_beat: 480 },
    tracks: [{ id: 'bj', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
    notation: { bj: [{ measure: 1, events: [{ tick: 480, notes }, ...extraEvents] }] },
});

afterEach(() => vi.unstubAllGlobals());

describe('TabPlayer.play() with fx and grace', () => {
    it('plays a brushed chord low string to high, first attack on the tick', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(otf([1, 2, 3, 4].map(s => ({ s, f: 0, fx: ['brush'] }))));
        const s = sounded().sort((a, b) => a.when - b.when);
        expect(s.map(n => n.midi)).toEqual([50, 55, 59, 62]);   // s4, s3, s2, s1
        const spread = s[3].when - s[0].when;
        expect(spread).toBeGreaterThan(0.03);
        expect(spread).toBeLessThanOrEqual(BRUSH_MAX_SEC + 1e-9);
        expect(s[0].when - p.playbackStartTime).toBeCloseTo(480 * SPT);
    });

    it('a grace note sounds just before its main note; highlight keys the main tick', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(otf([{ s: 3, f: 2, grace: { f: 0 } }]));
        const s = sounded().sort((a, b) => a.when - b.when);
        expect(s.map(n => n.midi)).toEqual([55, 57]);
        expect(s[1].when - p.playbackStartTime).toBeCloseTo(480 * SPT);
        expect(s[1].when - s[0].when).toBeCloseTo(GRACE_MAX_LEAD_SEC);
        expect(p._scheduledNotes.map(n => n.absTick)).toEqual([480]);
    });

    it('a hammer grace is one pick; transpose applies to the grace too', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(otf([{ s: 3, f: 2, grace: { f: 0, kind: 'hp' } }]), { transpose: 2 });
        const s = sounded();
        expect(s).toHaveLength(1);
        expect(s[0].midi).toBe(57);                               // open G3 + capo 2
        expect(s[0].slides[s[0].slides.length - 1].delta).toBe(2); // steps to fret 2
    });

    it('play-from-cursor clips the grace with its main note', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(otf([{ s: 3, f: 2, grace: { f: 0 } }],
            [{ tick: 960, notes: [{ s: 1, f: 0 }] }]), { startTick: 960 });
        expect(sounded().map(n => n.midi)).toEqual([62]);
    });

    it('a natural harmonic at the 12th sounds an octave above the open string', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(otf([{ s: 4, f: 12, fx: ['harmonic'] }]));
        expect(sounded()[0].midi).toBe(62);
    });

    it('let-ring outlasts the next column, staccato halves, ghost is quieter', async () => {
        const run = async (fx) => {
            const { p, sounded } = stubPlayer();
            await p.play(otf([{ s: 3, f: 0, dur: 240, ...(fx ? { fx } : {}) }],
                [{ tick: 720, notes: [{ s: 1, f: 0, dur: 240 }] },
                 { tick: 1440, notes: [{ s: 3, f: 2, dur: 240 }] }]));
            return sounded().find(n => n.midi === 55);
        };
        const plain = await run();
        expect(plain.duration).toBeCloseTo(240 * SPT);
        expect((await run(['let-ring'])).duration).toBeCloseTo(960 * SPT); // to the next s3 note
        expect((await run(['staccato'])).duration).toBeCloseTo(120 * SPT);
        expect((await run(['ghost'])).volume).toBeCloseTo(plain.volume * GHOST_GAIN);
    });

    it('notes without fx schedule exactly as before', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(otf([{ s: 3, f: 0, dur: 240 }, { s: 1, f: 0, dur: 240 }]));
        const s = sounded();
        expect(s).toHaveLength(2);
        expect(s.every(n => n.slides === undefined)).toBe(true);
        for (const n of s) expect(n.when - p.playbackStartTime).toBeCloseTo(480 * SPT, 9);
    });
});
