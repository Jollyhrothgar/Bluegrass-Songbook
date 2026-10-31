// G21c: the tab staff's annotation lanes, drawn (renderers/tablature.js +
// tab-lanes.js), and the own-track filter (attachOtfDecorations).
//
// Above the staff, outward: articulations, left-hand numbers, text lanes,
// chord diagrams, chord names, the section name. Below: right-hand fingering,
// then text. Each lane exists only when something is in it.
//
// Realistic fixture: fixtures/fmb-ensemble-1481.otf.json, Foggy Mountain
// Breakdown's ensemble as the OTF 1.3 importer writes it (frozen 2026-10-31).
// The rest are small synthetic tabs.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { TabRenderer, setTabChordParser } from '../renderers/tablature.js';
import {
    attachOtfDecorations, attachChordDiagrams, densifyNotation, maxMeasureIn,
} from '../renderers/measure-timing.js';
import { pitchedTracks } from '../renderers/otf-tracks.js';
import { MeasureTiming, TimelineTiming, identityTimeline } from '../renderers/measure-timing.js';
import { estimateTextWidth, chordLaneRuns, chordParts, chordRunsWidth, MIN_GAP } from '../renderers/tab-lanes.js';

const num = (el, attr) => Number(el.getAttribute(attr));
afterEach(() => { document.body.innerHTML = ''; setTabChordParser(null); });

/** One track drawn the way the song page draws it (no reading list). */
function draw(otf, trackId, options = {}) {
    const track = otf.tracks.find(t => t.id === trackId);
    let notation = densifyNotation(otf.notation[trackId], maxMeasureIn(otf.notation));
    notation = attachOtfDecorations(notation, otf, trackId);
    notation = attachChordDiagrams(notation, otf, trackId);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderer = new TabRenderer(container, options);
    renderer.render(track, notation, otf.timing?.ticks_per_beat || 480, otf.metadata?.time_signature || '4/4');
    return { container, renderer, notation };
}

const texts = (c) => [...c.querySelectorAll('.annotation-text')];

/** Any two texts of a row that sit on one baseline and run into each other. */
function overprints(container) {
    const bad = [];
    for (const svg of container.querySelectorAll('.stave-row svg')) {
        const byY = new Map();
        for (const t of svg.querySelectorAll('.annotation-text')) {
            const w = t.classList.contains('annotation-chord') ? chordRunsWidth(chordRunsOf(t)) : estimateTextWidth(t.textContent);
            const y = num(t, 'y');
            if (!byY.has(y)) byY.set(y, []);
            byY.get(y).push([num(t, 'x'), num(t, 'x') + w, t.textContent]);
        }
        for (const spans of byY.values()) {
            spans.sort((a, b) => a[0] - b[0]);
            for (let i = 1; i < spans.length; i++) {
                if (spans[i][0] < spans[i - 1][1] + MIN_GAP - 1e-6) bad.push([spans[i - 1][2], spans[i][2]]);
            }
        }
    }
    return bad;
}
/** The runs a drawn chord name was made of (from its tspans). */
const chordRunsOf = (t) => [...t.querySelectorAll('tspan')].map(s => ({
    kind: s.getAttribute('class').split('chord-').pop(), text: s.textContent,
}));

const TRACK_SET = [
    { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] },
    { id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'] },
    { id: 'drums', instrument: 'percussion', percussion: true, tuning: [] },
];

