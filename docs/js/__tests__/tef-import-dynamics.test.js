// G15d1: per-note dynamics through the in-browser importer.
// Code 0 is the LOUDEST (0 fff .. 6 pp); 7 is the tie sentinel. The golden gate
// proves JS == Python on every file; this pins the meaning on known files.
// Python counterpart: tests/parser/test_tef_dynamics.py
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';
import { dynamicCode } from '../tef-import/otf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../tef-import/__fixtures__/golden.json'), 'utf8'));

function doc(name) {
    const entry = fixture.files[name];
    if (!entry) throw new Error(`missing golden entry: ${name}`);
    return parseTef(Uint8Array.from(Buffer.from(entry.bytes_b64, 'base64')), name);
}
function notes(d, trackId) {
    const out = {};
    for (const m of d.notation[trackId] || [])
        for (const ev of m.events) for (const n of ev.notes) out[`${m.measure}:${ev.tick}:${n.s}`] = n;
    return out;
}

describe('dynamicCode', () => {
    it('reads bits 5-7 of V3 byte 5, V2 byte 3 and the 4-byte byte 3', () => {
        const v3 = new Uint8Array(12); v3[5] = (3 << 5) | 9;
        expect(dynamicCode({ raw: v3 })).toBe(3);
        const v2 = new Uint8Array(6); v2[3] = (0 << 5) | 6;
        expect(dynamicCode({ raw: v2 })).toBe(0);
        const v2s = new Uint8Array(4); v2s[3] = (6 << 5) | 6;
        expect(dynamicCode({ raw: v2s })).toBe(6);
    });
    it('is null for the tie code and for a missing record', () => {
        const tie = new Uint8Array(12); tie[5] = 7 << 5;
        expect(dynamicCode({ raw: tie })).toBeNull();
        expect(dynamicCode({})).toBeNull();
    });
});

describe('TEF import: dynamics', () => {
    it('V3 mixed file: track f, exceptions on the notes, none on the tie', () => {
        const d = doc('dynamics_v3_mixed.tef');
        expect(d.tracks[0].dyn).toBe('f');
        const n = notes(d, 'banjo');
        expect(n['1:1440:4'].dyn).toBe('mf');
        expect(n['2:960:3'].dyn).toBe('fff');
        expect(n['3:240:3'].dyn).toBe('pp');
        expect(n['4:1200:3'].dyn).toBe('ff');
        expect(n['4:1440:1'].dyn).toBe('mp');
        expect(n['5:0:1'].dyn).toBe('p');
        const withDyn = Object.values(n).filter(x => x.dyn);
        expect(withDyn.length).toBe(7);
        for (const x of Object.values(n)) if (x.tie) expect(x.dyn).toBeFalsy();
    });

    it('V2 six-byte multi-track: each track gets its own most common level', () => {
        const d = doc('wheel_hoss_2430_packed_tracks.tef');
        expect(d.tracks[0].dyn).toBe('ff');
        expect(d.tracks[1].dyn).toBe('ff');
        const first = Object.values(notes(d, d.tracks[0].id)).filter(x => !x.tie);
        expect(first.filter(x => x.dyn === 'fff').length).toBe(69);
        expect(first.filter(x => !x.dyn).length).toBe(388);
    });

    it('V2 four-byte records', () => {
        const d = doc('10591_fire_on_the_mountain_v2_4byte.tef');
        expect(d.tracks[0].dyn).toBe('fff');
        expect(d.tracks[1].dyn).toBe('ff');
        const g = Object.values(notes(d, d.tracks[0].id));
        expect(g.filter(x => x.dyn === 'mf').length).toBe(3);
        expect(g.filter(x => x.dyn === 'mp').length).toBe(2);
    });

    it('a single-level file carries tracks[].dyn only', () => {
        const d = doc('21802_fingering_annotations.tef');
        expect(d.tracks[0].dyn).toBe('f');
        expect(Object.values(notes(d, d.tracks[0].id)).some(x => x.dyn)).toBe(false);
    });
});
