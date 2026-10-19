// TablEdit per-note effects (note.fx) and grace notes (note.grace) must be
// DRAWN, so an imported tab shows what TablEdit shows (fix-it A15). The
// format is fixed in otf-editor/DESIGN.md ("interface Note"); this file pins
// how the renderer engraves it:
//
//   - inline, on the fret itself: ghost "(5)", harmonic "<12>"
//   - left of the chord column, once per column: brush arrow, roll wave
//   - on the stem below the staff: tremolo slashes
//   - in an effects band ABOVE the staff (reserved only when the tab uses
//     it): point marks (ch, staccato dot, A.H., T, vibrato, b/r, S) and
//     spanning runs ("let ring - - -┐", "P.M. - - -┐")
//   - grace: a small fret left of the main fret, joined by a slur
//
// jsdom: no layout engine, so the renderer lays out against its nominal
// 800px width (4 measures per row at 180px).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { TabRenderer } from '../renderers/tablature.js';

const REPO_ROOT = (() => {
    let dir = process.cwd();
    while (!fs.existsSync(path.join(dir, 'works')) && path.dirname(dir) !== dir) {
        dir = path.dirname(dir);
    }
    return dir;
})();

const TRACK = {
    id: 'banjo', instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};

function render(notation, options = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderer = new TabRenderer(container, options);
    renderer.render(TRACK, notation, 480, '4/4');
    return { container, renderer };
}

/** One measure of quarter notes on string 3, the third one carrying `note`. */
function oneNote(note) {
    return [{
        measure: 1,
        events: [
            { tick: 0, notes: [{ s: 3, f: 0 }] },
            { tick: 480, notes: [{ s: 3, f: 2 }] },
            { tick: 960, notes: [{ s: 3, f: 5, ...note }] },
            { tick: 1440, notes: [{ s: 3, f: 0 }] },
        ],
    }];
}

const num = (el, attr) => Number(el.getAttribute(attr));
const noteTexts = (c) => [...c.querySelectorAll('.note-text')];

const FX = [
    'brush', 'roll', 'choke', 'ghost', 'staccato', 'let-ring', 'muted',
    'harmonic', 'artificial-harmonic', 'tap', 'vibrato', 'tremolo',
    'bend-release', 'slap',
];

describe('note.fx: every effect draws a findable mark', () => {
    for (const fx of FX) {
        it(`${fx} draws .fx-${fx}`, () => {
            const { container } = render(oneNote({ fx: [fx] }));
            expect(container.querySelectorAll(`.fx-${fx}`).length).toBeGreaterThan(0);
        });
    }

    it('unknown fx names are ignored, not drawn and not fatal', () => {
        const { container } = render(oneNote({ fx: ['wah-wah'] }));
        expect(container.querySelector('[class*="fx-"]')).toBeNull();
    });

    it('marks use the themed annotation ink, never a hard-coded colour', () => {
        const { container, renderer } = render(oneNote({ fx: ['choke', 'staccato', 'vibrato'] }));
        const ink = renderer.options.mutedColor;
        for (const el of container.querySelectorAll('.fx-choke, .fx-staccato, .fx-vibrato')) {
            const paint = el.getAttribute('fill') !== 'none'
                ? el.getAttribute('fill') : el.getAttribute('stroke');
            expect(paint).toBe(ink);
        }
    });
});

describe('brush / roll: one mark per chord column', () => {
    const chord = (fx) => [{
        measure: 1,
        events: [
            { tick: 0, notes: [1, 2, 3, 4].map(s => ({ s, f: 2, fx: [fx] })) },
            { tick: 960, notes: [2, 3].map(s => ({ s, f: 0, fx: [fx] })) },
        ],
    }];

    for (const fx of ['brush', 'roll']) {
        it(`${fx}: one mark per column, not per note`, () => {
            const { container } = render(chord(fx));
            expect(container.querySelectorAll(`.fx-${fx}`)).toHaveLength(2);
        });
    }

    it('the brush arrow sits LEFT of the column and spans its strings', () => {
        const { container, renderer } = render(chord('brush'));
        const opt = renderer.options;
        const first = container.querySelector('.fx-brush');
        const columnX = num(noteTexts(container)[0], 'x');
        // d = "M x y1 L x y2 ..." — a vertical shaft
        const n = first.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
        const [x1, y1, x2, y2] = n;
        expect(x1).toBe(x2);
        expect(x1).toBeLessThan(columnX - 6);
        const yString = (s) => opt.topMargin + (s - 1) * opt.stringSpacing;
        expect(Math.min(y1, y2)).toBeLessThanOrEqual(yString(1));
        expect(Math.max(y1, y2)).toBeGreaterThanOrEqual(yString(4));
    });
});

