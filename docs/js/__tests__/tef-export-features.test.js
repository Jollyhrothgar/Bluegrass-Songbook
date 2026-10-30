// G15f: hand-made OTF documents that use every feature the .tef writer models,
// written to a .tef and read back with the importer. Plus the notices, the
// template rules and the reader changes (title at pointer 64, "Tab by:" line).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';
import { headerString, isV3Layout, tabByFromComments } from '../tef-import/reader.js';
import { decodeDurationCode } from '../tef-import/reader.js';
import { writeTef, TefWriteError } from '../tef-export/writer.js';
import { noticeLine, noticeSummary, NOTICE_LABELS } from '../tef-export/notices.js';
import { durationCode, placeEffects } from '../tef-export/notes.js';
import { decodeMarkRaw, validateOTF, OTF_VERSION } from '../otf-editor/otf-validate.js';
import { FX_ORDER } from '../tef-import/otf.js';
import { canonical, firstDifference, at } from './tef-roundtrip-helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const template = new Uint8Array(fs.readFileSync(path.join(repo, 'docs/js/tef-export/template.tef')));

const note = (s, f, dur, extra = {}) => ({ s, f, dur, ...extra });
const ev = (tick, ...notes) => ({ tick, notes });
const mark = (measure, raw) => ({ measure, ...decodeMarkRaw(raw), raw });