describe('attachOtfDecorations: a text is drawn on its own track', () => {
    const notation = [{ measure: 1, events: [] }, { measure: 2, events: [] }];
    const otf = {
        tracks: [TRACK_SET[2], TRACK_SET[0], TRACK_SET[1]],   // a drum track first
        annotations: [
            { measure: 1, tick: 0, text: 'banjo text', track: 'banjo' },
            { measure: 1, tick: 0, text: 'guitar text', track: 'guitar' },
            { measure: 2, tick: 480, text: 'no track' },
            { measure: 2, tick: 0, text: 'G', track: 'banjo', kind: 'chord', place: 'above' },
            { measure: 2, tick: 960, text: 'm', track: 'banjo', place: 'below' },
        ],
    };
    const textsOf = (out) => out.flatMap(m => (m.texts || []).map(t => t.text));

    it('keeps only the track\'s own', () => {
        expect(textsOf(attachOtfDecorations(notation, otf, 'guitar'))).toEqual(['guitar text']);
        expect(textsOf(attachOtfDecorations(notation, otf, 'banjo')))
            .toEqual(['banjo text', 'no track', 'G', 'm']);
    });

    it('a track-less text goes on the first PITCHED track only (not the drum track before it)', () => {
        expect(pitchedTracks(otf.tracks)[0].id).toBe('banjo');
        expect(textsOf(attachOtfDecorations(notation, otf, 'guitar'))).not.toContain('no track');
        expect(textsOf(attachOtfDecorations(notation, otf, 'drums'))).toEqual([]);
    });

    it('carries kind and place when the file has them, and nothing when it does not', () => {
        const out = attachOtfDecorations(notation, otf, 'banjo');
        expect(out[1].texts).toEqual([
            { tick: 480, text: 'no track' },
            { tick: 0, text: 'G', kind: 'chord', place: 'above' },
            { tick: 960, text: 'm', place: 'below' },
        ]);
    });

    it('without a trackId (a caller that has not been updated) every text is kept, as before 1.3', () => {
        expect(textsOf(attachOtfDecorations(notation, otf))).toHaveLength(5);
    });

    it('a file with no track information draws once, on its first pitched track', () => {
        const old = { tracks: otf.tracks, annotations: [{ measure: 1, tick: 0, text: 'x' }] };
        expect(textsOf(attachOtfDecorations(notation, old, 'banjo'))).toEqual(['x']);
        expect(textsOf(attachOtfDecorations(notation, old, 'guitar'))).toEqual([]);
    });
});

describe('text lanes', () => {
    const base = () => [{ measure: 1, events: [{ tick: 0, notes: [{ s: 1, f: 0 }] }] }, { measure: 2, events: [] }];
    const drawTexts = (texts, options) => {
        const notation = base();
        notation[0].texts = texts;
        const container = document.createElement('div');
        document.body.appendChild(container);
        const renderer = new TabRenderer(container, options);
        renderer.render(TRACK_SET[0], notation, 480, '4/4');
        return { container, renderer };
    };

    it('a tab with no annotation lays out as before (topMargin 40)', () => {
        expect(drawTexts([]).renderer.options.topMargin).toBe(40);
    });

    it('sizes the band from its content: one lane, then as many as it takes', () => {
        const one = drawTexts([{ tick: 0, text: 'Hi' }]).renderer.options.topMargin;
        const six = drawTexts(Array.from({ length: 6 }, (_, i) => ({ tick: i * 10, text: 'overlapping text' })))
            .renderer.options.topMargin;
        expect(one).toBe(40 + 12);
        expect(six).toBe(40 + 6 * 12);
    });

    it('six texts at one spot print on six lanes: nothing overprints, array order does not matter', () => {
        const items = ['f', 'e', 'd', 'c', 'b', 'a'].map(t => ({ tick: 0, text: `text ${t}` }));
        const { container } = drawTexts(items);
        expect(texts(container)).toHaveLength(6);
        expect(new Set(texts(container).map(t => t.getAttribute('y'))).size).toBe(6);
        expect(overprints(container)).toEqual([]);
    });

    it('lane 0 is the nearest the staff and the earlier text takes it', () => {
        const { container } = drawTexts([{ tick: 960, text: 'later one' }, { tick: 940, text: 'earlier' }]);
        const y = Object.fromEntries(texts(container).map(t => [t.textContent, num(t, 'y')]));
        expect(y.earlier).toBeGreaterThan(y['later one']);
    });

    it('keeps data-measure and data-tick for the editor', () => {
        const { container } = drawTexts([{ tick: 240, text: 'Hi' }]);
        const t = texts(container)[0];
        expect([t.dataset.measure, t.dataset.tick]).toEqual(['1', '240']);
    });

    it('a text near the end of a row slides left to stay inside the drawing', () => {
        const { container } = drawTexts([{ tick: 1900, text: 'a rather long banner at the barline' }],
            { measuresPerRow: 1 });
        const svg = container.querySelector('svg');
        const right = Number(svg.getAttribute('viewBox').split(' ')[2]);
        const t = texts(container)[0];
        expect(num(t, 'x') + estimateTextWidth(t.textContent)).toBeLessThanOrEqual(right);
    });

    it('texts placed below go under the staff, below the fingering row, and grow the row', () => {
        const above = drawTexts([{ tick: 0, text: 'up' }]);
        const below = drawTexts([{ tick: 0, text: 'm', place: 'below' }, { tick: 0, text: 'i', place: 'below' }]);
        const lines = [...below.container.querySelectorAll('.stave-row svg > line')]
            .filter(l => l.getAttribute('y1') === l.getAttribute('y2')).map(l => num(l, 'y1'));
        const bottom = Math.max(...lines);
        const ys = texts(below.container).map(t => num(t, 'y'));
        expect(ys.every(y => y > bottom + below.renderer.options.stemAreaHeight)).toBe(true);
        expect(new Set(ys).size).toBe(2);                         // two at one spot: two lanes
        expect(below.renderer.options.topMargin).toBe(40);        // nothing added above
        const h = (c) => num(c.querySelector('svg'), 'height');
        expect(h(below.container) - h(drawTexts([]).container)).toBe(24);
        expect(h(above.container)).toBeGreaterThan(h(drawTexts([]).container));
        expect(below.container.querySelectorAll('.annotation-below')).toHaveLength(2);
    });
});

