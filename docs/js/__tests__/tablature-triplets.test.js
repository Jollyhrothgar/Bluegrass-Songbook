// Triplet brackets for every triplet the converter and the editor produce
// (fix-it A15). The detector used to accept only onsets 70-90 ticks apart —
// a 16th triplet — so eighth triplets (160 apart, the common bluegrass
// case, and what the editor types) and quarter triplets (320) never got a
// "3". TablEdit marks tuplets in 153 corpus files.

import { describe, it, expect, afterEach } from 'vitest';

import { TabRenderer } from '../renderers/tablature.js';

const TRACK = { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] };

afterEach(() => { document.body.innerHTML = ''; });

function render(events) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    new TabRenderer(container).render(TRACK, [{ measure: 1, events }], 480, '4/4');
    return container;
}

const ev = (tick, dur, f = 0) => ({ tick, notes: [{ s: 3, f, dur }] });

describe('triplet brackets', () => {
    it('brackets an eighth-note triplet (160-tick spacing)', () => {
        const c = render([ev(0, 160), ev(160, 160, 2), ev(320, 160), ev(480, 240), ev(720, 240)]);
        expect(c.querySelectorAll('.triplet-label')).toHaveLength(1);
    });

    it('brackets a 16th-note triplet (80-tick spacing)', () => {
        const c = render([ev(0, 80), ev(80, 80, 2), ev(160, 80), ev(240, 240)]);
        expect(c.querySelectorAll('.triplet-label')).toHaveLength(1);
    });

    it('brackets a quarter-note triplet (320-tick spacing)', () => {
        const c = render([ev(0, 320), ev(320, 320, 2), ev(640, 320), ev(960, 960)]);
        expect(c.querySelectorAll('.triplet-label')).toHaveLength(1);
    });

    it('does not bracket straight eighths', () => {
        const c = render([ev(0, 240), ev(240, 240), ev(480, 240), ev(720, 240)]);
        expect(c.querySelectorAll('.triplet-label')).toHaveLength(0);
    });

    it('does not bracket three evenly spaced notes that start off the triplet span', () => {
        // 160 apart but starting at tick 80: not a triplet grouping.
        const c = render([ev(80, 160), ev(240, 160), ev(400, 160)]);
        expect(c.querySelectorAll('.triplet-label')).toHaveLength(0);
    });
});
