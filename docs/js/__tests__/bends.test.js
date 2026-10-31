// Bends (G15d2, closes #184): the amount is the fret difference between the
// bent note and the next note on its string, which is not picked again.
// Importer parity is pinned by tef-import-golden (the bend_* fixtures) and
// tests/parser/test_tef_bends.py; this file pins the renderer label, the
// player, and the TablEdit oracle shape.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { TabRenderer, bendLabel } from '../renderers/tablature.js';
import { TabPlayer, absorbBend, bendIntoWaypoints, noteAttacks } from '../renderers/tab-player.js';

describe('bendLabel (TablEdit: 1 = ½, 2 = full, 3 = 1½, 4 = 2)', () => {
    it('labels from the fret difference', () => {
        expect([1, 2, 3, 4].map(bendLabel)).toEqual(['½', 'full', '1½', '2']);
        expect(bendLabel(5)).toBe('2½');
    });
    it('prints no sign, and nothing for no bend', () => {
        expect(bendLabel(-2)).toBe('full');
        expect(bendLabel(0)).toBe('');
    });
});

const TRACK = { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] };
function render(events) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    new TabRenderer(container, {}).render(TRACK, [{ measure: 1, events }], 480, '4/4');
    return container;
}
const bend = (f0, f1) => render([
    { tick: 0, notes: [{ s: 3, f: f0, fx: ['bend'] }] },
    { tick: 480, notes: [{ s: 3, f: f1, tech: 'b' }] },
]);

describe('bend drawing', () => {
    it('labels the target arrow from the fret difference, not always ½', () => {
        const label = (c) => c.querySelector('.bend-amount').textContent;
        expect(label(bend(3, 4))).toBe('½');
        expect(label(bend(3, 5))).toBe('full');
        expect(label(bend(3, 6))).toBe('1½');
        expect(label(bend(3, 7))).toBe('2');
    });
    it('draws ONE mark per bend: the arrow on the target, nothing in the band', () => {
        const c = bend(3, 4);
        expect(c.querySelectorAll('.bend-arrow')).toHaveLength(1);
        expect(c.querySelectorAll('.fx-bend')).toHaveLength(0);
        expect(c.querySelectorAll('.fx-bend-release')).toHaveLength(0);
    });
    it('reserves no effects lane for a bend that has its target', () => {
        const plain = render([{ tick: 0, notes: [{ s: 3, f: 3 }] }]);
        const paired = bend(3, 4);
        const topMargin = (c) => Math.min(...[...c.querySelectorAll('.stave-row svg > line')]
            .filter(l => l.getAttribute('y1') === l.getAttribute('y2')).map(l => Number(l.getAttribute('y1'))));
        expect(topMargin(paired)).toBe(topMargin(plain));
    });
    it('a bend-release with its target is also one mark', () => {
        const c = render([
            { tick: 0, notes: [{ s: 3, f: 5, fx: ['bend-release'] }] },
            { tick: 480, notes: [{ s: 3, f: 7, tech: 'b' }] },
        ]);
        expect(c.querySelectorAll('.bend-arrow')).toHaveLength(1);
        expect(c.querySelectorAll('.fx-bend-release')).toHaveLength(0);
    });
    it('a bend with no target keeps its band mark', () => {
        const c = render([{ tick: 0, notes: [{ s: 3, f: 3, fx: ['bend'] }] }]);
        expect(c.querySelectorAll('.bend-arrow')).toHaveLength(0);
        expect(c.querySelectorAll('.fx-bend')).toHaveLength(1);
    });
    it('a bend whose target is on another string keeps its band mark', () => {
        const c = render([
            { tick: 0, notes: [{ s: 3, f: 3, fx: ['bend'] }] },
            { tick: 480, notes: [{ s: 4, f: 4, tech: 'b' }] },
        ]);
        expect(c.querySelectorAll('.fx-bend')).toHaveLength(1);
    });
    it('a target far from its source (a half note on) still takes the one mark', () => {
        const c = render([
            { tick: 0, notes: [{ s: 3, f: 3, fx: ['bend'] }] },
            { tick: 1440, notes: [{ s: 3, f: 4, tech: 'b' }] },
        ]);
        expect(c.querySelectorAll('.bend-arrow')).toHaveLength(1);
        expect(c.querySelectorAll('.fx-bend')).toHaveLength(0);
    });
    it('a source whose target starts the next row keeps its band mark (no arrow can reach it)', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const measures = Array.from({ length: 12 }, (_, i) => ({ measure: i + 1, events: [] }));
        const r = new TabRenderer(container, { measuresPerRow: 4 });
        measures[3].events = [{ tick: 1680, notes: [{ s: 3, f: 3, fx: ['bend'] }] }];
        measures[4].events = [{ tick: 0, notes: [{ s: 3, f: 4, tech: 'b' }] }];
        r.render(TRACK, measures, 480, '4/4');
        expect(container.querySelectorAll('.fx-bend')).toHaveLength(1);
    });
});