describe('chord lane', () => {
    const notation = () => [{
        measure: 1,
        events: [{ tick: 0, notes: [{ s: 1, f: 0 }] }],
        texts: [
            { tick: 0, text: 'G', kind: 'chord' },
            { tick: 960, text: 'A (G)', kind: 'chord' },
            { tick: 960, text: 'a note to self' },
        ],
    }];
    const run = () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const renderer = new TabRenderer(container, {});
        renderer.render(TRACK_SET[0], notation(), 480, '4/4');
        return { container, renderer };
    };

    it('without the shared parser a chord is drawn as written, in the chord lane above the text', () => {
        const { container } = run();
        const chords = container.querySelectorAll('.annotation-chord');
        expect([...chords].map(c => c.textContent)).toEqual(['G', 'A (G)']);
        const note = [...texts(container)].find(t => t.textContent === 'a note to self');
        expect(num(chords[0], 'y')).toBeLessThan(num(note, 'y'));
    });

    it('with the parser: the capo shape follows, smaller and lighter', () => {
        setTabChordParser(text => text === 'A (G)'
            ? { chord: 'A', optional: false, shape: 'G', ext: null }
            : { chord: text, optional: false, shape: null, ext: null });
        const { container } = run();
        const shaped = container.querySelectorAll('.annotation-chord')[1];
        expect(shaped.textContent).toBe('A (G)');
        const shape = [...shaped.querySelectorAll('.chord-shape')];
        expect(shape.length).toBeGreaterThan(0);
        expect(parseFloat(shape[0].getAttribute('font-size'))).toBeLessThan(12);
    });

    it('a chord lane costs the tab nothing it does not use', () => {
        expect(run().renderer.options.topMargin).toBe(40 + 16 + 12);   // one chord row, one text lane
    });

    it('chord names never overprint', () => {
        const names = ['G', 'C', 'D', 'Em', 'Am', 'F#m7', 'Bb/D', 'A (G)'];
        const n = [{ measure: 1, events: [], texts: names.map((text, i) => ({ tick: i * 20, text, kind: 'chord' })) }];
        const container = document.createElement('div');
        document.body.appendChild(container);
        new TabRenderer(container, {}).render(TRACK_SET[0], n, 480, '4/4');
        expect(container.querySelectorAll('.annotation-chord')).toHaveLength(8);
        expect(overprints(container)).toEqual([]);
        expect(chordRunsWidth(chordLaneRuns(chordParts('F#m7', null)))).toBeGreaterThan(0);
    });
});

