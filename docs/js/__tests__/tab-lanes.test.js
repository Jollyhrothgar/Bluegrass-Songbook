// G21c: the pure layout under a tab's annotation lanes (renderers/tab-lanes.js).
import { describe, it, expect } from 'vitest';
import {
    assignLanes, laneStack, belowBaseline, bendSources, chordParts, chordGlyphRuns,
    chordLaneRuns, chordRunsWidth, estimateTextWidth,
    BASE_ZONE, LEGACY_PAD, FX_LANE_H, TEXT_LANE_H, LH_LANE_H, CHORD_NAME_H, SECTION_H,
} from '../renderers/tab-lanes.js';

/** Ranges per lane never intersect (a gap apart). */
function noOverlap(items, res, gap = 6) {
    const byLane = new Map();
    items.forEach((it, i) => {
        const l = res.lane[i];
        if (!byLane.has(l)) byLane.set(l, []);
        byLane.get(l).push([res.x[i], res.x[i] + it.w]);
    });
    for (const spans of byLane.values()) {
        spans.sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < spans.length; i++) {
            if (spans[i][0] < spans[i - 1][1] + gap - 1e-9) return false;
        }
    }
    return true;
}

describe('assignLanes', () => {
    it('keeps items that fit on lane 0', () => {
        const r = assignLanes([{ x: 0, w: 20 }, { x: 40, w: 20 }, { x: 80, w: 20 }]);
        expect(r.lane).toEqual([0, 0, 0]);
        expect(r.count).toBe(1);
    });

    it('puts a collision on the next lane, however many it takes', () => {
        const items = [{ x: 10, w: 60 }, { x: 12, w: 60 }, { x: 14, w: 60 }, { x: 16, w: 60 }];
        const r = assignLanes(items);
        expect(r.lane).toEqual([0, 1, 2, 3]);
        expect(r.count).toBe(4);
        expect(noOverlap(items, r)).toBe(true);
    });

    it('places in tick order, whatever order the array is in', () => {
        // array order: the later text first. The earlier one still gets lane 0.
        const r = assignLanes([{ x: 100, w: 30 }, { x: 90, w: 30 }]);
        expect(r.lane).toEqual([1, 0]);
    });

    it('reuses a lane once its text has ended', () => {
        const r = assignLanes([{ x: 0, w: 50 }, { x: 10, w: 50 }, { x: 70, w: 20 }]);
        expect(r.lane).toEqual([0, 1, 0]);
    });

    it('needs a gap, not just no touching', () => {
        expect(assignLanes([{ x: 0, w: 50 }, { x: 52, w: 10 }]).lane).toEqual([0, 1]);
        expect(assignLanes([{ x: 0, w: 50 }, { x: 56, w: 10 }]).lane).toEqual([0, 0]);
    });

    it('slides an item that would leave the row and still avoids overlap', () => {
        const items = [{ x: 180, w: 60 }, { x: 195, w: 30 }];
        const r = assignLanes(items, { min: 10, max: 200 });
        expect(r.x[0]).toBe(140);                     // ends at the row's edge
        expect(r.x[1]).toBe(170);
        expect(noOverlap(items, r)).toBe(true);
        expect(r.x.every((x, i) => x + items[i].w <= 200)).toBe(true);
    });

    it('is stable for a thousand random items (no two overlap)', () => {
        let seed = 7;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const items = Array.from({ length: 1000 }, () => ({ x: rnd() * 900, w: 10 + rnd() * 90 }));
        const r = assignLanes(items, { min: 0, max: 1000 });
        expect(noOverlap(items, r)).toBe(true);
    });

    it('handles nothing', () => {
        expect(assignLanes([])).toEqual({ lane: [], x: [], count: 0 });
    });
});

describe('laneStack: the band is sized from what it holds', () => {
    it('a tab with none of it lays out as before: 40 above the first string', () => {
        expect(laneStack({}).topMargin).toBe(LEGACY_PAD + BASE_ZONE);
        expect(laneStack({}).topMargin).toBe(40);
    });

    it('effects lanes add 11 each, with the baselines they always had', () => {
        const s = laneStack({ fx: 2 });
        expect(s.topMargin).toBe(40 + 2 * FX_LANE_H);
        expect(s.topMargin - s.fx[0]).toBe(30);       // the point lane
        expect(s.topMargin - s.fx[1]).toBe(41);       // the run lane above it
    });

    it('stacks outward in Mike\'s order: fx, left hand, text, chord diagrams, chord names, section', () => {
        const s = laneStack({ section: true, chordNames: 1, chordDiagrams: 45, textAbove: 2, lh: true, fx: 1 });
        const ys = [s.fx[0], s.lhCenter, s.textAbove[0], s.textAbove[1], s.chordDiagramTop, s.chordNames[0], s.sectionBaseline];
        for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
        expect(s.topMargin).toBe(SECTION_H + CHORD_NAME_H + 45 + 2 * TEXT_LANE_H + LH_LANE_H + FX_LANE_H + BASE_ZONE);
    });

    it('a lane exists only when something is in it', () => {
        const base = laneStack({ fx: 1 }).topMargin;
        expect(laneStack({ fx: 1, lh: true }).topMargin).toBe(base + LH_LANE_H);
        expect(laneStack({ fx: 1, textAbove: 3 }).topMargin).toBe(base + 3 * TEXT_LANE_H);
        expect(laneStack({ textBelow: 2 }).topMargin).toBe(40);   // below the staff adds no headroom
        expect(laneStack({ textBelow: 2 }).belowExtra).toBe(2 * TEXT_LANE_H);
        expect(laneStack({}).belowExtra).toBe(0);
    });

    it('every baseline is inside the stack, below the section name, above the staff', () => {
        const s = laneStack({ section: true, chordNames: 2, textAbove: 3, lh: true, fx: 2 });
        const all = [...s.chordNames, ...s.textAbove, s.lhCenter, ...s.fx];
        for (const y of all) { expect(y).toBeGreaterThan(SECTION_H); expect(y).toBeLessThan(s.topMargin - BASE_ZONE); }
        expect(new Set(all).size).toBe(all.length);
    });

    it('below-the-staff lanes step down by their height', () => {
        expect(belowBaseline(100, 1) - belowBaseline(100, 0)).toBe(TEXT_LANE_H);
    });
});

