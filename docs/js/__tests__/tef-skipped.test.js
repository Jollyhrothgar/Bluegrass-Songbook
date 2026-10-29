// G15e: the JS importer counts what a .tef holds that OTF does not keep, the
// same numbers as the Python importer (tests/parser/test_tef_skipped.py; the
// fixtures come from tests/parser/make_skipped_fixtures.py), and the words for
// them live in one module the take header and Save as share.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';
import { SKIPPED_KEYS } from '../tef-import/skipped.js';
import { SKIPPED_LABELS, skippedLine, skippedSummary } from '../tef-skipped.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../../../tests/parser/fixtures');
const read = (name) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

const EXPECTED_V3 = {
    tempo_changes: 2, instrument_changes: 1, scale_diagrams: 3, accents: 4,
    slurs: 5, picking_marks: 6, special_characters: 7, percussion: 8,
    free_text: 3, tapping: 9, vibrato: 10, tremolo_bar: 11, other: 12,
};
const { free_text: _freeText, ...EXPECTED_V2 } = EXPECTED_V3;

describe('TEF import counts what OTF does not keep', () => {
    describe.each([['V3', 'skipped_v3_all.tef', EXPECTED_V3], ['V2', 'skipped_v2_all.tef', EXPECTED_V2]])(
        '%s', (_label, file, expected) => {
            // The fixtures' bare 0x35 / V2 0x1c records have no chord table, so the
            // chord-diagram importer (G15d3) also reports them, as dropped diagrams.
            const withChords = { ...expected, chord_diagrams: 2 };
            const skipped = parseTef(read(file), file).x_source?.skipped;
            it.each(Object.entries(expected))('%s', (key, count) => {
                expect(skipped[key]).toBe(count);
            });
            it('counts nothing else', () => {
                expect(skipped).toEqual(withChords);
                expect(Object.keys(skipped)).toEqual(SKIPPED_KEYS.filter(k => k in withChords));
            });
        });

    it.each(['cherokee_shuffle_21874_v3.tef', '18998_dup_banjo.tef', '2927_gold_rush_percussion.tef'])(
        'a file with nothing skipped has no x_source (%s)', (file) => {
            const doc = parseTef(read(file), file);
            expect('x_source' in doc).toBe(false);
            expect(skippedLine(doc.x_source?.skipped)).toBe('');
        });
});

describe('the words', () => {
    it('has a label for every key, in the importers\' order', () => {
        expect(Object.keys(SKIPPED_LABELS)).toEqual(SKIPPED_KEYS);
    });

    it('the schema description lists every key with its plural label', () => {
        const schema = JSON.parse(fs.readFileSync(
            path.join(__dirname, '../../schema/otf.schema.json'), 'utf8'));
        const description = schema.properties.x_source.description;
        let at = -1;
        for (const [key, [, many]] of Object.entries(SKIPPED_LABELS)) {
            const i = description.indexOf(`${key} = ${many}`);
            expect(i, key).toBeGreaterThan(at);
            at = i;
        }
    });

    it('says what a header should say', () => {
        expect(skippedLine({ tempo_changes: 2, free_text: 1 }))
            .toBe('Not kept from this file: 2 tempo changes, 1 line of free text.');
        expect(skippedLine({ tempo_changes: 1 }))
            .toBe('Not kept from this file: 1 tempo change.');
    });

    it('is stable whatever order the keys arrive in', () => {
        expect(skippedSummary({ free_text: 1, tempo_changes: 2 })).toBe('2 tempo changes, 1 line of free text');
    });

    it('says nothing when nothing was skipped', () => {
        expect(skippedLine(undefined)).toBe('');
        expect(skippedLine({})).toBe('');
        expect(skippedLine({ tempo_changes: 0 })).toBe('');
    });

    it('folds a key it has no words for into "other"', () => {
        expect(skippedSummary({ other: 1, from_the_future: 2 })).toBe('3 other TablEdit markings');
    });
});