describe('the order of the lanes, outward from the staff', () => {
    it('articulation, left-hand number, text, chord diagram, chord name, section name', () => {
        const otf = {
            metadata: { time_signature: '4/4' }, timing: { ticks_per_beat: 480 },
            tracks: [TRACK_SET[0]],
            chords: [{ name: 'G', frets: [0, 0, 0, 0, 0], first_fret: 1 }],
            chord_diagrams: [{ measure: 1, tick: 0, track: 'banjo', chord: 0 }],
            reading_list: [{ from_measure: 1, to_measure: 2, name: 'Intro' }],
            annotations: [
                { measure: 1, tick: 0, text: 'D', track: 'banjo', kind: 'chord' },
                { measure: 1, tick: 480, text: 'Banner', track: 'banjo' },
            ],
            notation: { banjo: [{ measure: 1, events: [
                { tick: 0, notes: [{ s: 2, f: 3, lh: 2, finger: 'M', fx: ['choke'] }] }] }] },
        };
        const { container, renderer } = draw(otf, 'banjo');
        const top = renderer.options.topMargin;
        const y = (sel) => num(container.querySelector(sel), 'y');
        const section = y('.section-label');
        const chordName = y('.annotation-chord');
        const diagram = Number(/translate\([\d.-]+ ([\d.-]+)\)/.exec(
            container.querySelector('.chord-diagram').getAttribute('transform'))[1]);
        const banner = [...texts(container)].find(t => t.textContent === 'Banner');
        const lh = num(container.querySelector('.lh-finger-circle'), 'cy');
        const fx = y('.fx-choke');
        const finger = y('.finger-text');
        const stringsBottom = top + 4 * renderer.options.stringSpacing;
        expect(section).toBeLessThan(chordName);
        expect(chordName).toBeLessThan(diagram);
        expect(diagram).toBeLessThan(num(banner, 'y'));
        expect(num(banner, 'y')).toBeLessThan(lh);
        expect(lh).toBeLessThan(fx);
        expect(fx).toBeLessThan(top);
        expect(finger).toBeGreaterThan(stringsBottom);    // right hand below
        // and the cursor's maths still lands on the first string
        const firstString = [...container.querySelectorAll('.stave-row svg > line')]
            .filter(l => l.getAttribute('y1') === l.getAttribute('y2')).map(l => num(l, 'y1'));
        expect(Math.min(...firstString)).toBe(top);
    });

    it('the circled left-hand digit is no longer under the beams', () => {
        const otf = {
            metadata: { time_signature: '4/4' }, timing: { ticks_per_beat: 480 }, tracks: [TRACK_SET[0]],
            notation: { banjo: [{ measure: 1, events: [{ tick: 0, notes: [{ s: 2, f: 3, lh: 2 }] }] }] },
        };
        const { container, renderer } = draw(otf, 'banjo');
        expect(num(container.querySelector('.lh-finger-circle'), 'cy')).toBeLessThan(renderer.options.topMargin);
        expect(container.querySelector('.lh-finger-text').textContent).toBe('2');
    });

    it('showFingerings: false gives both lanes back', () => {
        const otf = {
            metadata: { time_signature: '4/4' }, timing: { ticks_per_beat: 480 }, tracks: [TRACK_SET[0]],
            notation: { banjo: [{ measure: 1, events: [{ tick: 0, notes: [{ s: 2, f: 3, lh: 2, finger: 'T' }] }] }] },
        };
        expect(draw(otf, 'banjo').renderer.options.topMargin).toBe(40 + 14);
        const hidden = draw(otf, 'banjo', { showFingerings: false });
        expect(hidden.renderer.options.topMargin).toBe(40);
        expect(hidden.container.querySelector('.lh-finger-text, .finger-text')).toBeNull();
    });

    it('notes of one chord column fan out instead of printing on top of each other', () => {
        const otf = {
            metadata: { time_signature: '4/4' }, timing: { ticks_per_beat: 480 }, tracks: [TRACK_SET[0]],
            notation: { banjo: [{ measure: 1, events: [{ tick: 0, notes: [
                { s: 1, f: 0, lh: 1, finger: 'I' }, { s: 2, f: 1, lh: 2, finger: 'M' }, { s: 5, f: 0, finger: 'T' }] }] }] },
        };
        const { container } = draw(otf, 'banjo');
        const xs = (sel) => [...container.querySelectorAll(sel)].map(e => num(e, 'x') || num(e, 'cx'));
        expect(new Set(xs('.finger-text')).size).toBe(3);
        expect(new Set(xs('.lh-finger-circle')).size).toBe(2);
    });
});

