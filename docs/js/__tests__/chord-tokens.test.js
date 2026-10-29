// The shared chord-token table (also read by tests/test_chord_chart.py) pins
// isValidChord here against the Python port in scripts/lib/chord_chart.py.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isValidChord } from '../chords.js';

const table = JSON.parse(readFileSync(
    resolve(process.cwd(), 'tests/fixtures/chord-chart/chord-tokens.json'), 'utf8'));

describe('chord-chart token table', () => {
    it.each(table.valid)('accepts %j', (tok) => {
        expect(isValidChord(tok)).toBe(true);
    });
    it.each(table.invalid)('rejects %j', (tok) => {
        expect(isValidChord(tok)).toBe(false);
    });
});