describe('absorbBend', () => {
    const src = (fx = ['bend']) => ({ s: 3, midi: 60, fx, absTick: 0 });
    it('folds the next tech-b note on the string into the bent note', () => {
        const last = { 3: src() };
        expect(absorbBend(last, { s: 3, tech: 'b', dur: 240 }, 61, 240)).toBe(true);
        expect(last[3].bendTo).toEqual({ deltaSemitones: 1, atTick: 240 });
        expect(last[3].explicitEndTick).toBe(480);
    });
    it('keeps the sign of a downward bend', () => {
        const last = { 3: src() };
        absorbBend(last, { s: 3, tech: 'b', dur: 240 }, 58, 240);
        expect(last[3].bendTo.deltaSemitones).toBe(-2);
    });
    it('plays an orphan tech-b note (no bent source) normally', () => {
        expect(absorbBend({ 3: src([]) }, { s: 3, tech: 'b' }, 61, 240)).toBe(false);
        expect(absorbBend({}, { s: 3, tech: 'b' }, 61, 240)).toBe(false);
    });
    it('leaves a choke alone and only absorbs once', () => {
        expect(absorbBend({ 3: src(['choke']) }, { s: 3, tech: 'b' }, 61, 240)).toBe(false);
        const last = { 3: src() };
        expect(absorbBend(last, { s: 3, tech: 'b', dur: 1 }, 61, 240)).toBe(true);
        expect(absorbBend(last, { s: 3, tech: 'b', dur: 1 }, 62, 480)).toBe(false);
    });
    it('does not absorb a plain note', () => {
        expect(absorbBend({ 3: src() }, { s: 3 }, 61, 240)).toBe(false);
    });
});

describe('bendIntoWaypoints', () => {
    it('ramps to the fret difference over the source length and holds', () => {
        expect(bendIntoWaypoints(2, 0.25, 0.5, false)).toEqual([
            { delta: 0, when: 0 }, { delta: 2, when: 0.25 }]);
    });
    it('bend-release comes back down', () => {
        const wp = bendIntoWaypoints(2, 0.25, 0.75, true);
        expect(wp[1]).toEqual({ delta: 2, when: 0.25 });
        expect(wp.at(-1)).toEqual({ delta: 0, when: 0.75 });
    });
});

// 120 BPM, 480 tpq: one tick = 1/960 s
const SPT = 60 / 120 / 480;
function stubPlayer() {
    const calls = [];
    const node = () => ({
        gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {},
    });
    const ctx = {
        state: 'running', currentTime: 0, destination: {},
        createGain: node, createOscillator: node, resume: () => Promise.resolve(),
    };
    const p = new TabPlayer();
    p.init = async () => {
        p.audioContext = ctx;
        p.player = { queueWaveTable: (...a) => { calls.push(a); return {}; }, cancelQueue() {} };
    };
    p.loadInstruments = async () => {};
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const sounded = () => calls.map(([, , , when, midi, duration, volume, slides]) =>
        ({ when, midi, duration, volume, slides }));
    return { p, sounded };
}
const doc = (events) => ({
    metadata: { tempo: 120 }, timing: { ticks_per_beat: 480 },
    tracks: [{ id: 'bj', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
    notation: { bj: [{ measure: 1, events }] },
});

afterEach(() => vi.unstubAllGlobals());

describe('TabPlayer.play(): bends', () => {
    // The shape of TablEdit's own MIDI for Welcome to New York's bend
    // (spike/oracle; pinned in tests/parser/test_bends_oracle.py): ONE
    // note-on covers source and destination, and the pitch ramps to the
    // fret difference (+1 semitone) across the source note.
    it('a bend is one attack that ramps to the fret difference', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(doc([
            { tick: 0, notes: [{ s: 3, f: 5, dur: 240, fx: ['bend'] }] },
            { tick: 240, notes: [{ s: 3, f: 6, dur: 240, tech: 'b' }] },
            { tick: 960, notes: [{ s: 3, f: 0, dur: 240 }] },
        ]));
        const s = sounded().sort((a, b) => a.when - b.when);
        expect(s).toHaveLength(2);                       // not 3: the target is not re-attacked
        expect(s[0].midi).toBe(60);
        expect(s[0].slides.at(-1).delta).toBe(1);
        expect(s[0].slides.at(-1).when).toBeCloseTo(240 * SPT);
        expect(s[0].duration).toBeGreaterThanOrEqual(480 * SPT - 1e-9);   // source + target
    });

    it('a two-fret bend-release reaches a whole step and returns to pitch', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(doc([
            { tick: 0, notes: [{ s: 3, f: 5, dur: 240, fx: ['bend-release'] }] },
            { tick: 240, notes: [{ s: 3, f: 7, dur: 480, tech: 'b' }] },
        ]));
        const s = sounded();
        expect(s).toHaveLength(1);
        const wp = s[0].slides;
        expect(Math.max(...wp.map(w => w.delta))).toBe(2);
        expect(wp.at(-1).delta).toBe(0);
    });

    it('a bend into a later measure is still one attack', async () => {
        const { p, sounded } = stubPlayer();
        await p.play({
            ...doc([]),
            notation: { bj: [
                { measure: 1, events: [{ tick: 1680, notes: [{ s: 3, f: 3, dur: 240, fx: ['bend'] }] }] },
                { measure: 2, events: [{ tick: 0, notes: [{ s: 3, f: 4, dur: 240, tech: 'b' }] }] },
            ] },
        });
        expect(sounded()).toHaveLength(1);
        expect(sounded()[0].slides.at(-1).delta).toBe(1);
    });

    it('a bend with no destination sounds as a plain note; a choke is unchanged', async () => {
        const { p, sounded } = stubPlayer();
        await p.play(doc([{ tick: 0, notes: [{ s: 3, f: 5, dur: 240, fx: ['bend'] }] }]));
        expect(sounded()[0].slides).toBeUndefined();
        const choke = noteAttacks({ midi: 62, duration: 0.5, volume: 0.7, absTick: 0, fx: ['choke'] },
            { secondsPerTick: SPT, thirtySecondSec: 0.0625 });
        expect(choke[0].slides[1].delta).toBe(1);
    });
});