describe('Foggy Mountain Breakdown, ensemble (frozen OTF 1.3 import)', () => {
    const otf = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'fixtures/fmb-ensemble-1481.otf.json'), 'utf8'));
    const ownCount = (id) => otf.annotations.filter(a => a.track === id).length;

    it('the banjo staff shows the banjo\'s own texts and none of the others\'', () => {
        const { container } = draw(otf, 'banjo');
        expect(texts(container)).toHaveLength(ownCount('banjo'));
        const shown = texts(container).map(t => t.textContent);
        expect(shown.some(t => /Lead Guitar|Rhythm Guitar|Bass/.test(t))).toBe(false);
        const others = new Set(otf.annotations.filter(a => a.track !== 'banjo').map(a => a.text));
        const mine = new Set(otf.annotations.filter(a => a.track === 'banjo').map(a => a.text));
        for (const t of shown) expect(mine.has(t)).toBe(true);
        expect(others.size).toBeGreaterThan(0);
    });

    it('the guitar staff shows its own banners', () => {
        const { container } = draw(otf, 'guitar');
        expect(texts(container)).toHaveLength(ownCount('guitar'));
        expect(texts(container).some(t => /Lead Guitar/.test(t.textContent))).toBe(true);
    });

    it('the m / i texts marked below sit under the banjo staff', () => {
        const { container, renderer } = draw(otf, 'banjo');
        const below = [...container.querySelectorAll('.annotation-below')];
        expect(below).toHaveLength(otf.annotations.filter(a => a.track === 'banjo' && a.place === 'below').length);
        expect(below.length).toBeGreaterThan(400);
        expect(new Set(below.map(t => t.textContent))).toEqual(new Set(['m', 'i']));
        const stringsBottom = renderer.options.topMargin + 4 * renderer.options.stringSpacing;
        for (const t of below) expect(num(t, 'y')).toBeGreaterThan(stringsBottom + renderer.options.stemAreaHeight);
    });

    it('nothing overprints, on any track', () => {
        for (const track of pitchedTracks(otf.tracks)) {
            const { container } = draw(otf, track.id);
            expect(overprints(container), track.id).toEqual([]);
        }
    });

    it('draws at the width a phone gets as well', () => {
        const { container } = draw(otf, 'banjo', { measuresPerRow: 2 });
        expect(texts(container)).toHaveLength(ownCount('banjo'));
        expect(overprints(container)).toEqual([]);
    });
});

describe('Foggy Mountain Breakdown, ensemble: stage two (chords are chords, m/i are fingering)', () => {
    const otf = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'fixtures/fmb-ensemble-1481-g21bd.otf.json'), 'utf8'));
    const own = (id, kind) => otf.annotations.filter(a => a.track === id && (a.kind || 'text') === kind);

    it('each chord name is drawn once per chord, in the chord lane above the text lanes', () => {
        const { container, renderer } = draw(otf, 'banjo');
        const chords = [...container.querySelectorAll('.annotation-chord')];
        expect(chords).toHaveLength(own('banjo', 'chord').length);
        expect(chords.length).toBeGreaterThan(100);
        const plain = [...texts(container)].filter(t => !t.classList.contains('annotation-chord'));
        expect(plain).toHaveLength(own('banjo', 'text').length);
        expect(plain.map(t => t.textContent).some(t => /Lead Guitar|Bass\.\.\./.test(t))).toBe(false);
        // per row: every chord name is above every text lane
        for (const svg of container.querySelectorAll('.stave-row svg')) {
            const cy = [...svg.querySelectorAll('.annotation-chord')].map(t => num(t, 'y'));
            const ty = [...svg.querySelectorAll('.annotation-text:not(.annotation-chord)')].map(t => num(t, 'y'));
            if (cy.length && ty.length) expect(Math.max(...cy)).toBeLessThan(Math.min(...ty));
            for (const y of [...cy, ...ty]) expect(y).toBeLessThan(renderer.options.topMargin);
        }
    });

    it('without the shared parser the chord text is as written ("(em)")', () => {
        const { container } = draw(otf, 'banjo');
        const shown = new Set([...container.querySelectorAll('.annotation-chord')].map(t => t.textContent));
        expect(shown).toEqual(new Set(own('banjo', 'chord').map(a => a.text)));
        expect(shown.has('(em)')).toBe(true);
    });

    it('with a parser, an optional chord is drawn in parentheses and a plain one is not', () => {
        setTabChordParser(text => {
            const m = /^\((.*)\)$/.exec(text);
            const name = (m ? m[1] : text).replace(/^e/, 'E');
            return { chord: name, optional: !!m, shape: null, ext: null };
        });
        const { container } = draw(otf, 'banjo');
        const shown = new Set([...container.querySelectorAll('.annotation-chord')].map(t => t.textContent));
        expect(shown.has('(Em)')).toBe(true);
        expect(shown.has('Em')).toBe(true);
    });

    it('every typed m / i is a right-hand letter below the notes, none is a text', () => {
        const { container, renderer } = draw(otf, 'banjo');
        const letters = [...container.querySelectorAll('.finger-text')].map(t => t.textContent);
        expect(letters).toHaveLength(426);
        expect(new Set(letters)).toEqual(new Set(['M', 'I']));
        expect(container.querySelectorAll('.annotation-below')).toHaveLength(0);
        const stringsBottom = renderer.options.topMargin + 4 * renderer.options.stringSpacing;
        for (const t of container.querySelectorAll('.finger-text')) expect(num(t, 'y')).toBeGreaterThan(stringsBottom);
    });

    it('the other tracks keep their own chords and banners; nothing overprints anywhere', () => {
        for (const track of pitchedTracks(otf.tracks)) {
            const { container } = draw(otf, track.id);
            expect(texts(container), track.id).toHaveLength(otf.annotations.filter(a => a.track === track.id).length);
            expect(overprints(container), track.id).toEqual([]);
        }
    });

    it('draws at a narrow width too', () => {
        const { container } = draw(otf, 'banjo', { measuresPerRow: 2 });
        expect(overprints(container)).toEqual([]);
    });
});

