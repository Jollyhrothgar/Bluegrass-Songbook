// Technique slurs (slide / hammer-on / pull-off) must be VISIBLE.
//
// Regression guard for the invisible-slide bug: renderSlurs used to gate
// technique arcs behind a fixed 60px proximity cap, so any slide spanning a
// quarter note or more was silently dropped — no arc, no "sl" label, and the
// tech-symbol fallback in the note loop deliberately skips h/p// because
// renderSlurs "handles" them. On Foggy Mountain Breakdown that swallowed 7 of
// 27 slides while playback still sounded every one of them.
//
// jsdom: container.clientWidth is 0, so the renderer falls back to an 800px
// container -> availableWidth 720 -> 4 measures per row at 180px.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { TabRenderer } from '../renderers/tablature.js';

// jsdom's import.meta.url isn't a file: URL, so walk up from cwd to the
// repo root instead of resolving relative to this module.
const REPO_ROOT = (() => {
    let dir = process.cwd();
    while (!fs.existsSync(path.join(dir, 'works')) && path.dirname(dir) !== dir) {
        dir = path.dirname(dir);
    }
    return dir;
})();

const FMB = JSON.parse(fs.readFileSync(path.join(
    REPO_ROOT, 'works/foggy-mountain-breakdown/banjo.otf.json'), 'utf8'));

const TECH = new Set(['h', 'p', '/']);

function renderTrack(track, notation, ticksPerBeat, options = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    new TabRenderer(container, options)
        .render(track, notation, ticksPerBeat, '4/4');
    return container;
}

// Techniques pair with the immediately preceding note on the same string.
// renderSlurs is row-scoped, so a technique whose source sits on the previous
// ROW legitimately gets no arc (a known, out-of-scope limitation) — count the
// pairs that are actually drawable so the expectation is exact, not a floor.
function expectedSlurs(notation, measuresPerRow) {
    let drawable = 0;
    let total = 0;
    for (let start = 0; start < notation.length; start += measuresPerRow) {
        const lastOnString = {};
        for (const measure of notation.slice(start, start + measuresPerRow)) {
            for (const event of measure.events || []) {
                for (const note of event.notes) {
                    if (TECH.has(note.tech)) {
                        total++;
                        if (lastOnString[note.s]) drawable++;
                    }
                    lastOnString[note.s] = true;
                }
            }
        }
    }
    return { drawable, total };
}

const countTech = (notation, tech) => notation.reduce((n, m) =>
    n + (m.events || []).reduce((k, e) =>
        k + e.notes.filter(note => tech ? note.tech === tech
            : TECH.has(note.tech)).length, 0), 0);

describe('technique slurs on the real Foggy Mountain Breakdown banjo tab', () => {
    const banjo = FMB.notation.banjo;
    const track = FMB.tracks.find(t => t.id === 'banjo');
    const tpb = FMB.timing.ticks_per_beat;

    it('the fixture still holds the articulations this test is about', () => {
        expect(countTech(banjo, '/')).toBe(27);
        expect(countTech(banjo, 'h')).toBe(33);
        expect(countTech(banjo, 'p')).toBe(14);
    });

    it('draws an arc for EVERY slide, including the long ones', () => {
        const c = renderTrack(track, banjo, tpb);
        // 'sl' labels are emitted once per drawn slide arc.
        const slLabels = [...c.querySelectorAll('text')]
            .filter(t => t.textContent === 'sl');
        expect(slLabels).toHaveLength(27);
    });

    it('draws exactly one arc per technique — no spurious pairings', () => {
        const c = renderTrack(track, banjo, tpb);
        const { drawable, total } = expectedSlurs(banjo, 4);
        expect(total).toBe(74);            // 27 slides + 33 hammers + 14 pulls
        expect(drawable).toBe(74);         // none stranded on a row boundary here
        // Total arcs must EQUAL the technique count: a missing arc is the bug
        // we fixed, a surplus arc would mean we started pairing unrelated notes.
        expect(c.querySelectorAll('.tech-slur')).toHaveLength(drawable);
        const labels = [...c.querySelectorAll('text')]
            .filter(t => ['sl', 'H', 'P'].includes(t.textContent));
        expect(labels).toHaveLength(drawable);
    });

    it('gives the long slides sane geometry, not degenerate stubs', () => {
        const c = renderTrack(track, banjo, tpb);
        const arcs = [...c.querySelectorAll('.tech-slur')];
        // d = "M x1 y Q mx my x2 y"
        const spans = arcs.map(a => {
            const n = a.getAttribute('d').split(/[MQ\s]+/).filter(Boolean).map(Number);
            return { x1: n[0], x2: n[4] };
        });
        for (const { x1, x2 } of spans) {
            expect(x2).toBeGreaterThan(x1);           // left-to-right
            expect(x2 - x1).toBeLessThan(720);        // never wider than a row
        }
        // The bug class was *long* techniques vanishing. Arcs inset 6px from
        // each note centre, so the old 60px centre-to-centre cap is a 48px
        // drawn span — at least one arc must now be wider than that.
        expect(Math.max(...spans.map(s => s.x2 - s.x1))).toBeGreaterThan(48);
    });

    it('survives a wide layout (1 measure per row) without dropping arcs', () => {
        // measureWidthFloor auto-expansion in the editor can blow past any
        // fixed pixel cap; a layout-independent predicate must not care.
        const c = renderTrack(track, banjo, tpb, { measuresPerRow: 1 });
        const { drawable } = expectedSlurs(banjo, 1);
        expect(c.querySelectorAll('.tech-slur')).toHaveLength(drawable);
    });
});

