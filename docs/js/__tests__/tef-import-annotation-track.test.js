// Every annotation records its track (G21a, OTF 1.3): the JS importer gives each
// text the track its cumulative string row is on, as the Python one does.
//
// Corpus files are the proof: Foggy Mountain Breakdown 1481 is V2 with four tracks,
// Cumberland Gap 24908 is V3 with three. Python counterpart:
// tests/parser/test_tef_annotation_track.py (the golden gate pins JS == Python).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';
import { parseTefBytes } from '../tef-import/reader.js';
import { tefToOtf, toOtfDict } from '../tef-import/otf.js';
import { validateOTF } from '../otf-editor/otf-validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FMB = 'sources/flatpicker-hangout/downloads/1481_tef_foggy_mountain_breakdown___banjo_and_guitar_duel.tef';
const CUMBERLAND = 'sources/banjo-hangout/downloads/24908_tef_cumberland_gap___reno.tef';
const bytesOf = (file) => new Uint8Array(fs.readFileSync(path.join(root, file)));
const count = (items) => items.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});

describe('annotation track from the string row', () => {
    it('Foggy Mountain Breakdown (V2, four tracks)', () => {
        const otf = parseTef(bytesOf(FMB), '1481.tef');
        expect(otf.tracks.map(t => t.id)).toEqual(['banjo', 'guitar', 'guitar-2', 'bass']);
        // 977 texts in the file; the banjo's 426 m/i letters became fingering (G21b)
        expect(otf.annotations).toHaveLength(551);
        expect(count(otf.annotations.map(a => a.track))).toEqual({
            banjo: 119, guitar: 208, 'guitar-2': 113, bass: 111 });
        const atStart = otf.annotations.filter(a => a.measure === 2 && a.tick === 0)
            .map(a => [a.text, a.track]).sort();
        expect(atStart).toEqual([
            ['Blank for now...', 'guitar'], ['G', 'banjo'], ['G: Bass...', 'bass'],
            ['G: Lead Guitar...', 'guitar'], ['G: Rhythm Guitar...', 'guitar-2'],
        ]);
        expect(validateOTF(otf).errors).toEqual([]);
        expect(otf.otf_version).toBe('1.3');
    });

    it('Cumberland Gap (V3, three tracks) puts every text on the banjo rows', () => {
        const otf = parseTef(bytesOf(CUMBERLAND), '24908.tef');
        expect(otf.tracks.map(t => t.id)).toEqual(['banjo', 'bass', 'mandolin']);
        expect(count(otf.annotations.map(a => a.text))).toEqual({ G: 24, D: 8 });
        expect(new Set(otf.annotations.map(a => a.track))).toEqual(new Set(['banjo']));
        expect(validateOTF(otf).errors).toEqual([]);
    });

    it('a row past every track leaves the text track-less', () => {
        // Move one text past the last string, then run the same conversion parseTef does.
        const tef = parseTefBytes(bytesOf(CUMBERLAND), '24908');
        tef.text_events[0].string_row = 99;
        const otf = toOtfDict(tefToOtf(tef));
        expect('track' in otf.annotations[0]).toBe(false);
        expect(otf.annotations[1].track).toBe('banjo');
        expect(validateOTF(otf).errors).toEqual([]);
    });
});

// Text placement (G21a): TablEdit stores a text's side as a placement value, V3 text
// record byte 11 or V2 byte 4 bits 5-6. 0 above, 1 below the staff, 2 above, 3 on the
// staff near its string. OTF keeps only `place: "below"` (value 1).
describe('annotation place from the placement value', () => {
    const BRILLIANCY_V2 = 'sources/banjo-hangout/downloads/11655_tef_brilliancy.tef';
    const BRILLIANCY_V3 = 'tests/parser/fixtures/brilliancy_11655_tabledit_v3.tef';     // TablEdit's own conversion
    const placed = (file) => parseTef(bytesOf(file), 'x.tef').annotations.map(a => [a.measure, a.text, a.place]);

    it('Brilliancy: the three "Part" labels are below, in V2 and in TablEdit\'s own V3', () => {
        const v2 = placed(BRILLIANCY_V2);
        const below = v2.filter(([, , place]) => place === 'below');
        expect(below.map(([, text]) => text.split(' ')[0])).toEqual(['Part', 'Part', 'Part']);
        expect(v2.every(([, , place]) => place === undefined || place === 'below')).toBe(true);
        expect(placed(BRILLIANCY_V3)).toEqual(v2);
    });

    // G21b: every below text in these three files is a typed fingering letter, so none is
    // left as an annotation; each became the finger of the note it sat on.
    const fingers = (otf) => Object.values(otf.notation).flat().flatMap(m => m.events.flatMap(e => e.notes))
        .filter(n => n.finger).length;
    const belowInFile = (file) => parseTefBytes(bytesOf(file), 'x').text_events.filter(t => t.placement === 1);

    it('Foggy Mountain Breakdown: the 426 m and i letters are below, on the banjo, and become fingering', () => {
        const letters = belowInFile(FMB);
        expect(letters).toHaveLength(426);
        expect(new Set(letters.map(t => t.text))).toEqual(new Set(['m', 'i']));
        const otf = parseTef(bytesOf(FMB), 'x.tef');
        expect(otf.annotations.filter(a => a.place === 'below')).toHaveLength(0);
        expect(fingers(otf)).toBe(426);
    });

    it.each([['21627_tef_temperance_reel.tef', 16, 64], ['28162_tef_temperance_reel.tef', 114, 159]])(
        'Temperance Reel %s (V3): %i of %i texts are below, all fingering letters', (name, below, total) => {
            const file = `sources/banjo-hangout/downloads/${name}`;
            const otf = parseTef(bytesOf(file), name);
            expect(belowInFile(file)).toHaveLength(below);
            expect(otf.annotations).toHaveLength(total - below);
            expect(otf.annotations.filter(a => a.place === 'below')).toHaveLength(0);
            expect(fingers(otf)).toBe(below);
        });

    it('placements 0, 2 and 3 leave place absent; 1 sets it', () => {
        const edited = (value) => {
            const tef = parseTefBytes(bytesOf(CUMBERLAND), '24908');
            tef.text_events[0].placement = value;
            return toOtfDict(tefToOtf(tef)).annotations[0];
        };
        for (const value of [0, 2, 3]) expect('place' in edited(value)).toBe(false);
        expect(edited(1).place).toBe('below');
        expect(Object.keys(edited(1))).toEqual(['measure', 'tick', 'text', 'track', 'kind', 'place']);
    });
});
