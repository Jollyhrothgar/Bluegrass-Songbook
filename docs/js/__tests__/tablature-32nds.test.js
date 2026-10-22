// 32nd notes are drawn as 32nds (fix-it A21 follow-up).
//
// The renderer placed rhythm on a 16th-note grid (`pos16th`), so two 32nds
// in one 16th slot had a "gap" of zero: no second beam joined them, no
// third beam existed at all, and a lone 32nd got two flags. Rests were
// split largest-first from wherever the silence began, so a 32nd on beat 1
// was followed by a half rest straddling beats 1-3 instead of the
// 32nd-16th-8th that fill out the beat. Mike hit all of it the moment the
// editor's horizontal zoom made 32nd entry usable.
import { describe, it, expect, afterEach } from 'vitest';

import { TabRenderer, restGlyphSequence } from '../renderers/tablature.js';

const TRACK = {
    id: 'banjo',
    instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};

function render(events, options = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const r = new TabRenderer(container, { measuresPerRow: 1, ...options });
    r.render(TRACK, [{ measure: 1, events }], 480, '4/4');
    return container;
}

const note = (tick, dur, s = 3, f = 0) => ({ tick, notes: [{ s, f, ...(dur ? { dur } : {}) }] });
const beams = (c, level) => [...c.querySelectorAll(`rect[data-beam="${level}"]`)];
const flags = (c) => [...c.querySelectorAll('svg path')]
    .filter(p => p.getAttribute('fill') !== 'none');

afterEach(() => { document.body.innerHTML = ''; });

describe('beams', () => {
    it('four 32nds in a beat: one group, three full beams', () => {
        const c = render([0, 60, 120, 180].map(t => note(t, 60)));
        expect(beams(c, 1)).toHaveLength(1);
        // levels 2 and 3 join each consecutive pair: 3 segments apiece
        expect(beams(c, 2)).toHaveLength(3);
        expect(beams(c, 3)).toHaveLength(3);
        expect(flags(c)).toHaveLength(0);
    });

    it('the same, written without durations (gap inference)', () => {
        const c = render([0, 60, 120, 180].map(t => note(t, null)).concat(note(240, null)));
        expect(beams(c, 3).length).toBeGreaterThan(0);
    });

    it('a 16th then two 32nds: two beams across, a third only on the 32nds', () => {
        const c = render([note(0, 120), note(120, 60), note(180, 60)]);
        expect(beams(c, 2)).toHaveLength(2);
        expect(beams(c, 3)).toHaveLength(1);
        const b3 = beams(c, 3)[0];
        const b2 = beams(c, 2)[0];
        // the third beam starts at the first 32nd, not the 16th
        expect(Number(b3.getAttribute('x'))).toBeGreaterThan(Number(b2.getAttribute('x')));
    });

    it('a dotted 16th + 32nd: the 32nd gets a third-beam stub', () => {
        const c = render([note(0, 180), note(180, 60)]);
        expect(beams(c, 2)).toHaveLength(1);
        expect(beams(c, 3)).toHaveLength(1);           // the stub
        const stub = beams(c, 3)[0];
        expect(Number(stub.getAttribute('width'))).toBeLessThan(10);
    });

    it('16th-only beats draw no third beam (unchanged)', () => {
        const c = render([0, 120, 240, 360].map(t => note(t, 120)));
        expect(beams(c, 2)).toHaveLength(3);
        expect(beams(c, 3)).toHaveLength(0);
    });

    it('stems reach the highest beam they carry', () => {
        const c = render([0, 60, 120, 180].map(t => note(t, 60)));
        const top3 = Number(beams(c, 3)[0].getAttribute('y'));
        const stems = [...c.querySelectorAll('line')]
            .filter(l => l.getAttribute('stroke-width') === '1.5'
                && l.getAttribute('x1') === l.getAttribute('x2'));
        const ends = stems.map(l => Math.min(Number(l.getAttribute('y1')), Number(l.getAttribute('y2'))));
        // every stem in the group ends at the third beam's line, or beyond it toward the staff
        for (const e of ends.slice(-4)) expect(e).toBeLessThanOrEqual(top3 + 3);
    });
});

describe('flags', () => {
    it('a lone 32nd gets three flags', () => {
        const c = render([note(0, 60), note(480, 480)]);
        expect(flags(c)).toHaveLength(3);
    });

    it('a lone 16th still gets two, an 8th one', () => {
        expect(flags(render([note(0, 120), note(480, 480)]))).toHaveLength(2);
        expect(flags(render([note(0, 240), note(480, 480)]))).toHaveLength(1);
    });
});

describe('rests line up with the beat', () => {
    it('restGlyphSequence(len, start) fills to the beat before larger values', () => {
        // after a 32nd on beat 1: 32nd, 16th, 8th rest finish the beat,
        // then a quarter (beat 2) and a half (beats 3-4)
        expect(restGlyphSequence(1860, 60).map(r => r.ticks))
            .toEqual([60, 120, 240, 480, 960]);
    });

    it('a span starting on beat 2 is a quarter, then a half (TablEdit\'s manual)', () => {
        // "TablEdit will enter a 1/4 rest and a 1/2 rest to fill out the
        // first measure"
        expect(restGlyphSequence(1440, 480).map(r => r.ticks)).toEqual([480, 960]);
    });

    it('without a start it still decomposes largest-first', () => {
        expect(restGlyphSequence(1440).map(r => r.ticks)).toEqual([960, 480]);
    });

    it('the renderer draws the aligned sequence', () => {
        TabRenderer._bravuraReady = true;
        const c = render([note(0, 60)]);
        const glyphs = [...c.querySelectorAll('.rest-glyph')].map(g => g.textContent);
        // 32nd, 16th, 8th, quarter, half (SMuFL E4E8 E4E7 E4E6 E4E5 E4E4)
        expect(glyphs).toEqual(['', '', '', '', '']);
    });

    it('a short rest stays inside its own span (never past the next onset)', () => {
        TabRenderer._bravuraReady = true;
        const c = render([note(0, 60), note(120, 60), note(180, 60)]);
        const r = c.querySelector('.rest-glyph');           // the 32nd rest at tick 60
        const digits = [...c.querySelectorAll('text.note-text')];
        const xNext = Number(digits[1].getAttribute('x'));  // the note at tick 120
        const xRest = Number(r.getAttribute('x'));
        expect(xRest).toBeLessThan(xNext);
        const xPrev = Number(digits[0].getAttribute('x'));
        expect(xRest).toBeGreaterThan(xPrev);
    });
});