describe('renderSlurs pairing predicate', () => {
    const TRACK = {
        id: 'banjo',
        instrument: '5-string-banjo',
        tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
    };
    const render = (notation, options) => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        new TabRenderer(container, options)
            .render(TRACK, notation, 480, '4/4');
        return container;
    };

    it('arcs a technique across a barline between two quarter notes', () => {
        // Quarter on beat 4 of m1 slid into the downbeat of m2 — the exact
        // shape (quarter-note source, tick-0 target) that the pixel cap ate.
        const c = render([
            { measure: 1, events: [{ tick: 1440, notes: [{ s: 3, f: 0, dur: 480 }] }] },
            { measure: 2, events: [{ tick: 0, notes: [{ s: 3, f: 2, dur: 480, tech: '/' }] }] },
        ]);
        expect(c.querySelectorAll('.tech-slur')).toHaveLength(1);
        expect([...c.querySelectorAll('text')]
            .filter(t => t.textContent === 'sl')).toHaveLength(1);
    });

    it('arcs a hammer-on a full measure away (playback sounds it either way)', () => {
        const c = render([
            { measure: 1, events: [{ tick: 0, notes: [{ s: 3, f: 0 }] }] },
            { measure: 2, events: [{ tick: 0, notes: [{ s: 3, f: 2, tech: 'h' }] }] },
        ]);
        expect(c.querySelectorAll('.tech-slur')).toHaveLength(1);
    });

    it('pairs only within a string, and only with the immediate predecessor', () => {
        const c = render([{
            measure: 1,
            events: [
                { tick: 0, notes: [{ s: 3, f: 0 }] },
                { tick: 480, notes: [{ s: 1, f: 5 }] },   // other string, ignored
                { tick: 960, notes: [{ s: 3, f: 2, tech: 'h' }] },
            ],
        }]);
        expect(c.querySelectorAll('.tech-slur')).toHaveLength(1);
    });

    it('draws no arc when the technique has no predecessor on its string', () => {
        const c = render([{
            measure: 1,
            events: [{ tick: 0, notes: [{ s: 3, f: 2, tech: '/' }] }],
        }]);
        expect(c.querySelectorAll('.tech-slur')).toHaveLength(0);
    });

    it('leaves tie arcs behaving as before', () => {
        const c = render([
            { measure: 1, events: [{ tick: 960, notes: [{ s: 3, f: 0, dur: 960 }] }] },
            { measure: 2, events: [{ tick: 0, notes: [{ s: 3, f: 0, dur: 960, tie: true }] }] },
        ]);
        expect(c.querySelectorAll('.tie-arc')).toHaveLength(1);
        expect(c.querySelectorAll('.tech-slur')).toHaveLength(0);
        // ties carry no letter label
        expect([...c.querySelectorAll('text')]
            .filter(t => ['sl', 'H', 'P'].includes(t.textContent))).toHaveLength(0);
    });
});
