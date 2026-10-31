// Foggy Mountain Breakdown's typed m/i letters become banjo fingering (G21b).
//
// Foggy Mountain Breakdown 1481 (V2) has 426 m/i letters on the banjo, all
// place "below", each over a single note. tests/fixtures/tab-fingering/
// fmb-banjo-fingering.json is the frozen answer ([measure, tick, string, finger] for
// every letter, and how many annotations are left), frozen from the file before G21b.
// Python counterpart: tests/parser/test_tef_typed_fingering_fmb.py.
//
// The round trip proves the writer keeps a converted letter as TablEdit pick-hand
// fingering: the written .tef holds 551 texts, not 977, and the fingers come back.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';
import { writeTef } from '../tef-export/writer.js';
import { validateOTF } from '../otf-editor/otf-validate.js';
import { canonical, firstDifference } from './tef-roundtrip-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FROZEN = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/tab-fingering/fmb-banjo-fingering.json'), 'utf8'));
const bytes = new Uint8Array(fs.readFileSync(path.join(root, FROZEN.source)));
const template = new Uint8Array(fs.readFileSync(path.join(root, 'docs/js/tef-export/template.tef')));
const cmp = (a, b) => a.reduce((d, x, i) => d || x - b[i], 0);

const fingered = (otf, track) => otf.notation[track].flatMap(m => m.events.flatMap(e => e.notes
    .filter(n => n.finger).map(n => [m.measure, e.tick, n.s, n.finger]))).sort(cmp);

describe('Foggy Mountain Breakdown typed fingering', () => {
    const otf = parseTef(bytes, '1481.tef');

    it('the 426 letters become the banjo notes\' finger', () => {
        expect(FROZEN.fingering).toHaveLength(426);
        expect(fingered(otf, 'banjo')).toEqual([...FROZEN.fingering].sort(cmp));
        for (const t of Object.keys(otf.notation).filter(t => t !== 'banjo')) expect(fingered(otf, t)).toEqual([]);
    });

    it('the letters leave the annotations and nothing else does', () => {
        expect(otf.annotations).toHaveLength(FROZEN.annotations_after);
        expect(otf.annotations.filter(a => ['m', 'i'].includes(a.text.trim().toLowerCase()))).toEqual([]);
        expect(FROZEN.annotations_before - FROZEN.fingering.length).toBe(FROZEN.annotations_after);
    });

    it('chord names are chords and the rest stays text', () => {
        expect(otf.annotations.filter(a => a.kind === 'chord')).toHaveLength(415);
        const text = new Set(otf.annotations.filter(a => !('kind' in a)).map(a => a.text));
        for (const t of ['etc.', 'G: Lead Guitar...', 'G: Bass...']) expect(text.has(t)).toBe(true);
        expect(validateOTF(otf).errors).toEqual([]);
    });

    it('the round trip keeps the fingering as fingering, not as text', () => {
        const { bytes: out } = writeTef(otf, { template });
        const back = parseTef(out, '1481.tef');
        expect(back.annotations).toHaveLength(FROZEN.annotations_after);
        expect(fingered(back, 'banjo')).toEqual([...FROZEN.fingering].sort(cmp));
        expect(firstDifference(canonical(otf), canonical(back))).toBe(null);
    });
});