describe('inline fret marks', () => {
    it('ghost: the fret is parenthesised', () => {
        const { container } = render(oneNote({ fx: ['ghost'] }));
        expect(noteTexts(container).map(t => t.textContent)).toContain('(5)');
    });

    it('harmonic: the fret is in angle brackets', () => {
        const { container } = render(oneNote({ f: 12, fx: ['harmonic'] }));
        expect(noteTexts(container).map(t => t.textContent)).toContain('<12>');
    });

    it('artificial harmonic: brackets plus an A.H. label', () => {
        const { container } = render(oneNote({ f: 12, fx: ['artificial-harmonic'] }));
        expect(noteTexts(container).map(t => t.textContent)).toContain('<12>');
        const label = container.querySelector('.fx-artificial-harmonic');
        expect(label.textContent).toBe('A.H.');
    });

    it('the fret chip widens to cover the wrapped text', () => {
        const { container } = render(oneNote({ f: 12, fx: ['harmonic'] }));
        const bgs = [...container.querySelectorAll('.note-bg')];
        expect(Math.max(...bgs.map(b => num(b, 'width')))).toBeGreaterThanOrEqual(24);
    });

    it('ghost + tie stack as [(5)], tie bracket outermost', () => {
        const { container } = render(oneNote({ fx: ['ghost'], tie: true }));
        expect(noteTexts(container).map(t => t.textContent)).toContain('[(5)]');
    });
});

describe('the effects band above the staff', () => {
    it('is reserved only when the tab uses it', () => {
        const plain = render(oneNote({})).renderer.options.topMargin;
        const inline = render(oneNote({ fx: ['ghost'] })).renderer.options.topMargin;
        const point = render(oneNote({ fx: ['choke'] })).renderer.options.topMargin;
        const both = render([{
            measure: 1,
            events: [{ tick: 0, notes: [{ s: 1, f: 0, fx: ['choke', 'let-ring'] }] }],
        }]).renderer.options.topMargin;
        expect(inline).toBe(plain);          // inline marks need no band
        expect(point).toBeGreaterThan(plain);
        expect(both).toBeGreaterThan(point); // runs get their own lane
    });

    it('sits clear of string-1 slur labels and ending brackets', () => {
        const { container, renderer } = render(oneNote({ fx: ['choke'] }));
        const top = renderer.options.topMargin;
        const mark = container.querySelector('.fx-choke');
        // H/P labels over string 1 reach ~topMargin-25; endings start there
        expect(num(mark, 'y')).toBeLessThan(top - 26);
        expect(num(mark, 'y')).toBeGreaterThan(8);
    });

    it('pushes free-text annotations up rather than printing over them', () => {
        const notation = oneNote({ fx: ['choke'] });
        notation[0].texts = [{ tick: 960, text: 'Long Choke' }];
        const { container } = render(notation);
        const ann = container.querySelector('.annotation-text');
        const mark = container.querySelector('.fx-choke');
        expect(num(ann, 'y')).toBeLessThan(num(mark, 'y') - 9);
    });

    it('stacked point marks on one column do not overlap each other', () => {
        const { container } = render(oneNote({ fx: ['choke', 'artificial-harmonic', 'tap', 'slap'] }));
        const lefts = ['.fx-choke', '.fx-artificial-harmonic', '.fx-tap', '.fx-slap']
            .map(sel => num(container.querySelector(sel), 'x'));
        // laid out left-to-right in canonical order, each a few px apart
        for (let i = 1; i < lefts.length; i++) {
            expect(lefts[i] - lefts[i - 1]).toBeGreaterThanOrEqual(4);
        }
    });

    it('staccato is a dot just above the column\'s topmost note, not in the band', () => {
        const notation = [{
            measure: 1,
            events: [{ tick: 0, notes: [{ s: 2, f: 0, fx: ['staccato'] }, { s: 4, f: 2, fx: ['staccato'] }] }],
        }];
        const { container, renderer } = render(notation);
        const opt = renderer.options;
        expect(opt.topMargin).toBe(40);      // no band reserved for it
        const dots = container.querySelectorAll('.fx-staccato');
        expect(dots).toHaveLength(1);        // one per column
        const top = noteTexts(container)[0];
        expect(num(dots[0], 'cx')).toBe(num(top, 'x'));
        const y2 = opt.topMargin + opt.stringSpacing;
        expect(num(dots[0], 'cy')).toBeLessThan(y2 - 7);   // above string 2's chip
        expect(num(dots[0], 'cy')).toBeGreaterThan(y2 - 14); // below string 1
    });

    it('let ring over consecutive notes is ONE label and a dashed extender', () => {
        const notation = [{
            measure: 1,
            events: [0, 480, 960, 1440].map(tick =>
                ({ tick, notes: [{ s: 2, f: 1, fx: ['let-ring'] }] })),
        }];
        const { container } = render(notation);
        const labels = [...container.querySelectorAll('text.fx-let-ring')];
        expect(labels).toHaveLength(1);
        expect(container.querySelectorAll('.fx-let-ring-line')).toHaveLength(1);
    });

    it('a run breaks where a note without the effect intervenes', () => {
        const fx = [['muted'], ['muted'], undefined, ['muted'], ['muted']];
        const notation = [{
            measure: 1,
            events: fx.map((f, i) => ({ tick: i * 240, notes: [{ s: 2, f: 1, ...(f ? { fx: f } : {}) }] })),
        }, {
            measure: 2,
            events: [{ tick: 0, notes: [{ s: 2, f: 1, fx: ['muted'] }] }],
        }];
        const { container } = render(notation, { measuresPerRow: 1 });
        // row 1: two runs; row 2 (its own row): a third
        expect(container.querySelectorAll('text.fx-muted')).toHaveLength(3);
    });
});