function doc(over = {}) {
    return {
        otf_version: OTF_VERSION,
        metadata: { title: 'Feature Tune', time_signature: '4/4', tempo: 132 },
        timing: { ticks_per_beat: 480 },
        tracks: [{ id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead', dyn: 'f' }],
        notation: { banjo: [] },
        ...over,
    };
}

function roundTrip(otf, options = {}) {
    const { bytes, notices } = writeTef(otf, { template, ...options });
    return { bytes, notices, back: parseTef(bytes, 'fixture.tef') };
}

function expectRoundTrip(otf, options) {
    expect(validateOTF(otf).errors).toEqual([]);
    const { back, notices } = roundTrip(otf, options);
    const pointer = firstDifference(canonical(otf), canonical(back));
    expect(pointer && `${pointer}: ${JSON.stringify(at(canonical(otf), pointer))} became ${JSON.stringify(at(canonical(back), pointer))}`).toBe(null);
    expect(noticeLine(notices)).toBe('');
}

describe('.tef writer: feature fixtures (write -> parse -> equal)', () => {
    it('every plain note field: strings, frets, 32nd and 64th lengths, ties, fingers, left hand, dynamics', () => {
        const banjo = [
            { measure: 1, events: [
                ev(0, note(5, 0, 480), note(1, 2, 480, { finger: 'T', lh: 0 })),
                ev(480, note(2, 3, 240, { finger: 'I', lh: 1 }), note(3, 24, 240, { finger: 'M', lh: 2 })),
                ev(720, note(4, 12, 240, { finger: 'R', lh: 3, dyn: 'ff' })),
                ev(960, note(1, 5, 120, { finger: 'P', lh: 4, dyn: 'pp' })),
                ev(1080, note(1, 5, 60, { dyn: 'mp' })),
                ev(1140, note(1, 7, 60, { dyn: 'mf' })),
                ev(1200, note(2, 1, 30), note(3, 2, 30, { dyn: 'p' })),
                ev(1230, note(2, 2, 30)),
                ev(1260, note(1, 0, 240, { dyn: 'fff' })),
                ev(1500, note(1, 0, 420)),
            ] },
            { measure: 2, events: [
                ev(0, note(1, 3, 1920)),
            ] },
            { measure: 3, events: [
                ev(0, note(1, 3, 960, { tie: true })),
                ev(960, note(1, 3, 960)),
            ] },
        ];
        expectRoundTrip(doc({ notation: { banjo } }));
    });

    it('techniques: hammer-on, pull-off, slide, dead note, bend target', () => {
        const banjo = [{ measure: 1, events: [
            ev(0, note(1, 0, 240)),
            ev(240, note(1, 2, 240, { tech: 'h' })),
            ev(480, note(1, 0, 240, { tech: 'p' })),
            ev(720, note(1, 5, 240, { tech: '/' })),
            ev(960, note(2, 3, 240, { tech: 'x' })),
            ev(1200, note(3, 2, 240, { fx: ['bend'] })),
            ev(1440, note(3, 3, 480, { tech: 'b' })),
        ] }];
        expectRoundTrip(doc({ notation: { banjo } }));
    });

    it('a note that is both the end of a hammer-on and the start of a pull-off, and a dead note that starts one', () => {
        const banjo = [{ measure: 1, events: [
            ev(0, note(1, 0, 240)),
            ev(240, note(1, 2, 240, { tech: '/' })),
            ev(480, note(1, 4, 240, { tech: 'h', fx: ['choke'] })),   // the pull-off after it takes byte 6, so the choke does not fit
            ev(720, note(1, 2, 240, { tech: 'p' })),
            ev(960, note(2, 3, 240, { tech: 'x' })),
            ev(1200, note(2, 5, 240, { tech: 'h' })),
        ] }];
        const { back, notices } = roundTrip(doc({ notation: { banjo } }));
        const notes = back.notation.banjo[0].events.map(e => e.notes[0]);
        expect(notices.effects_not_written).toBe(1);
        expect(notes[2].fx).toBeUndefined();
        expect(notes.map(n => n.tech)).toEqual([undefined, '/', 'h', 'p', 'x', 'h']);
    });

    it('every effect, alone and in the pairs a note can hold (bends have their own test)', () => {
        const plain = FX_ORDER.filter(fx => !fx.startsWith('bend'));
        const single = plain.map((fx, i) => ev(i * 120, note(1 + (i % 5), i % 12, 120, { fx: [fx] })));
        const banjo = [{ measure: 1, events: single }];
        // a longer second measure for combinations
        const pairs = [['brush', 'let-ring'], ['choke', 'staccato'], ['ghost', 'harmonic'], ['roll', 'slap'],
            ['let-ring', 'muted'], ['ghost', 'tap'], ['staccato', 'vibrato'], ['tremolo', 'slap']];
        banjo.push({ measure: 2, events: pairs.map((fx, i) => ev(i * 240, note(1 + (i % 5), 2, 120, { fx }))) });
        expectRoundTrip(doc({ notation: { banjo } }));
    });

    it('every grace kind, with a fret', () => {
        const kinds = ['hp', 'slide', 'bend', 'mordent', 'double', 'gruppetto', 'trill'];
        const banjo = [{ measure: 1, events: [
            ...kinds.map((kind, i) => ev(i * 240, note(1 + (i % 5), 7, 240, { grace: { f: 5, kind } }))),
            ev(1680, note(1, 9, 240, { grace: { f: 3 } })),
        ] }];
        expectRoundTrip(doc({ notation: { banjo } }));
    });

    it('triplets are written straight and come back stretched', () => {
        const banjo = [{ measure: 1, events: [
            ev(0, note(1, 0, 160), note(5, 0, 160)), ev(160, note(2, 1, 160)), ev(320, note(3, 2, 160)),
            ev(480, note(1, 5, 80)), ev(560, note(1, 7, 80)), ev(640, note(1, 9, 80)),
            ev(960, note(1, 3, 320)), ev(1280, note(2, 3, 320)), ev(1600, note(3, 3, 320)),
        ] }];
        expectRoundTrip(doc({ notation: { banjo } }));
    });

    it('a time-signature change, multiple tracks, and a percussion track', () => {
        const otf = doc({
            metadata: { title: 'Three tracks', time_signature: '4/4', tempo: 100,
                time_signature_changes: [{ measure: 2, time_signature: '3/4' }, { measure: 3, time_signature: '6/8' }] },
            tracks: [
                { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 2, role: 'lead', dyn: 'f' },
                { id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0, role: 'rhythm', dyn: 'mf' },
                { id: 'bass', instrument: 'upright-bass', tuning: ['G2', 'D2', 'A1', 'E1'], capo: 0, role: 'rhythm', dyn: 'f' },
                { id: 'percussion', instrument: 'percussion', tuning: [], capo: 0, role: 'percussion', percussion: true, lines: 3, dyn: 'f' },
            ],
            notation: {
                banjo: [{ measure: 1, events: [ev(0, note(1, 0, 480))] }, { measure: 2, events: [ev(1200, note(2, 3, 240))] }],
                guitar: [{ measure: 2, events: [ev(0, note(6, 0, 480), note(1, 0, 480))] }, { measure: 3, events: [ev(1380, note(3, 5, 240))] }],
                bass: [{ measure: 1, events: [ev(0, note(4, 0, 960)), ev(960, note(3, 2, 960))] }],
                percussion: [{ measure: 1, events: [ev(0, note(1, 0, 480), note(3, 0, 480)), ev(480, note(2, 0, 480))] }],
            },
        });
        expectRoundTrip(otf);
    });

    it('annotations, a named reading list, repeat signs, tab_by and a tempo', () => {
        const banjo = [1, 2, 3, 4].map(measure => ({ measure, events: [ev(0, note(1, measure, 960)), ev(960, note(2, measure, 960))] }));
        const otf = doc({
            metadata: { title: 'Marked up', time_signature: '4/4', tempo: 77, tab_by: { name: 'Jess Picker', url: 'https://example.com/jess' } },
            notation: { banjo },
            annotations: [{ measure: 1, tick: 0, text: 'G' }, { measure: 1, tick: 0, text: 'Intro' },
                { measure: 2, tick: 960, text: 'Keep this loose' }, { measure: 4, tick: 1440, text: 'Slide to the D' }],
            reading_list: [{ from_measure: 1, to_measure: 2, name: 'Part A' }, { from_measure: 3, to_measure: 4 },
                { from_measure: 1, to_measure: 4, name: 'Whole tune, played once' }],
            measure_marks: [mark(1, 0x40), mark(2, 0x81), mark(3, 0x0a), mark(4, 0x08)],
        });
        expectRoundTrip(otf);
        // a tab_by without a link
        expectRoundTrip(doc({ metadata: { ...otf.metadata, tab_by: { name: 'Jess Picker' } }, notation: { banjo } }));
    });

    it('chords and chord diagrams, with fingers, a first fret, offsets and a name-only record', () => {
        const banjo = [1, 2].map(measure => ({ measure, events: [ev(0, note(1, 0, 960)), ev(960, note(2, 2, 960))] }));
        const otf = doc({
            tracks: [
                { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead', dyn: 'f' },
                { id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0, role: 'rhythm', dyn: 'f' },
            ],
            notation: { banjo, guitar: [{ measure: 1, events: [ev(0, note(1, 0, 960))] }] },
            chords: [
                { name: 'G', frets: [0, 0, 0, 0, 0], fingers: [null, null, null, null, null] },
                { name: 'C', frets: [0, 1, 0, 2, 3, null], fingers: [null, 1, null, 2, 3, null] },
                { name: 'F barre', frets: [1, 1, 2, 3, 3, 1], first_fret: 1 },
                { name: 'Dm7', frets: [5, 6, 5, 7, null, null], first_fret: 5 },
                { name: 'N.C.' },
            ],
            chord_diagrams: [
                { measure: 1, tick: 0, track: 'banjo', chord: 0 },
                { measure: 2, tick: 960, track: 'banjo', chord: 3, dx: 4, dy: -5 },
                { measure: 1, tick: 0, track: 'guitar', chord: 1 },
                { measure: 2, tick: 0, track: 'guitar', chord: 2, dy: 3 },
            ],
        });
        // A first-fret of 1 is the default and is not kept as a field.
        otf.chords[2] = { name: 'F barre', frets: [1, 1, 2, 3, 3, 1] };
        otf.chords[0] = { name: 'G', frets: [0, 0, 0, 0, 0] };
        expectRoundTrip(otf);
    });

    it('dynamics: a track default and per-note exceptions', () => {
        const banjo = [{ measure: 1, events: [
            ev(0, note(1, 0, 480)), ev(480, note(1, 2, 480, { dyn: 'p' })), ev(960, note(1, 3, 480, { dyn: 'fff' })),
            ev(1440, note(1, 3, 480, { tie: true })),
        ] }, { measure: 2, events: [
            ev(0, note(2, 0, 960)), ev(960, note(3, 0, 960)),
        ] }];
        expectRoundTrip(doc({ notation: { banjo }, tracks: [{ id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead', dyn: 'mp' }] }));
    });

    it('bends: bend, bend and release, across a barline', () => {
        const banjo = [
            { measure: 1, events: [ev(0, note(2, 3, 480, { fx: ['bend'] })), ev(480, note(2, 4, 480, { tech: 'b' })),
                ev(960, note(3, 2, 960, { fx: ['bend-release'] }))] },
            { measure: 2, events: [ev(0, note(3, 3, 960, { tech: 'b' })), ev(960, note(4, 5, 960, { fx: ['bend'] }))] },
        ];
        expectRoundTrip(doc({ notation: { banjo } }));
    });

    it('a 5-string track with a capo carries TablEdit\'s derived capo bytes', () => {
        const otf = doc({ tracks: [{ id: 'banjo', instrument: '5-string-banjo', tuning: ['E4', 'C#4', 'A3', 'E3', 'A4'], capo: 2, role: 'lead', dyn: 'f' }],
            notation: { banjo: [{ measure: 1, events: [ev(0, note(1, 0, 960))] }] } });
        expectRoundTrip(otf);
        const { bytes } = roundTrip(otf);
        const p = bytes[0x60] | (bytes[0x61] << 8);
        const record = bytes.subarray(p + 4, p + 4 + 68);
        expect(record[12]).toBe(2);            // the capo, as our reader and TablEdit's loader read it
        expect(record[10] & 0x0f).toBe(2);     // capo + t1 - t5 - 5, which TablEdit recomputes on load
    });
});

describe('.tef writer: layout', () => {
    const otf = doc({ notation: { banjo: [{ measure: 1, events: [ev(0, note(1, 0, 480))] }] }, annotations: [{ measure: 1, tick: 0, text: 'hi' }] });

    it('writes a TablEdit 3 file: debt magic, tempo, regions in order, components end in 0xFFFFFFFF', () => {
        const { bytes } = roundTrip(otf);
        expect(isV3Layout(bytes)).toBe(true);
        expect(String.fromCharCode(...bytes.subarray(0x38, 0x3c))).toMatch(/^(debt|tbed)$/);
        expect(bytes[6] | (bytes[7] << 8)).toBe(132);
        const u32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
        expect(u32(0x10)).toBe(0);
        expect(u32(0x40)).toBe(0x100);
        const order = [0x40, 0x44, 0x48, 0x4c, 0x50, 0x54, 0x5c, 0x60, 0x64, 0x3c].map(u32);
        expect([...order]).toEqual([...order].sort((a, b) => a - b));
        expect(u32(0x3c) + 2 * 12 + 4).toBe(bytes.length);   // a note and a text anchor, then the terminator
        expect(u32(bytes.length - 4)).toBe(0xffffffff);
        expect(headerString(bytes, 0x40)).toBe('Feature Tune');
    });

    it('component locations are sorted', () => {
        const banjo = [{ measure: 1, events: [ev(480, note(1, 0, 480)), ev(0, note(3, 2, 480)), ev(960, note(2, 1, 480))] }];
        const { bytes } = roundTrip(doc({ notation: { banjo } }));
        const u32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
        const start = u32(0x3c);
        const locs = [];
        for (let o = start; o + 12 <= bytes.length - 4; o += 12) locs.push(u32(o));
        expect(locs).toEqual([...locs].sort((a, b) => a - b));
    });

    it('uses the original file as the template when its tracks match, and carries over what OTF does not model', () => {
        const source = new Uint8Array(fs.readFileSync(path.join(repo, 'sources/banjo-hangout/downloads/25251_tef_red_haired_boy.tef')));
        const a = parseTef(source, 'x');
        const { bytes } = writeTef(a, { source, template });
        // Page-layout block (header pointer 0x64): byte for byte
        const block = (d) => { const p = (d[0x64] | (d[0x65] << 8) | (d[0x66] << 16)); const n = d[p] | (d[p + 1] << 8); return Buffer.from(d.subarray(p, p + 2 + n)).toString('hex'); };
        expect(block(bytes)).toBe(block(source));
        // Comments and "notes" strings survive
        expect(headerString(bytes, 0x48)).toBe(headerString(source, 0x48));
        expect(headerString(bytes, 0x4c)).toBe(headerString(source, 0x4c));
        // With different tracks the default template is used instead (no 0x64 block from the source)
        const changed = JSON.parse(JSON.stringify(a));
        changed.tracks.push({ id: 'bass', instrument: 'upright-bass', tuning: ['G2', 'D2', 'A1', 'E1'], capo: 0, role: 'rhythm' });
        const out = writeTef(changed, { source, template }).bytes;
        expect(headerString(out, 0x4c)).not.toBe(headerString(source, 0x4c));
    });

    it('tracks the template lacks get the per-track bytes TablEdit 3.06 itself writes', () => {
        // A blank 4-track file saved by TablEdit 3.06: mandolin, banjo, guitar, bass.
        const four = new Uint8Array(fs.readFileSync(path.join(repo, 'tests/parser/fixtures/tabledit_306_blank_4track.tef')));
        const a = parseTef(four, 'blank.tef');
        expect(a.tracks.map(t => t.id)).toEqual(['mandolin', 'banjo', 'guitar', 'bass']);
        const { bytes } = writeTef(a, { template });      // the 1-track template, no source
        const record = (d, i) => { const p = (d[0x60] | (d[0x61] << 8) | (d[0x62] << 16)); return d.subarray(p + 4 + 68 * i, p + 4 + 68 * i + 32); };
        // Not byte 16 (a created track shows tab only, below) and not the bass's MIDI
        // program (acoustic bass, the corpus's choice: TablEdit's blank has electric).
        const same = (d, i) => [...record(d, i)].filter((_, k) => k !== 16 && !(i === 3 && k === 8));
        for (let i = 0; i < 4; i++) expect(same(bytes, i)).toEqual(same(four, i));
    });

    it('needs a template when there is no usable source', () => {
        expect(() => writeTef(otf)).toThrow(TefWriteError);
        expect(() => writeTef(otf, { template: new Uint8Array(10) })).toThrow(TefWriteError);
    });

    it('refuses what a .tef cannot hold at all', () => {
        expect(() => writeTef(doc({ tracks: [] }), { template })).toThrow(TefWriteError);
        const many = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, instrument: '4-string', tuning: ['G2', 'D2', 'A1', 'E1'], capo: 0, role: 'rhythm' }));
        expect(() => writeTef(doc({ tracks: many, notation: {} }), { template })).toThrow(/at most 15/);
    });
});

describe('.tef writer: durations', () => {
    it('writes the code TablEdit itself uses, and 2 * decode(code) equals the length', () => {
        for (let code = 0; code < 32; code++) {
            const dur = decodeDurationCode(code);
            const [chosen, exact] = durationCode(dur);
            expect(exact).toBe(true);
            expect(decodeDurationCode(chosen)).toBe(dur);
            expect(chosen).toBeLessThanOrEqual(code);
        }
        expect(durationCode(480)[0]).toBe(6);    // not 30
        expect(durationCode(30)[0]).toBe(18);    // not 21, 24 or 27
    });

    it('rounds an odd length to the nearest one TablEdit has and says so', () => {
        const banjo = [{ measure: 1, events: [ev(0, note(1, 0, 100))] }];
        const { notices, back } = roundTrip(doc({ notation: { banjo } }));
        expect(notices.durations_rounded).toBe(1);
        expect(back.notation.banjo[0].events[0].notes[0].dur).toBe(96);
    });
});

describe('.tef writer: notices (nothing is dropped silently)', () => {
    it('counts notes moved to the nearest 64th and moves them', () => {
        const banjo = [{ measure: 1, events: [ev(0, note(1, 0, 240)), ev(250, note(1, 1, 240)), ev(500, note(1, 2, 240))] }];
        const { notices, back } = roundTrip(doc({ notation: { banjo } }));
        expect(notices.notes_moved).toBe(2);
        expect(back.notation.banjo[0].events.map(e => e.tick)).toEqual([0, 240, 510]);
        expect(noticeLine(notices)).toBe('Changed when saved as .tef: 2 notes moved to the nearest 64th.');
    });

    it('counts effects that do not fit and keeps the earliest in FX_ORDER', () => {
        const fit = placeEffects(['muted', 'choke', 'tap'], 0, false);
        expect(fit.dropped).toBe(2);
        expect(fit.primary).toBe(4);          // choke comes before muted and tap in FX_ORDER
        expect(placeEffects(['brush', 'let-ring', 'ghost', 'staccato'], 0, false).dropped).toBe(1);
        const banjo = [{ measure: 1, events: [ev(0, note(1, 0, 480, { fx: ['choke', 'muted', 'tap'] }))] }];
        const { notices, back } = roundTrip(doc({ notation: { banjo } }));
        expect(notices.effects_not_written).toBe(2);
        expect(back.notation.banjo[0].events[0].notes[0].fx).toEqual(['choke']);
        expect(noticeLine(notices)).toContain('2 effects that do not fit');
    });

    it('truncates reading-list names over 27 characters and counts them', () => {
        const name = 'A very long section name of 40 characters';
        expect(name.length).toBeGreaterThan(27);
        const otf = doc({ notation: { banjo: [{ measure: 1, events: [ev(0, note(1, 0, 480))] }] },
            reading_list: [{ from_measure: 1, to_measure: 1, name }, { from_measure: 1, to_measure: 1, name: 'Short' }] });
        const { notices, back } = roundTrip(otf);
        expect(notices.reading_list_names_truncated).toBe(1);
        expect(back.reading_list[0].name).toBe(name.slice(0, 27));
        expect(back.reading_list[1].name).toBe('Short');
    });

    it('counts a note it cannot place instead of losing it quietly', () => {
        const banjo = [{ measure: 1, events: [ev(0, note(9, 0, 480), note(1, 25, 480), note(1, 0, 480))] }];
        const { notices, back } = roundTrip(doc({ notation: { banjo } }));
        expect(notices.notes_dropped).toBe(2);
        expect(back.notation.banjo[0].events[0].notes).toHaveLength(1);
    });

    it('counts a hammer-on with nothing to hang it on, a stray bend target, and a key it cannot write', () => {
        const banjo = [{ measure: 1, events: [ev(0, note(1, 0, 240, { tech: 'h' })), ev(1500, note(2, 1, 240)), ev(1800, note(2, 3, 120, { tech: 'b' }))] }];
        const { notices } = roundTrip(doc({ metadata: { title: 'x', time_signature: '4/4', tempo: 100, key: 'G' }, notation: { banjo } }));
        expect(notices.techniques_not_written).toBe(2);
        expect(notices.key_not_written).toBe(1);
    });

    it('counts text it had to change, and unsupported signatures and tempos', () => {
        const otf = doc({ metadata: { title: 'Café ♯', time_signature: '7/32', tempo: 900 }, notation: { banjo: [{ measure: 1, events: [ev(0, note(1, 0, 480))] }] } });
        const { notices } = roundTrip(otf);
        expect(notices.text_changed).toBe(1);
        expect(notices.time_signatures_changed).toBe(1);
        expect(notices.values_clamped).toBe(1);
    });

    it('noticeLine is empty for no changes and uses singular and plural labels', () => {
        expect(noticeLine({})).toBe('');
        expect(noticeLine(null)).toBe('');
        expect(noticeSummary({ notes_moved: 1 })).toBe('1 note moved to the nearest 64th');
        expect(noticeSummary({ effects_not_written: 3, notes_moved: 2 })).toBe('2 notes moved to the nearest 64th, 3 effects that do not fit');
        expect(Object.keys(NOTICE_LABELS).every(k => NOTICE_LABELS[k].length === 2)).toBe(true);
    });
});

describe('.tef writer: readers', () => {
    it('the title comes from header pointer 64, so "Part" and short titles survive', () => {
        for (const title of ['The Parting Glass', 'Part of Your World', 'A', '(Untitled)', '- Dash', 'Café Rag']) {
            const { back } = roundTrip(doc({ metadata: { title, time_signature: '4/4', tempo: 100 }, notation: { banjo: [{ measure: 1, events: [ev(0, note(1, 0, 480))] }] } }));
            expect(back.metadata.title).toBe(title);
        }
    });

    it('the committed fixture (written by this writer) reads back as the expected OTF in both importers', () => {
        const dir = path.join(repo, 'tests/parser/fixtures');
        const bytes = new Uint8Array(fs.readFileSync(path.join(dir, 'writer_v3_title_and_credit.tef')));
        const expected = JSON.parse(fs.readFileSync(path.join(dir, 'writer_v3_title_and_credit.expected.otf.json'), 'utf8'));
        expect(parseTef(bytes, 'writer_v3_title_and_credit.tef')).toEqual(expected);
        expect(expected.metadata.title).toBe('The Parting Glass');
    });

    it('an empty title reads back as the file name, and the blank template does not invent one', () => {
        const blank = parseTef(template, 'Blank Sheet.tef');
        expect(blank.metadata.title).toBe('Blank Sheet');
    });

    it('a multi-line title keeps the old first-string heuristic (corpus parse unchanged)', () => {
        const one = writeTef(doc({ metadata: { title: 'Line one', time_signature: '4/4', tempo: 100 } }), { template }).bytes;
        const patched = new Uint8Array(one);
        patched[0x100 + 2 + 4] = 0x0d;       // "Line\rone": a control character in the stored title
        expect(parseTef(patched, 'x').metadata.title).not.toBe('Line one');
    });

    it('"Tab by:" in the comments reads back as metadata.tab_by, and other comment text is kept', () => {
        const source = new Uint8Array(fs.readFileSync(path.join(repo, 'sources/banjo-hangout/downloads/25251_tef_red_haired_boy.tef')));
        const a = parseTef(source, 'x');
        a.metadata.tab_by = { name: 'Jess Picker', url: 'https://example.com/j' };
        const { bytes } = writeTef(a, { source, template });
        const comments = headerString(bytes, 0x48);
        expect(comments.startsWith(headerString(source, 0x48).trim())).toBe(true);
        expect(comments.endsWith('Tab by: Jess Picker <https://example.com/j>')).toBe(true);
        expect(parseTef(bytes, 'x').metadata.tab_by).toEqual(a.metadata.tab_by);
        // Changing it replaces the line; removing it removes the line
        a.metadata.tab_by = { name: 'Someone Else' };
        const again = writeTef(a, { source: bytes, template }).bytes;
        expect(parseTef(again, 'x').metadata.tab_by).toEqual({ name: 'Someone Else' });
        expect(headerString(again, 0x48).match(/Tab by:/g)).toHaveLength(1);
        delete a.metadata.tab_by;
        const gone = writeTef(a, { source: again, template }).bytes;
        expect(parseTef(gone, 'x').metadata.tab_by).toBeUndefined();
        expect(headerString(gone, 0x48)).not.toContain('Tab by:');
    });

    it('an ordinary "Tab by Name" comment (no colon) is not a credit', () => {
        const dir = path.join(repo, 'sources/banjo-hangout/downloads');
        const file = fs.readdirSync(dir).find(f => f.startsWith('27159_'));
        const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
        expect(headerString(bytes, 0x48)).toBe('Tab by David Johnson');
        expect(parseTef(bytes, file).metadata.tab_by).toBeUndefined();
    });
});

describe('TablEdit "TablEdited by NAME" as the credit (G15f)', () => {
    const accepted = [
        ['TablEdited by Lee Marcus', 'Lee Marcus'],
        ['tabledited BY  James N  Leonard ', 'James N Leonard'],
        ['TablEdited by: Stan Slack', 'Stan Slack'],
        ['TablEdited by L.Bradshaw', 'L.Bradshaw'],
        ['TablEdited by Jean-Pierre Devin', 'Jean-Pierre Devin'],
        ['TablEdited by Mike Larsen AKA Lefty5string', 'Mike Larsen AKA Lefty5string'],
        ['Arranged & Tabledited by Tom Arri', 'Tom Arri'],
        ['Transcribed and TablEdited by Jim Crowley', 'Jim Crowley'],
        ['Modified and TablEdited by Robert Fentress', 'Robert Fentress'],
        ['TablEdited & Arr. by Martin Blake', 'Martin Blake'],
        ['TablEdited and Arranged by Martin Blake', 'Martin Blake'],
    ];
    const rejected = [
        'TablEdited by', 'Arranged & Tabledited', 'TablEdited on 12-7-2013',
        'TablEdited by Tom Arri 2010', 'TablEdited by Stan Slack, Jan 2013',
        'TablEdited by Nic Durham: picke_r@hotmail.com', 'TablEdited by5stringabuse',
        'Tabledited byToni Ruiz', 'TablEdited by Holt&Holt /Yep, Guitars', 'TablEdited by \\ Rick Diesel',
        'TablEdited by Greg Crisp (breaks 1 & 2)', 'TablEdited by Donald W,Couchie',
        'Arranged and TablEdited for clawhammer banjo by Jan-Olov Sundqvist',
        'Banjo Tuning: aDADE     TablEdited by Ned Banta',
        'Sequenced by  Barry Taylor TablEdited by Patrick P.',
        'TablEdited by ' + 'Abcdefgh '.repeat(7), 'TablEdited by ' + 'x'.repeat(61),
    ];
    it.each(accepted)('%j is a credit', (line, name) => expect(tabByFromComments(line)).toEqual({ name }));
    it.each(rejected)('%j is no credit', line => expect(tabByFromComments(line)).toBeNull());
    it('the last line wins, and an explicit "Tab by:" line beats it', () => {
        expect(tabByFromComments('TablEdited by A B\r\nTablEdited by C D')).toEqual({ name: 'C D' });
        expect(tabByFromComments('TablEdited by Devon Wells\r\nTab by: Jane Doe')).toEqual({ name: 'Jane Doe' });
        expect(tabByFromComments('Tab by: Jane Doe\r\nTablEdited by Devon Wells')).toEqual({ name: 'Jane Doe' });
    });

    const chicken = new Uint8Array(fs.readFileSync(path.join(repo, 'sources/banjo-hangout/downloads/13038_tef_chicken_reel.tef')));
    it('a V2 source keeps its comments, and an unchanged credit adds no second line', () => {
        const a = parseTef(chicken, 'x');
        expect(a.metadata.tab_by).toEqual({ name: 'Devon Wells' });
        const { bytes } = writeTef(a, { source: chicken, template });
        expect(headerString(bytes, 0x48)).toBe('TablEdited by Devon Wells');
        expect(parseTef(bytes, 'x').metadata.tab_by).toEqual({ name: 'Devon Wells' });
        // and again from the V3 file just written
        expect(headerString(writeTef(a, { source: bytes, template }).bytes, 0x48)).toBe('TablEdited by Devon Wells');
    });
    it('a changed credit follows the kept line; reading it back gives the new name', () => {
        const a = parseTef(chicken, 'x');
        a.metadata.tab_by = { name: 'Jane Doe' };
        const { bytes } = writeTef(a, { source: chicken, template });
        expect(headerString(bytes, 0x48)).toBe('TablEdited by Devon Wells\r\nTab by: Jane Doe');
        expect(parseTef(bytes, 'x').metadata.tab_by).toEqual({ name: 'Jane Doe' });
        const again = writeTef(a, { source: bytes, template }).bytes;
        expect(headerString(again, 0x48)).toBe('TablEdited by Devon Wells\r\nTab by: Jane Doe');
    });
    it('a credit with a link is written as a Tab by line after the kept comment', () => {
        const a = parseTef(chicken, 'x');
        a.metadata.tab_by = { name: 'Devon Wells', url: 'https://example.com/d' };
        const { bytes } = writeTef(a, { source: chicken, template });
        expect(headerString(bytes, 0x48)).toBe('TablEdited by Devon Wells\r\nTab by: Devon Wells <https://example.com/d>');
    });
});

// What TablEdit's own MusicXML export of 50 corpus files and their rewrites showed
// (G15f oracle, 2026-10-30): the same music, but not the same file.
describe('.tef writer: what a TablEdit export of the written file showed', () => {
    const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
    const corpus = (rel) => new Uint8Array(fs.readFileSync(path.join(repo, 'sources', rel)));
    const trackRecord = (d, i) => { const p = u32(d, 0x60); return d.subarray(p + 4 + 68 * i, p + 4 + 68 * (i + 1)); };
    const trackCount = (d) => d[u32(d, 0x60) + 2] | (d[u32(d, 0x60) + 3] << 8);
    const rowsOf = (d) => { let n = 0; for (let i = 0; i < trackCount(d); i++) n += trackRecord(d, i)[0]; return n; };
    /** [{pos, row, rec}] for every component of one type, as TablEdit places it. */
    const cellsOf = (d, type) => {
        const rows = rowsOf(d), out = [];
        for (let o = u32(d, 0x3c); u32(d, o) !== 0xffffffff; o += 12) {
            if (d[o + 4] !== type) continue;
            const loc = u32(d, o) / 8;
            out.push({ pos: Math.floor(loc / rows), row: loc % rows, rec: d.subarray(o, o + 12) });
        }
        return out;
    };
    const showMode = (d, i) => (trackRecord(d, i)[16] >> 4) & 7;      // 1 tab, 2 notation, 3 both, 0 hidden
    const hex = (rec) => Buffer.from(rec).toString('hex');

    it('shows tab only on every track it creates (TablEdit exports a notation staff above the tab otherwise)', () => {
        const two = doc({ tracks: [
            { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead' },
            { id: 'bass', instrument: 'upright-bass', tuning: ['G2', 'D2', 'A1', 'E1'], capo: 0, role: 'rhythm' }],
        notation: { banjo: [{ measure: 1, events: [ev(0, note(1, 0, 480))] }], bass: [] } });
        const { bytes } = roundTrip(two);
        expect([showMode(bytes, 0), showMode(bytes, 1)]).toEqual([1, 1]);
        expect(showMode(template, 0)).toBe(3);                       // the template itself shows both
        // A V2 file has no TablEdit 3 original to copy from: its tracks are created too
        const v2 = corpus('banjo-hangout/downloads/14667_tef_cumberland_gap.tef');
        expect(isV3Layout(v2)).toBe(false);
        expect(showMode(writeTef(parseTef(v2, 'x'), { source: undefined, template }).bytes, 0)).toBe(1);
    });

    it('puts a sign that ends a measure on its last sixteenth, as TablEdit does', () => {
        // V3 corpus: repeat ends, end bars and jumps sit 4 slots before the measure's
        // end (64 of 85), starts and endings on its first slot. TablEdit's export
        // dropped a repeat end written on the first slot (834 m8).
        const notes = [1, 2, 3].map(m => ({ measure: m, events: [ev(0, note(1, 0, 480))] }));
        const marks = [mark(1, 0x40), mark(2, 0x80), mark(3, 0xc0)];
        const { bytes, back } = roundTrip(doc({ notation: { banjo: notes }, measure_marks: marks }));
        expect(back.measure_marks.map(m => m.raw)).toEqual([0x40, 0x80, 0xc0]);
        const at = cellsOf(bytes, 0xb7).map(c => [c.pos, c.rec[6]]).sort((a, b) => a[0] - b[0]);
        expect(at).toEqual([[0, 0x40], [64 + 60, 0x80], [128, 0x40], [128 + 60, 0x80]]);
    });

    it('turns off the document-wide Notation switch the blank template has on', () => {
        // TablEdit 3.06 saved one blank file with Settings ▸ General ▸ Notation on and
        // one with it off: they differ in track byte 16 and two layout-block bytes.
        // Track byte 16 alone still exported a notation staff (Chicken Reel, 13038).
        const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(repo, 'tests/parser/fixtures', name)));
        const on = fixture('tabledit_306_blank_notation_on.tef');
        const off = fixture('tabledit_306_blank_notation_off.tef');
        const layout = (d) => { const p = u32(d, 0x64); return [d[p + 17], d[p + 78]]; };
        const diffs = [...on].flatMap((b, i) => (b === off[i] ? [] : [i]));
        expect(diffs).toEqual([u32(on, 0x60) + 4 + 16, u32(on, 0x64) + 17, u32(on, 0x64) + 78]);
        expect(layout(template)).toEqual(layout(on));
        const { bytes } = roundTrip(doc({ notation: { banjo: [{ measure: 1, events: [ev(0, note(1, 0, 480))] }] } }));
        expect(layout(bytes)).toEqual(layout(off));
        expect(showMode(bytes, 0)).toBe(showMode(off, 0));
        // A TablEdit 3 original keeps its own switch
        const source = corpus('banjo-hangout/downloads/26497_tef_cripple_creek___up_the_neck.tef');
        expect(layout(writeTef(parseTef(source, 'x'), { source, template }).bytes)).toEqual(layout(source));
    });

    it('keeps what a TablEdit 3 original showed: both, tab only, or hidden', () => {
        for (const rel of ['fiddle-hangout/downloads/3404_tef_wheel_hoss.tef',       // first track tab, the rest hidden
            'banjo-hangout/downloads/26497_tef_cripple_creek___up_the_neck.tef']) {  // notation and tab
            const source = corpus(rel);
            const { bytes } = writeTef(parseTef(source, 'x'), { source, template });
            for (let i = 0; i < trackCount(source); i++) {
                expect(showMode(bytes, i), `${rel} track ${i}`).toBe(showMode(source, i));
                expect(trackRecord(bytes, i)[16]).toBe(trackRecord(source, i)[16]);
            }
        }
    });

    it('keeps the name bytes of an unchanged original, an empty name included (it reads back as the same track)', () => {
        for (const rel of ['banjo-hangout/downloads/25808_tef_cumberland_gap.tef',   // empty name
            'fiddle-hangout/downloads/3404_tef_wheel_hoss.tef',
            'flatpicker-hangout/downloads/3433_tef_gold_rush.tef']) {
            const source = corpus(rel);
            const a = parseTef(source, 'x');
            const { bytes } = writeTef(a, { source, template });
            for (let i = 0; i < trackCount(source); i++) {
                expect([...trackRecord(bytes, i).subarray(32)], `${rel} track ${i}`).toEqual([...trackRecord(source, i).subarray(32)]);
            }
            expect(parseTef(bytes, 'x').tracks.map(t => t.id)).toEqual(a.tracks.map(t => t.id));
        }
        expect(trackRecord(corpus('banjo-hangout/downloads/25808_tef_cumberland_gap.tef'), 0)[32]).toBe(0);
    });

    it('an unedited original keeps every track record byte for byte: drum-line codes, capo offset, bytes past the last string', () => {
        for (const rel of ['banjo-hangout/downloads/25014_tef_blackberry_blossom.tef',       // a drum track
            'banjo-hangout/downloads/24440_tef_north_carolina_breakdown.tef',                // a capo offset the rule does not give
            'flatpicker-hangout/downloads/3424_tef_clinch_mountain_backstep.tef',            // bytes after the strings
            'fiddle-hangout/downloads/3404_tef_wheel_hoss.tef']) {
            const source = corpus(rel);
            const { bytes } = writeTef(parseTef(source, 'x'), { source, template });
            for (let i = 0; i < trackCount(source); i++) expect([...trackRecord(bytes, i)], `${rel} track ${i}`).toEqual([...trackRecord(source, i)]);
        }
    });

    it('a created track gets a name the importer reads back, never an empty one', () => {
        const { bytes } = roundTrip(doc());
        expect(trackRecord(bytes, 0)[32]).not.toBe(0);
    });

    it('plays a created upright bass as an acoustic bass (program 32, as 18 of 31 corpus bass tracks do)', () => {
        const bass = doc({ tracks: [{ id: 'bass', instrument: 'upright-bass', tuning: ['G2', 'D2', 'A1', 'E1'], capo: 0, role: 'rhythm' }],
            notation: { bass: [{ measure: 1, events: [ev(0, note(1, 0, 480))] }] } });
        const { bytes } = roundTrip(bass);
        expect(trackRecord(bytes, 0)[8]).toBe(32);
        const banjo = roundTrip(doc()).bytes;
        expect(trackRecord(banjo, 0)[8]).toBe(105);
    });

    it('puts text, repeat signs and chord diagrams back on the rows and with the bytes the original had', () => {
        for (const rel of ['banjo-hangout/downloads/28438_tef_angeline_the_baker.tef',      // text on the last string
            'flatpicker-hangout/downloads/3433_tef_gold_rush.tef',                           // text on the second track
            'mandolin-hangout/downloads/3419_tef_st__anne_s_reel.tef',                       // marks on the third track
            'banjo-hangout/downloads/27500_tef_temperance_reel__geade_.tef',                 // text with a vertical offset
            'fiddle-hangout/downloads/3404_tef_wheel_hoss.tef']) {                           // chord diagrams on the fourth string
            const source = corpus(rel);
            const { bytes } = writeTef(parseTef(source, 'x'), { source, template });
            const key = ({ pos, row, rec }) => `${pos}:${row}:${hex(rec.subarray(6))}`;     // all but the location and the text index
            for (const type of [0x39, 0xb7, 0x35]) {
                expect(cellsOf(bytes, type).map(key).sort(), `${rel} ${type.toString(16)}`).toEqual(cellsOf(source, type).map(key).sort());
            }
        }
    });

    it('moves text that is not in the original to a free cell instead', () => {
        const source = corpus('banjo-hangout/downloads/28438_tef_angeline_the_baker.tef');
        const a = parseTef(source, 'x');
        const old = a.annotations[0];
        a.annotations[0] = { ...old, text: 'changed' };                       // no longer the original's text
        a.annotations.push({ measure: 2, tick: 0, text: 'new' });
        const { bytes, notices } = writeTef(a, { source, template });
        expect(noticeLine(notices)).toBe('');
        expect(parseTef(bytes, 'x').annotations.map(t => t.text).sort()).toEqual(a.annotations.map(t => t.text).sort());
        const cells = cellsOf(bytes, 0x39);
        expect(new Set(cells.map(c => `${c.pos}:${c.row}`)).size).toBe(cells.length);   // no two on one cell
    });
});
