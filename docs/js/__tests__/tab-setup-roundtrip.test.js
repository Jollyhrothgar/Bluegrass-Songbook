// G20b: what Tab setup changes, through the .tef writer and back. A setup value
// that comes back different is a finding, not something to hide: this file says
// which survive (and the key, which cannot, is counted as a notice).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';
import { writeTef } from '../tef-export/writer.js';
import { noticeLine } from '../tef-export/notices.js';
import { EditingFacade } from '../otf-editor/facade.js';
import { createMultiTrackOTF } from '../otf-editor/new-otf.js';
import { TUNING_PRESETS } from '../otf-editor/tab-setup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = new Uint8Array(fs.readFileSync(path.join(here, '../tef-export/template.tef')));

/** A banjo and a guitar with a few notes, set up through the facade like the panel does. */
function setUp(setup, trackId, instruments = ['5-string-banjo', '6-string-guitar']) {
    const otf = createMultiTrackOTF({ instruments, title: 'Untitled', measures: 4 });
    const first = otf.notation[otf.tracks[0].id];
    first[0].events = [{ tick: 0, notes: [{ s: 2, f: 3, dur: 480 }, { s: 1, f: 0, dur: 480 }] }];
    const f = new EditingFacade(otf);
    f.applyTabSetup(setup, trackId);
    const { bytes, notices } = writeTef(f.export(), { template });
    return { before: f.export(), back: parseTef(bytes, 'setup.tef'), notices };
}

describe('Tab setup values through writeTef and parseTef', () => {
    it('title, composer, time signature and tempo come back', () => {
        const { back } = setUp({ title: 'Cripple Creek', composer: 'Trad.', timeSignature: '3/4', tempo: 96 });
        expect(back.metadata).toMatchObject({
            title: 'Cripple Creek', composer: 'Trad.', time_signature: '3/4', tempo: 96,
        });
    });

    it.each(['4/4', '3/4', '2/4', '2/2', '6/8'])('the time signature %s comes back', (sig) => {
        expect(setUp({ timeSignature: sig }).back.metadata.time_signature).toBe(sig);
    });

    it('capo comes back, on the track it was set on', () => {
        const { back } = setUp({ track: { capo: 2 } }, 'banjo');
        expect(back.tracks.find(t => t.id === 'banjo').capo).toBe(2);
        expect(back.tracks.find(t => t.id === 'guitar').capo).toBe(0);
    });

    it('a changed tuning comes back, string for string, and the notes keep their frets', () => {
        const double = TUNING_PRESETS['5-string-banjo'].find(([n]) => n === 'Double C')[1];
        const { back, before } = setUp({ track: { tuning: double } }, 'banjo');
        expect(back.tracks.find(t => t.id === 'banjo').tuning).toEqual(double);
        const frets = (otf) => otf.notation.banjo[0].events[0].notes.map(n => [n.s, n.f]).sort();
        expect(frets(back)).toEqual(frets(before));
    });

    it('every preset of every instrument comes back as it was set', () => {
        for (const [instrument, presets] of Object.entries(TUNING_PRESETS)) {
            for (const [name, pitches] of presets) {
                const { back } = setUp({ track: { tuning: pitches } }, undefined, [instrument]);
                expect(back.tracks[0].tuning, `${instrument} ${name}`).toEqual(pitches);
            }
        }
    });

    it('a capo with a changed 5-string banjo tuning still reads back', () => {
        const { back } = setUp({ track: { capo: 2, tuning: ['D4', 'C4', 'G3', 'C3', 'G4'] } }, 'banjo');
        const banjo = back.tracks.find(t => t.id === 'banjo');
        expect(banjo.capo).toBe(2);
        expect(banjo.tuning).toEqual(['D4', 'C4', 'G3', 'C3', 'G4']);
    });

    it('a track with a string more comes back with that many strings', () => {
        const seven = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2', 'B1'];
        const { back } = setUp({ track: { tuning: seven } }, 'guitar');
        expect(back.tracks.find(t => t.id === 'guitar').tuning).toEqual(seven);
    });

    it('the key does not survive: the writer counts it as a notice', () => {
        const { back, notices } = setUp({ key: 'G' });
        expect(notices.key_not_written).toBe(1);
        expect(noticeLine(notices)).toBe('Changed when saved as .tef: 1 key name not written.');
        expect(back.metadata.key || '').toBe('');
    });

    it('a track\'s instrument comes back only if its name still says the same thing', () => {
        // The writer names a track from its id, and the importer reads the instrument back
        // from that name. banjo -> tenor-banjo keeps the id "banjo": the importer says 5-string.
        const { back, notices } = setUp({ track: { instrument: 'tenor-banjo' } }, 'banjo');
        expect(back.tracks.find(t => t.id === 'banjo').instrument).toBe('5-string-banjo');
        expect(notices.track_details_changed).toBeGreaterThan(0);
    });
});