describe('grace notes', () => {
    it('draws a small fret and a slur, without moving the main note', () => {
        const plain = render(oneNote({}));
        const grace = render(oneNote({ grace: { f: 3, kind: 'hp' } }));
        const xs = (c) => noteTexts(c).map(t => num(t, 'x'));
        expect(xs(grace.container)).toEqual(xs(plain.container));

        const g = grace.container.querySelector('.grace-note');
        expect(g.textContent).toBe('3');
        expect(parseFloat(g.getAttribute('font-size'))).toBeLessThan(
            grace.renderer.options.fretFontSize);
        const main = noteTexts(grace.container)[2];
        expect(num(g, 'x')).toBeLessThan(num(main, 'x'));
        expect(grace.container.querySelectorAll('.grace-arc')).toHaveLength(1);
        // the grace is not a note of its own: no extra highlightable chip
        expect(noteTexts(grace.container)).toHaveLength(4);
    });

    it('labels hp by direction: a lower grace is a hammer, a higher a pull', () => {
        const up = render(oneNote({ grace: { f: 3, kind: 'hp' } })).container;
        const down = render(oneNote({ grace: { f: 7, kind: 'hp' } })).container;
        expect(up.querySelector('.grace-label').textContent).toBe('h');
        expect(down.querySelector('.grace-label').textContent).toBe('p');
    });

    it('labels a slide "sl" and leaves other kinds as a bare arc', () => {
        const sl = render(oneNote({ grace: { f: 3, kind: 'slide' } })).container;
        expect(sl.querySelector('.grace-label').textContent).toBe('sl');
        const plain = render(oneNote({ grace: { f: 3 } })).container;
        expect(plain.querySelector('.grace-arc')).not.toBeNull();
        expect(plain.querySelector('.grace-label')).toBeNull();
    });

    it('shrinks rather than overlapping a close previous note', () => {
        // An eighth-triplet step in a one-measure row: the full-size grace
        // would run into the previous fret's chip, so it shrinks to fit.
        const notation = [{
            measure: 1,
            events: [
                { tick: 0, notes: [{ s: 3, f: 9 }] },
                { tick: 160, notes: [{ s: 3, f: 12, grace: { f: 10, kind: 'slide' } }] },
            ],
        }];
        const roomy = render(oneNote({ f: 12, grace: { f: 10, kind: 'slide' } }),
            { measuresPerRow: 1 }).container.querySelector('.grace-note');
        const { container } = render(notation, { measuresPerRow: 1 });
        const g = container.querySelector('.grace-note');
        const [prev] = noteTexts(container);
        const size = parseFloat(g.getAttribute('font-size'));
        expect(size).toBeLessThan(parseFloat(roomy.getAttribute('font-size')));
        // the grace's left edge stays right of the previous fret's digit
        // (one digit at the 12px fret font is ~7.2px wide)
        const graceLeft = num(g, 'x') - (2 * 0.6 * size) / 2;
        expect(graceLeft).toBeGreaterThanOrEqual(num(prev, 'x') + 3.6);
        expect(container.querySelector('.grace-bg')).not.toBeNull();
    });

    it('when even the smallest size cannot fit, it never blanks a neighbour', () => {
        const notation = [{
            measure: 1,
            events: [
                { tick: 0, notes: [{ s: 3, f: 10 }] },
                { tick: 60, notes: [{ s: 3, f: 12, grace: { f: 10, kind: 'slide' } }] },
            ],
        }];
        const { container } = render(notation);
        const g = container.querySelector('.grace-note');
        expect(parseFloat(g.getAttribute('font-size'))).toBe(5);
        expect(container.querySelector('.grace-bg')).toBeNull();
    });
});

