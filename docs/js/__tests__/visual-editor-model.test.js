// @vitest-environment node
// Tests for visual editor SongDocument model: parse + serialize round-trip
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSong, serializeSong, serializeLine, resetIdsForTest } from '../visual-editor/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ANNIE = `{meta: title Annie's Song}
{meta: artist John Denver}
{meta: x_source classic-country}

{start_of_verse: Verse 1}
[C]You fill up my [F]sen-ses [G7]like [Am]a night [F]in a [C]forest
[F]Like the [G7]mountains in [Dm]spring-time  [F]like a walk in the [G7]rain
{end_of_verse}

{start_of_chorus: Chorus}
[F]Come let [G7]me l-ove [Am]you
{end_of_chorus}
`;

// Mid-word chords (real data pattern from works/believe/)
const BELIEVE_LINES = `{start_of_verse: Verse 1}
[G]Old man Wrigley lived in that white house,
D[D/F]own the street where I grew up.
H[C]e said I'll see my wife and son in just a little while
{end_of_verse}
`;

function normalize(text) {
    const lines = text.split('\n').map(l => l.replace(/\s+$/, ''));
    const out = [];
    for (const l of lines) {
        if (l === '' && out[out.length - 1] === '') continue;
        out.push(l);
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
}

beforeEach(() => resetIdsForTest());

describe('parseSong', () => {
    it('extracts bound metadata fields and keeps raw lines', () => {
        const doc = parseSong(ANNIE);
        expect(doc.metadata.fields.title).toBe("Annie's Song");
        expect(doc.metadata.fields.artist).toBe('John Denver');
        expect(doc.metadata.rawLines).toHaveLength(3);
        expect(doc.metadata.rawLines[2].raw).toBe('{meta: x_source classic-country}');
        expect(doc.metadata.rawLines[2].field).toBeNull();
    });

    it('parses sections with type, label, and verbatim directives', () => {
        const doc = parseSong(ANNIE);
        expect(doc.sections).toHaveLength(2);
        expect(doc.sections[0].type).toBe('verse');
        expect(doc.sections[0].label).toBe('Verse 1');
        expect(doc.sections[0].openRaw).toBe('{start_of_verse: Verse 1}');
        expect(doc.sections[1].type).toBe('chorus');
        expect(doc.sections[0].lines).toHaveLength(2);
    });

    it('parses chords to character offsets (same shape as parseLineWithChords)', () => {
        const doc = parseSong(ANNIE);
        const line = doc.sections[0].lines[0];
        expect(line.lyrics).toBe('You fill up my sen-ses like a night in a forest');
        expect(line.chords[0]).toEqual({ chord: 'C', position: 0 });
        expect(line.chords[1]).toEqual({ chord: 'F', position: 15 });
    });

    it('preserves mid-word chord offsets exactly', () => {
        const doc = parseSong(BELIEVE_LINES);
        const line = doc.sections[0].lines[1];
        expect(line.lyrics).toBe('Down the street where I grew up.');
        expect(line.chords[0]).toEqual({ chord: 'D/F', position: 1 });
    });

    it('groups bare lines into implicit verse sections split on blank lines', () => {
        const doc = parseSong('First verse line one\nFirst verse line two\n\nSecond verse line');
        expect(doc.sections).toHaveLength(2);
        expect(doc.sections[0].implicit).toBe(true);
        expect(doc.sections[0].label).toBe('Verse 1');
        expect(doc.sections[1].label).toBe('Verse 2');
        expect(doc.sections[0].lines).toHaveLength(2);
    });

    it('turns ABC blocks into passthrough sections verbatim', () => {
        const abc = '{start_of_abc}\nX:1\nK:A\n|: E2AB :|\n{end_of_abc}';
        const doc = parseSong(abc);
        expect(doc.sections).toHaveLength(1);
        expect(doc.sections[0].type).toBe('passthrough');
        expect(doc.sections[0].raw).toBe(abc);
    });

    it('turns unknown standalone directives into passthrough sections', () => {
        const doc = parseSong('{comment: Repeat Verse 1}');
        expect(doc.sections[0].type).toBe('passthrough');
        expect(doc.sections[0].raw).toBe('{comment: Repeat Verse 1}');
    });

    it('keeps unknown directives inside a section as opaque lines', () => {
        const doc = parseSong('{start_of_verse: V1}\nline one\n{comment: soft}\nline two\n{end_of_verse}');
        expect(doc.sections).toHaveLength(1);
        expect(doc.sections[0].lines).toHaveLength(3);
        expect(doc.sections[0].lines[1].opaque).toBe(true);
        expect(doc.sections[0].lines[1].lyrics).toBe('{comment: soft}');
    });

    it('accepts shorthand directives and preserves them verbatim', () => {
        const doc = parseSong('{sov: Verse 1}\nhello\n{eov}');
        expect(doc.sections[0].type).toBe('verse');
        expect(doc.sections[0].openRaw).toBe('{sov: Verse 1}');
        expect(serializeSong(doc)).toContain('{sov: Verse 1}');
    });
});

describe('serializeLine', () => {
    it('reinserts brackets at exact positions, right-to-left', () => {
        expect(serializeLine({
            lyrics: 'Down the street', chords: [{ chord: 'D/F', position: 1 }]
        })).toBe('D[D/F]own the street');
    });

    it('preserves multiple chords at the same position in order', () => {
        expect(serializeLine({
            lyrics: 'word', chords: [{ chord: 'G', position: 0 }, { chord: 'C', position: 0 }]
        })).toBe('[G][C]word');
    });

    it('clamps trailing chords to end of line', () => {
        expect(serializeLine({
            lyrics: 'hello', chords: [{ chord: 'G', position: 5 }]
        })).toBe('hello[G]');
    });

    it('serializes chord-only lines (empty lyrics)', () => {
        expect(serializeLine({
            lyrics: ' ', chords: [{ chord: 'G', position: 0 }, { chord: 'C', position: 1 }]
        })).toBe('[G] [C]');
    });
});

describe('round-trip', () => {
    it('round-trips the fixtures byte-identically after normalization', () => {
        for (const src of [ANNIE, BELIEVE_LINES]) {
            expect(normalize(serializeSong(parseSong(src)))).toBe(normalize(src));
        }
    });

    it('regenerates a metadata line only when its field changed', () => {
        const doc = parseSong(ANNIE);
        doc.metadata.fields.artist = 'Someone Else';
        const out = serializeSong(doc);
        expect(out).toContain('{meta: artist Someone Else}');
        expect(out).toContain("{meta: title Annie's Song}"); // untouched, verbatim
    });

    it('emits metadata for new songs in project order', () => {
        const doc = parseSong('hello world');
        doc.metadata.fields.title = 'New Song';
        doc.metadata.fields.key = 'G';
        const out = serializeSong(doc);
        expect(out.indexOf('{meta: title New Song}')).toBeLessThan(out.indexOf('{key: G}'));
    });
});

describe('corpus round-trip (property test)', () => {
    it('round-trips 300 sampled works after normalization', () => {
        const worksDir = path.resolve(__dirname, '../../../works');
        const dirs = fs.readdirSync(worksDir).sort().slice(0, 400);
        let tested = 0;
        for (const d of dirs) {
            const f = path.join(worksDir, d, 'lead-sheet.pro');
            if (!fs.existsSync(f)) continue;
            const src = fs.readFileSync(f, 'utf8');
            const out = serializeSong(parseSong(src));
            expect(normalize(out), `round-trip failed for works/${d}`).toBe(normalize(src));
            if (++tested >= 300) break;
        }
        expect(tested).toBeGreaterThan(100);
    });
});