describe('bendSources: one mark per bend', () => {
    const row = (...events) => [{ measure: 1, events }];
    it('a bend whose next note on the string is a b target is a source', () => {
        const src = { s: 3, f: 3, fx: ['bend'] };
        const m = row({ tick: 0, notes: [src] }, { tick: 480, notes: [{ s: 3, f: 4, tech: 'b' }] });
        expect([...bendSources(m)]).toEqual([src]);
    });
    it('also bend-release, and across a barline', () => {
        const src = { s: 2, f: 5, fx: ['bend-release'] };
        const m = [{ measure: 1, events: [{ tick: 1680, notes: [src] }] },
            { measure: 2, events: [{ tick: 0, notes: [{ s: 2, f: 7, tech: 'b' }] }] }];
        expect(bendSources(m).has(src)).toBe(true);
    });
    it('a bend with no target keeps its mark', () => {
        const src = { s: 3, f: 3, fx: ['bend'] };
        expect(bendSources(row({ tick: 0, notes: [src] })).size).toBe(0);
        // another string's b note is not its target
        expect(bendSources(row({ tick: 0, notes: [src] },
            { tick: 480, notes: [{ s: 4, f: 4, tech: 'b' }] })).size).toBe(0);
        // a plain note in between: the b note is no longer "next"
        expect(bendSources(row({ tick: 0, notes: [src] }, { tick: 240, notes: [{ s: 3, f: 3 }] },
            { tick: 480, notes: [{ s: 3, f: 4, tech: 'b' }] })).size).toBe(0);
    });
    it('a choke is not a bend', () => {
        const src = { s: 3, f: 3, fx: ['choke'] };
        expect(bendSources(row({ tick: 0, notes: [src] },
            { tick: 480, notes: [{ s: 3, f: 4, tech: 'b' }] })).size).toBe(0);
    });
});

describe('the chord adapter: the shared parser when there is one, the text as written when not', () => {
    const stub = (text) => ({
        'A (G)': { chord: 'A', optional: false, shape: 'G', ext: null },
        '(em)': { chord: 'Em', optional: true, shape: null, ext: null },
        'A(7)': { chord: 'A', optional: false, shape: null, ext: '7' },
    })[text] || null;

    it('without a parser, the text is drawn as written', () => {
        const parts = chordParts('em', null);
        expect(chordLaneRuns(parts)).toEqual([{ kind: 'main', text: 'em' }]);
        expect(chordParts('em', undefined).raw).toBe(true);
    });

    it('a parser that does not take the text leaves it as written', () => {
        expect(chordLaneRuns(chordParts('Banjo break', stub))).toEqual([{ kind: 'main', text: 'Banjo break' }]);
    });

    it('with a parser: chord, optional in parentheses, ext as a superscript, shape small after', () => {
        expect(chordLaneRuns(chordParts('(em)', stub)).map(r => r.text).join('')).toBe('(Em)');
        expect(chordLaneRuns(chordParts('A(7)', stub))).toEqual([
            { kind: 'main', text: 'A' }, { kind: 'sup', text: '(7)' }]);
        const shaped = chordLaneRuns(chordParts('A (G)', stub));
        expect(shaped.map(r => r.text).join('')).toBe('A (G)');
        expect(shaped.slice(1).every(r => r.kind === 'shape')).toBe(true);
    });

    it('draws the app\'s chord glyphs: accidental sign, minor, superscript extension, bass', () => {
        expect(chordGlyphRuns('F#m7')).toEqual([{ kind: 'main', text: 'F♯m' }, { kind: 'sup', text: '7' }]);
        expect(chordGlyphRuns('Bb')).toEqual([{ kind: 'main', text: 'B♭' }]);
        expect(chordGlyphRuns('D/F#')).toEqual([{ kind: 'main', text: 'D' }, { kind: 'small', text: '/F♯' }]);
        expect(chordGlyphRuns('G')).toEqual([{ kind: 'main', text: 'G' }]);
    });

    it('a width estimate that grows with the text', () => {
        const a = chordRunsWidth(chordLaneRuns(chordParts('G', stub)));
        const b = chordRunsWidth(chordLaneRuns(chordParts('A (G)', stub)));
        expect(b).toBeGreaterThan(a);
        expect(estimateTextWidth('abcd')).toBeGreaterThan(estimateTextWidth('ab'));
    });
});