describe('notes without fx render exactly as before', () => {
    const NOTATION = [{
        measure: 1,
        events: [
            { tick: 0, notes: [{ s: 1, f: 0, finger: 'T' }, { s: 3, f: 2, lh: 2 }] },
            { tick: 240, notes: [{ s: 2, f: 3, tech: 'h' }] },
            { tick: 480, notes: [{ s: 2, f: 5, tech: 'b' }] },
            { tick: 960, notes: [{ s: 4, f: 0, tech: 'x' }] },
        ],
    }];

    it('adds no new elements and reserves no band', () => {
        const { container, renderer } = render(NOTATION);
        expect(container.querySelector('[class*="fx-"], [class*="grace"]')).toBeNull();
        expect(renderer.options.topMargin).toBe(40);
    });

    it('an empty fx list is the same as none', () => {
        const withEmpty = NOTATION.map(m => ({
            ...m,
            events: m.events.map(e => ({ ...e, notes: e.notes.map(n => ({ ...n, fx: [] })) })),
        }));
        expect(render(withEmpty).container.innerHTML).toBe(render(NOTATION).container.innerHTML);
    });
});

describe('a real corpus tab', () => {
    const otf = JSON.parse(fs.readFileSync(path.join(
        REPO_ROOT, 'works/cripple-creek/banjo.otf.json'), 'utf8'));
    const track = otf.tracks.find(t => t.id === 'banjo');
    const notation = otf.notation.banjo;

    function renderReal(n) {
        const container = document.createElement('div');
        document.body.appendChild(container);
        new TabRenderer(container).render(track, n, otf.timing.ticks_per_beat, '4/4');
        return container;
    }

    it('renders end to end as published', () => {
        const c = renderReal(notation);
        expect(c.querySelectorAll('.note-text').length).toBeGreaterThan(100);
    });

    it('renders with effects and graces sprinkled over every kind of note', () => {
        // Deep copy, then decorate: chords get brush/roll alternately, every
        // 7th single note one of the other effects, every 5th a grace note.
        const single = FX.filter(f => f !== 'brush' && f !== 'roll');
        const decorated = JSON.parse(JSON.stringify(notation));
        let i = 0;
        let chords = 0;
        for (const m of decorated) {
            for (const e of m.events || []) {
                if (e.notes.length > 1) {
                    const fx = chords++ % 2 ? 'roll' : 'brush';
                    e.notes.forEach(n => { n.fx = [fx]; });
                    continue;
                }
                const n = e.notes[0];
                if (!n) continue;
                // The published tab carries its own fx/graces now (A15
                // refresh); replace them so the expected counts are ours.
                delete n.fx;
                delete n.grace;
                if (i % 7 === 0) n.fx = [single[(i / 7) % single.length]];
                if (i % 5 === 0) n.grace = { f: n.f + 2, kind: 'hp' };
                i++;
            }
        }
        const c = renderReal(decorated);
        const marks = c.querySelectorAll('.fx-brush').length + c.querySelectorAll('.fx-roll').length;
        expect(marks).toBe(chords);
        expect(c.querySelectorAll('.grace-note').length).toBeGreaterThan(10);
        expect(c.querySelectorAll('.note-text').length)
            .toBe(renderReal(notation).querySelectorAll('.note-text').length);
    });
});
