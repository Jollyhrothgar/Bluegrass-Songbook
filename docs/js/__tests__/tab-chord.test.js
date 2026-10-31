// The shared table (also read by tests/test_tab_chord.py) pins parseTabChord
// here against parse_tab_chord in scripts/lib/tab_chord.py.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseTabChord } from '../tab-chord.js';

const table = JSON.parse(readFileSync(
    resolve(process.cwd(), 'tests/fixtures/tab-chord/tab-chords.json'), 'utf8'));

describe('tab chord parser', () => {
    it.each(table.cases)('parses $text', ({ text, parts }) => {
        expect(parseTabChord(text)).toEqual(parts);
    });
    it('returns null for non-strings', () => {
        expect(parseTabChord(undefined)).toBeNull();
        expect(parseTabChord(7)).toBeNull();
    });
});
