// G21c, folded in: the renderer names a tuning from its note letters, string
// 1 first, and four entries held letters that are not the tunings players
// mean (found while building the tab editor's Tab setup, G20). Each tuning
// below is written as players spell it, 5th string first.
import { describe, it, expect } from 'vitest';
import { BANJO_TUNINGS, MANDOLIN_TUNINGS, GUITAR_TUNINGS, detectTuningName } from '../renderers/tablature.js';
import { TUNING_PRESETS } from '../otf-editor/tab-setup.js';

describe('tuning names', () => {
    it.each([
        ['banjo Open D (f#DF#AD)', '5-string-banjo', ['D4', 'A3', 'F#3', 'D3', 'F#4'], 'Open D'],
        ['banjo C (gCGBD)', '5-string-banjo', ['D4', 'B3', 'G3', 'C3', 'G4'], 'C Tuning'],
        ['banjo Open A (aEAC#E)', '5-string-banjo', ['E4', 'C#4', 'A3', 'E3', 'A4'], 'Open A'],
        ['mandolin DADA', 'mandolin', ['D5', 'A4', 'D4', 'A3'], 'DADA'],
        ['banjo Open G', '5-string-banjo', ['D4', 'B3', 'G3', 'D3', 'G4'], 'Open G'],
        ['banjo Double C', '5-string-banjo', ['D4', 'C4', 'G3', 'C3', 'G4'], 'Double C'],
        ['mandolin standard', 'mandolin', ['E5', 'A4', 'D4', 'G3'], 'Standard'],
    ])('%s is named', (_, instrument, pitches, name) => {
        expect(detectTuningName(pitches, instrument).name).toBe(name);
    });

    it('a capo shifts the tuning before it is named', () => {
        expect(detectTuningName(['E4', 'B3', 'G#3', 'E3', 'G#4'], '5-string-banjo', 2))
            .toEqual({ name: 'Open D', display: 'Open D, Capo 2' });
    });

    it('the letters the tables held before are not those tunings', () => {
        expect(detectTuningName(['D4', 'A3', 'D3', 'F#3', 'A4'], '5-string-banjo').name).toBeNull();
        expect(detectTuningName(['E5', 'A4', 'D4', 'A3'], 'mandolin').name).toBeNull();
    });

    it('the keys of every table are one letter-pattern for one name', () => {
        for (const table of [BANJO_TUNINGS, MANDOLIN_TUNINGS, GUITAR_TUNINGS]) {
            for (const key of Object.keys(table)) expect(key).toMatch(/^[A-G]#?(-[A-G]#?)+$/);
        }
    });

    it('the tab editors presets map to their names, as the stave header prints them', () => {
        // Banjo "C Tuning" is left out: the editor's preset is gCGCE (E-C-G-C-G),
        // the table's gCGBD (D-B-G-C-G). Two readings; see the G21 report.
        for (const [instrument, list] of Object.entries(TUNING_PRESETS)) {
            for (const [name, pitches] of list) {
                if (instrument === '5-string-banjo' && name === 'C Tuning') continue;
                const named = detectTuningName(pitches, instrument).name;
                if (named) expect(named, `${instrument} ${name}`).toBe(name);
            }
        }
        for (const [name] of TUNING_PRESETS['5-string-banjo']) {
            if (['Open D', 'Open A', 'Open G', 'Double C', 'G Modal'].includes(name)) {
                const preset = TUNING_PRESETS['5-string-banjo'].find(([n]) => n === name);
                expect(detectTuningName(preset[1], '5-string-banjo').name, name).toBe(name);
            }
        }
        expect(detectTuningName(TUNING_PRESETS.mandolin.find(([n]) => n === 'DADA')[1], 'mandolin').name).toBe('DADA');
    });
});