describe('every tab in the corpus', () => {
    // live smoke test: catches a real tab whose annotations still overprint.
    // It runs the lane planner over the real tabs without drawing them (the
    // drawing of a few hundred long tabs does not fit a test's memory).
    const dir = path.resolve(__dirname, '../../../works');   // live smoke test
    const files = [];
    for (const slug of fs.readdirSync(dir)) {
        const full = path.join(dir, slug);
        if (!fs.statSync(full).isDirectory()) continue;
        for (const f of fs.readdirSync(full)) if (f.endsWith('.otf.json')) files.push(path.join(full, f));
    }

    /** Plan one track's lanes at `perRow` measures a row; the overprints it leaves. */
    function planOverprints(otf, track, perRow) {
        let notation = densifyNotation(otf.notation[track.id], maxMeasureIn(otf.notation));
        notation = attachOtfDecorations(notation, otf, track.id);
        const renderer = new TabRenderer(document.createElement('div'), { measuresPerRow: perRow });
        renderer.timing = new TimelineTiming(
            new MeasureTiming({ timeSignature: otf.metadata?.time_signature || '4/4',
                timeSignatureChanges: otf.metadata?.time_signature_changes || [], ticksPerBeat: 480 }),
            identityTimeline(maxMeasureIn(otf.notation)));
        renderer._layoutWidth = 800;
        renderer._calculateLayout(800);
        renderer._fxLanes = { point: false, runs: [], band: 0 };
        const plan = renderer._planLanes(notation, renderer._computedMeasuresPerRow);
        const key = (g, lane, row) => `${row} ${g} ${lane}`;
        const spans = new Map();
        notation.forEach((m, mi) => {
            for (const t of m.texts || []) {
                const spot = plan.place.get(t);
                const w = spot.runs ? chordRunsWidth(spot.runs) : estimateTextWidth(t.text);
                const k = key(spot.group, spot.lane, Math.floor(mi / renderer._computedMeasuresPerRow));
                if (!spans.has(k)) spans.set(k, []);
                spans.get(k).push([spot.x, spot.x + w, t.text]);
            }
        });
        const bad = [];
        for (const list of spans.values()) {
            list.sort((a, b) => a[0] - b[0]);
            for (let i = 1; i < list.length; i++) {
                if (list[i][0] < list[i - 1][1] + MIN_GAP - 1e-6) bad.push([list[i - 1][2], list[i][2]]);
            }
        }
        return bad;
    }

    it('has no overprinting annotation text, with the estimated widths', () => {
        const bad = [];
        for (const file of files) {
            const otf = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!otf.annotations?.length || !otf.notation) continue;
            for (const track of pitchedTracks(otf.tracks)) {
                if (!otf.notation[track.id]) continue;
                for (const perRow of [2, 4]) {
                    const o = planOverprints(otf, track, perRow);
                    if (o.length) bad.push(`${path.basename(path.dirname(file))}/${track.id}: ${JSON.stringify(o[0])}`);
                }
            }
        }
        expect(bad).toEqual([]);
    }, 120000);
});
