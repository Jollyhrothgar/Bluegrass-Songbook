// G15d5: a slide source the triplet retime stacks on its target (#318).
// The retime keeps TablEdit's timing (f6 lands on f7's tick); the importer then
// folds the source into the target as grace {f, kind:'slide'} so a string never
// holds two notes in one event. Frozen copies: tests/parser/fixtures/ (3098 m40,
// 3302 m88 control, synthetic_v2_slide_stack), carried in golden.json.
// Python counterpart: tests/parser/test_tef_slide_stack.py
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../tef-import/__fixtures__/golden.json'), 'utf8'));

function convert(name) {
    const entry = fixture.files[name];
    if (!entry) throw new Error(`missing golden entry: ${name}`);
    return parseTef(Uint8Array.from(Buffer.from(entry.bytes_b64, 'base64')), name);
}
const measure = (otf, track, n) => otf.notation[track].find(m => m.measure === n);

describe('slide source folded into a grace', () => {
    it('synthetic V2 pattern: f6 slide + f7 on one string become one note', () => {
        const ev = measure(convert('synthetic_v2_slide_stack.tef'), 'banjo', 1)
            .events.find(e => e.tick === 480);
        expect(ev.notes.filter(n => n.s === 1))
            .toEqual([{ s: 1, f: 7, dur: 480, grace: { f: 6, kind: 'slide' } }]);
    });

    it('3098 m40 has no duplicate string and carries the grace', () => {
        const m = measure(convert('3098_jerusalem_ridge_slide_stack.tef'), 'fiddle', 40);
        const keys = m.events.flatMap(e => e.notes.map(n => `${e.tick}:${n.s}`));
        expect(new Set(keys).size).toBe(keys.length);
        for (const tick of [480, 960]) {
            const n = m.events.find(e => e.tick === tick).notes.find(x => x.s === 2);
            expect(n).toEqual({ s: 2, f: 7, dur: 480, grace: { f: 6, kind: 'slide' } });
        }
        expect(m.events.some(e => e.notes.some(n => n.f === 6))).toBe(false);
    });

    it('triplet slots 0-2 still land on 0/160/...', () => {
        const ticks = measure(convert('synthetic_v2_slide_stack.tef'), 'banjo', 1)
            .events.map(e => e.tick);
        for (const t of [0, 160, 640]) expect(ticks).toContain(t);
    });

    it('3302 m88 index-3 hammer-on stays on beat 4, unfolded', () => {
        const ev = measure(convert('3302_beaumont_rag_triplet_slot3.tef'), 'bryan-sutton', 88)
            .events.find(e => e.tick === 1440);
        expect(ev.notes).toContainEqual({ s: 5, f: 4, tech: 'h', dur: 160 });
        expect(ev.notes.some(n => n.grace)).toBe(false);
    });
});

// A triplet retime may not push a note onto/past the barline (10676 m7/m8):
// TablEdit's export keeps m7's slot-3 note inside the measure (945/240 divisions).
describe('triplet retime stays inside the measure', () => {
    it('10676 m7/m8: no event at or past tick 1920; m7 keeps its note at 1800', () => {
        const otf = convert('10676_doug_s_tune_slot3_barline.tef');
        for (const n of [7, 8]) {
            const m = measure(otf, 'banjo', n);
            expect(Math.max(...m.events.map(e => e.tick))).toBeLessThan(1920);
        }
        const ev = measure(otf, 'banjo', 7).events.find(e => e.tick === 1800);
        expect(ev.notes.some(n => n.s === 1)).toBe(true);
    });
});
