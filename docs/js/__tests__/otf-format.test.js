// G15b: the one OTF file layout. Python twin: scripts/lib/otf_format.py
// (tests/test_otf_format.py). Both run the same fixtures, so passing both
// proves they write identical bytes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { serializeOTF, KEY_ORDER } from '../otf-format.js';

const ROOT = resolve(__dirname, '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const SCHEMA = JSON.parse(read('docs/schema/otf.schema.json'));

describe('KEY_ORDER equals the schema property order', () => {
    const top = SCHEMA.properties;
    const note = SCHEMA.$defs.note.properties;
    const measure = top.notation.additionalProperties.items.properties;
    const expected = {
        doc: top,
        metadata: top.metadata.properties,
        timing: top.timing.properties,
        track: top.tracks.items.properties,
        measure,
        event: measure.events.items.properties,
        note,
        grace: note.grace.properties,
        annotation: top.annotations.items.properties,
        reading: top.reading_list.items.properties,
        tsc: top.metadata.properties.time_signature_changes.items.properties,
    };
    for (const [ctx, props] of Object.entries(expected)) {
        it(ctx, () => expect(KEY_ORDER[ctx]).toEqual(Object.keys(props)));
    }
    it('names no context the schema lacks', () => {
        expect(Object.keys(KEY_ORDER).sort()).toEqual(Object.keys(expected).sort());
    });
});

describe('serializeOTF', () => {
    it('writes the shared edge fixture byte for byte', () => {
        const doc = JSON.parse(read('tests/fixtures/otf/layout/edge.input.json'));
        expect(serializeOTF(doc)).toBe(read('tests/fixtures/otf/layout/edge.expected.json'));
    });

    it('ends with exactly one newline', () => {
        expect(serializeOTF({ otf_version: '1.0' })).toBe('{\n  "otf_version": "1.0"\n}\n');
    });

    it('writes empty containers as [] and {}', () => {
        expect(serializeOTF({ a: [], b: {} })).toBe('{\n  "a": [],\n  "b": {}\n}\n');
    });

    it('writes a whole number as an integer and refuses a fraction', () => {
        expect(serializeOTF({ metadata: { tempo: 120.0 } })).toContain('"tempo": 120\n');
        expect(() => serializeOTF({ metadata: { tempo: 120.5 } })).toThrow();
    });

    it('escapes strings like Python does', () => {
        const s = (v) => serializeOTF({ k: v }).split('\n')[1].slice('  "k": '.length);
        expect(s('\x01\x1f')).toBe('"\\u0001\\u001f"');
        expect(s('\x7f')).toBe('"\x7f"');
        expect(s('a"b\\c')).toBe('"a\\"b\\\\c"');
        expect(s('\n\r\t\b\f')).toBe('"\\n\\r\\t\\b\\f"');
        expect(s('  ')).toBe('"  "');
        expect(s('café \u{1f3b5}')).toBe('"café \u{1f3b5}"');
        expect(s('\ud800')).toBe('"\\ud800"');
        expect(s('🎵')).toBe('"\u{1f3b5}"');
    });

    it('drops _ keys and keeps unknown x_source keys in order', () => {
        const out = serializeOTF({ _partFile: 'x', x_source: { z: 1, a: 2, _c: 3 }, otf_version: '1.0' });
        expect(out).toBe('{\n  "otf_version": "1.0",\n  "x_source": {\n    "z": 1,\n    "a": 2\n  }\n}\n');
    });
});

// Corpus sweep: reads live files on purpose (it catches a writer that drifts
// or a hand edit in the wrong layout; .claude/rules/tests.md allows that).
describe('every tracked .otf.json is already in the canonical layout', () => {
    it('serializeOTF(parse(f)) equals the bytes of f', () => {
        const files = execFileSync('git', ['ls-files', 'works/*/*.otf.json', 'docs/data/tabs/*_tef.otf.json',
            'tests/parser/fixtures/*.otf.json', 'sources/*/parsed/*.otf.json'], { cwd: ROOT, encoding: 'utf8' })
            .split('\n').filter(Boolean);
        expect(files.length).toBeGreaterThan(1000);
        const off = files.filter((f) => serializeOTF(JSON.parse(read(f))) !== read(f));
        expect(off.slice(0, 10)).toEqual([]);
    }, 120000);
});
