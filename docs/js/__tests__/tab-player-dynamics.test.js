// G15d1: dynamics are PLAYED. Velocity follows TablEdit (127 - 16 * code, f = 95),
// normalised to the track's level so a track at one level sounds as it always did.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TabPlayer, dynamicVelocity, dynamicGain } from '../renderers/tab-player.js';

describe('dynamicVelocity', () => {
    it('is TablEdit\'s 127 - 16 * code, loudest first', () => {
        const levels = ['fff', 'ff', 'f', 'mf', 'mp', 'p', 'pp'];
        expect(levels.map(dynamicVelocity)).toEqual([127, 111, 95, 79, 63, 47, 31]);
    });
    it('treats a missing level as f', () => {
        expect(dynamicVelocity(undefined)).toBe(95);
        expect(dynamicVelocity(null)).toBe(95);
    });
});

describe('dynamicGain', () => {
    it('is exactly 1 for a note with no dyn, whatever the track level', () => {
        for (const t of [undefined, 'fff', 'f', 'pp']) expect(dynamicGain(undefined, t)).toBe(1);
    });
    it('is the velocity ratio to the track level for a note that differs', () => {
        expect(dynamicGain('mf', 'f')).toBeCloseTo(79 / 95);
        expect(dynamicGain('fff', 'f')).toBeCloseTo(127 / 95);
        expect(dynamicGain('f', 'fff')).toBeCloseTo(95 / 127);
        expect(dynamicGain('mp', undefined)).toBeCloseTo(63 / 95);   // no track dyn = f
    });
});

function stubPlayer() {
    const calls = [];
    const node = () => ({
        gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {},
    });
    const ctx = { state: 'running', currentTime: 0, destination: {},
        createGain: node, createOscillator: node, resume: () => Promise.resolve() };
    const p = new TabPlayer();
    p.init = async () => {
        p.audioContext = ctx;
        p.player = { queueWaveTable: (...a) => { calls.push(a); return {}; }, cancelQueue() {} };
    };
    p.loadInstruments = async () => {};
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    return { p, volumes: () => calls.map(a => a[6]) };
}
afterEach(() => vi.unstubAllGlobals());

const doc = (trackDyn, notes) => ({
    metadata: { tempo: 120 },
    timing: { ticks_per_beat: 480 },
    tracks: [{ id: 'bj', instrument: '5-string-banjo',
        tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], ...(trackDyn ? { dyn: trackDyn } : {}) }],
    notation: { bj: [{ measure: 1, events: notes.map((n, i) => ({ tick: 480 * i, notes: [n] })) }] },
});
const plain = [{ s: 1, f: 0 }, { s: 2, f: 0 }, { s: 3, f: 0 }];

async function volumesOf(d) {
    const { p, volumes } = stubPlayer();
    await p.play(d);
    return volumes();
}

describe('TabPlayer.play() with dynamics', () => {
    it('a track at one level sounds exactly as it does without dynamics, at any level', async () => {
        const base = await volumesOf(doc(undefined, plain));
        for (const level of ['fff', 'f', 'mp', 'pp']) {
            expect(await volumesOf(doc(level, plain))).toEqual(base);
        }
    });

    it('a note louder or quieter than its track is scaled by the velocity ratio', async () => {
        const base = await volumesOf(doc(undefined, plain));
        const v = await volumesOf(doc('f', [
            { s: 1, f: 0, dyn: 'fff' }, { s: 2, f: 0 }, { s: 3, f: 0, dyn: 'mp' }]));
        expect(v[0]).toBeCloseTo(base[0] * 127 / 95);
        expect(v[1]).toBeCloseTo(base[1]);
        expect(v[2]).toBeCloseTo(base[2] * 63 / 95);
    });

    it('the track level is the reference, not f', async () => {
        const base = await volumesOf(doc(undefined, plain));
        const v = await volumesOf(doc('mf', [{ s: 1, f: 0, dyn: 'f' }, { s: 2, f: 0 }, { s: 3, f: 0 }]));
        expect(v[0]).toBeCloseTo(base[0] * 95 / 79);
        expect(v[1]).toBeCloseTo(base[1]);
    });

    it('still multiplies with the fx gains', async () => {
        const base = await volumesOf(doc(undefined, [{ s: 1, f: 0, fx: ['ghost'] }]));
        const v = await volumesOf(doc('f', [{ s: 1, f: 0, fx: ['ghost'], dyn: 'mf' }]));
        expect(v[0]).toBeCloseTo(base[0] * 79 / 95);
    });
});
